import { describe, it, expect, afterEach } from 'vitest';
import { HttpTransport } from '../../src/transport/HttpTransport.js';
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

describe('HttpTransport', () => {
  const transports: HttpTransport[] = [];

  function createTransport(config?: Parameters<typeof HttpTransport['prototype']['close']> extends never[] ? never : Parameters<(typeof HttpTransport)['prototype']['send']> extends never[] ? never : ConstructorParameters<typeof HttpTransport>[0]): HttpTransport {
    const t = new HttpTransport(config);
    transports.push(t);
    return t;
  }

  afterEach(async () => {
    for (const t of transports) {
      await t.close();
    }
    transports.length = 0;
  });

  it('has name "http"', () => {
    const transport = createTransport();
    expect(transport.name).toBe('http');
  });

  it('sends and receives a request-response via HTTP POST', async () => {
    const server = createTransport({ port: 0 });
    const expectedResponse = makeResponse();

    await server.listen(async () => expectedResponse);

    const client = createTransport();
    const request = makeMessage();
    const response = await client.send(request, {
      endpoint: `http://127.0.0.1:${server.port}`,
    });

    expect(response.id).toBe(expectedResponse.id);
    expect(response.type).toBe('response');
  });

  it('receives the request payload on the server side', async () => {
    const server = createTransport({ port: 0 });
    let receivedMessage: SnapMessage | null = null;

    await server.listen(async (msg) => {
      receivedMessage = msg;
      return makeResponse();
    });

    const client = createTransport();
    const request = makeMessage({ id: 'test-recv' });
    await client.send(request, { endpoint: `http://127.0.0.1:${server.port}` });

    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage!.id).toBe('test-recv');
    expect(receivedMessage!.method).toBe('message/send');
  });

  it('returns 404 for wrong path', async () => {
    const server = createTransport({ port: 0, path: '/snap' });
    await server.listen(async () => makeResponse());

    const client = createTransport();
    // Request to root (wrong path)
    await expect(
      client.send(makeMessage(), { endpoint: `http://127.0.0.1:${server.port}` }),
    ).rejects.toThrow('404');
  });

  it('streams SSE events from server', async () => {
    const server = createTransport({ port: 0 });

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

    for await (const msg of client.sendStream(makeMessage({ method: 'message/stream' }), {
      endpoint: `http://127.0.0.1:${server.port}`,
    })) {
      received.push(msg);
    }

    expect(received).toHaveLength(3);
    expect(received[0].id).toBe('evt-1');
    expect(received[0].type).toBe('event');
    expect(received[2].id).toBe('resp-final');
    expect(received[2].type).toBe('response');
  });

  it('falls back to request-response handler when no stream handler', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => makeResponse({ id: 'fallback-resp' }));

    const client = createTransport();
    // Even with Accept: text/event-stream, if no stream handler is set,
    // the server falls back to request-response
    const response = await client.send(makeMessage(), {
      endpoint: `http://127.0.0.1:${server.port}`,
    });

    expect(response.id).toBe('fallback-resp');
  });

  it('returns error payload when no handler is registered', async () => {
    // Start a server with listenStream only, then send a non-stream request
    const server = createTransport({ port: 0 });
    await server.listenStream(async function* () {
      yield makeResponse({ id: 'stream-only', type: 'response' });
    });

    const client = createTransport();
    // Normal POST (no Accept: text/event-stream) → no handler → 200 with error
    const response = await client.send(
      makeMessage(),
      { endpoint: `http://127.0.0.1:${server.port}` },
    );
    expect((response as any).error.code).toBe(1007);
  });

  it('closes the server gracefully', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => makeResponse());
    const port = server.port;
    expect(port).toBeDefined();

    await server.close();
    expect(server.port).toBeUndefined();

    // Attempting to connect should fail
    const client = createTransport();
    await expect(
      client.send(makeMessage(), { endpoint: `http://127.0.0.1:${port}` }),
    ).rejects.toThrow();
  });

  it('port is undefined before listen', () => {
    const transport = createTransport();
    expect(transport.port).toBeUndefined();
  });

  it('supports both listen and listenStream simultaneously', async () => {
    const server = createTransport({ port: 0 });

    await server.listen(async () => makeResponse({ id: 'rr-resp' }));
    await server.listenStream(async function* () {
      yield makeResponse({ id: 'stream-evt', type: 'event' });
      yield makeResponse({ id: 'stream-final', type: 'response' });
    });

    const client = createTransport();
    const endpoint = `http://127.0.0.1:${server.port}`;

    // Request-response
    const rrResp = await client.send(makeMessage(), { endpoint });
    expect(rrResp.id).toBe('rr-resp');

    // SSE streaming
    const streamMsgs: SnapMessage[] = [];
    for await (const msg of client.sendStream(makeMessage({ method: 'message/stream' }), { endpoint })) {
      streamMsgs.push(msg);
    }
    expect(streamMsgs).toHaveLength(2);
    expect(streamMsgs[0].id).toBe('stream-evt');
  });

  // --- Edge case tests ---

  it('returns 404 for non-POST methods', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => makeResponse());

    // Use raw fetch to send a GET request
    const resp = await fetch(`http://127.0.0.1:${server.port}/`, { method: 'GET' });
    expect(resp.status).toBe(404);
  });

  it('handler returning void sends 204 No Content', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => undefined as any);

    const resp = await fetch(`http://127.0.0.1:${server.port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeMessage()),
    });
    expect(resp.status).toBe(204);
  });

  it('handles multiple concurrent requests', async () => {
    const server = createTransport({ port: 0 });
    let counter = 0;
    await server.listen(async (msg) => {
      counter++;
      return makeResponse({ id: `resp-${msg.id}` });
    });

    const client = createTransport();
    const endpoint = `http://127.0.0.1:${server.port}`;

    const promises = Array.from({ length: 5 }, (_, i) =>
      client.send(makeMessage({ id: `concurrent-${i}` }), { endpoint }),
    );

    const responses = await Promise.all(promises);
    expect(responses).toHaveLength(5);
    expect(counter).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(responses[i].id).toBe(`resp-concurrent-${i}`);
    }
  });

  it('send() rejects on connection refused', async () => {
    const client = createTransport();
    await expect(
      client.send(makeMessage(), { endpoint: 'http://127.0.0.1:1' }),
    ).rejects.toThrow();
  });

  it('send() rejects on timeout', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => {
      // Simulate slow response
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return makeResponse();
    });

    const client = createTransport({ timeout: 100 });
    await expect(
      client.send(makeMessage(), { endpoint: `http://127.0.0.1:${server.port}` }),
    ).rejects.toThrow();
  });

  it('sendStream() rejects on connection refused', async () => {
    const client = createTransport();
    const collected: SnapMessage[] = [];

    await expect(async () => {
      for await (const msg of client.sendStream(makeMessage(), { endpoint: 'http://127.0.0.1:1' })) {
        collected.push(msg);
      }
    }).rejects.toThrow();
    expect(collected).toHaveLength(0);
  });

  it('close() is idempotent', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => makeResponse());
    await server.close();
    // Second close should not throw
    await server.close();
  });

  it('uses custom path for listening', async () => {
    const server = createTransport({ port: 0, path: '/snap/v1' });
    await server.listen(async () => makeResponse({ id: 'custom-path' }));

    const client = createTransport();
    // Correct path should work
    const response = await client.send(makeMessage(), {
      endpoint: `http://127.0.0.1:${server.port}/snap/v1`,
    });
    expect(response.id).toBe('custom-path');

    // Wrong path should 404
    await expect(
      client.send(makeMessage(), { endpoint: `http://127.0.0.1:${server.port}/wrong` }),
    ).rejects.toThrow('404');
  });

  it('server handles malformed JSON body with 400', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => makeResponse());

    const resp = await fetch(`http://127.0.0.1:${server.port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    });
    expect(resp.status).toBe(400);
  });

  it('SSE stream with no events (immediate final response)', async () => {
    const server = createTransport({ port: 0 });
    await server.listenStream(async function* () {
      yield makeResponse({ id: 'only-final', type: 'response' });
    });

    const client = createTransport();
    const received: SnapMessage[] = [];
    for await (const msg of client.sendStream(makeMessage({ method: 'message/stream' }), {
      endpoint: `http://127.0.0.1:${server.port}`,
    })) {
      received.push(msg);
    }

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('only-final');
    expect(received[0].type).toBe('response');
  });

  it('SSE stream with many events', async () => {
    const server = createTransport({ port: 0 });
    const eventCount = 20;

    await server.listenStream(async function* () {
      for (let i = 0; i < eventCount - 1; i++) {
        yield makeResponse({ id: `evt-${i}`, type: 'event' });
      }
      yield makeResponse({ id: 'final', type: 'response' });
    });

    const client = createTransport();
    const received: SnapMessage[] = [];
    for await (const msg of client.sendStream(makeMessage({ method: 'message/stream' }), {
      endpoint: `http://127.0.0.1:${server.port}`,
    })) {
      received.push(msg);
    }

    expect(received).toHaveLength(eventCount);
    expect(received[eventCount - 1].id).toBe('final');
  });

  it('per-request timeout overrides config timeout', async () => {
    const server = createTransport({ port: 0 });
    await server.listen(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return makeResponse();
    });

    const client = createTransport({ timeout: 60_000 }); // Long default
    await expect(
      client.send(makeMessage(), {
        endpoint: `http://127.0.0.1:${server.port}`,
        timeout: 100, // Short override
      }),
    ).rejects.toThrow();
  });

  // --- Logger tests ---

  it('logger is called when request handler throws', async () => {
    const logs: Array<{ level: string; message: string; data: unknown }> = [];
    const server = createTransport({
      port: 0,
      logger: (level, message, data) => {
        logs.push({ level, message, data });
      },
    });

    await server.listen(async () => {
      throw new Error('handler boom');
    });

    const resp = await fetch(`http://127.0.0.1:${server.port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeMessage()),
    });

    expect(resp.status).toBe(500);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].level).toBe('error');
    expect(logs[0].message).toContain('HTTP request handler error');
    expect(logs[0].data).toBeInstanceOf(Error);
  });

  it('malformed JSON body returns 400 without logging an error', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const server = createTransport({
      port: 0,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    await server.listen(async () => makeResponse());

    const resp = await fetch(`http://127.0.0.1:${server.port}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    });

    expect(resp.status).toBe(400);
    // Malformed JSON is handled gracefully — no error logged
    expect(logs.length).toBe(0);
  });

  // --- Streaming edge case tests ---

  it('sendStream() timeout resets on each SSE event', async () => {
    const server = createTransport({ port: 0 });

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
      { endpoint: `http://127.0.0.1:${server.port}` },
    )) {
      received.push(msg);
    }

    expect(received).toHaveLength(4);
    expect(received[3].id).toBe('slow-final');
  });

  it('sendStream() aborts when no events arrive within timeout', async () => {
    const server = createTransport({ port: 0 });

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
        { endpoint: `http://127.0.0.1:${server.port}` },
      )) {
        received.push(msg);
      }
    }).rejects.toThrow();

    // First event was received before timeout
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('evt-1');
  });

  it('sendStream() handles server ending response mid-stream', async () => {
    const server = createTransport({ port: 0 });

    await server.listenStream(async function* () {
      yield makeResponse({ id: 'before-end', type: 'event' });
      // Generator ends without yielding a type=response — server closes connection
    });

    const client = createTransport();
    const received: SnapMessage[] = [];
    for await (const msg of client.sendStream(
      makeMessage({ method: 'message/stream' }),
      { endpoint: `http://127.0.0.1:${server.port}` },
    )) {
      received.push(msg);
    }

    // Stream ends gracefully when the HTTP response body closes
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].id).toBe('before-end');
  });
});
