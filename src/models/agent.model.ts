import mongoose, { Schema } from 'mongoose';

const agentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
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
    knowledgeDocumentIds: [{ type: Schema.Types.ObjectId, ref: 'Document' }],
    deployment: {
      browserVoice: { type: Boolean, default: true },
      inboundCalls: { type: Boolean, default: false },
      outboundCalls: { type: Boolean, default: false },
    },
    conversationCount: { type: Number, default: 0 },
    lastActive: { type: String, default: 'just now' },
  },
  { timestamps: true },
);

export const AgentModel = mongoose.models.Agent || mongoose.model('Agent', agentSchema);
