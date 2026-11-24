import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { config } from '../config/env';
import { getChatModel } from '../config/llm';
import { GeminiServiceError } from './gemini.service';

export async function answerFromDocuments(
  question: string,
  documentContexts: Array<{ name: string; content: string }>,
  options: { comprehensive?: boolean } = {},
): Promise<string> {
  if (!config.geminiApiKey) {
    throw new GeminiServiceError('GEMINI_API_KEY is not configured on the backend.', 503);
  }

  if (!config.geminiModel.trim()) {
    throw new GeminiServiceError('GEMINI_MODEL is not configured on the backend.', 503);
  }

  if (config.geminiModel.toLowerCase().includes('live')) {
    throw new GeminiServiceError(
      'GEMINI_MODEL must be a text-generation model, not a Gemini Live model. Use gemini-3.8-flash for knowledge-base answers and set GEMINI_LIVE_MODEL separately for voice sessions.',
      503,
    );
  }

  if (options.comprehensive && documentContexts.length === 0) {
    throw new GeminiServiceError('Upload a document before asking a knowledge-base question.', 400);
  }

  const context = documentContexts
    .map(({ name, content }) => `DOCUMENT: ${name}\n${content}`)
    .join('\n\n---\n\n')
    .slice(0, options.comprehensive ? 100000 : 40000);
  const systemInstruction = options.comprehensive
    ? 'Answer using only the supplied complete document text. The user wants comprehensive details, so explain the document section by section in the original order, covering the key facts, instructions, people, dates, numbers, and conclusions present. Do not limit the answer to the first sections or only the most relevant passages. Do not invent details; clearly identify information the document does not contain. Summarize faithfully rather than claiming to reproduce text verbatim.'
    : 'Use the supplied document excerpts as the primary source. If the user asks what a document says or asks a document-specific question, answer only from the excerpts and say when they do not contain the answer. For general-knowledge questions that the excerpts do not cover, answer from your general knowledge and clearly preface that part with "The uploaded documents do not cover this; from general knowledge:". If the excerpts answer only part of the question, separate the document-supported answer from any general-knowledge addition. Never imply general knowledge came from the uploaded documents, and do not invent document contents.';

  const requestStartedAt = Date.now();
  try {
    const response = await getChatModel().invoke(
      [
        new SystemMessage(systemInstruction),
        new HumanMessage(
          `Question: ${question}\n\nDocument excerpts:\n${context || '(No relevant excerpts were found in the uploaded documents.)'}`,
        ),
      ],
      { timeout: 120_000 },
    );
    const answer = response.text.trim();

    if (!answer) {
      throw new GeminiServiceError('Gemini returned an empty answer for the document question.', 502);
    }

    return answer;
  } catch (error) {
    if (error instanceof GeminiServiceError) throw error;

    const errorDetails: Record<string, string | number> = {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      model: config.geminiModel,
      durationMs: Date.now() - requestStartedAt,
    };
    if (error instanceof Error && error.cause instanceof Error) {
      errorDetails.causeMessage = error.cause.message;
    }
    if (typeof error === 'object' && error !== null) {
      const details = error as Record<string, unknown>;
      if (typeof details.code === 'string') errorDetails.errorCode = details.code;
      if (typeof details.status === 'number') errorDetails.httpStatus = details.status;
      else if (typeof details.statusCode === 'number') errorDetails.httpStatus = details.statusCode;
    }
    const isTimeout =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const isUnavailableModel =
      errorDetails.httpStatus === 404 && /model/i.test(String(errorDetails.errorMessage));
    console.error('LangChain document answer generation failed.', errorDetails);
    throw new GeminiServiceError(
      isTimeout
        ? 'The Gemini API request timed out after 120 seconds. Please try again.'
        : isUnavailableModel
          ? 'The configured Gemini model is unavailable. Set GEMINI_MODEL to a supported text-generation model such as gemini-3.8-flash.'
        : 'Gemini could not answer the question.',
      isTimeout ? 504 : isUnavailableModel ? 503 : 502,
    );
  }
}
