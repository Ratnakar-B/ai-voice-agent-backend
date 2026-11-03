import mongoose, { Schema } from 'mongoose';

const documentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    size: { type: String, required: true },
    content: { type: String, required: true, select: false },
    status: { type: String, enum: ['ready', 'processing', 'failed'], default: 'ready' },
    uploadedAt: { type: Date, default: Date.now },
    indexedAt: { type: Date },
    embeddingDimensions: { type: Number },
  },
  { timestamps: true },
);

export const DocumentModel = mongoose.models.Document || mongoose.model('Document', documentSchema);
