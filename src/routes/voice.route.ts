import mongoose from 'mongoose';
import { Router } from 'express';
import { agents } from '../data/store';
import { AgentModel } from '../models/agent.model';
import { authMiddleware } from '../middleware/authMiddleware';
import { ConversationModel } from '../models/conversation.model';
import { MessageModel } from '../models/message.model';
import { DocumentModel } from '../models/document.model';
import { GeminiService } from '../services/gemini.service';
import { conversations, documents, messages } from '../data/store';
import type { Agent, AuthenticatedRequest, Message } from '../types';

const router = Router();
const supportedVoices = new Set(['Kore', 'Aoede', 'Charon', 'Fenrir', 'Puck']);

router.post('/preview', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { voice } = req.body as { voice?: string };
  if (!voice || !supportedVoices.has(voice)) {
    return res.status(400).json({ message: 'Choose a supported voice to preview.' });
  }

  const session = await GeminiService.createVoicePreviewSession(voice);
  return res.json(session);
});

router.post('/session', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { agentId } = req.body as { agentId?: string };
  const user = req.user;

  if (!user) return res.status(401).json({ message: 'Authentication required.' });
  if (!agentId) return res.status(400).json({ message: 'An agent must be selected.' });

  let agent: Agent | undefined;
  if (mongoose.connection.readyState === 1) {
    if (!mongoose.isValidObjectId(agentId)) {
      return res.status(404).json({ message: 'Selected voice agent was not found.' });
    }

    const storedAgent = await AgentModel.findOne({ _id: agentId, userId: user.id }).lean();
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
  } else {
    agent = agents.find((entry) => entry.id === agentId && entry.userId === user.id);
  }

  if (!agent) return res.status(404).json({ message: 'Selected voice agent was not found.' });
  if (agent.status !== 'active') {
    return res.status(400).json({ message: 'Select an active voice agent to start a call.' });
  }

  let documentContexts: Array<{ name: string; content: string }>;
  if (mongoose.connection.readyState === 1) {
    const userDocuments = await DocumentModel.find({
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
  } else {
    documentContexts = documents
      .filter(
        (document) =>
          document.userId === user.id &&
          document.status === 'ready' &&
          typeof document.content === 'string' &&
          document.content.trim().length > 0,
      )
      .slice(-20)
      .map((document) => ({ name: document.name, content: document.content }));
  }

  const session = await GeminiService.createVoiceSession(agent, documentContexts);
  if (mongoose.connection.readyState === 1) {
    const conversation = await ConversationModel.create({
      userId: user.id,
      agentId: agent.id,
      agentName: agent.name,
      status: 'active',
      duration: '00:00',
      startedAt: new Date(),
    });
    session.sessionId = String(conversation._id);
  } else {
    conversations.unshift({
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

router.post('/session/end', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const { sessionId } = req.body as { sessionId?: string };
  const user = req.user;
  if (!user) return res.status(401).json({ message: 'Authentication required.' });
  if (!sessionId) return res.status(400).json({ message: 'A session ID is required.' });

  if (mongoose.connection.readyState === 1) {
    if (!mongoose.isValidObjectId(sessionId)) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }

    const conversation = await ConversationModel.findOne({ _id: sessionId, userId: user.id });
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });
    if (conversation.status === 'active') {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - conversation.startedAt.getTime()) / 1000));
      conversation.status = 'completed';
      conversation.duration = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
      await conversation.save();
      await AgentModel.updateOne({ _id: conversation.agentId, userId: user.id }, { $inc: { conversationCount: 1 } });
    }

    return res.json({ status: 'ended', message: 'Voice session closed successfully.' });
  }

  const conversation = conversations.find((entry) => entry.id === sessionId && entry.userId === user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });
  if (conversation.status === 'active') {
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(conversation.startedAt).getTime()) / 1000));
    conversation.status = 'completed';
    conversation.duration = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  }
  return res.json({ status: 'ended', message: 'Voice session closed successfully.' });
});

router.post('/session/:sessionId/messages', authMiddleware, async (req: AuthenticatedRequest, res) => {
  const user = req.user;
  const { role, content } = req.body as { role?: string; content?: string };
  const messageContent = content?.trim();
  if (!user) return res.status(401).json({ message: 'Authentication required.' });
  if (role !== 'user' && role !== 'assistant') {
    return res.status(400).json({ message: 'Message role must be user or assistant.' });
  }
  if (!messageContent || messageContent.length > 20000) {
    return res.status(400).json({ message: 'Message content must be between 1 and 20,000 characters.' });
  }

  if (mongoose.connection.readyState === 1) {
    if (!mongoose.isValidObjectId(req.params.sessionId)) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }
    const conversation = await ConversationModel.findOne({
      _id: req.params.sessionId,
      userId: user.id,
    }).select('_id');
    if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });

    const message = await MessageModel.create({
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

  const conversation = conversations.find((entry) => entry.id === req.params.sessionId && entry.userId === user.id);
  if (!conversation) return res.status(404).json({ message: 'Conversation not found.' });
  const savedMessage: Message = {
    id: `message-${Date.now()}-${messages.length}`,
    conversationId: conversation.id,
    role,
    content: messageContent,
    createdAt: new Date().toISOString(),
  };
  messages.push(savedMessage);
  return res.status(201).json(savedMessage);
});

export default router;
