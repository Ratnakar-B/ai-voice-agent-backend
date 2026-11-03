"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const jwtSecret = process.env.JWT_SECRET?.trim();
if (!jwtSecret) {
    throw new Error('JWT_SECRET must be set in the backend environment before starting the API.');
}
exports.config = {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: Number(process.env.PORT ?? 4000),
    jwtSecret,
    sessionSecret: process.env.SESSION_SECRET?.trim() || jwtSecret,
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    mongodbUri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/voicepilot',
    mongodbDbName: process.env.MONGODB_DB_NAME ?? 'voicepilot',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.8-flash',
    geminiEmbeddingModel: process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    geminiEmbeddingDimensions: Number(process.env.GEMINI_EMBEDDING_DIMENSIONS ?? 3072),
    geminiLiveModel: process.env.GEMINI_LIVE_MODEL ?? 'gemini-2.5-flash-native-audio-latest',
    mongoVectorIndexName: process.env.MONGODB_VECTOR_INDEX ?? 'document_chunks_vector_index',
};
