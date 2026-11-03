import mongoose from 'mongoose';
import { config } from '../config/env';
import { DocumentChunkModel } from '../models/documentChunk.model';
import { GeminiService } from './gemini.service';

const embeddingDimensions = config.geminiEmbeddingDimensions;
const chunkSize = 1200;
const chunkOverlap = 180;
const retrievalLimit = 8;

export class RagServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'RagServiceError';
  }
}

export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const chunks: string[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);
    if (end < normalized.length) {
      const boundary = normalized.lastIndexOf(' ', end);
      if (boundary > start + chunkSize * 0.6) end = boundary;
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= normalized.length) break;

    start = Math.max(start + 1, end - chunkOverlap);
    while (start < normalized.length && /\s/.test(normalized[start])) start += 1;
  }

  return chunks;
}

let vectorIndexPromise: Promise<void> | undefined;
let vectorIndexReady = false;

async function createOrWaitForVectorIndex(): Promise<void> {
  const collection = DocumentChunkModel.collection;
  const indexName = config.mongoVectorIndexName;

  try {
    let indexes = await collection.listSearchIndexes(indexName).toArray();
    if (indexes.length === 0) {
      try {
        await collection.createSearchIndex({
          name: indexName,
          type: 'vectorSearch',
          definition: {
            fields: [
              {
                type: 'vector',
                path: 'embedding',
                numDimensions: embeddingDimensions,
                similarity: 'cosine',
              },
              { type: 'filter', path: 'userId' },
            ],
          },
        });
      } catch (createError) {
        indexes = await collection.listSearchIndexes(indexName).toArray();
        if (indexes.length === 0) throw createError;
      }
    }

    for (let attempt = 0; attempt < 60; attempt += 1) {
      indexes = await collection.listSearchIndexes(indexName).toArray();
      const index = indexes[0] as {
        status?: string;
        queryable?: boolean;
        definition?: { fields?: Array<{ path?: string; numDimensions?: number }> };
        latestDefinition?: { fields?: Array<{ path?: string; numDimensions?: number }> };
      } | undefined;
      const fields = index?.latestDefinition?.fields ?? index?.definition?.fields;
      const indexedDimensions = fields?.find((field) => field.path === 'embedding')?.numDimensions;
      if (index?.status === 'READY' && index.queryable !== false) {
        if (indexedDimensions !== embeddingDimensions) {
          throw new RagServiceError(
            `Atlas vector index "${indexName}" uses ${indexedDimensions ?? 'unknown'} dimensions, but the configured Gemini embeddings use ${embeddingDimensions}. Update the Atlas index and reindex existing documents.`,
            503,
          );
        }
        return;
      }
      if (index?.status === 'FAILED') {
        throw new Error(`Atlas reported that vector index "${indexName}" failed to build.`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Timed out waiting for Atlas vector index "${indexName}" to become ready.`);
  } catch (error) {
    if (error instanceof RagServiceError) throw error;
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new RagServiceError(
      `MongoDB Atlas Vector Search could not prepare index "${indexName}". Configure MONGODB_URI for a supported Atlas cluster and allow the database user to manage search indexes.${detail}`,
      503,
    );
  }
}

async function ensureVectorIndex(): Promise<void> {
  if (vectorIndexReady) return;
  if (!vectorIndexPromise) {
    vectorIndexPromise = createOrWaitForVectorIndex()
      .then(() => {
        vectorIndexReady = true;
      })
      .catch((error: unknown) => {
        vectorIndexPromise = undefined;
        throw error;
      });
  }
  await vectorIndexPromise;
}

export class RagService {
  static async indexDocument(input: {
    userId: string;
    documentId: string;
    documentName: string;
    content: string;
  }): Promise<number> {
    if (mongoose.connection.readyState !== 1) {
      throw new RagServiceError('Document indexing requires a connected MongoDB Atlas database.', 503);
    }

    const chunks = chunkText(input.content);
    if (chunks.length === 0) {
      throw new RagServiceError('No readable text was found to index.', 422);
    }

    const embeddings = await GeminiService.embedTexts(chunks, 'RETRIEVAL_DOCUMENT');
    const userId = new mongoose.Types.ObjectId(input.userId);
    const documentId = new mongoose.Types.ObjectId(input.documentId);

    await DocumentChunkModel.deleteMany({ userId, documentId });
    await DocumentChunkModel.insertMany(
      chunks.map((text, chunkIndex) => ({
        userId,
        documentId,
        documentName: input.documentName,
        chunkIndex,
        text,
        embedding: embeddings[chunkIndex],
      })),
    );
    await ensureVectorIndex();

    return chunks.length;
  }

  static async findRelevantChunks(userId: string, question: string): Promise<Array<{ name: string; content: string }>> {
    if (mongoose.connection.readyState !== 1) {
      throw new RagServiceError('Document search requires a connected MongoDB Atlas database.', 503);
    }

    await ensureVectorIndex();
    const [queryEmbedding] = await GeminiService.embedTexts([question], 'RETRIEVAL_QUERY');
    const results = await DocumentChunkModel.collection
      .aggregate<{ documentName: string; text: string }>([
        {
          $vectorSearch: {
            index: config.mongoVectorIndexName,
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: Math.max(retrievalLimit * 20, 100),
            limit: retrievalLimit,
            filter: { userId: new mongoose.Types.ObjectId(userId) },
          },
        },
        { $project: { _id: 0, documentName: 1, text: 1 } },
      ])
      .toArray();

    return results.map((result) => ({ name: result.documentName, content: result.text }));
  }

  static async findBestMatchingDocumentId(userId: string, question: string): Promise<string | undefined> {
    if (mongoose.connection.readyState !== 1) {
      throw new RagServiceError('Document search requires a connected MongoDB Atlas database.', 503);
    }

    await ensureVectorIndex();
    const [queryEmbedding] = await GeminiService.embedTexts([question], 'RETRIEVAL_QUERY');
    const [match] = await DocumentChunkModel.collection
      .aggregate<{ documentId: mongoose.Types.ObjectId }>([
        {
          $vectorSearch: {
            index: config.mongoVectorIndexName,
            path: 'embedding',
            queryVector: queryEmbedding,
            numCandidates: Math.max(retrievalLimit * 20, 100),
            limit: 1,
            filter: { userId: new mongoose.Types.ObjectId(userId) },
          },
        },
        { $project: { _id: 0, documentId: 1 } },
      ])
      .toArray();

    return match ? String(match.documentId) : undefined;
  }
}
