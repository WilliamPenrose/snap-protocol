import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SnapMessage } from '../types/message.js';
import type { TransportSendOptions, TransportLogger } from '../types/plugin.js';
import type { StreamTransportPlugin } from '../types/transport.js';
import { ErrorCodes } from '../types/errors.js';

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
