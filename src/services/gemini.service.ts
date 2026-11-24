import { randomUUID } from 'node:crypto';
import { config } from '../config/env';
import type { Agent } from '../types';

type GeminiModel = {
  name: string;
  supportedGenerationMethods?: string[];
};

type GeminiTokenResponse = {
  name?: string;
  error?: { message?: string };
};

export type GeminiSessionResponse = {
  sessionId: string;
  status: 'ready';
  model: string;
  provider: 'Google Gemini';
  message: string;
  ephemeralToken: string;
  websocketUrl: string;
  voiceName: string;
  systemInstruction: string;
  welcomeMessage: string;
};

export class GeminiServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = 'GeminiServiceError';
  }
}

const apiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
const websocketBaseUrl =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

function supportsLiveAudio(modelName: string): boolean {
  const model = modelName.replace(/^models\//, '');
  return /^gemini-(?:3\.8-live(?:-extended-thinking)?|3\.1-flash-live-preview|2\.5-flash-native-audio(?:-.+)?)$/i.test(model);
}

async function fetchGemini(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new GeminiServiceError('The Gemini API request timed out after 60 seconds. Please try again.', 504);
    }
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new GeminiServiceError(`Could not connect to the Gemini API.${detail}`, 502);
  }
}

async function getLiveModel(): Promise<string> {
  const headers = { 'x-goog-api-key': config.geminiApiKey };
  const configuredModel = config.geminiLiveModel.replace(/^models\//, '');
  const configuredResponse = await fetchGemini(
    `${apiBaseUrl}/models/${encodeURIComponent(configuredModel)}`,
    { headers },
  );

  if (configuredResponse.ok) {
    const model = (await configuredResponse.json()) as GeminiModel;
    if (
      model.supportedGenerationMethods?.includes('bidiGenerateContent') &&
      supportsLiveAudio(model.name)
    ) {
      return model.name.replace(/^models\//, '');
    }
  }

  const modelsResponse = await fetchGemini(`${apiBaseUrl}/models?pageSize=1000`, { headers });
  const modelsBody = (await modelsResponse.json()) as {
    models?: GeminiModel[];
    error?: { message?: string };
  };
  if (!modelsResponse.ok) {
    throw new GeminiServiceError(
      modelsBody.error?.message ?? 'Could not retrieve available Gemini Live models.',
      502,
    );
  }

  const liveModels = (modelsBody.models ?? []).filter(
    (model) =>
      model.supportedGenerationMethods?.includes('bidiGenerateContent') &&
      supportsLiveAudio(model.name),
  );
  const selectedModel =
    liveModels.find((model) => model.name === 'models/gemini-3.8-live') ??
    liveModels.find((model) => model.name === 'models/gemini-3.1-flash-live-preview') ??
    liveModels.find((model) => model.name === 'models/gemini-2.5-flash-native-audio-latest') ??
    liveModels[0];

  if (!selectedModel) {
    throw new GeminiServiceError(
      `The configured Gemini Live model "${configuredModel}" is unavailable, and no supported Live model was found for this API key.`,
      503,
    );
  }

  return selectedModel.name.replace(/^models\//, '');
}

async function createLiveToken(): Promise<string> {
  const now = Date.now();
  const response = await fetchGemini(`${apiBaseUrl}/auth_tokens`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': config.geminiApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      uses: 1,
      expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
      newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
    }),
  });
  const body = (await response.json()) as GeminiTokenResponse;

  if (!response.ok || !body.name) {
    throw new GeminiServiceError(
      body.error?.message ?? 'Gemini did not issue a short-lived Live session token.',
      502,
    );
  }
  return body.name;
}

export class GeminiService {
  static async createVoicePreviewSession(voice: string, timeZone = 'UTC'): Promise<GeminiSessionResponse> {
    return this.createVoiceSession({
      id: 'voice-preview',
      userId: '',
      name: 'Voice preview',
      description: 'Voice preview',
      status: 'active',
      avatar: '/agent01.jpg',
      model: config.geminiLiveModel,
      voice,
      language: 'English',
      instructions: 'Use the time-appropriate greeting specified in the system instructions, then say the voice preview welcome message exactly once. Do not substitute a different time-of-day greeting.',
      welcomeMessage: `Hello there. This is a preview of the ${voice} voice.`,
      conversationScript: '',
      speakingStyle: 'Natural and friendly',
      responseBehavior: 'Balanced',
      temperature: 0.7,
      knowledgeDocumentIds: [],
      deployment: { browserVoice: true, inboundCalls: false, outboundCalls: false },
      conversationCount: 0,
      lastActive: 'just now',
    }, [], timeZone);
  }

  static async embedTexts(
    texts: string[],
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  ): Promise<number[][]> {
    if (!config.geminiApiKey) {
      throw new GeminiServiceError('GEMINI_API_KEY is not configured on the backend.', 503);
    }

    const embeddings: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += 32) {
      const batch = texts.slice(offset, offset + 32);
      const response = await fetchGemini(
        `${apiBaseUrl}/models/${encodeURIComponent(config.geminiEmbeddingModel)}:batchEmbedContents`,
        {
          method: 'POST',
          headers: {
            'x-goog-api-key': config.geminiApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model: `models/${config.geminiEmbeddingModel}`,
              content: { parts: [{ text }] },
              taskType,
              outputDimensionality: config.geminiEmbeddingDimensions,
            })),
          }),
        },
      );
      const body = (await response.json()) as {
        embeddings?: Array<{ values?: number[] }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        throw new GeminiServiceError(
          body.error?.message ?? 'Gemini could not generate document embeddings.',
          502,
        );
      }

      const batchEmbeddings = body.embeddings?.map((embedding) => embedding.values ?? []);
      if (
        !batchEmbeddings ||
        batchEmbeddings.length !== batch.length ||
        batchEmbeddings.some((embedding) => embedding.length !== config.geminiEmbeddingDimensions || embedding.some((value) => !Number.isFinite(value)))
      ) {
        throw new GeminiServiceError('Gemini returned invalid document embeddings.', 502);
      }

      embeddings.push(...batchEmbeddings);
    }

    return embeddings;
  }

  static async createVoiceSession(
    agent: Agent,
    documentContexts: Array<{ name: string; content: string }> = [],
    timeZone = 'UTC',
  ): Promise<GeminiSessionResponse> {
    if (!config.geminiApiKey) {
      throw new GeminiServiceError('GEMINI_API_KEY is not configured on the backend.', 503);
    }

    const model = await getLiveModel();
    const ephemeralToken = await createLiveToken();

    const localTime = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date());
    const localHour = Number(localTime.split(':')[0]);
    const timeGreeting = localHour < 12 ? 'Good morning' : localHour < 17 ? 'Good afternoon' : 'Good evening';
    const identity = agent.name ? `You are ${agent.name}, a voice AI agent.` : 'You are a voice AI agent.';
    const systemInstruction = [
      identity,
      `Speak naturally and clearly in ${agent.language || 'English'}.`,
      agent.instructions,
      'Respond in complete, natural sentences. Give enough detail to fully answer what the caller asked; do not make answers so brief that important information is missing. Usually use one to three sentences for a simple question and expand when the caller asks for details or the topic needs it. Keep spoken responses easy to follow and avoid unnecessary repetition.',
      `The caller's local time is ${localTime} (${timeZone}). Begin promptly with "${timeGreeting}", identify yourself as ${agent.name || 'the voice assistant'}, then continue with the configured welcome message: "${agent.welcomeMessage}". Remove any greeting at the beginning of that message if it would repeat or conflict with the time-appropriate greeting. Mention the business or salon name only if it is stated in the knowledge-base documents; never guess it.`,
      `Follow this conversation script as a flexible step-by-step flow; do not recite it all at once: ${agent.conversationScript || 'Greet the caller, ask how you can help, answer one step at a time, and thank them before ending.'}`,
      'Treat the final step of the configured conversation script as a required ending: once all script steps are complete, say a brief final farewell, then call end_call immediately after the farewell without waiting for another caller response. Do not end before completing the script. If the caller clearly says they are done before the script is complete, give a brief farewell and call end_call. Never leave the call open after saying goodbye. If tool calling is unavailable, include [END_CALL] only after the spoken farewell.',
      'For business-specific questions, use the knowledge-base documents as the source of truth. If the documents do not provide the answer, say so clearly and offer an appropriate next step; do not invent business details.',
      ...(documentContexts.length > 0
        ? [
            documentContexts
              .map(({ name, content }) => `DOCUMENT: ${name}\n${content}`)
              .join('\n\n---\n\n')
              .slice(0, 40000),
          ]
        : []),
    ].join(' ');

    return {
      sessionId: randomUUID(),
      status: 'ready',
      model,
      provider: 'Google Gemini',
      message: `Secure Live token ready for ${agent.name}. Connect your microphone to start speaking.`,
      ephemeralToken,
      websocketUrl: websocketBaseUrl,
      voiceName: agent.voice,
      systemInstruction,
      welcomeMessage: agent.welcomeMessage,
    };
  }
}
