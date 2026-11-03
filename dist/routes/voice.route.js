"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const express_1 = require("express");
const store_1 = require("../data/store");
const agent_model_1 = require("../models/agent.model");
const authMiddleware_1 = require("../middleware/authMiddleware");
const conversation_model_1 = require("../models/conversation.model");
const message_model_1 = require("../models/message.model");
const document_model_1 = require("../models/document.model");
const gemini_service_1 = require("../services/gemini.service");
const store_2 = require("../data/store");
const router = (0, express_1.Router)();
const supportedVoices = new Set(['Kore', 'Aoede', 'Charon', 'Fenrir', 'Puck']);
router.post('/preview', authMiddleware_1.authMiddleware, async (req, res) => {
    const { voice } = req.body;
    if (!voice || !supportedVoices.has(voice)) {
        return res.status(400).json({ message: 'Choose a supported voice to preview.' });
    }
    const session = await gemini_service_1.GeminiService.createVoicePreviewSession(voice);
    return res.json(session);
});
router.post('/session', authMiddleware_1.authMiddleware, async (req, res) => {
    const { agentId } = req.body;
    const user = req.user;
    if (!user)
        return res.status(401).json({ message: 'Authentication required.' });
    if (!agentId)
        return res.status(400).json({ message: 'An agent must be selected.' });
    let agent;
    if (mongoose_1.default.connection.readyState === 1) {
        if (!mongoose_1.default.isValidObjectId(agentId)) {
            return res.status(404).json({ message: 'Selected voice agent was not found.' });
        }
        const storedAgent = await agent_model_1.AgentModel.findOne({ _id: agentId, userId: user.id }).lean();
        if (storedAgent) {
            agent = {
                id: String(storedAgent._id),
                userId: String(storedAgent.userId),
                name: storedAgent.name,
                description: storedAgent.description,
                status: storedAgent.status,
                model: storedAgent.model,
                voice: storedAgent.voice,
                language: storedAgent.language,
                instructions: storedAgent.instructions,
                welcomeMessage: storedAgent.welcomeMessage,
                speakingStyle: storedAgent.speakingStyle,
                responseBehavior: storedAgent.responseBehavior,
                temperature: storedAgent.temperature,
                knowledgeDocumentIds: (storedAgent.knowledgeDocumentIds ?? []).map(String),
                deployment: storedAgent.deployment,
                conversationCount: storedAgent.conversationCount,
                lastActive: storedAgent.lastActive,
            };
        }
    }
    else {
        agent = store_1.agents.find((entry) => entry.id === agentId && entry.userId === user.id);
    }
    if (!agent)
        return res.status(404).json({ message: 'Selected voice agent was not found.' });
    if (agent.status !== 'active') {
        return res.status(400).json({ message: 'Select an active voice agent to start a call.' });
    }
    let documentContexts;
    if (mongoose_1.default.connection.readyState === 1) {
        const userDocuments = await document_model_1.DocumentModel.find({
            userId: user.id,
            status: 'ready',
            content: { $exists: true, $ne: '' },
        })
            .select('+content name')
            .sort({ uploadedAt: -1 })
            .limit(20)
            .lean();
        documentContexts = userDocuments
            .filter((document) => typeof document.content === 'string' && document.content.trim().length > 0)
            .map((document) => ({ name: document.name, content: document.content }));
    }
    else {
        documentContexts = store_2.documents
            .filter((document) => document.userId === user.id &&
            document.status === 'ready' &&
            typeof document.content === 'string' &&
            document.content.trim().length > 0)
            .slice(-20)
            .map((document) => ({ name: document.name, content: document.content }));
    }
    const session = await gemini_service_1.GeminiService.createVoiceSession(agent, documentContexts);
    if (mongoose_1.default.connection.readyState === 1) {
        const conversation = await conversation_model_1.ConversationModel.create({
            userId: user.id,
            agentId: agent.id,
            agentName: agent.name,
            status: 'active',
            duration: '00:00',
            startedAt: new Date(),
        });
        session.sessionId = String(conversation._id);
    }
    else {
        store_2.conversations.unshift({
            id: session.sessionId,
            userId: user.id,
            agentId: agent.id,
            agentName: agent.name,
            status: 'active',
            duration: '00:00',
            startedAt: new Date().toISOString(),
        });
    }
    return res.json(session);
});
router.post('/session/end', authMiddleware_1.authMiddleware, async (req, res) => {
    const { sessionId } = req.body;
    const user = req.user;
    if (!user)
        return res.status(401).json({ message: 'Authentication required.' });
    if (!sessionId)
        return res.status(400).json({ message: 'A session ID is required.' });
    if (mongoose_1.default.connection.readyState === 1) {
        if (!mongoose_1.default.isValidObjectId(sessionId)) {
            return res.status(404).json({ message: 'Conversation not found.' });
        }
        const conversation = await conversation_model_1.ConversationModel.findOne({ _id: sessionId, userId: user.id });
        if (!conversation)
            return res.status(404).json({ message: 'Conversation not found.' });
        if (conversation.status === 'active') {
            const elapsedSeconds = Math.max(0, Math.floor((Date.now() - conversation.startedAt.getTime()) / 1000));
            conversation.status = 'completed';
            conversation.duration = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
            await conversation.save();
            await agent_model_1.AgentModel.updateOne({ _id: conversation.agentId, userId: user.id }, { $inc: { conversationCount: 1 } });
        }
        return res.json({ status: 'ended', message: 'Voice session closed successfully.' });
    }
    const conversation = store_2.conversations.find((entry) => entry.id === sessionId && entry.userId === user.id);
    if (!conversation)
        return res.status(404).json({ message: 'Conversation not found.' });
    if (conversation.status === 'active') {
        const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(conversation.startedAt).getTime()) / 1000));
        conversation.status = 'completed';
        conversation.duration = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
    }
    return res.json({ status: 'ended', message: 'Voice session closed successfully.' });
});
router.post('/session/:sessionId/messages', authMiddleware_1.authMiddleware, async (req, res) => {
    const user = req.user;
    const { role, content } = req.body;
    const messageContent = content?.trim();
    if (!user)
        return res.status(401).json({ message: 'Authentication required.' });
    if (role !== 'user' && role !== 'assistant') {
        return res.status(400).json({ message: 'Message role must be user or assistant.' });
    }
    if (!messageContent || messageContent.length > 20000) {
        return res.status(400).json({ message: 'Message content must be between 1 and 20,000 characters.' });
    }
    if (mongoose_1.default.connection.readyState === 1) {
        if (!mongoose_1.default.isValidObjectId(req.params.sessionId)) {
            return res.status(404).json({ message: 'Conversation not found.' });
        }
        const conversation = await conversation_model_1.ConversationModel.findOne({
            _id: req.params.sessionId,
            userId: user.id,
        }).select('_id');
        if (!conversation)
            return res.status(404).json({ message: 'Conversation not found.' });
        const message = await message_model_1.MessageModel.create({
            conversationId: conversation._id,
            role,
            content: messageContent,
        });
        return res.status(201).json({
            id: String(message._id),
            conversationId: String(message.conversationId),
            role: message.role,
            content: message.content,
            createdAt: message.createdAt.toISOString(),
        });
    }
    const conversation = store_2.conversations.find((entry) => entry.id === req.params.sessionId && entry.userId === user.id);
    if (!conversation)
        return res.status(404).json({ message: 'Conversation not found.' });
    const savedMessage = {
        id: `message-${Date.now()}-${store_2.messages.length}`,
        conversationId: conversation.id,
        role,
        content: messageContent,
        createdAt: new Date().toISOString(),
    };
    store_2.messages.push(savedMessage);
    return res.status(201).json(savedMessage);
});
exports.default = router;
