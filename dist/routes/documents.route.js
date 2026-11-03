"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = __importDefault(require("mongoose"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const mammoth_1 = __importDefault(require("mammoth"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const env_1 = require("../config/env");
const store_1 = require("../data/store");
const authMiddleware_1 = require("../middleware/authMiddleware");
const document_model_1 = require("../models/document.model");
const documentChunk_model_1 = require("../models/documentChunk.model");
const gemini_service_1 = require("../services/gemini.service");
const rag_service_1 = require("../services/rag.service");
const router = (0, express_1.Router)();
const supportedExtensions = new Set(['.txt', '.md', '.csv', '.pdf', '.docx']);
const comprehensiveDocumentRequest = /\b(?:entire|whole|complete|full)\s+(?:(?:uploaded|source)\s+)?(?:document|file|content)\b|\b(?:document|file|content)\b.{0,60}\b(?:entire|whole|complete|full|all\s+details|start\s+to\s+(?:finish|end)|beginning\s+to\s+end|from\s+(?:the\s+)?(?:beginning|start))\b|\b(?:summari[sz]e|overview|all\s+details|everything)\b.{0,60}\b(?:document|file|uploaded)\b|\b(?:all|every)\s+(?:the\s+)?(?:details|sections|content)\s+(?:of|from)\s+(?:the\s+)?(?:document|file)\b|\bcomplete\s+details\s+(?:of|from)\s+(?:the\s+)?(?:document|file)\b/i;
const upload = (0, multer_1.default)({
    dest: env_1.config.uploadDir,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
        if (!supportedExtensions.has((0, node_path_1.extname)(file.originalname).toLowerCase())) {
            callback(Object.assign(new Error('Upload a TXT, Markdown, CSV, PDF, or DOCX document.'), { statusCode: 415 }));
            return;
        }
        callback(null, true);
    },
});
const normalizeDocument = (doc) => ({
    id: String(doc._id ?? doc.id),
    userId: String(doc.userId ?? ''),
    name: doc.name,
    size: doc.size,
    status: doc.status === 'ready' &&
        (doc.embeddingDimensions !== env_1.config.geminiEmbeddingDimensions || !doc.indexedAt)
        ? 'pending'
        : doc.status ?? 'processing',
    uploadedAt: doc.uploadedAt ? new Date(doc.uploadedAt).toISOString() : new Date().toISOString(),
});
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function extractText(filePath, originalName) {
    const extension = (0, node_path_1.extname)(originalName).toLowerCase();
    if (extension === '.pdf') {
        return (await (0, pdf_parse_1.default)(await (0, promises_1.readFile)(filePath))).text;
    }
    if (extension === '.docx') {
        return (await mammoth_1.default.extractRawText({ path: filePath })).value;
    }
    return (0, promises_1.readFile)(filePath, 'utf8');
}
router.post('/upload', authMiddleware_1.authMiddleware, upload.single('file'), async (req, res) => {
    const currentUser = req.user;
    const file = req.file;
    if (!file)
        return res.status(400).json({ message: 'No file attached.' });
    try {
        if (mongoose_1.default.connection.readyState !== 1) {
            throw new rag_service_1.RagServiceError('Document uploads require a connected MongoDB Atlas database for vector indexing.', 503);
        }
        const content = (await extractText(file.path, file.originalname)).trim();
        if (!content) {
            return res.status(422).json({ message: 'No readable text was found in the document.' });
        }
        const cappedContent = content.slice(0, 100000);
        const newDocument = await document_model_1.DocumentModel.create({
            userId: currentUser.id,
            name: file.originalname,
            size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
            status: 'processing',
            content: cappedContent,
            uploadedAt: new Date(),
            embeddingDimensions: env_1.config.geminiEmbeddingDimensions,
        });
        try {
            await rag_service_1.RagService.indexDocument({
                userId: currentUser.id,
                documentId: String(newDocument._id),
                documentName: newDocument.name,
                content: cappedContent,
            });
            newDocument.status = 'ready';
            newDocument.indexedAt = new Date();
            newDocument.embeddingDimensions = env_1.config.geminiEmbeddingDimensions;
            await newDocument.save();
            return res.status(201).json(normalizeDocument(newDocument));
        }
        catch (error) {
            try {
                await documentChunk_model_1.DocumentChunkModel.deleteMany({ userId: newDocument.userId, documentId: newDocument._id });
                newDocument.status = 'failed';
                await newDocument.save();
            }
            catch (cleanupError) {
                console.error('Could not clean up a failed document indexing operation.', cleanupError);
                throw new rag_service_1.RagServiceError('Document indexing failed, and its partial records could not be cleaned up.', 500);
            }
            throw error;
        }
    }
    finally {
        await (0, promises_1.unlink)(file.path).catch((error) => {
            console.error('Could not remove temporary uploaded document.', error);
        });
    }
});
router.post('/ask', authMiddleware_1.authMiddleware, async (req, res) => {
    const currentUser = req.user;
    const { question } = req.body;
    const normalizedQuestion = question?.trim();
    if (!normalizedQuestion)
        return res.status(400).json({ message: 'Enter a question about your documents.' });
    if (normalizedQuestion.length > 2000) {
        return res.status(400).json({ message: 'Questions must be 2,000 characters or fewer.' });
    }
    if (!currentUser)
        return res.status(401).json({ message: 'Authentication required.' });
    if (mongoose_1.default.connection.readyState !== 1) {
        throw new rag_service_1.RagServiceError('Document search requires a connected MongoDB Atlas database for vector search.', 503);
    }
    const legacyDocuments = await document_model_1.DocumentModel.find({
        userId: currentUser.id,
        status: 'ready',
        content: { $exists: true, $ne: '' },
        $or: [
            { indexedAt: { $exists: false } },
            { indexedAt: null },
            { embeddingDimensions: { $ne: env_1.config.geminiEmbeddingDimensions } },
        ],
    })
        .select('+content name')
        .lean();
    for (const document of legacyDocuments) {
        if (typeof document.content !== 'string' || !document.content.trim())
            continue;
        await rag_service_1.RagService.indexDocument({
            userId: currentUser.id,
            documentId: String(document._id),
            documentName: document.name,
            content: document.content,
        });
        await document_model_1.DocumentModel.updateOne({ _id: document._id, userId: currentUser.id }, {
            $set: {
                status: 'ready',
                indexedAt: new Date(),
                embeddingDimensions: env_1.config.geminiEmbeddingDimensions,
            },
        });
    }
    const hasIndexedDocuments = await document_model_1.DocumentModel.exists({
        userId: currentUser.id,
        status: 'ready',
        indexedAt: { $type: 'date' },
    });
    if (!hasIndexedDocuments) {
        return res.status(400).json({ message: 'Upload a readable document before asking a question.' });
    }
    if (comprehensiveDocumentRequest.test(normalizedQuestion)) {
        const documentId = await rag_service_1.RagService.findBestMatchingDocumentId(currentUser.id, normalizedQuestion);
        if (!documentId) {
            return res.json({ answer: 'I could not find a matching indexed document.' });
        }
        const document = await document_model_1.DocumentModel.findOne({
            _id: documentId,
            userId: currentUser.id,
            status: 'ready',
            indexedAt: { $type: 'date' },
        })
            .select('+content name')
            .lean();
        if (!document || typeof document.content !== 'string' || !document.content.trim()) {
            return res.json({ answer: 'I found a matching document, but its full text is unavailable. Please upload it again.' });
        }
        const answer = await gemini_service_1.GeminiService.answerFromDocuments(normalizedQuestion, [{ name: document.name, content: document.content }], { comprehensive: true });
        return res.json({ answer });
    }
    const relevantChunks = await rag_service_1.RagService.findRelevantChunks(currentUser.id, normalizedQuestion);
    if (relevantChunks.length === 0) {
        return res.json({ answer: 'I could not find relevant information in your indexed documents.' });
    }
    const answer = await gemini_service_1.GeminiService.answerFromDocuments(normalizedQuestion, relevantChunks);
    return res.json({ answer });
});
router.get('/', authMiddleware_1.authMiddleware, async (req, res) => {
    const currentUser = req.user;
    if (!currentUser)
        return res.status(401).json({ message: 'Authentication required.' });
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const type = typeof req.query.type === 'string' ? req.query.type : 'all';
    const status = typeof req.query.status === 'string' ? req.query.status : 'all';
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'newest';
    const supportedTypes = new Set(['all', 'pdf', 'docx', 'txt', 'md', 'csv']);
    const supportedStatuses = new Set(['all', 'ready', 'pending', 'processing', 'failed']);
    if (search.length > 100) {
        return res.status(400).json({ message: 'Search must be 100 characters or fewer.' });
    }
    if (!supportedTypes.has(type)) {
        return res.status(400).json({ message: 'Choose a supported document type.' });
    }
    if (!supportedStatuses.has(status)) {
        return res.status(400).json({ message: 'Choose a valid document status.' });
    }
    if (sort !== 'newest' && sort !== 'oldest' && sort !== 'name') {
        return res.status(400).json({ message: 'Choose a valid document sort order.' });
    }
    if (mongoose_1.default.connection.readyState === 1) {
        const query = { userId: currentUser.id };
        const nameFilters = [];
        if (search)
            nameFilters.push({ name: { $regex: escapeRegex(search), $options: 'i' } });
        if (type !== 'all')
            nameFilters.push({ name: { $regex: `\\.${escapeRegex(type)}$`, $options: 'i' } });
        if (nameFilters.length === 1)
            Object.assign(query, nameFilters[0]);
        else if (nameFilters.length > 1)
            query.$and = nameFilters;
        if (status === 'ready')
            query.status = 'ready';
        else if (status === 'processing' || status === 'failed')
            query.status = status;
        else if (status === 'pending') {
            query.$or = [
                { status: 'ready', indexedAt: { $exists: false } },
                { status: 'ready', embeddingDimensions: { $ne: env_1.config.geminiEmbeddingDimensions } },
            ];
        }
        const sortOrder = sort === 'name'
            ? { name: 1 }
            : { uploadedAt: sort === 'oldest' ? 1 : -1 };
        const list = await document_model_1.DocumentModel.find(query).sort(sortOrder).lean();
        return res.json(list.map(normalizeDocument));
    }
    const filteredDocuments = store_1.documents.filter((doc) => {
        if (doc.userId !== currentUser.id)
            return false;
        if (search && !doc.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
            return false;
        if (type !== 'all' && (0, node_path_1.extname)(doc.name).toLowerCase() !== `.${type}`)
            return false;
        if (status !== 'all' && doc.status !== status)
            return false;
        return true;
    });
    filteredDocuments.sort((left, right) => {
        if (sort === 'name')
            return left.name.localeCompare(right.name);
        const difference = new Date(left.uploadedAt).getTime() - new Date(right.uploadedAt).getTime();
        return sort === 'oldest' ? difference : -difference;
    });
    return res.json(filteredDocuments.map(normalizeDocument));
});
router.delete('/:id', authMiddleware_1.authMiddleware, async (req, res) => {
    const currentUser = req.user;
    if (mongoose_1.default.connection.readyState === 1) {
        const existing = await document_model_1.DocumentModel.findOne({ _id: req.params.id, userId: currentUser.id }).select('_id');
        if (!existing)
            return res.status(404).json({ message: 'Document not found.' });
        await documentChunk_model_1.DocumentChunkModel.deleteMany({ documentId: existing._id, userId: currentUser.id });
        const removed = await document_model_1.DocumentModel.findOneAndDelete({ _id: req.params.id, userId: currentUser.id });
        if (!removed)
            return res.status(404).json({ message: 'Document not found.' });
        return res.json({ message: 'Document deleted', document: normalizeDocument(removed) });
    }
    const docIndex = store_1.documents.findIndex((doc) => doc.id === req.params.id && doc.userId === currentUser?.id);
    if (docIndex === -1)
        return res.status(404).json({ message: 'Document not found.' });
    const [removed] = store_1.documents.splice(docIndex, 1);
    return res.json({ message: 'Document deleted', document: normalizeDocument(removed) });
});
exports.default = router;
