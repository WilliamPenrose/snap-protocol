import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketTransport } from '../../src/transport/WebSocketTransport.js';
import type { SnapMessage } from '../../src/types/message.js';

const DUMMY_SIG = '0'.repeat(128);

function makeMessage(overrides: Partial<SnapMessage> = {}): SnapMessage {
  return {
    id: 'msg-001',
    version: '0.1',
    from: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8' as SnapMessage['from'],
    to: 'bc1pxyz' as SnapMessage['to'],
    type: 'request',
    method: 'message/send',
    payload: { message: { messageId: 'im-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } },
    timestamp: Date.now(),
    sig: DUMMY_SIG,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<SnapMessage> = {}): SnapMessage {
  return {
    id: 'resp-001',
    version: '0.1',
    from: 'bc1pxyz' as SnapMessage['from'],
    to: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8' as SnapMessage['to'],
    type: 'response',
    method: 'message/send',
    payload: { task: { id: 'task-1', status: { state: 'completed', timestamp: new Date().toISOString() } } },
    timestamp: Date.now(),
    sig: DUMMY_SIG,
    ...overrides,
  };
}

describe('WebSocketTransport', () => {
  const transports: WebSocketTransport[] = [];

  function createTransport(config?: ConstructorParameters<typeof WebSocketTransport>[0]): WebSocketTransport {
    const t = new WebSocketTransport(config);
    transports.push(t);
    return t;
  }

  afterEach(async () => {
    for (const t of transports) {
      await t.close();
    }
    transports.length = 0;
  });

  it('has name "websocket"', () => {
    const transport = createTransport();
    expect(transport.name).toBe('websocket');
  });

  it('sends and receives a request-response via WebSocket', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    const expectedResponse = makeResponse();

    await server.listen(async () => expectedResponse);

    const client = createTransport();
    const response = await client.send(makeMessage(), {
      endpoint: `ws://127.0.0.1:${server.port}`,
    });

    expect(response.id).toBe(expectedResponse.id);
    expect(response.type).toBe('response');
  });

  it('receives the request payload on the server side', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    let receivedMessage: SnapMessage | null = null;

    await server.listen(async (msg) => {
      receivedMessage = msg;
      return makeResponse();
    });

    const client = createTransport();
    await client.send(makeMessage({ id: 'test-recv' }), {
      endpoint: `ws://127.0.0.1:${server.port}`,
    });

    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage!.id).toBe('test-recv');
  });

  it('streams events via WebSocket', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });

    const events: SnapMessage[] = [
      makeResponse({ id: 'evt-1', type: 'event' }),
      makeResponse({ id: 'evt-2', type: 'event' }),
      makeResponse({ id: 'resp-final', type: 'response' }),
    ];

    await server.listenStream(async function* () {
      for (const evt of events) {
        yield evt;
      }
    });

    const client = createTransport();
    const received: SnapMessage[] = [];

    for await (const msg of client.sendStream(
      makeMessage({ method: 'message/stream' }),
      { endpoint: `ws://127.0.0.1:${server.port}` },
    )) {
      received.push(msg);
    }

    expect(received).toHaveLength(3);
    expect(received[0].id).toBe('evt-1');
    expect(received[0].type).toBe('event');
    expect(received[2].id).toBe('resp-final');
    expect(received[2].type).toBe('response');
  });

  it('routes message/stream to stream handler', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });

    let rrCalled = false;
    let streamCalled = false;

    await server.listen(async () => {
      rrCalled = true;
      return makeResponse({ id: 'rr' });
    });

    await server.listenStream(async function* () {
      streamCalled = true;
      yield makeResponse({ id: 'stream-resp', type: 'response' });
    });

    const client = createTransport();
    const endpoint = `ws://127.0.0.1:${server.port}`;

    // message/send → request-response handler
    await client.send(makeMessage({ method: 'message/send' }), { endpoint });
    expect(rrCalled).toBe(true);

    // message/stream → stream handler
    const msgs: SnapMessage[] = [];
    for await (const msg of client.sendStream(
      makeMessage({ method: 'message/stream' }),
      { endpoint },
    )) {
      msgs.push(msg);
    }
    expect(streamCalled).toBe(true);
    expect(msgs[0].id).toBe('stream-resp');
  });

  it('routes tasks/resubscribe to stream handler', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });

    await server.listenStream(async function* () {
      yield makeResponse({ id: 'resub-resp', type: 'response' });
    });

    const client = createTransport();
    const msgs: SnapMessage[] = [];
    for await (const msg of client.sendStream(
      makeMessage({ method: 'tasks/resubscribe' }),
      { endpoint: `ws://127.0.0.1:${server.port}` },
    )) {
      msgs.push(msg);
    }

    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('resub-resp');
  });

  it('closes the server gracefully', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    await server.listen(async () => makeResponse());
    const port = server.port;
    expect(port).toBeDefined();

    await server.close();
    expect(server.port).toBeUndefined();
  });

  it('port is undefined before listen', () => {
    const transport = createTransport();
    expect(transport.port).toBeUndefined();
  });

  // --- Edge case tests ---

  it('handles multiple concurrent request-response exchanges', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    await server.listen(async (msg) => makeResponse({ id: `resp-${msg.id}` }));

    const endpoint = `ws://127.0.0.1:${server.port}`;
    const promises = Array.from({ length: 5 }, (_, i) => {
      const client = createTransport();
      return client.send(makeMessage({ id: `concurrent-${i}` }), { endpoint });
    });

    const responses = await Promise.all(promises);
    expect(responses).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(responses[i].id).toBe(`resp-concurrent-${i}`);
    }
  });

  it('send() rejects on connection refused', async () => {
    const client = createTransport();
    await expect(
      client.send(makeMessage(), { endpoint: 'ws://127.0.0.1:1' }),
    ).rejects.toThrow();
  });

  it('send() rejects on timeout', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    await server.listen(async () => {
      // Never respond — simulate timeout
      await new Promise((resolve) => setTimeout(resolve, 10000));
      return makeResponse();
    });

    const client = createTransport({ timeout: 100 });
    await expect(
      client.send(makeMessage(), { endpoint: `ws://127.0.0.1:${server.port}` }),
    ).rejects.toThrow('timed out');
  });

  it('sendStream() rejects on connection refused', async () => {
    const client = createTransport();
    const collected: SnapMessage[] = [];

    await expect(async () => {
      for await (const msg of client.sendStream(makeMessage(), { endpoint: 'ws://127.0.0.1:1' })) {
        collected.push(msg);
      }
    }).rejects.toThrow();
    expect(collected).toHaveLength(0);
  });

  it('stream completes when final response (type=response) is received', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });

    await server.listenStream(async function* () {
      yield makeResponse({ id: 'evt-1', type: 'event' });
      yield makeResponse({ id: 'evt-2', type: 'event' });
      yield makeResponse({ id: 'evt-3', type: 'event' });
      yield makeResponse({ id: 'final', type: 'response' });
    });

    const client = createTransport();
    const received: SnapMessage[] = [];
    for await (const msg of client.sendStream(
      makeMessage({ method: 'message/stream' }),
      { endpoint: `ws://127.0.0.1:${server.port}` },
    )) {
      received.push(msg);
    }

    expect(received).toHaveLength(4);
    expect(received[3].type).toBe('response');
  });

  it('stream with single final response (no events)', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });

    await server.listenStream(async function* () {
      yield makeResponse({ id: 'only-response', type: 'response' });
    });

    const client = createTransport();
    const received: SnapMessage[] = [];
    for await (const msg of client.sendStream(
      makeMessage({ method: 'message/stream' }),
      { endpoint: `ws://127.0.0.1:${server.port}` },
    )) {
      received.push(msg);
    }

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('only-response');
  });

  it('close() is idempotent', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    await server.listen(async () => makeResponse());
    await server.close();
    // Second close should not throw
    await server.close();
  });

  it('handler returning void sends no response', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    await server.listen(async () => undefined as any);

    const client = createTransport({ timeout: 500 });
    // Server handler returns void → no message sent → client times out
    await expect(
      client.send(makeMessage(), { endpoint: `ws://127.0.0.1:${server.port}` }),
    ).rejects.toThrow('timed out');
  });

  it('server ignores malformed JSON messages', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    let handlerCalled = false;
    await server.listen(async () => {
      handlerCalled = true;
      return makeResponse();
    });

    // Use raw WebSocket to send garbage
    const { WebSocket: WsWebSocket } = await import('ws');
    const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve) => ws.once('open', resolve));
    ws.send('not-json{{{');

    // Wait a moment to ensure server didn't crash
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(handlerCalled).toBe(false);
    ws.close();
  });

  it('falls back to request-response handler for non-stream methods', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });
    let rrCalled = false;

    await server.listen(async () => {
      rrCalled = true;
      return makeResponse({ id: 'rr-fallback' });
    });
    await server.listenStream(async function* () {
      yield makeResponse({ id: 'stream', type: 'response' });
    });

    const client = createTransport();
    // message/send is NOT a stream method → uses request-response handler
    const response = await client.send(
      makeMessage({ method: 'message/send' }),
      { endpoint: `ws://127.0.0.1:${server.port}` },
    );

    expect(rrCalled).toBe(true);
    expect(response.id).toBe('rr-fallback');
  });

  // --- Logger tests ---

  it('logger is called when server receives malformed JSON', async () => {
    const logs: Array<{ level: string; message: string; data: unknown }> = [];
    const server = createTransport({
      port: 0,
      heartbeatInterval: 0,
      logger: (level, message, data) => {
        logs.push({ level, message, data });
      },
    });

    await server.listen(async () => makeResponse());

    // Send malformed data via raw WebSocket
    const { WebSocket: WsWebSocket } = await import('ws');
    const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve) => ws.once('open', resolve));
    ws.send('not-json{{{');

    // Wait for server to process
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].level).toBe('warn');
    expect(logs[0].message).toContain('WebSocket message');

    ws.close();
  });

  it('logger is called when handler throws an error', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const server = createTransport({
      port: 0,
      heartbeatInterval: 0,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    await server.listen(async () => {
      throw new Error('handler boom');
    });

    const { WebSocket: WsWebSocket } = await import('ws');
    const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve) => ws.once('open', resolve));
    ws.send(JSON.stringify(makeMessage()));

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].level).toBe('warn');

    ws.close();
  });

  // --- Heartbeat tests ---

  it('heartbeat sends ping and receives pong from client', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 100 });
    await server.listen(async () => makeResponse());

    const { WebSocket: WsWebSocket } = await import('ws');
    const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve) => ws.once('open', resolve));

    let pongReceived = false;
    // ws client automatically responds to ping with pong (built-in behavior)
    // We just need to verify the server sends pings by checking the connection stays alive
    ws.on('ping', () => { pongReceived = true; });

    // Wait for at least one heartbeat cycle
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(pongReceived).toBe(true);
    ws.close();
  });

  it('heartbeat terminates stale clients that do not respond to pong', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 100 });
    await server.listen(async () => makeResponse());

    const { WebSocket: WsWebSocket } = await import('ws');
    const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((resolve) => ws.once('open', resolve));

    // Disable automatic pong responses to simulate a stale client
    ws.pong = () => {};  // Override pong to be a no-op

    const closed = new Promise<number | undefined>((resolve) => {
      ws.on('close', (code) => resolve(code));
    });

    // After 2 heartbeat cycles without pong, server should terminate
    // Cycle 1: isAlive=true → set isAlive=false, send ping
    // Cycle 2: isAlive still false (no pong) → terminate
    const code = await Promise.race([
      closed,
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 500)),
    ]);

    expect(code).not.toBe('timeout');
  });

  // --- Streaming edge case tests ---

  it('sendStream() timeout resets on each received event', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });

    await server.listenStream(async function* () {
      // Each event is sent 80ms apart, but timeout is 200ms
      // Without timeout reset, total time (240ms) would exceed timeout (200ms)
      yield makeResponse({ id: 'slow-1', type: 'event' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield makeResponse({ id: 'slow-2', type: 'event' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield makeResponse({ id: 'slow-3', type: 'event' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield makeResponse({ id: 'slow-final', type: 'response' });
    });

    const client = createTransport({ timeout: 200 });
    const received: SnapMessage[] = [];
    for await (const msg of client.sendStream(
      makeMessage({ method: 'message/stream' }),
      { endpoint: `ws://127.0.0.1:${server.port}` },
    )) {
      received.push(msg);
    }

    expect(received).toHaveLength(4);
    expect(received[3].id).toBe('slow-final');
  });

  it('sendStream() times out when no events arrive within timeout', async () => {
    const server = createTransport({ port: 0, heartbeatInterval: 0 });

    await server.listenStream(async function* () {
      yield makeResponse({ id: 'evt-1', type: 'event' });
      // Then go silent for longer than timeout
      await new Promise((resolve) => setTimeout(resolve, 5000));
      yield makeResponse({ id: 'never', type: 'response' });
    });

    const client = createTransport({ timeout: 200 });
    const received: SnapMessage[] = [];

    await expect(async () => {
      for await (const msg of client.sendStream(
        makeMessage({ method: 'message/stream' }),
        { endpoint: `ws://127.0.0.1:${server.port}` },
      )) {
        received.push(msg);
      }
    }).rejects.toThrow('WebSocket stream timed out');

    // First event was received before timeout
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('evt-1');
  });

  it('sendStream() exits gracefully when server closes WebSocket mid-stream', async () => {
    // Use raw WebSocket server to explicitly close the connection mid-stream
    const { WebSocketServer } = await import('ws');
    const { createServer } = await import('node:http');

    const httpServer = createServer();
    const wss = new WebSocketServer({ server: httpServer });

    wss.on('connection', (ws) => {
      ws.on('message', () => {
        // Send one event then close the connection
        ws.send(JSON.stringify(makeResponse({ id: 'before-close', type: 'event' })));
        setTimeout(() => ws.close(), 50);
      });
    });

    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = (httpServer.address() as any).port;

    try {
      const client = createTransport();
      const received: SnapMessage[] = [];
      for await (const msg of client.sendStream(
        makeMessage({ method: 'message/stream' }),
        { endpoint: `ws://127.0.0.1:${port}` },
      )) {
        received.push(msg);
      }

      // Stream ends when server closes connection
      expect(received).toHaveLength(1);
      expect(received[0].id).toBe('before-close');
    } finally {
      wss.close();
      httpServer.close();
    }
  });
});
