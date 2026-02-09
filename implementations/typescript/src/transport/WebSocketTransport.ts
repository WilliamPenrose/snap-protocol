import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import { createServer, type Server as HttpServer } from 'node:http';
import type { SnapMessage } from '../types/message.js';
import type { TransportSendOptions, TransportLogger } from '../types/plugin.js';
import type { StreamTransportPlugin } from '../types/transport.js';

export interface WebSocketTransportConfig {
  /** Port to listen on (default: 8080). */
  port?: number;
  /** Hostname to bind to (default: '0.0.0.0'). */
  host?: string;
  /** Heartbeat interval in ms (default: 30000). Set to 0 to disable. */
  heartbeatInterval?: number;
  /** Request timeout in ms (default: 30000). */
  timeout?: number;
  /** Optional logger for diagnostic events. */
  logger?: TransportLogger;
}

interface PendingRequest {
  resolve: (msg: SnapMessage) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingStream {
  push: (msg: SnapMessage) => void;
  end: () => void;
  error: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** WebSocket transport: full-duplex request-response and streaming. */
export class WebSocketTransport implements StreamTransportPlugin {
  readonly name = 'websocket';

  private readonly config: Required<Omit<WebSocketTransportConfig, 'logger'>> & { logger?: TransportLogger };
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private handler: ((message: SnapMessage) => Promise<SnapMessage | void>) | null = null;
  private streamHandler: ((message: SnapMessage) => AsyncIterable<SnapMessage>) | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: WebSocketTransportConfig) {
    this.config = {
      port: config?.port ?? 8080,
      host: config?.host ?? '0.0.0.0',
      heartbeatInterval: config?.heartbeatInterval ?? 30_000,
      timeout: config?.timeout ?? 30_000,
      logger: config?.logger,
    };
  }

  /** Send a request and wait for a single response. */
  async send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage> {
    const ws = await this.connect(options.endpoint);
    const timeout = options.timeout ?? this.config.timeout;

    try {
      return await new Promise<SnapMessage>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('WebSocket request timed out'));
        }, timeout);

        const onMessage = (data: WsWebSocket.Data) => {
          clearTimeout(timer);
          ws.off('message', onMessage);
          try {
            resolve(JSON.parse(data.toString()) as SnapMessage);
          } catch (err) {
            reject(err);
          }
        };

        ws.on('message', onMessage);
        ws.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });

        ws.send(JSON.stringify(message));
      });
    } finally {
      ws.close();
    }
  }

  /** Send a request and receive a stream of responses. */
  async *sendStream(
    message: SnapMessage,
    options: TransportSendOptions,
  ): AsyncIterable<SnapMessage> {
    const ws = await this.connect(options.endpoint);
    const timeout = options.timeout ?? this.config.timeout;

    const queue: SnapMessage[] = [];
    let done = false;
    let error: Error | null = null;
    let resolveWait: (() => void) | null = null;

    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        error = new Error('WebSocket stream timed out');
        done = true;
        resolveWait?.();
      }, timeout);
    };

    let timer = setTimeout(() => {
      error = new Error('WebSocket stream timed out');
      done = true;
      resolveWait?.();
    }, timeout);

    ws.on('message', (data: WsWebSocket.Data) => {
      resetTimer();
      const msg = JSON.parse(data.toString()) as SnapMessage;
      queue.push(msg);
      if (msg.type === 'response') {
        done = true;
      }
      resolveWait?.();
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      error = err instanceof Error ? err : new Error(String(err));
      done = true;
      resolveWait?.();
    });

    ws.on('close', () => {
      clearTimeout(timer);
      done = true;
      resolveWait?.();
    });

    ws.send(JSON.stringify(message));

    try {
      while (true) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        if (error) throw error;
        if (done) break;
        await new Promise<void>((r) => { resolveWait = r; });
        resolveWait = null;
      }
    } finally {
      clearTimeout(timer);
      ws.close();
    }
  }

  /** Start the WebSocket server and handle incoming messages. */
  async listen(
    handler: (message: SnapMessage) => Promise<SnapMessage | void>,
  ): Promise<void> {
    this.handler = handler;
    await this.ensureServer();
  }

  /** Register a stream handler for incoming requests. */
  async listenStream(
    handler: (message: SnapMessage) => AsyncIterable<SnapMessage>,
  ): Promise<void> {
    this.streamHandler = handler;
    await this.ensureServer();
  }

  /** Stop the WebSocket server. */
  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.wss) {
      const wss = this.wss;
      this.wss = null;
      for (const client of wss.clients) {
        client.close();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }

    if (this.httpServer) {
      const server = this.httpServer;
      this.httpServer = null;
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  }

  /** The port the server is listening on (undefined if not started). */
  get port(): number | undefined {
    const addr = this.httpServer?.address();
    if (addr && typeof addr === 'object') return addr.port;
    return undefined;
  }

  private connect(endpoint: string): Promise<WsWebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WsWebSocket(endpoint);
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  private async ensureServer(): Promise<void> {
    if (this.wss) return;

    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      (ws as any).isAlive = true;
      ws.on('pong', () => { (ws as any).isAlive = true; });

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString()) as SnapMessage;
          const isStreamRequest =
            message.method === 'message/stream' ||
            message.method === 'tasks/resubscribe';

          if (isStreamRequest && this.streamHandler) {
            for await (const event of this.streamHandler(message)) {
              ws.send(JSON.stringify(event));
            }
          } else if (this.handler) {
            const response = await this.handler(message);
            if (response) {
              ws.send(JSON.stringify(response));
            }
          }
        } catch (err) {
          this.config.logger?.('warn', 'Failed to process WebSocket message', err);
        }
      });
    });

    // Heartbeat
    if (this.config.heartbeatInterval > 0) {
      this.heartbeatTimer = setInterval(() => {
        this.wss?.clients.forEach((ws) => {
          if ((ws as any).isAlive === false) {
            ws.terminate();
            return;
          }
          (ws as any).isAlive = false;
          ws.ping();
        });
      }, this.config.heartbeatInterval);
    }

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => resolve());
    });
  }
}
