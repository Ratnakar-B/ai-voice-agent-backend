# VoicePilot API

The backend is an Express and TypeScript API. It provides authentication, voice-agent management, Gemini Live sessions, conversation history, and document ingestion and retrieval.

## Requirements

- Node.js 20.19+ or 22.12+
- npm
- MongoDB (MongoDB Atlas is required for document vector search)
- A Gemini API key for voice sessions, document embeddings, and AI answers

## Install

From PowerShell in the project root:

```powershell
Set-Location .\server
npm install
```

## Configure

Create `server\.env` and set the values for your environment. Keep this file private and never commit API keys, database credentials, or signing secrets.

```dotenv
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:5174

MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>/<database>
MONGODB_DB_NAME=voicepilot

JWT_SECRET=<use-a-long-random-secret>
SESSION_SECRET=<use-a-different-long-random-secret>
GEMINI_API_KEY=<your-gemini-api-key>

GEMINI_MODEL=gemini-3.8-flash
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSIONS=3072
GEMINI_LIVE_MODEL=gemini-2.5-flash-native-audio-latest
MONGODB_VECTOR_INDEX=document_chunks_vector_index
UPLOAD_DIR=uploads
```

Use a MongoDB Atlas cluster with Vector Search enabled for knowledge-base search. Configure the vector index with the same dimensions as `GEMINI_EMBEDDING_DIMENSIONS` (3072 by default). Keep `ALLOWED_ORIGINS` aligned with the frontend's actual development or production URL. Local MongoDB can be used for other API functionality, but it does not provide the Atlas Vector Search required by RAG.

## Run in development

```powershell
Set-Location .\server
npm run dev
```

`npm run dev` compiles the TypeScript source and starts the compiled API. It does not watch for source changes; rerun the command after editing backend code. The API listens on `http://localhost:4000` by default. Check `http://localhost:4000/health` for a health response.

## Build and start

```powershell
Set-Location .\server
npm run build
npm start
```

The compiled JavaScript is written to `server\dist`.

## Knowledge-base RAG

Document uploads require MongoDB Atlas Vector Search and a Gemini API key:

1. Configure `MONGODB_URI`, `MONGODB_DB_NAME`, and `GEMINI_API_KEY` in `server\.env`.
2. Use an Atlas cluster that supports Vector Search. The MongoDB database user needs permission to create and inspect search indexes.
3. Start the server. On the first upload, the API creates the vector index named by `MONGODB_VECTOR_INDEX` (default: `document_chunks_vector_index`) and waits until it is ready.

Uploads extract text, split it into overlapping chunks, generate 3,072-dimensional Gemini retrieval embeddings by default, and store the chunk text and vectors in the `document_chunks` collection. Set `GEMINI_EMBEDDING_DIMENSIONS` to match the Atlas vector index. Questions are embedded as retrieval queries, filtered to the authenticated user, and answered using the top eight similar chunks.

Documents without a current embedding-dimension marker are re-indexed the first time that user asks a question. Uploads and document search return an explicit error when MongoDB Atlas Vector Search is unavailable or configured with a different vector dimension; they do not fall back to whole-document prompting or in-memory storage.
