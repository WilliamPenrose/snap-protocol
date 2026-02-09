import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { schnorr } from '@noble/curves/secp256k1.js';
import type { SnapMessage } from '../types/message.js';
import type { TransportSendOptions, TransportLogger } from '../types/plugin.js';
import type { StreamTransportPlugin } from '../types/transport.js';
import type { AgentCard, SignedAgentCard } from '../types/agent-card.js';
import type { PrivateKeyHex } from '../types/keys.js';
import { ErrorCodes } from '../types/errors.js';
import { Canonicalizer } from '../crypto/Canonicalizer.js';
import { KeyManager } from '../crypto/KeyManager.js';

const WELL_KNOWN_PATH = '/.well-known/snap-agent.json';

export interface HttpTransportConfig {
  /** Port to listen on (default: 3000). */
  port?: number;
  /** Hostname to bind to (default: '0.0.0.0'). */
  host?: string;
  /** URL path for the handler (default: '/'). */
  path?: string;
  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number;
  /** Optional logger for diagnostic events. */
  logger?: TransportLogger;
}

/** HTTP transport: POST for request-response, POST + SSE for streaming. */
export class HttpTransport implements StreamTransportPlugin {
  readonly name = 'http';

  private readonly config: Required<Omit<HttpTransportConfig, 'logger'>> & { logger?: TransportLogger };
  private server: Server | null = null;
  private handler: ((message: SnapMessage) => Promise<SnapMessage | void>) | null = null;
  private streamHandler: ((message: SnapMessage) => AsyncIterable<SnapMessage>) | null = null;
  private signedCard: SignedAgentCard | null = null;

  constructor(config?: HttpTransportConfig) {
    this.config = {
      port: config?.port ?? 3000,
      host: config?.host ?? '0.0.0.0',
      path: config?.path ?? '/',
      timeout: config?.timeout ?? 30_000,
      logger: config?.logger,
    };
  }

  /** Send a request and receive a response via HTTP POST. */
  async send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      options.timeout ?? this.config.timeout,
    );

    try {
      const response = await fetch(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return (await response.json()) as SnapMessage;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Send a request and receive an SSE stream of responses. */
  async *sendStream(
    message: SnapMessage,
    options: TransportSendOptions,
  ): AsyncIterable<SnapMessage> {
    const controller = new AbortController();
    const timeoutMs = options.timeout ?? this.config.timeout;

    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null');
    }

    // Reset timeout on each event
    let timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      yield* this.parseSSE(response.body, () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Start the HTTP server and handle incoming requests. */
  async listen(
    handler: (message: SnapMessage) => Promise<SnapMessage | void>,
  ): Promise<void> {
    this.handler = handler;
    await this.ensureServer();
  }

  /** Register a stream handler for incoming SSE requests. */
  async listenStream(
    handler: (message: SnapMessage) => AsyncIterable<SnapMessage>,
  ): Promise<void> {
    this.streamHandler = handler;
    await this.ensureServer();
  }

  /** Stop the HTTP server. */
  async close(): Promise<void> {
    if (this.server) {
      const server = this.server;
      this.server = null;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  /** The port the server is listening on (undefined if not started). */
  get port(): number | undefined {
    const addr = this.server?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return undefined;
  }

  /**
   * Set the agent card to serve at GET /.well-known/snap-agent.json.
   * The card is signed with the provided private key for verifiability.
   */
  setAgentCard(card: AgentCard, privateKey: PrivateKeyHex): void {
    const timestamp = Math.floor(Date.now() / 1000);
    const canonical = Canonicalizer.canonicalize(card);
    const sigInput = `${canonical}|${timestamp}`;
    const hash = sha256(new TextEncoder().encode(sigInput));
    const tweakedKey = KeyManager.tweakPrivateKey(privateKey);
    const sig = bytesToHex(schnorr.sign(hash, hexToBytes(tweakedKey)));
    const publicKey = KeyManager.p2trToPublicKey(card.identity);

    this.signedCard = { card, sig, publicKey, timestamp };
  }

  /**
   * Fetch and verify an agent card from a well-known URL.
   * @param baseUrl The base URL of the agent (e.g., "https://agent.example.com")
   * @returns The verified AgentCard, or throws if verification fails.
   */
  static async discoverViaHttp(baseUrl: string): Promise<AgentCard> {
    const url = baseUrl.replace(/\/$/, '') + WELL_KNOWN_PATH;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Discovery failed: HTTP ${response.status} from ${url}`);
    }
    const signed = (await response.json()) as SignedAgentCard;

    // Verify signature
    const canonical = Canonicalizer.canonicalize(signed.card);
    const sigInput = `${canonical}|${signed.timestamp}`;
    const hash = sha256(new TextEncoder().encode(sigInput));
    const valid = schnorr.verify(hexToBytes(signed.sig), hash, hexToBytes(signed.publicKey));
    if (!valid) {
      throw new Error(`Agent card signature verification failed for ${url}`);
    }

    // Verify public key matches identity
    const expectedKey = KeyManager.p2trToPublicKey(signed.card.identity);
    if (expectedKey !== signed.publicKey) {
      throw new Error(`Public key mismatch: card identity ${signed.card.identity} does not match signing key`);
    }

    return signed.card;
  }

  private async ensureServer(): Promise<void> {
    if (this.server) return;

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        this.config.logger?.('error', 'HTTP request handler error', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => resolve());
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Well-Known agent card endpoint
    if (req.method === 'GET' && req.url === WELL_KNOWN_PATH) {
      if (!this.signedCard) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent card not configured' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      });
      res.end(JSON.stringify(this.signedCard));
      return;
    }

    // CORS preflight for well-known endpoint
    if (req.method === 'OPTIONS' && req.url === WELL_KNOWN_PATH) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.method !== 'POST' || req.url !== this.config.path) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const body = await this.readBody(req);

    let message: SnapMessage;
    try {
      message = JSON.parse(body) as SnapMessage;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Malformed JSON' }));
      return;
    }

    const acceptSSE = req.headers.accept?.includes('text/event-stream');

    if (acceptSSE && this.streamHandler) {
      // SSE streaming response
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      for await (const event of this.streamHandler(message)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      res.end();
    } else if (this.handler) {
      // Standard request-response
      const response = await this.handler(message);
      if (response) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
      } else {
        res.writeHead(204);
        res.end();
      }
    } else {
      // No handler — return SNAP error in payload (HTTP 200)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: { code: ErrorCodes.METHOD_NOT_FOUND, message: 'No handler registered' },
      }));
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  private async *parseSSE(
    body: ReadableStream<Uint8Array>,
    onEvent: () => void,
  ): AsyncIterable<SnapMessage> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop()!;

        for (const part of parts) {
          const dataLine = part
            .split('\n')
            .find((line) => line.startsWith('data: '));
          if (dataLine) {
            onEvent();
            yield JSON.parse(dataLine.slice(6)) as SnapMessage;
          }
        }
      }

      // Handle any remaining data
      if (buffer.trim()) {
        const dataLine = buffer
          .split('\n')
          .find((line) => line.startsWith('data: '));
        if (dataLine) {
          onEvent();
          yield JSON.parse(dataLine.slice(6)) as SnapMessage;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
