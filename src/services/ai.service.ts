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

  if (documentContexts.length === 0) {
    throw new GeminiServiceError('Upload a document before asking a knowledge-base question.', 400);
  }

  const context = documentContexts
    .map(({ name, content }) => `DOCUMENT: ${name}\n${content}`)
    .join('\n\n---\n\n')
    .slice(0, options.comprehensive ? 100000 : 40000);
  const systemInstruction = options.comprehensive
    ? 'Answer using only the supplied complete document text. The user wants comprehensive details, so explain the document section by section in the original order, covering the key facts, instructions, people, dates, numbers, and conclusions present. Do not limit the answer to the first sections or only the most relevant passages. Do not invent details; clearly identify information the document does not contain. Summarize faithfully rather than claiming to reproduce text verbatim.'
    : 'Answer using only the supplied document excerpts. If they do not contain the answer, say that the uploaded documents do not provide enough information. Do not invent facts or citations.';

  try {
    const response = await getChatModel().invoke(
      [
        new SystemMessage(systemInstruction),
        new HumanMessage(`Question: ${question}\n\nDocument excerpts:\n${context}`),
      ],
      { timeout: 20_000 },
    );
    const answer = response.text.trim();

    if (!answer) {
      throw new GeminiServiceError('Gemini returned an empty answer for the document question.', 502);
    }

    return answer;
  } catch (error) {
    if (error instanceof GeminiServiceError) throw error;

    const isTimeout =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    console.error('LangChain document answer generation failed.', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    throw new GeminiServiceError(
      isTimeout
        ? 'The Gemini API request timed out. Please try again.'
        : 'Gemini could not answer from the uploaded documents.',
      isTimeout ? 504 : 502,
    );
  }
}
