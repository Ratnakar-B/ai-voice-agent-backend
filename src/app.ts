import cors from 'cors';
import express from 'express';
import { mkdirSync } from 'node:fs';
import { config } from './config/env';
import { errorMiddleware } from './middleware/errorMiddleware';
import { connectDatabase } from './database/connection';
import authRouter from './routes/auth.route';
import agentsRouter from './routes/agents.route';
import conversationsRouter from './routes/conversations.route';
import dashboardRouter from './routes/dashboard.route';
import documentsRouter from './routes/documents.route';
import voiceRouter from './routes/voice.route';

const app = express();

mkdirSync(config.uploadDir, { recursive: true });

app.use(
  cors({
    origin: (origin, callback) => {
      const isLocalDevelopmentOrigin =
        config.nodeEnv === 'development' &&
        origin !== undefined &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

      if (!origin || config.allowedOrigins.includes(origin) || isLocalDevelopmentOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'voice-pilot-api' });
});

app.use('/api/auth', authRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/voice', voiceRouter);

app.use(errorMiddleware);

void connectDatabase().then(() => {
  app.listen(config.port, () => {
    console.log(`VoicePilot API running on http://localhost:${config.port}`);
  });
});
