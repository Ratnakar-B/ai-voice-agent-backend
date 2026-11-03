"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RagService = exports.RagServiceError = void 0;
exports.chunkText = chunkText;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("../config/env");
const documentChunk_model_1 = require("../models/documentChunk.model");
const gemini_service_1 = require("./gemini.service");
const embeddingDimensions = env_1.config.geminiEmbeddingDimensions;
const chunkSize = 1200;
const chunkOverlap = 180;
const retrievalLimit = 8;
class RagServiceError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'RagServiceError';
    }
}
exports.RagServiceError = RagServiceError;
function chunkText(text) {
    const normalized = text.replace(/\r\n?/g, '\n').trim();
    const chunks = [];
    let start = 0;
    while (start < normalized.length) {
        let end = Math.min(start + chunkSize, normalized.length);
        if (end < normalized.length) {
            const boundary = normalized.lastIndexOf(' ', end);
            if (boundary > start + chunkSize * 0.6)
                end = boundary;
        }
        const chunk = normalized.slice(start, end).trim();
        if (chunk)
            chunks.push(chunk);
        if (end >= normalized.length)
            break;
        start = Math.max(start + 1, end - chunkOverlap);
        while (start < normalized.length && /\s/.test(normalized[start]))
            start += 1;
    }
    return chunks;
}
let vectorIndexPromise;
let vectorIndexReady = false;
async function createOrWaitForVectorIndex() {
    const collection = documentChunk_model_1.DocumentChunkModel.collection;
    const indexName = env_1.config.mongoVectorIndexName;
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
            }
            catch (createError) {
                indexes = await collection.listSearchIndexes(indexName).toArray();
                if (indexes.length === 0)
                    throw createError;
            }
        }
        for (let attempt = 0; attempt < 60; attempt += 1) {
            indexes = await collection.listSearchIndexes(indexName).toArray();
            const index = indexes[0];
            const fields = index?.latestDefinition?.fields ?? index?.definition?.fields;
            const indexedDimensions = fields?.find((field) => field.path === 'embedding')?.numDimensions;
            if (index?.status === 'READY' && index.queryable !== false) {
                if (indexedDimensions !== embeddingDimensions) {
                    throw new RagServiceError(`Atlas vector index "${indexName}" uses ${indexedDimensions ?? 'unknown'} dimensions, but the configured Gemini embeddings use ${embeddingDimensions}. Update the Atlas index and reindex existing documents.`, 503);
                }
                return;
            }
            if (index?.status === 'FAILED') {
                throw new Error(`Atlas reported that vector index "${indexName}" failed to build.`);
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        throw new Error(`Timed out waiting for Atlas vector index "${indexName}" to become ready.`);
    }
    catch (error) {
        if (error instanceof RagServiceError)
            throw error;
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new RagServiceError(`MongoDB Atlas Vector Search could not prepare index "${indexName}". Configure MONGODB_URI for a supported Atlas cluster and allow the database user to manage search indexes.${detail}`, 503);
    }
}
async function ensureVectorIndex() {
    if (vectorIndexReady)
        return;
    if (!vectorIndexPromise) {
        vectorIndexPromise = createOrWaitForVectorIndex()
            .then(() => {
            vectorIndexReady = true;
        })
            .catch((error) => {
            vectorIndexPromise = undefined;
            throw error;
        });
    }
    await vectorIndexPromise;
}
class RagService {
    static async indexDocument(input) {
        if (mongoose_1.default.connection.readyState !== 1) {
            throw new RagServiceError('Document indexing requires a connected MongoDB Atlas database.', 503);
        }
        const chunks = chunkText(input.content);
        if (chunks.length === 0) {
            throw new RagServiceError('No readable text was found to index.', 422);
        }
        const embeddings = await gemini_service_1.GeminiService.embedTexts(chunks, 'RETRIEVAL_DOCUMENT');
        const userId = new mongoose_1.default.Types.ObjectId(input.userId);
        const documentId = new mongoose_1.default.Types.ObjectId(input.documentId);
        await documentChunk_model_1.DocumentChunkModel.deleteMany({ userId, documentId });
        await documentChunk_model_1.DocumentChunkModel.insertMany(chunks.map((text, chunkIndex) => ({
            userId,
            documentId,
            documentName: input.documentName,
            chunkIndex,
            text,
            embedding: embeddings[chunkIndex],
        })));
        await ensureVectorIndex();
        return chunks.length;
    }
    static async findRelevantChunks(userId, question) {
        if (mongoose_1.default.connection.readyState !== 1) {
            throw new RagServiceError('Document search requires a connected MongoDB Atlas database.', 503);
        }
        await ensureVectorIndex();
        const [queryEmbedding] = await gemini_service_1.GeminiService.embedTexts([question], 'RETRIEVAL_QUERY');
        const results = await documentChunk_model_1.DocumentChunkModel.collection
            .aggregate([
            {
                $vectorSearch: {
                    index: env_1.config.mongoVectorIndexName,
                    path: 'embedding',
                    queryVector: queryEmbedding,
                    numCandidates: Math.max(retrievalLimit * 20, 100),
                    limit: retrievalLimit,
                    filter: { userId: new mongoose_1.default.Types.ObjectId(userId) },
                },
            },
            { $project: { _id: 0, documentName: 1, text: 1 } },
        ])
            .toArray();
        return results.map((result) => ({ name: result.documentName, content: result.text }));
    }
    static async findBestMatchingDocumentId(userId, question) {
        if (mongoose_1.default.connection.readyState !== 1) {
            throw new RagServiceError('Document search requires a connected MongoDB Atlas database.', 503);
        }
        await ensureVectorIndex();
        const [queryEmbedding] = await gemini_service_1.GeminiService.embedTexts([question], 'RETRIEVAL_QUERY');
        const [match] = await documentChunk_model_1.DocumentChunkModel.collection
            .aggregate([
            {
                $vectorSearch: {
                    index: env_1.config.mongoVectorIndexName,
                    path: 'embedding',
                    queryVector: queryEmbedding,
                    numCandidates: Math.max(retrievalLimit * 20, 100),
                    limit: 1,
                    filter: { userId: new mongoose_1.default.Types.ObjectId(userId) },
                },
            },
            { $project: { _id: 0, documentId: 1 } },
        ])
            .toArray();
        return match ? String(match.documentId) : undefined;
    }
}
exports.RagService = RagService;
