import { randomUUID } from 'node:crypto';
import type { P2TRAddress, PrivateKeyHex, Network } from '../types/keys.js';
import type { SnapMessage, MethodName, MessageType, UnsignedMessage } from '../types/message.js';
import type { TransportPlugin, TransportSendOptions, ReplayStore, TaskStore, Middleware, MiddlewareContext, NextFn } from '../types/plugin.js';
import type { StreamTransportPlugin } from '../types/transport.js';
import type { AgentCard } from '../types/agent-card.js';
import type { MethodPayloadMap, HandlerContext, MethodHandler, StreamMethodHandler } from '../types/handler.js';
import type { MessageSendResponse, TasksGetResponse, TasksCancelResponse } from '../types/payloads.js';
import type { InnerMessage } from '../types/task.js';
import { MessageBuilder } from '../messaging/MessageBuilder.js';
import { MessageSigner } from '../messaging/MessageSigner.js';
import { MessageValidator } from '../messaging/MessageValidator.js';
import { SnapError } from '../errors/SnapError.js';
import { KeyManager } from '../crypto/KeyManager.js';
import { HttpTransport } from '../transport/HttpTransport.js';

export interface SnapAgentConfig {
  privateKey: PrivateKeyHex;
  card: AgentCard;
  network?: Network;
}

/** Unified agent peer — sends, receives, and streams SNAP messages. */
export class SnapAgent {
  readonly address: P2TRAddress;
  readonly card: AgentCard;

  private readonly signer: MessageSigner;
  private readonly privateKey: PrivateKeyHex;
  private readonly transports: TransportPlugin[] = [];
  private readonly middlewares: Middleware[] = [];
  private readonly handlers = new Map<string, MethodHandler<any>>();
  private readonly streamHandlers = new Map<string, StreamMethodHandler<any>>();
  private _replayStore?: ReplayStore;
  private _taskStore?: TaskStore;

  constructor(config: SnapAgentConfig) {
    this.privateKey = config.privateKey;
    this.signer = new MessageSigner(config.privateKey);
    this.address = this.signer.getAddress(config.network ?? 'mainnet');
    this.card = { ...config.card, identity: this.address };
  }

  /** Register a request-response handler for a method. */
  handle<M extends keyof MethodPayloadMap>(
    method: M,
    handler: MethodHandler<M>,
  ): this {
    this.handlers.set(method, handler);
    return this;
  }

  /** Register a streaming handler for a method. */
  handleStream<M extends keyof MethodPayloadMap>(
    method: M,
    handler: StreamMethodHandler<M>,
  ): this {
    this.streamHandlers.set(method, handler);
    return this;
  }

  /** Add a transport plugin. */
  transport(plugin: TransportPlugin): this {
    this.transports.push(plugin);
    return this;
  }

  /** Add a middleware. */
  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /** Set the replay store. */
  replayStore(store: ReplayStore): this {
    this._replayStore = store;
    return this;
  }

  /** Set the task store. */
  taskStore(store: TaskStore): this {
    this._taskStore = store;
    return this;
  }

  /** Start listening on all transports. */
  async start(): Promise<void> {
    for (const tp of this.transports) {
      // Auto-configure well-known endpoint for HTTP transports
      if (tp instanceof HttpTransport) {
        tp.setAgentCard(this.card, this.privateKey);
      }

      if (tp.listen) {
        await tp.listen((msg) => this.processMessage(msg));
      }

      const streamTp = tp as StreamTransportPlugin;
      if (typeof streamTp.listenStream === 'function') {
        await streamTp.listenStream((msg) => this.processStream(msg));
      }
    }
  }

  /** Stop all transports. */
  async stop(): Promise<void> {
    for (const tp of this.transports) {
      if (tp.close) {
        await tp.close();
      }
    }
  }

  /** Process an inbound message and return a response. */
  async processMessage(inbound: SnapMessage): Promise<SnapMessage> {
    // 1. Validate structure and signature
    MessageValidator.validate(inbound);

    // 2. Check destination (skip when `to` is absent — Agent-to-Service)
    if (inbound.to !== undefined && inbound.to !== this.address) {
      throw SnapError.invalidMessage(`Message not addressed to this agent: ${inbound.to}`);
    }

    // 3. Replay check
    if (this._replayStore) {
      const seen = await this._replayStore.hasSeen(inbound.from, inbound.id);
      if (seen) {
        throw SnapError.duplicateMessage(inbound.id, inbound.from);
      }
      await this._replayStore.markSeen(inbound.from, inbound.id, inbound.timestamp);
    }

    // 4. Inbound middleware
    await this.runMiddleware({ message: inbound, direction: 'inbound' });

    // 5. Route to handler
    const handler = this.handlers.get(inbound.method);
    if (!handler) {
      throw SnapError.methodNotFound(inbound.method);
    }

    const context: HandlerContext = {
      message: inbound,
      taskStore: this._taskStore,
    };

    const responsePayload = await handler(inbound.payload, context);

    // 6. Build and sign response
    const unsigned = this.buildMessage({
      to: inbound.from,
      type: 'response',
      method: inbound.method as MethodName,
      payload: responsePayload as Record<string, unknown>,
    });
    const response = this.signer.sign(unsigned);

    // 7. Outbound middleware
    await this.runMiddleware({ message: response, direction: 'outbound' });

    return response;
  }

  /** Process an inbound streaming request. */
  async *processStream(inbound: SnapMessage): AsyncIterable<SnapMessage> {
    // 1. Validate
    MessageValidator.validate(inbound);

    // 2. Check destination (skip when `to` is absent — Agent-to-Service)
    if (inbound.to !== undefined && inbound.to !== this.address) {
      throw SnapError.invalidMessage(`Message not addressed to this agent: ${inbound.to}`);
    }

    // 3. Replay check
    if (this._replayStore) {
      const seen = await this._replayStore.hasSeen(inbound.from, inbound.id);
      if (seen) {
        throw SnapError.duplicateMessage(inbound.id, inbound.from);
      }
      await this._replayStore.markSeen(inbound.from, inbound.id, inbound.timestamp);
    }

    // 4. Inbound middleware
    await this.runMiddleware({ message: inbound, direction: 'inbound' });

    // 5. Route to stream handler
    const handler = this.streamHandlers.get(inbound.method);
    if (!handler) {
      throw SnapError.methodNotFound(inbound.method);
    }

    const context: HandlerContext = {
      message: inbound,
      taskStore: this._taskStore,
    };

    // 6. Yield each event signed
    for await (const event of handler(inbound.payload, context)) {
      // Events from handler are already SnapMessages (or we wrap them)
      if (event.sig) {
        yield event;
      } else {
        // Sign event messages
        const unsigned = this.buildMessage({
          to: inbound.from,
          type: event.type ?? 'event',
          method: event.method ?? (inbound.method as MethodName),
          payload: event.payload ?? {},
        });
        yield this.signer.sign(unsigned);
      }
    }
  }

  // --- Outbound methods ---

  /** Send a message to another agent via the first available transport. */
  async send<P extends Record<string, unknown> = Record<string, unknown>>(
    to: P2TRAddress,
    endpoint: string,
    method: MethodName,
    payload: P,
    options?: Partial<TransportSendOptions>,
  ): Promise<SnapMessage> {
    const unsigned = this.buildMessage({ to, type: 'request', method, payload: payload as Record<string, unknown> });
    const signed = this.signer.sign(unsigned);

    await this.runMiddleware({ message: signed, direction: 'outbound' });

    const sendOptions: TransportSendOptions = {
      endpoint,
      ...options,
    };

    // Try transports in order
    let lastError: Error | undefined;
    for (const tp of this.transports) {
      try {
        const response = await tp.send(signed, sendOptions);
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error('No transports configured');
  }

  /** Send a streaming request to another agent. */
  async *sendStream<P extends Record<string, unknown> = Record<string, unknown>>(
    to: P2TRAddress,
    endpoint: string,
    method: MethodName,
    payload: P,
    options?: Partial<TransportSendOptions>,
  ): AsyncIterable<SnapMessage> {
    const unsigned = this.buildMessage({ to, type: 'request', method, payload: payload as Record<string, unknown> });
    const signed = this.signer.sign(unsigned);

    await this.runMiddleware({ message: signed, direction: 'outbound' });

    const sendOptions: TransportSendOptions = {
      endpoint,
      ...options,
    };

    // Find a streaming transport
    for (const tp of this.transports) {
      const streamTp = tp as StreamTransportPlugin;
      if (typeof streamTp.sendStream === 'function') {
        yield* streamTp.sendStream(signed, sendOptions);
        return;
      }
    }

    throw new Error('No streaming transport configured');
  }

  // --- Convenience methods ---

  /** Send a message/send request. */
  async sendMessage(
    to: P2TRAddress,
    endpoint: string,
    message: InnerMessage,
    options?: Partial<TransportSendOptions>,
  ): Promise<MessageSendResponse> {
    const response = await this.send(to, endpoint, 'message/send', { message }, options);
    return response.payload as MessageSendResponse;
  }

  /** Stream a message/stream request. */
  async *streamMessage(
    to: P2TRAddress,
    endpoint: string,
    message: InnerMessage,
    options?: Partial<TransportSendOptions>,
  ): AsyncIterable<SnapMessage> {
    yield* this.sendStream(to, endpoint, 'message/stream', { message }, options);
  }

  /** Get a task by ID. */
  async getTask(
    to: P2TRAddress,
    endpoint: string,
    taskId: string,
    options?: Partial<TransportSendOptions>,
  ): Promise<TasksGetResponse> {
    const response = await this.send(to, endpoint, 'tasks/get', { taskId }, options);
    return response.payload as TasksGetResponse;
  }

  /** Cancel a task. */
  async cancelTask(
    to: P2TRAddress,
    endpoint: string,
    taskId: string,
    options?: Partial<TransportSendOptions>,
  ): Promise<TasksCancelResponse> {
    const response = await this.send(to, endpoint, 'tasks/cancel', { taskId }, options);
    return response.payload as TasksCancelResponse;
  }

  // --- Private helpers ---

  private buildMessage(opts: {
    to: P2TRAddress;
    type: MessageType;
    method: MethodName;
    payload: Record<string, unknown>;
  }): UnsignedMessage {
    return new MessageBuilder()
      .id(randomUUID())
      .from(this.address)
      .to(opts.to)
      .type(opts.type)
      .method(opts.method)
      .payload(opts.payload)
      .timestamp(Math.floor(Date.now() / 1000))
      .build();
  }

  private async runMiddleware(ctx: MiddlewareContext): Promise<void> {
    const stack = [...this.middlewares];
    let index = 0;

    const next: NextFn = async () => {
      if (index < stack.length) {
        const mw = stack[index++];
        await mw.handle(ctx, next);
      }
    };

    await next();
  }
}
