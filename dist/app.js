"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const node_http_1 = require("node:http");
const node_fs_1 = require("node:fs");
const env_1 = require("./config/env");
const errorMiddleware_1 = require("./middleware/errorMiddleware");
const connection_1 = require("./database/connection");
const auth_route_1 = __importDefault(require("./routes/auth.route"));
const agents_route_1 = __importDefault(require("./routes/agents.route"));
const conversations_route_1 = __importDefault(require("./routes/conversations.route"));
const dashboard_route_1 = __importDefault(require("./routes/dashboard.route"));
const documents_route_1 = __importDefault(require("./routes/documents.route"));
const voice_route_1 = __importDefault(require("./routes/voice.route"));
const gemini_transcription_proxy_1 = require("./services/gemini-transcription-proxy");
const app = (0, express_1.default)();
(0, node_fs_1.mkdirSync)(env_1.config.uploadDir, { recursive: true });
app.use((0, cors_1.default)({
    origin: (origin, callback) => {
        const isLocalDevelopmentOrigin = env_1.config.nodeEnv === 'development' &&
            origin !== undefined &&
            /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
        if (!origin || env_1.config.allowedOrigins.includes(origin) || isLocalDevelopmentOrigin) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'voice-pilot-api' });
});
app.use('/api/auth', auth_route_1.default);
app.use('/api/agents', agents_route_1.default);
app.use('/api/documents', documents_route_1.default);
app.use('/api/conversations', conversations_route_1.default);
app.use('/api/dashboard', dashboard_route_1.default);
app.use('/api/voice', voice_route_1.default);
app.use(errorMiddleware_1.errorMiddleware);
void (0, connection_1.connectDatabase)().then(() => {
    const server = (0, node_http_1.createServer)(app);
    (0, gemini_transcription_proxy_1.attachGeminiTranscriptionProxy)(server);
    server.listen(env_1.config.port, () => {
        console.log(`VoicePilot API running on http://localhost:${env_1.config.port}`);
    });
});
