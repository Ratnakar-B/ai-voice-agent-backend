import mongoose, { Schema } from 'mongoose';

const conversationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    agentName: { type: String, required: true },
    status: { type: String, enum: ['completed', 'active'], default: 'active' },
    duration: { type: String, default: '00:00' },
    startedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

export const ConversationModel = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
