/**
 * Integration tests for Agent-to-Service communication (RFC 001).
 *
 * Tests the full end-to-end flow:
 *   1. Agent builds & signs a `service/call` message without `to`
 *   2. Sends it over HTTP to a service endpoint
 *   3. Service validates the message (structure + signature + timestamp)
 *   4. Service checks `from` against an allowlist
 *   5. Service processes the request and returns a plain JSON response
 *
 * Also tests the SnapAgent path: an agent with a `service/call` handler
 * processes inbound messages that have no `to` field.
 */
import { createServer, type Server } from 'node:http';
import { describe, it, expect, afterEach } from 'vitest';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import { MessageValidator } from '../../src/messaging/MessageValidator.js';
import { SnapAgent } from '../../src/agent/SnapAgent.js';
import { HttpTransport } from '../../src/transport/HttpTransport.js';
import { InMemoryReplayStore } from '../../src/stores/InMemoryReplayStore.js';
import type { AgentCard } from '../../src/types/agent-card.js';

const CLIENT_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
const CLIENT_SIGNER = new MessageSigner(CLIENT_KEY);
const CLIENT_ADDRESS = CLIENT_SIGNER.getAddress();

const UNAUTHORIZED_KEY = '0000000000000000000000000000000000000000000000000000000000000003';
const UNAUTHORIZED_SIGNER = new MessageSigner(UNAUTHORIZED_KEY);
const UNAUTHORIZED_ADDRESS = UNAUTHORIZED_SIGNER.getAddress();

function makeCard(name: string): AgentCard {
  return {
    name,
    description: `${name} agent`,
    version: '1.0.0',
    identity: '' as any,
    skills: [{ id: 'service', name: 'Service', description: 'Service call', tags: ['service'] }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}

/**
 * Create a plain HTTP server that acts as a SNAP-authenticated service.
 * This simulates the server-side pattern from RFC 001:
 *   - MessageValidator.validate() for structure + signature + timestamp
 *   - Allowlist check on `from` address
 *   - No P2TR identity, no private key, no SnapAgent
 */
function createServiceServer(allowlist: Set<string>): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      // Only accept POST
      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Read body
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString('utf-8');

      let message: unknown;
      try {
        message = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      // Step 1: Validate structure + signature + timestamp
      try {
        MessageValidator.validate(message);
      } catch (err: any) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
        return;
      }

      const msg = message as any;

      // Step 2: Allowlist check
      if (!allowlist.has(msg.from)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Address not authorized' }));
        return;
      }

      // Step 3: Process the request
      const { name, arguments: args } = msg.payload;
      let result: unknown;
      if (name === 'echo') {
        result = { echoed: args };
      } else if (name === 'add') {
        result = { sum: (args?.a ?? 0) + (args?.b ?? 0) };
      } else {
        result = { message: `Unknown capability: ${name}` };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result }));
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

describe('Agent-to-Service Integration', () => {
  const servers: Server[] = [];
  const agents: SnapAgent[] = [];

  afterEach(async () => {
    for (const s of servers) {
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
    servers.length = 0;

    for (const a of agents) {
      await a.stop();
    }
    agents.length = 0;
  });

  // ─── Plain HTTP service (no SnapAgent on server) ─────────────────

  describe('plain HTTP service with MessageValidator + allowlist', () => {
    it('authorized agent calls service/call and gets response', async () => {
      const allowlist = new Set([CLIENT_ADDRESS]);
      const { server, port } = await createServiceServer(allowlist);
      servers.push(server);

      const now = Math.floor(Date.now() / 1000);
      const msg = new MessageBuilder()
        .id('svc-int-001')
        .from(CLIENT_ADDRESS)
        .method('service/call')
        .payload({ name: 'echo', arguments: { hello: 'world' } })
        .timestamp(now)
        .build();
      const signed = CLIENT_SIGNER.sign(msg);

      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result).toEqual({ echoed: { hello: 'world' } });
    });

    it('authorized agent calls different capabilities', async () => {
      const allowlist = new Set([CLIENT_ADDRESS]);
      const { server, port } = await createServiceServer(allowlist);
      servers.push(server);

      const now = Math.floor(Date.now() / 1000);
      const msg = new MessageBuilder()
        .id('svc-int-002')
        .from(CLIENT_ADDRESS)
        .method('service/call')
        .payload({ name: 'add', arguments: { a: 3, b: 4 } })
        .timestamp(now)
        .build();
      const signed = CLIENT_SIGNER.sign(msg);

      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result).toEqual({ sum: 7 });
    });

    it('unauthorized agent is rejected with 403', async () => {
      const allowlist = new Set([CLIENT_ADDRESS]); // Only CLIENT authorized
      const { server, port } = await createServiceServer(allowlist);
      servers.push(server);

      const now = Math.floor(Date.now() / 1000);
      const msg = new MessageBuilder()
        .id('svc-int-003')
        .from(UNAUTHORIZED_ADDRESS)
        .method('service/call')
        .payload({ name: 'echo', arguments: {} })
        .timestamp(now)
        .build();
      const signed = UNAUTHORIZED_SIGNER.sign(msg);

      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toBe('Address not authorized');
    });

    it('tampered message is rejected with 401', async () => {
      const allowlist = new Set([CLIENT_ADDRESS]);
      const { server, port } = await createServiceServer(allowlist);
      servers.push(server);

      const now = Math.floor(Date.now() / 1000);
      const msg = new MessageBuilder()
        .id('svc-int-004')
        .from(CLIENT_ADDRESS)
        .method('service/call')
        .payload({ name: 'echo', arguments: {} })
        .timestamp(now)
        .build();
      const signed = CLIENT_SIGNER.sign(msg);

      // Tamper with payload after signing
      const tampered = { ...signed, payload: { name: 'drop_database', arguments: {} } };

      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tampered),
      });

      expect(res.status).toBe(401);
    });

    it('expired timestamp is rejected with 401', async () => {
      const allowlist = new Set([CLIENT_ADDRESS]);
      const { server, port } = await createServiceServer(allowlist);
      servers.push(server);

      const expired = Math.floor(Date.now() / 1000) - 120; // 2 minutes ago
      const msg = new MessageBuilder()
        .id('svc-int-005')
        .from(CLIENT_ADDRESS)
        .method('service/call')
        .payload({ name: 'echo', arguments: {} })
        .timestamp(expired)
        .build();
      const signed = CLIENT_SIGNER.sign(msg);

      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });

      expect(res.status).toBe(401);
    });

    it('invalid JSON is rejected with 400', async () => {
      const allowlist = new Set([CLIENT_ADDRESS]);
      const { server, port } = await createServiceServer(allowlist);
      servers.push(server);

      const res = await fetch(`http://127.0.0.1:${port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── SnapAgent with service/call handler ──────────────────────────

  describe('SnapAgent handling service/call (no to field)', () => {
    it('agent processes service/call from client without to', async () => {
      const httpA = new HttpTransport({ port: 0 });
      const agent = new SnapAgent({ privateKey: '0000000000000000000000000000000000000000000000000000000000000002', card: makeCard('Service Agent') });
      agent.transport(httpA);
      agent.replayStore(new InMemoryReplayStore());

      agent.handle('service/call', async (payload) => {
        const { name, arguments: args } = payload as any;
        return { result: `called ${name}`, args };
      });

      await agent.start();
      agents.push(agent);

      const now = Math.floor(Date.now() / 1000);
      const msg = new MessageBuilder()
        .id('svc-agent-int-001')
        .from(CLIENT_ADDRESS)
        .method('service/call')
        .payload({ name: 'my_tool', arguments: { input: 'test' } })
        .timestamp(now)
        .build();
      const signed = CLIENT_SIGNER.sign(msg);

      // Send directly via HTTP POST (not through SnapAgent.send, since client
      // may be a plain HTTP client in Agent-to-Service)
      const res = await fetch(`http://127.0.0.1:${httpA.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.payload.result).toBe('called my_tool');
      expect(body.payload.args).toEqual({ input: 'test' });
    });

    it('agent still processes regular message/send with to', async () => {
      const httpA = new HttpTransport({ port: 0 });
      const agentKey = '0000000000000000000000000000000000000000000000000000000000000002';
      const agent = new SnapAgent({ privateKey: agentKey, card: makeCard('Dual Agent') });
      agent.transport(httpA);

      agent.handle('message/send', async (payload) => {
        return {
          task: {
            id: 'task-dual',
            status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          },
        };
      });

      agent.handle('service/call', async (payload) => {
        return { result: 'service response' };
      });

      await agent.start();
      agents.push(agent);

      // Agent-to-Agent: with `to`
      const clientAgent = new SnapAgent({ privateKey: CLIENT_KEY, card: makeCard('Client') });
      clientAgent.transport(new HttpTransport());
      agents.push(clientAgent);

      const result = await clientAgent.sendMessage(
        agent.address,
        `http://127.0.0.1:${httpA.port}`,
        { messageId: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
      );
      expect(result.task.id).toBe('task-dual');

      // Agent-to-Service: without `to`
      const now = Math.floor(Date.now() / 1000);
      const svcMsg = new MessageBuilder()
        .id('svc-dual-001')
        .from(CLIENT_ADDRESS)
        .method('service/call')
        .payload({ name: 'ping' })
        .timestamp(now)
        .build();
      const signed = CLIENT_SIGNER.sign(svcMsg);

      const res = await fetch(`http://127.0.0.1:${httpA.port}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.payload.result).toBe('service response');
    });

    it('replay protection works for service/call messages', async () => {
      const httpA = new HttpTransport({ port: 0 });
      const agent = new SnapAgent({ privateKey: '0000000000000000000000000000000000000000000000000000000000000002', card: makeCard('Replay Service') });
      agent.transport(httpA);
      agent.replayStore(new InMemoryReplayStore());

      agent.handle('service/call', async () => ({ result: 'ok' }));

      await agent.start();
      agents.push(agent);

      const now = Math.floor(Date.now() / 1000);
      const msg = new MessageBuilder()
        .id('svc-replay-001')
        .from(CLIENT_ADDRESS)
        .method('service/call')
        .payload({ name: 'ping' })
        .timestamp(now)
        .build();
      const signed = CLIENT_SIGNER.sign(msg);

      const endpoint = `http://127.0.0.1:${httpA.port}`;

      // First call succeeds
      const res1 = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });
      expect(res1.status).toBe(200);

      // Replay is rejected
      const res2 = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(signed),
      });
      expect(res2.status).toBe(500);
    });
  });
});
