import mongoose from 'mongoose';
import { Router } from 'express';
import { agents } from '../data/store';
import { authMiddleware } from '../middleware/authMiddleware';
import { AgentModel } from '../models/agent.model';
import type { Agent, AuthenticatedRequest } from '../types';

const agentAvatars = new Set(['/agent01.jpg', '/agent02.jfif', '/agent03.jfif', '/agent04.jfif', '/agent05.jfif']);
const defaultAgentAvatar = '/agent01.jpg';
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeAgent = (agent: any) => ({
  id: String(agent._id ?? agent.id),
  userId: String(agent.userId ?? ''),
  name: agent.name,
  description: agent.description,
  status: agent.status ?? 'active',
  avatar: agent.avatar ?? defaultAgentAvatar,
  model: agent.model ?? 'gemini-3.8-flash',
  voice: agent.voice,
  language: agent.language,
  instructions: agent.instructions ?? 'Be helpful, concise, and friendly.',
  welcomeMessage: agent.welcomeMessage ?? 'Hello! I can help you get started.',
  speakingStyle: agent.speakingStyle ?? 'Natural and friendly',
  responseBehavior: agent.responseBehavior ?? 'Balanced',
  temperature: agent.temperature ?? 0.7,
  knowledgeDocumentIds: (agent.knowledgeDocumentIds ?? []).map(String),
  deployment: agent.deployment ?? { browserVoice: true, inboundCalls: false, outboundCalls: false },
  conversationCount: agent.conversationCount ?? 0,
  lastActive: agent.lastActive ?? 'just now',
});

const router = Router();

router.get('/', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const currentUser = req.user;
  if (!currentUser) return res.status(401).json({ message: 'Authentication required.' });

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status : 'all';
  const language = typeof req.query.language === 'string' ? req.query.language.trim() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';

  if (search.length > 100) {
    return res.status(400).json({ message: 'Search must be 100 characters or fewer.' });
  }
  if (status !== 'all' && status !== 'active' && status !== 'inactive') {
    return res.status(400).json({ message: 'Choose a valid agent status.' });
  }
  if (language.length > 80) {
    return res.status(400).json({ message: 'Language filter must be 80 characters or fewer.' });
  }
  if (sort !== 'newest' && sort !== 'name' && sort !== 'conversations') {
    return res.status(400).json({ message: 'Choose a valid agent sort order.' });
  }

  if (mongoose.connection.readyState === 1) {
    const query: Record<string, unknown> = { userId: currentUser.id };
    if (status !== 'all') query.status = status;
    if (language) query.language = language;
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: 'i' };
      query.$or = [{ name: regex }, { description: regex }];
    }

    const sortOrder: Record<string, 1 | -1> = sort === 'name'
      ? { name: 1 }
      : sort === 'conversations'
        ? { conversationCount: -1, createdAt: -1 }
        : { createdAt: -1 };
    const list = await AgentModel.find(query).sort(sortOrder).lean();
    return res.json(list.map(normalizeAgent));
  }

  const userAgents = agents
    .filter((agent) => {
      if (agent.userId !== currentUser.id) return false;
      if (status !== 'all' && agent.status !== status) return false;
      if (language && agent.language !== language) return false;
      if (search && !`${agent.name} ${agent.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) return false;
      return true;
    })
    .sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name);
      if (sort === 'conversations') return right.conversationCount - left.conversationCount;
      return agents.indexOf(right) - agents.indexOf(left);
    });
  return res.json(userAgents);
});

router.post('/', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const currentUser = req.user;
  const { name, description, voice, language, model, instructions, welcomeMessage, avatar } = req.body as {
    name?: string; description?: string; voice?: string; language?: string; model?: string; instructions?: string; welcomeMessage?: string; avatar?: string;
  };

  if (!name || !description || !voice || !language) {
    return res.status(400).json({ message: 'Agent name, description, voice, and language are required.' });
  }
  if (avatar !== undefined && !agentAvatars.has(avatar)) {
    return res.status(400).json({ message: 'Choose an available agent picture.' });
  }

  if (mongoose.connection.readyState === 1) {
    const nextAgent = await AgentModel.create({
      userId: currentUser!.id,
      name,
      description,
      status: 'active',
      avatar: avatar ?? defaultAgentAvatar,
      model: model ?? 'gemini-3.8-flash',
      voice,
      language,
      instructions: instructions ?? 'Be helpful, concise, and friendly.',
      welcomeMessage: welcomeMessage ?? 'Hello! I can help you get started.',
      speakingStyle: 'Natural and friendly',
      responseBehavior: 'Balanced',
      temperature: 0.7,
      knowledgeDocumentIds: [],
      deployment: { browserVoice: true, inboundCalls: false, outboundCalls: false },
      conversationCount: 0,
      lastActive: 'just now',
    });

    return res.status(201).json(normalizeAgent(nextAgent));
  }

  const nextAgent = {
    id: `agent-${Date.now()}`,
    userId: currentUser!.id,
    name,
    description,
    status: 'active' as const,
    avatar: avatar ?? defaultAgentAvatar,
    model: model ?? 'gemini-3.8-flash',
    voice,
    language,
    instructions: instructions ?? 'Be helpful, concise, and friendly.',
    welcomeMessage: welcomeMessage ?? 'Hello! I can help you get started.',
    speakingStyle: 'Natural and friendly',
    responseBehavior: 'Balanced',
    temperature: 0.7,
    knowledgeDocumentIds: [],
    deployment: { browserVoice: true, inboundCalls: false, outboundCalls: false },
    conversationCount: 0,
    lastActive: 'just now',
  };

  agents.push(nextAgent);
  return res.status(201).json(nextAgent);
});

router.get('/:id', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const currentUser = req.user;
  if (mongoose.connection.readyState === 1) {
    const agent = await AgentModel.findOne({ _id: req.params.id, userId: currentUser!.id }).lean();
    if (!agent) return res.status(404).json({ message: 'Agent not found.' });
    return res.json(normalizeAgent(agent));
  }

  const agent = agents.find((entry) => entry.id === req.params.id && entry.userId === currentUser?.id);
  if (!agent) return res.status(404).json({ message: 'Agent not found.' });
  return res.json(agent);
});

router.put('/:id', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const currentUser = req.user;
  const body = req.body as Partial<Omit<Agent, 'id' | 'userId' | 'conversationCount' | 'lastActive'>>;
  const allowedFields = ['name', 'description', 'status', 'model', 'voice', 'language', 'instructions', 'welcomeMessage', 'avatar'] as const;
  const updates: Record<string, string> = {};

  for (const field of allowedFields) {
    const value = body[field];
    if (value !== undefined) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        return res.status(400).json({ message: `${field} must be a non-empty string.` });
      }
      if (field === 'avatar' && !agentAvatars.has(value)) {
        return res.status(400).json({ message: 'Choose an available agent picture.' });
      }
      updates[field] = value.trim();
    }
  }
  if (updates.status && updates.status !== 'active' && updates.status !== 'inactive') {
    return res.status(400).json({ message: 'Agent status must be active or inactive.' });
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ message: 'Provide at least one valid agent field to update.' });
  }

  if (mongoose.connection.readyState === 1) {
    const updated = await AgentModel.findOneAndUpdate(
      { _id: req.params.id, userId: currentUser!.id },
      { $set: updates },
      { new: true },
    );
    if (!updated) return res.status(404).json({ message: 'Agent not found.' });
    return res.json(normalizeAgent(updated));
  }

  const agentIndex = agents.findIndex((entry) => entry.id === req.params.id && entry.userId === currentUser?.id);
  if (agentIndex === -1) return res.status(404).json({ message: 'Agent not found.' });

  agents[agentIndex] = { ...agents[agentIndex], ...updates };
  return res.json(agents[agentIndex]);
});

router.delete('/:id', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const currentUser = req.user;
  if (mongoose.connection.readyState === 1) {
    const removed = await AgentModel.findOneAndDelete({ _id: req.params.id, userId: currentUser!.id });
    if (!removed) return res.status(404).json({ message: 'Agent not found.' });
    return res.json({ message: 'Agent deleted', agent: normalizeAgent(removed) });
  }

  const agentIndex = agents.findIndex((entry) => entry.id === req.params.id && entry.userId === currentUser?.id);
  if (agentIndex === -1) return res.status(404).json({ message: 'Agent not found.' });

  const [removed] = agents.splice(agentIndex, 1);
  return res.json({ message: 'Agent deleted', agent: removed });
});

export default router;
