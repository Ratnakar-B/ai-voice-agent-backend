import dotenv from 'dotenv';

dotenv.config();

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  sessionSecret: process.env.SESSION_SECRET ?? process.env.JWT_SECRET ?? 'dev-secret',
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
