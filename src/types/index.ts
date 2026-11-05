import type { Request } from 'express';

export type User = {
  id: string;
  name: string;
  email: string;
  password: string;
};

export type Agent = {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  avatar?: string;
  model: string;
  voice: string;
  language: string;
  instructions: string;
  welcomeMessage: string;
  conversationScript: string;
  speakingStyle: string;
  responseBehavior: string;
  temperature: number;
  knowledgeDocumentIds?: string[];
  deployment: {
    browserVoice: boolean;
    inboundCalls: boolean;
    outboundCalls: boolean;
  };
  conversationCount: number;
  lastActive: string;
};

export type DocumentRecord = {
  id: string;
  userId: string;
  name: string;
  size: string;
  status: 'ready' | 'processing' | 'failed';
  uploadedAt: string;
  content: string;
};

export type Conversation = {
  id: string;
  userId: string;
  agentId: string;
  agentName: string;
  status: 'completed' | 'active';
  duration: string;
  startedAt: string;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
};

export type AuthenticatedRequest = Request & {
  user?: User;
};
