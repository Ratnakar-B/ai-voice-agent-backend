import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from '../config/env';

const transcriptionPath = '/api/voice/transcription';
const ticketLifetimeMs = 60_000;

type TranscriptionTicket = {
  sessionId: string;
  expiresAt: number;
};

const tickets = new Map<string, TranscriptionTicket>();
const transcriptionServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });

export function issueTranscriptionTicket(sessionId: string): string {
  const now = Date.now();
  for (const [ticket, details] of tickets) {
    if (details.expiresAt <= now) tickets.delete(ticket);
  }

  const ticket = randomUUID();
  tickets.set(ticket, { sessionId, expiresAt: now + ticketLifetimeMs });
  return ticket;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin || config.allowedOrigins.includes(origin)) return true;
  return config.nodeEnv === 'development' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function bridgeSockets(client: WebSocket, upstream: WebSocket): void {
  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
  });
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
  });

  client.on('close', (code, reason) => {
    if (upstream.readyState !== WebSocket.OPEN) return;
    if (code === 1006 || code === 1015) upstream.terminate();
    else upstream.close(code, reason);
  });
  upstream.on('close', (code, reason) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (code === 1006 || code === 1015) client.terminate();
    else client.close(code, reason);
  });

  client.on('error', () => upstream.terminate());
  upstream.on('error', () => client.close(1011, 'Transcription service connection failed'));
}

async function connectToGemini(): Promise<WebSocket> {
  const url = new URL(
    'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent',
  );
  url.searchParams.set('key', config.geminiApiKey);
  const upstream = new WebSocket(url, { perMessageDeflate: false });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      upstream.terminate();
      reject(new Error('Gemini transcription connection timed out.'));
    }, 15_000);
    const cleanup = () => {
      clearTimeout(timeout);
      upstream.off('open', onOpen);
      upstream.off('error', onError);
      upstream.off('unexpected-response', onUnexpectedResponse);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Gemini transcription connection failed.'));
    };
    const onUnexpectedResponse = () => {
      cleanup();
      upstream.terminate();
      reject(new Error('Gemini rejected the transcription connection.'));
    };
    upstream.once('open', onOpen);
    upstream.once('error', onError);
    upstream.once('unexpected-response', onUnexpectedResponse);
  });

  return upstream;
}

export function attachGeminiTranscriptionProxy(server: Server): void {
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    if (requestUrl.pathname !== transcriptionPath) return;

    const ticketValue = requestUrl.searchParams.get('ticket');
    const ticket = ticketValue ? tickets.get(ticketValue) : undefined;
    if (ticketValue) tickets.delete(ticketValue);
    const sessionId = requestUrl.searchParams.get('sessionId');
    if (!isAllowedOrigin(request.headers.origin)) {
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    if (!ticket || ticket.expiresAt <= Date.now() || ticket.sessionId !== sessionId) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (!config.geminiApiKey) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return;
    }

    void connectToGemini()
      .then((upstream) => {
        transcriptionServer.handleUpgrade(request, socket, head, (client) => {
          bridgeSockets(client, upstream);
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown transcription connection error.';
        console.error('Could not establish Gemini transcription connection.', message);
        if (!socket.destroyed) rejectUpgrade(socket, 502, 'Bad Gateway');
      });
  });
}
