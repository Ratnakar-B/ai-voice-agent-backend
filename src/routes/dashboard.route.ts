import mongoose from 'mongoose';
import { Router } from 'express';
import { agents, conversations } from '../data/store';
import { authMiddleware } from '../middleware/authMiddleware';
import { AgentModel } from '../models/agent.model';
import { ConversationModel } from '../models/conversation.model';
import type { AuthenticatedRequest } from '../types';

const router = Router();

router.get('/stats', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const currentUser = req.user;
  if (!currentUser) return res.status(401).json({ message: 'Authentication required.' });

  if (mongoose.connection.readyState === 1) {
    const [userAgents, userConversations] = await Promise.all([
      AgentModel.find({ userId: currentUser.id }).select('status').lean(),
      ConversationModel.find({ userId: currentUser.id }).select('duration').lean(),
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

  const userAgents = agents.filter((agent) => agent.userId === currentUser?.id);
  const userConversations = conversations.filter((entry) => entry.userId === currentUser?.id);
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

export default router;
