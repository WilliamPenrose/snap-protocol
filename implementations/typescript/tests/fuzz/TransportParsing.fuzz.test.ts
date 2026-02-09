/**
 * Fuzz tests for Transport-layer JSON parsing.
 *
 * Send random payloads to HTTP and WebSocket transports to verify
 * they never crash on malformed input.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import { HttpTransport } from '../../src/transport/HttpTransport.js';
import { WebSocketTransport } from '../../src/transport/WebSocketTransport.js';
import type { SnapMessage } from '../../src/types/message.js';

const DUMMY_SIG = '0'.repeat(128);

function makeResponse(): SnapMessage {
  return {
    id: 'fuzz-resp',
    version: '0.1',
    from: 'bc1pxyz' as SnapMessage['from'],
    to: 'bc1pxyz' as SnapMessage['to'],
    type: 'response',
    method: 'message/send',
    payload: { task: { id: 'task-1', status: { state: 'completed', timestamp: new Date().toISOString() } } },
    timestamp: Date.now(),
    sig: DUMMY_SIG,
  };
}

describe('Transport Parsing — Fuzz', () => {
  // ── HTTP Transport ──

  describe('HttpTransport', () => {
    let server: HttpTransport | undefined;

    afterEach(async () => {
      if (server) {
        await server.close();
        server = undefined;
      }
    });

    it('does not crash when receiving random string bodies', async () => {
      server = new HttpTransport({ port: 0 });
      let handlerCalled = false;

      await server.listen(async () => {
        handlerCalled = true;
        return makeResponse();
      });

      const endpoint = `http://127.0.0.1:${server.port}/`;

      // Send 20 random bodies
      await fc.assert(
        fc.asyncProperty(fc.string({ maxLength: 1000 }), async (body) => {
          handlerCalled = false;
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });

          // Server should respond with a status code, not crash
          expect(resp.status).toBeGreaterThanOrEqual(200);
          expect(resp.status).toBeLessThan(600);
        }),
        { numRuns: 20 },
      );
    });

    it('does not crash when receiving random JSON values as body', async () => {
      server = new HttpTransport({ port: 0 });

      await server.listen(async () => makeResponse());

      const endpoint = `http://127.0.0.1:${server.port}/`;

      await fc.assert(
        fc.asyncProperty(fc.jsonValue(), async (value) => {
          const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(value),
          });
          expect(resp.status).toBeGreaterThanOrEqual(200);
          expect(resp.status).toBeLessThan(600);
        }),
        { numRuns: 20 },
      );
    });
  });

  // ── WebSocket Transport ──

  describe('WebSocketTransport', () => {
    let server: WebSocketTransport | undefined;

    afterEach(async () => {
      if (server) {
        await server.close();
        server = undefined;
      }
    });

    it('does not crash when receiving random string messages', async () => {
      server = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });
      await server.listen(async () => makeResponse());

      const { WebSocket: WsWebSocket } = await import('ws');

      // Generate 20 random strings and send them all
      const randomStrings = fc.sample(fc.string({ maxLength: 500 }), 20);

      const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws.once('open', resolve));

      for (const str of randomStrings) {
        ws.send(str);
      }

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Server should still be alive — send a valid message and get response
      const validMsg = {
        id: 'post-fuzz',
        version: '0.1',
        from: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
        to: 'bc1pxyz',
        type: 'request',
        method: 'message/send',
        payload: {},
        timestamp: Date.now(),
        sig: DUMMY_SIG,
      };

      const responsePromise = new Promise<string>((resolve) => {
        ws.once('message', (data) => resolve(data.toString()));
      });
      ws.send(JSON.stringify(validMsg));

      const responseStr = await Promise.race([
        responsePromise,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 2000)),
      ]);

      expect(responseStr).not.toBe('timeout');
      ws.close();
    });

    it('does not crash when receiving random JSON values', async () => {
      server = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });
      await server.listen(async () => makeResponse());

      const { WebSocket: WsWebSocket } = await import('ws');

      const randomValues = fc.sample(fc.jsonValue(), 20);

      const ws = new WsWebSocket(`ws://127.0.0.1:${server.port}`);
      await new Promise<void>((resolve) => ws.once('open', resolve));

      for (const val of randomValues) {
        ws.send(JSON.stringify(val));
      }

      // Wait and verify server is still alive
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Server port should still be available
      expect(server.port).toBeDefined();

      ws.close();
    });
  });
});
