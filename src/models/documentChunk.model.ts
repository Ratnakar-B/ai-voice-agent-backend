import mongoose, { Schema } from 'mongoose';

const documentChunkSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    documentId: { type: Schema.Types.ObjectId, ref: 'Document', required: true },
    documentName: { type: String, required: true },
    chunkIndex: { type: Number, required: true },
    text: { type: String, required: true },
    embedding: { type: [Number], required: true },
  },
  { timestamps: true, collection: 'document_chunks' },
);

documentChunkSchema.index({ userId: 1, documentId: 1, chunkIndex: 1 }, { unique: true });

export const DocumentChunkModel =
  mongoose.models.DocumentChunk || mongoose.model('DocumentChunk', documentChunkSchema);
