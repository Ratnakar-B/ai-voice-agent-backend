"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentModel = void 0;
const mongoose_1 = __importStar(require("mongoose"));
const agentSchema = new mongoose_1.Schema({
    userId: { type: mongoose_1.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    avatar: {
        type: String,
        enum: ['/agent01.jpg', '/agent02.jfif', '/agent03.jfif', '/agent04.jfif', '/agent05.jfif'],
        default: '/agent01.jpg',
    },
    model: { type: String, default: 'gemini-3.8-flash' },
    voice: { type: String, required: true },
    language: { type: String, required: true },
    instructions: { type: String, default: 'Be helpful, concise, and friendly.' },
    welcomeMessage: { type: String, default: 'Hello! I can help you get started.' },
    speakingStyle: { type: String, default: 'Natural and friendly' },
    responseBehavior: { type: String, default: 'Balanced' },
    temperature: { type: Number, min: 0, max: 1, default: 0.7 },
    knowledgeDocumentIds: [{ type: mongoose_1.Schema.Types.ObjectId, ref: 'Document' }],
    deployment: {
        browserVoice: { type: Boolean, default: true },
        inboundCalls: { type: Boolean, default: false },
        outboundCalls: { type: Boolean, default: false },
    },
    conversationCount: { type: Number, default: 0 },
    lastActive: { type: String, default: 'just now' },
}, { timestamps: true });
exports.AgentModel = mongoose_1.default.models.Agent || mongoose_1.default.model('Agent', agentSchema);
