"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const express_1 = require("express");
const store_1 = require("../data/store");
const authMiddleware_1 = require("../middleware/authMiddleware");
const conversation_model_1 = require("../models/conversation.model");
const message_model_1 = require("../models/message.model");
const router = (0, express_1.Router)();
const normalizeConversation = (entry) => ({
    id: String(entry._id ?? entry.id),
    agent: entry.agentName ?? entry.agent,
    date: entry.startedAt ? new Date(entry.startedAt).toISOString() : 'Recently',
    duration: entry.duration ?? '00:00',
    status: entry.status ?? 'completed',
});
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
router.get('/', authMiddleware_1.authMiddleware, async (req, res) => {
    const currentUser = req.user;
    if (!currentUser)
        return res.status(401).json({ message: 'Authentication required.' });
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const agent = typeof req.query.agent === 'string' ? req.query.agent.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const date = typeof req.query.date === 'string' ? req.query.date : 'all';
    if (search.length > 100) {
        return res.status(400).json({ message: 'Search must be 100 characters or fewer.' });
    }
    if (status !== 'all' && status !== 'completed' && status !== 'active') {
        return res.status(400).json({ message: 'Choose a valid conversation status.' });
    }
    if (date !== 'all' && date !== '7' && date !== '30') {
        return res.status(400).json({ message: 'Choose a valid conversation date range.' });
    }
    const startedAt = date === 'all' ? undefined : { $gte: new Date(Date.now() - Number(date) * 24 * 60 * 60 * 1000) };
    if (mongoose_1.default.connection.readyState === 1) {
        const query = { userId: currentUser.id };
        if (agent)
            query.agentName = agent;
        if (status !== 'all')
            query.status = status;
        if (startedAt)
            query.startedAt = startedAt;
        if (search) {
            const nameSearch = { agentName: { $regex: escapeRegex(search), $options: 'i' } };
            if (agent)
                query.$and = [{ agentName: agent }, nameSearch];
            else
                query.agentName = nameSearch.agentName;
        }
        const list = await conversation_model_1.ConversationModel.find(query).sort({ startedAt: -1 }).lean();
        return res.json(list.map(normalizeConversation));
    }
    return res.json(store_1.conversations
        .filter((entry) => {
        if (entry.userId !== currentUser.id)
            return false;
        if (agent && entry.agentName !== agent)
            return false;
        if (status !== 'all' && entry.status !== status)
            return false;
        if (startedAt && new Date(entry.startedAt).getTime() < startedAt.$gte.getTime())
            return false;
        if (search && !entry.agentName.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
            return false;
        return true;
    })
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
        .map(normalizeConversation));
});
router.get('/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    const currentUser = req.user;
    if (!currentUser)
        return res.status(401).json({ message: 'Authentication required.' });
    if (mongoose_1.default.connection.readyState === 1) {
        if (!mongoose_1.default.isValidObjectId(req.params.id)) {
            return res.status(404).json({ message: 'Conversation not found.' });
        }
        const conversation = await conversation_model_1.ConversationModel.findOne({
            _id: req.params.id,
            userId: currentUser.id,
        }).lean();
        if (!conversation)
            return res.status(404).json({ message: 'Conversation not found.' });
        const transcript = await message_model_1.MessageModel.find({ conversationId: conversation._id })
            .sort({ createdAt: 1 })
            .lean();
        return res.json({
            ...normalizeConversation(conversation),
            messages: transcript.map((message) => ({
                id: String(message._id),
                role: message.role,
                content: message.content,
                createdAt: message.createdAt.toISOString(),
            })),
        });
    }
    const conversation = store_1.conversations.find((entry) => entry.id === req.params.id && entry.userId === currentUser.id);
    if (!conversation)
        return res.status(404).json({ message: 'Conversation not found.' });
    return res.json({
        ...normalizeConversation(conversation),
        messages: store_1.messages
            .filter((message) => message.conversationId === conversation.id)
            .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
            .map(({ id, role, content, createdAt }) => ({ id, role, content, createdAt })),
    });
});
exports.default = router;
