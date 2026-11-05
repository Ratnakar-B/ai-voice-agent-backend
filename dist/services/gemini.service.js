"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiService = exports.GeminiServiceError = void 0;
const node_crypto_1 = require("node:crypto");
const env_1 = require("../config/env");
class GeminiServiceError extends Error {
    statusCode;
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'GeminiServiceError';
    }
}
exports.GeminiServiceError = GeminiServiceError;
const apiBaseUrl = 'https://generativelanguage.googleapis.com/v1beta';
const websocketBaseUrl = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';
async function fetchGemini(url, init) {
    try {
        return await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(20000),
        });
    }
    catch (error) {
        if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
            throw new GeminiServiceError('The Gemini API request timed out. Please try again.', 504);
        }
        const detail = error instanceof Error ? ` ${error.message}` : '';
        throw new GeminiServiceError(`Could not connect to the Gemini API.${detail}`, 502);
    }
}
async function getLiveModel() {
    const headers = { 'x-goog-api-key': env_1.config.geminiApiKey };
    const configuredModel = env_1.config.geminiLiveModel.replace(/^models\//, '');
    const configuredResponse = await fetchGemini(`${apiBaseUrl}/models/${encodeURIComponent(configuredModel)}`, { headers });
    if (configuredResponse.ok) {
        const model = (await configuredResponse.json());
        if (model.supportedGenerationMethods?.includes('bidiGenerateContent')) {
            return model.name.replace(/^models\//, '');
        }
    }
    const modelsResponse = await fetchGemini(`${apiBaseUrl}/models?pageSize=1000`, { headers });
    const modelsBody = (await modelsResponse.json());
    if (!modelsResponse.ok) {
        throw new GeminiServiceError(modelsBody.error?.message ?? 'Could not retrieve available Gemini Live models.', 502);
    }
    const liveModels = (modelsBody.models ?? []).filter((model) => model.supportedGenerationMethods?.includes('bidiGenerateContent'));
    const selectedModel = liveModels.find((model) => model.name === 'models/gemini-2.5-flash-native-audio-latest') ??
        liveModels.find((model) => /native-audio-latest$/.test(model.name)) ??
        liveModels.find((model) => /live/i.test(model.name));
    if (!selectedModel) {
        throw new GeminiServiceError(`The configured Gemini Live model "${configuredModel}" is unavailable, and no supported Live model was found for this API key.`, 503);
    }
    return selectedModel.name.replace(/^models\//, '');
}
async function getContentModels() {
    const headers = { 'x-goog-api-key': env_1.config.geminiApiKey };
    const configuredModel = env_1.config.geminiModel.replace(/^models\//, '');
    const modelsResponse = await fetchGemini(`${apiBaseUrl}/models?pageSize=1000`, { headers });
    const modelsBody = (await modelsResponse.json());
    if (!modelsResponse.ok) {
        throw new GeminiServiceError(modelsBody.error?.message ?? 'Could not retrieve available Gemini text models.', 502);
    }
    const contentModels = (modelsBody.models ?? []).filter((model) => model.supportedGenerationMethods?.includes('generateContent'));
    const priorities = [
        'gemini-3.8-flash',
        ...(configuredModel === 'gemini-2.5-flash' ? [] : [configuredModel]),
        'gemini-3.7-flash',
        'gemini-3.6-flash',
        'gemini-flash-latest',
        'gemini-3.5-flash',
    ];
    const orderedModels = priorities
        .map((name) => contentModels.find((model) => model.name === `models/${name}`))
        .filter((model) => model !== undefined);
    for (const model of contentModels) {
        if (/gemini-.*-flash(?:-latest)?$/.test(model.name) && !orderedModels.includes(model)) {
            orderedModels.push(model);
        }
    }
    if (orderedModels.length === 0) {
        throw new GeminiServiceError(`The configured Gemini text model "${configuredModel}" is unavailable, and no supported content model was found for this API key.`, 503);
    }
    return orderedModels.slice(0, 3).map((model) => model.name.replace(/^models\//, ''));
}
async function createLiveToken() {
    const now = Date.now();
    const response = await fetchGemini(`${apiBaseUrl}/auth_tokens`, {
        method: 'POST',
        headers: {
            'x-goog-api-key': env_1.config.geminiApiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            uses: 1,
            expireTime: new Date(now + 30 * 60 * 1000).toISOString(),
            newSessionExpireTime: new Date(now + 60 * 1000).toISOString(),
        }),
    });
    const body = (await response.json());
    if (!response.ok || !body.name) {
        throw new GeminiServiceError(body.error?.message ?? 'Gemini did not issue a short-lived Live session token.', 502);
    }
    return body.name;
}
class GeminiService {
    static async createVoicePreviewSession(voice) {
        return this.createVoiceSession({
            id: 'voice-preview',
            userId: '',
            name: 'Voice preview',
            description: 'Voice preview',
            status: 'active',
            avatar: '/agent01.jpg',
            model: env_1.config.geminiLiveModel,
            voice,
            language: 'English',
            instructions: 'Speak the preview greeting exactly as written, without adding anything.',
            welcomeMessage: `Hello there. This is a preview of the ${voice} voice.`,
            conversationScript: '',
            speakingStyle: 'Natural and friendly',
            responseBehavior: 'Balanced',
            temperature: 0.7,
            knowledgeDocumentIds: [],
            deployment: { browserVoice: true, inboundCalls: false, outboundCalls: false },
            conversationCount: 0,
            lastActive: 'just now',
        }, [], 'UTC');
    }
    static async embedTexts(texts, taskType) {
        if (!env_1.config.geminiApiKey) {
            throw new GeminiServiceError('GEMINI_API_KEY is not configured on the backend.', 503);
        }
        const embeddings = [];
        for (let offset = 0; offset < texts.length; offset += 32) {
            const batch = texts.slice(offset, offset + 32);
            const response = await fetchGemini(`${apiBaseUrl}/models/${encodeURIComponent(env_1.config.geminiEmbeddingModel)}:batchEmbedContents`, {
                method: 'POST',
                headers: {
                    'x-goog-api-key': env_1.config.geminiApiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    requests: batch.map((text) => ({
                        model: `models/${env_1.config.geminiEmbeddingModel}`,
                        content: { parts: [{ text }] },
                        taskType,
                        outputDimensionality: env_1.config.geminiEmbeddingDimensions,
                    })),
                }),
            });
            const body = (await response.json());
            if (!response.ok) {
                throw new GeminiServiceError(body.error?.message ?? 'Gemini could not generate document embeddings.', 502);
            }
            const batchEmbeddings = body.embeddings?.map((embedding) => embedding.values ?? []);
            if (!batchEmbeddings ||
                batchEmbeddings.length !== batch.length ||
                batchEmbeddings.some((embedding) => embedding.length !== env_1.config.geminiEmbeddingDimensions || embedding.some((value) => !Number.isFinite(value)))) {
                throw new GeminiServiceError('Gemini returned invalid document embeddings.', 502);
            }
            embeddings.push(...batchEmbeddings);
        }
        return embeddings;
    }
    static async answerFromDocuments(question, documentContexts, options = {}) {
        if (!env_1.config.geminiApiKey) {
            throw new GeminiServiceError('GEMINI_API_KEY is not configured on the backend.', 503);
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
        const models = await getContentModels();
        let lastFailure = 'Gemini could not answer from the uploaded documents.';
        for (const model of models) {
            try {
                const response = await fetchGemini(`${apiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
                    method: 'POST',
                    headers: {
                        'x-goog-api-key': env_1.config.geminiApiKey,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        systemInstruction: {
                            parts: [
                                {
                                    text: systemInstruction,
                                },
                            ],
                        },
                        contents: [
                            {
                                role: 'user',
                                parts: [{ text: `Question: ${question}\n\nDocument excerpts:\n${context}` }],
                            },
                        ],
                    }),
                });
                const body = (await response.json());
                if (response.ok) {
                    const answer = body.candidates?.[0]?.content?.parts
                        ?.map((part) => part.text ?? '')
                        .join('')
                        .trim();
                    if (answer)
                        return answer;
                    throw new GeminiServiceError('Gemini returned an empty answer for the document question.', 502);
                }
                lastFailure = body.error?.message ?? lastFailure;
                if (response.status !== 400 && response.status !== 404 && response.status !== 429 && response.status !== 503) {
                    break;
                }
            }
            catch (error) {
                if (!(error instanceof GeminiServiceError) || error.statusCode !== 504)
                    throw error;
                lastFailure = error.message;
            }
        }
        throw new GeminiServiceError(lastFailure, 502);
    }
    static async createVoiceSession(agent, documentContexts = [], timeZone = 'UTC') {
        if (!env_1.config.geminiApiKey) {
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
            sessionId: (0, node_crypto_1.randomUUID)(),
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
exports.GeminiService = GeminiService;
