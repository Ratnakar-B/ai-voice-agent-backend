"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const express_1 = require("express");
const store_1 = require("../data/store");
const authMiddleware_1 = require("../middleware/authMiddleware");
const agent_model_1 = require("../models/agent.model");
const conversation_model_1 = require("../models/conversation.model");
const router = (0, express_1.Router)();
router.get('/stats', authMiddleware_1.authMiddleware, async (req, res) => {
    const currentUser = req.user;
    if (!currentUser)
        return res.status(401).json({ message: 'Authentication required.' });
    if (mongoose_1.default.connection.readyState === 1) {
        const [userAgents, userConversations] = await Promise.all([
            agent_model_1.AgentModel.find({ userId: currentUser.id }).select('status').lean(),
            conversation_model_1.ConversationModel.find({ userId: currentUser.id }).select('duration').lean(),
        ]);
        const totalMinutes = userConversations.reduce((total, entry) => {
            const [minutes, seconds] = entry.duration.split(':').map(Number);
            return total + (minutes || 0) + (seconds || 0) / 60;
        }, 0);
        return res.json({
            totalAgents: userAgents.length,
            activeAgents: userAgents.filter((agent) => agent.status === 'active').length,
            totalConversations: userConversations.length,
            totalMinutes: Math.round(totalMinutes),
        });
    }
    const userAgents = store_1.agents.filter((agent) => agent.userId === currentUser?.id);
    const userConversations = store_1.conversations.filter((entry) => entry.userId === currentUser?.id);
    const totalMinutes = userConversations.reduce((total, entry) => {
        const [minutes, seconds] = entry.duration.split(':').map(Number);
        return total + (minutes || 0) + (seconds || 0) / 60;
    }, 0);
    return res.json({
        totalAgents: userAgents.length,
        activeAgents: userAgents.filter((agent) => agent.status === 'active').length,
        totalConversations: userConversations.length,
        totalMinutes: Math.round(totalMinutes),
    });
});
exports.default = router;
