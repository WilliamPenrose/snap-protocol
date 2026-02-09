import { describe, it, expect, afterEach } from 'vitest';
import { SnapAgent } from '../../src/agent/SnapAgent.js';
import { HttpTransport } from '../../src/transport/HttpTransport.js';
import { WebSocketTransport } from '../../src/transport/WebSocketTransport.js';
import { InMemoryReplayStore } from '../../src/stores/InMemoryReplayStore.js';
import { InMemoryTaskStore } from '../../src/stores/InMemoryTaskStore.js';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import type { AgentCard } from '../../src/types/agent-card.js';
import type { SnapMessage } from '../../src/types/message.js';
import type { MessageSendRequest } from '../../src/types/payloads.js';

const AGENT_A_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
const AGENT_B_KEY = '0000000000000000000000000000000000000000000000000000000000000002';

function makeCard(name: string): AgentCard {
  return {
    name,
    description: `${name} agent`,
    version: '1.0.0',
    identity: '' as any,
    skills: [{ id: 'echo', name: 'Echo', description: 'Echo back', tags: ['test'] }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}

describe('Agent-to-Agent Integration', () => {
  const agents: SnapAgent[] = [];

  afterEach(async () => {
    for (const agent of agents) {
      await agent.stop();
    }
    agents.length = 0;
  });

  it('two agents communicate via HTTP: message/send round-trip', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Echo Agent') });
    agentA.transport(httpA);
    agentA.replayStore(new InMemoryReplayStore());
    agentA.taskStore(new InMemoryTaskStore());

    agentA.handle('message/send', async (payload, ctx) => {
      const msg = (payload as MessageSendRequest).message;
      const taskStore = ctx.taskStore!;
      const task = {
        id: 'task-echo-001',
        status: { state: 'completed' as const, timestamp: new Date().toISOString() },
        history: [
          msg,
          {
            messageId: 'resp-001',
            role: 'agent' as const,
            parts: [{ type: 'text' as const, text: `Echo: ${(msg.parts[0] as any).text}` }],
          },
        ],
      };
      await taskStore.set(task.id, task);
      return { task };
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('Caller') });
    agentB.transport(new HttpTransport());
    agents.push(agentB);

    const result = await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${httpA.port}`,
      {
        messageId: 'msg-001',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello, Agent A!' }],
      },
    );

    expect(result.task.id).toBe('task-echo-001');
    expect(result.task.status.state).toBe('completed');
    expect(result.task.history).toHaveLength(2);
    expect((result.task.history![1].parts[0] as any).text).toBe('Echo: Hello, Agent A!');
  });

  it('two agents communicate via WebSocket: message/send round-trip', async () => {
    const wsA = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('WS Echo') });
    agentA.transport(wsA);

    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'task-ws-001',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [msg],
        },
      };
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('WS Caller') });
    agentB.transport(new WebSocketTransport({ heartbeatInterval: 0 }));
    agents.push(agentB);

    const result = await agentB.sendMessage(
      agentA.address,
      `ws://127.0.0.1:${wsA.port}`,
      {
        messageId: 'msg-ws-001',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello via WebSocket!' }],
      },
    );

    expect(result.task.id).toBe('task-ws-001');
    expect(result.task.status.state).toBe('completed');
  });

  it('streaming via WebSocket: message/stream with events + final response', async () => {
    const wsA = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Stream Agent') });
    agentA.transport(wsA);

    agentA.handleStream('message/stream', async function* (_payload, ctx) {
      // Yield progress events
      const signerA = new MessageSigner(AGENT_A_KEY);
      const from = agentA.address;
      const to = ctx.message.from;

      // Event 1: progress
      const evt1 = new MessageBuilder()
        .id('evt-001')
        .from(from)
        .to(to)
        .type('event')
        .method('message/stream')
        .payload({ progress: 0.5, message: 'Processing...' })
        .timestamp(Math.floor(Date.now() / 1000))
        .build();
      yield signerA.sign(evt1);

      // Event 2: progress
      const evt2 = new MessageBuilder()
        .id('evt-002')
        .from(from)
        .to(to)
        .type('event')
        .method('message/stream')
        .payload({ progress: 1.0, message: 'Done!' })
        .timestamp(Math.floor(Date.now() / 1000))
        .build();
      yield signerA.sign(evt2);

      // Final response
      const resp = new MessageBuilder()
        .id('resp-stream')
        .from(from)
        .to(to)
        .type('response')
        .method('message/stream')
        .payload({
          task: {
            id: 'task-stream-001',
            status: { state: 'completed', timestamp: new Date().toISOString() },
          },
        })
        .timestamp(Math.floor(Date.now() / 1000))
        .build();
      yield signerA.sign(resp);
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('Stream Caller') });
    agentB.transport(new WebSocketTransport({ heartbeatInterval: 0 }));
    agents.push(agentB);

    const messages: SnapMessage[] = [];
    for await (const msg of agentB.sendStream(
      agentA.address,
      `ws://127.0.0.1:${wsA.port}`,
      'message/stream',
      { message: { messageId: 'msg-s1', role: 'user', parts: [{ type: 'text', text: 'Stream me' }] } },
    )) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(3);
    expect(messages[0].type).toBe('event');
    expect(messages[1].type).toBe('event');
    expect(messages[2].type).toBe('response');
    expect((messages[2].payload as any).task.status.state).toBe('completed');
  });

  it('streaming via HTTP SSE: message/stream with events + final response', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('SSE Agent') });
    agentA.transport(httpA);

    agentA.handleStream('message/stream', async function* (_payload, ctx) {
      const signerA = new MessageSigner(AGENT_A_KEY);
      const from = agentA.address;
      const to = ctx.message.from;

      // Event
      const evt = new MessageBuilder()
        .id('sse-evt-001')
        .from(from)
        .to(to)
        .type('event')
        .method('message/stream')
        .payload({ progress: 1.0 })
        .timestamp(Math.floor(Date.now() / 1000))
        .build();
      yield signerA.sign(evt);

      // Final response
      const resp = new MessageBuilder()
        .id('sse-resp')
        .from(from)
        .to(to)
        .type('response')
        .method('message/stream')
        .payload({
          task: {
            id: 'task-sse-001',
            status: { state: 'completed', timestamp: new Date().toISOString() },
          },
        })
        .timestamp(Math.floor(Date.now() / 1000))
        .build();
      yield signerA.sign(resp);
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('SSE Caller') });
    agentB.transport(new HttpTransport());
    agents.push(agentB);

    const messages: SnapMessage[] = [];
    for await (const msg of agentB.sendStream(
      agentA.address,
      `http://127.0.0.1:${httpA.port}`,
      'message/stream',
      { message: { messageId: 'msg-sse-1', role: 'user', parts: [{ type: 'text', text: 'SSE me' }] } },
    )) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe('event');
    expect(messages[1].type).toBe('response');
  });

  it('tasks/get and tasks/cancel work across agents', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Task Agent') });
    const taskStore = new InMemoryTaskStore();
    agentA.transport(httpA).taskStore(taskStore);

    // Pre-populate a task
    await taskStore.set('task-100', {
      id: 'task-100',
      status: { state: 'working', timestamp: new Date().toISOString() },
    });

    agentA.handle('tasks/get', async (payload, ctx) => {
      const task = await ctx.taskStore!.get((payload as any).taskId);
      if (!task) throw new Error('Task not found');
      return { task };
    });

    agentA.handle('tasks/cancel', async (payload, ctx) => {
      const task = await ctx.taskStore!.get((payload as any).taskId);
      if (!task) throw new Error('Task not found');
      task.status = { state: 'canceled', timestamp: new Date().toISOString() };
      await ctx.taskStore!.set(task.id, task);
      return { task };
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('Task Caller') });
    agentB.transport(new HttpTransport());
    agents.push(agentB);

    const endpoint = `http://127.0.0.1:${httpA.port}`;

    // Get task
    const getResult = await agentB.getTask(agentA.address, endpoint, 'task-100');
    expect(getResult.task.id).toBe('task-100');
    expect(getResult.task.status.state).toBe('working');

    // Cancel task
    const cancelResult = await agentB.cancelTask(agentA.address, endpoint, 'task-100');
    expect(cancelResult.task.id).toBe('task-100');
    expect(cancelResult.task.status.state).toBe('canceled');
  });

  it('middleware runs on both agents in the chain', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('MW Agent A') });
    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('MW Agent B') });

    const logA: string[] = [];
    const logB: string[] = [];

    agentA.transport(httpA);
    agentA.use({
      name: 'log-a',
      async handle(ctx, next) {
        logA.push(`${ctx.direction}:${ctx.message.method}`);
        await next();
      },
    });
    agentA.handle('message/send', async () => ({
      task: {
        id: 'task-mw',
        status: { state: 'completed' as const, timestamp: new Date().toISOString() },
      },
    }));

    agentB.transport(new HttpTransport());
    agentB.use({
      name: 'log-b',
      async handle(ctx, next) {
        logB.push(`${ctx.direction}:${ctx.message.method}`);
        await next();
      },
    });

    await agentA.start();
    agents.push(agentA, agentB);

    await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${httpA.port}`,
      { messageId: 'msg-mw', role: 'user', parts: [{ type: 'text', text: 'mw test' }] },
    );

    // Agent A should have: inbound (request), outbound (response)
    expect(logA).toContain('inbound:message/send');
    expect(logA).toContain('outbound:message/send');

    // Agent B should have: outbound (request)
    expect(logB).toContain('outbound:message/send');
  });

  it('bidirectional via HTTP: both agents send and receive', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const httpB = new HttpTransport({ port: 0 });

    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Bidir A') });
    agentA.transport(httpA);
    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'task-from-a',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [
            msg,
            { messageId: 'resp-a', role: 'agent' as const, parts: [{ type: 'text' as const, text: `A says: ${(msg.parts[0] as any).text}` }] },
          ],
        },
      };
    });

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('Bidir B') });
    agentB.transport(httpB);
    agentB.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'task-from-b',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [
            msg,
            { messageId: 'resp-b', role: 'agent' as const, parts: [{ type: 'text' as const, text: `B says: ${(msg.parts[0] as any).text}` }] },
          ],
        },
      };
    });

    await agentA.start();
    await agentB.start();
    agents.push(agentA, agentB);

    // B → A
    const resultFromA = await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${httpA.port}`,
      { messageId: 'msg-b2a', role: 'user', parts: [{ type: 'text', text: 'Hello from B' }] },
    );
    expect(resultFromA.task.id).toBe('task-from-a');
    expect((resultFromA.task.history![1].parts[0] as any).text).toBe('A says: Hello from B');

    // A → B (reverse)
    const resultFromB = await agentA.sendMessage(
      agentB.address,
      `http://127.0.0.1:${httpB.port}`,
      { messageId: 'msg-a2b', role: 'user', parts: [{ type: 'text', text: 'Hello from A' }] },
    );
    expect(resultFromB.task.id).toBe('task-from-b');
    expect((resultFromB.task.history![1].parts[0] as any).text).toBe('B says: Hello from A');
  });

  it('bidirectional via WebSocket: both agents send and receive', async () => {
    const wsA = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });
    const wsB = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });

    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('WS Bidir A') });
    agentA.transport(wsA);
    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'ws-task-from-a',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [msg],
        },
      };
    });

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('WS Bidir B') });
    agentB.transport(wsB);
    agentB.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'ws-task-from-b',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [msg],
        },
      };
    });

    await agentA.start();
    await agentB.start();
    agents.push(agentA, agentB);

    // B → A
    const resultFromA = await agentB.sendMessage(
      agentA.address,
      `ws://127.0.0.1:${wsA.port}`,
      { messageId: 'ws-b2a', role: 'user', parts: [{ type: 'text', text: 'WS Hello from B' }] },
    );
    expect(resultFromA.task.id).toBe('ws-task-from-a');

    // A → B
    const resultFromB = await agentA.sendMessage(
      agentB.address,
      `ws://127.0.0.1:${wsB.port}`,
      { messageId: 'ws-a2b', role: 'user', parts: [{ type: 'text', text: 'WS Hello from A' }] },
    );
    expect(resultFromB.task.id).toBe('ws-task-from-b');
  });

  it('handler exception returns signed error to sender via HTTP', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Error Agent') });
    agentA.transport(httpA);

    agentA.handle('message/send', async () => {
      throw new Error('Intentional failure');
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('Error Caller') });
    agentB.transport(new HttpTransport());
    agents.push(agentB);

    // processMessage throws → HTTP 500 → agentB.send rejects
    await expect(
      agentB.sendMessage(
        agentA.address,
        `http://127.0.0.1:${httpA.port}`,
        { messageId: 'msg-err', role: 'user', parts: [{ type: 'text', text: 'trigger error' }] },
      ),
    ).rejects.toThrow();
  });

  it('handler exception propagates error via WebSocket (client times out)', async () => {
    const wsA = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('WS Error Agent') });
    agentA.transport(wsA);

    agentA.handle('message/send', async () => {
      throw new Error('WS handler exploded');
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('WS Error Caller') });
    agentB.transport(new WebSocketTransport({ heartbeatInterval: 0, timeout: 1000 }));
    agents.push(agentB);

    await expect(
      agentB.sendMessage(
        agentA.address,
        `ws://127.0.0.1:${wsA.port}`,
        { messageId: 'msg-ws-err', role: 'user', parts: [{ type: 'text', text: 'boom' }] },
      ),
    ).rejects.toThrow();
  });

  it('replay protection rejects duplicate messages via HTTP', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Replay Agent') });
    agentA.transport(httpA);
    agentA.replayStore(new InMemoryReplayStore());

    agentA.handle('message/send', async () => ({
      task: { id: 'task-rp', status: { state: 'completed' as const, timestamp: new Date().toISOString() } },
    }));

    await agentA.start();
    agents.push(agentA);

    // Build a signed message manually so we can send the exact same bytes twice
    const signerB = new MessageSigner(AGENT_B_KEY);
    const addrB = signerB.getAddress();
    const unsigned = new MessageBuilder()
      .id('replay-msg-001')
      .from(addrB)
      .to(agentA.address)
      .method('message/send')
      .payload({ message: { messageId: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] } })
      .timestamp(Math.floor(Date.now() / 1000))
      .build();
    const signed = signerB.sign(unsigned);

    const endpoint = `http://127.0.0.1:${httpA.port}/`;

    // First send should succeed (200)
    const resp1 = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
    });
    expect(resp1.status).toBe(200);

    // Second send with same message should fail (duplicate → 500)
    const resp2 = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed),
    });
    expect(resp2.status).toBe(500);
  });

  it('middleware runs on streaming requests (inbound + outbound)', async () => {
    const wsA = new WebSocketTransport({ port: 0, heartbeatInterval: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('MW Stream Agent') });

    const logA: string[] = [];
    agentA.transport(wsA);
    agentA.use({
      name: 'stream-logger',
      async handle(ctx, next) {
        logA.push(`${ctx.direction}:${ctx.message.method}`);
        await next();
      },
    });

    agentA.handleStream('message/stream', async function* (_payload, ctx) {
      const signerA = new MessageSigner(AGENT_A_KEY);
      const resp = new MessageBuilder()
        .id('mw-stream-resp')
        .from(agentA.address)
        .to(ctx.message.from)
        .type('response')
        .method('message/stream')
        .payload({ task: { id: 'task-mw-stream', status: { state: 'completed', timestamp: new Date().toISOString() } } })
        .timestamp(Math.floor(Date.now() / 1000))
        .build();
      yield signerA.sign(resp);
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('MW Stream Caller') });
    const logB: string[] = [];
    agentB.transport(new WebSocketTransport({ heartbeatInterval: 0 }));
    agentB.use({
      name: 'stream-logger-b',
      async handle(ctx, next) {
        logB.push(`${ctx.direction}:${ctx.message.method}`);
        await next();
      },
    });
    agents.push(agentB);

    const messages: SnapMessage[] = [];
    for await (const msg of agentB.sendStream(
      agentA.address,
      `ws://127.0.0.1:${wsA.port}`,
      'message/stream',
      { message: { messageId: 'msg-mw-s', role: 'user', parts: [{ type: 'text', text: 'stream mw' }] } },
    )) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    // Agent A: inbound middleware ran for the stream request
    expect(logA).toContain('inbound:message/stream');
    // Agent B: outbound middleware ran for the stream request
    expect(logB).toContain('outbound:message/stream');
  });

  it('routes different methods to correct handlers on same agent', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Multi Method') });
    agentA.transport(httpA);

    const callLog: string[] = [];

    agentA.handle('message/send', async () => {
      callLog.push('message/send');
      return {
        task: { id: 'task-send', status: { state: 'completed' as const, timestamp: new Date().toISOString() } },
      };
    });

    agentA.handle('tasks/get', async (payload) => {
      callLog.push('tasks/get');
      return {
        task: { id: (payload as any).taskId, status: { state: 'working' as const, timestamp: new Date().toISOString() } },
      };
    });

    agentA.handle('tasks/cancel', async (payload) => {
      callLog.push('tasks/cancel');
      return {
        task: { id: (payload as any).taskId, status: { state: 'canceled' as const, timestamp: new Date().toISOString() } },
      };
    });

    await agentA.start();
    agents.push(agentA);

    const agentB = new SnapAgent({ privateKey: AGENT_B_KEY, card: makeCard('Multi Caller') });
    agentB.transport(new HttpTransport());
    agents.push(agentB);

    const endpoint = `http://127.0.0.1:${httpA.port}`;

    const sendResult = await agentB.sendMessage(agentA.address, endpoint, {
      messageId: 'msg-multi-1', role: 'user', parts: [{ type: 'text', text: 'multi test' }],
    });
    expect(sendResult.task.id).toBe('task-send');

    const getResult = await agentB.getTask(agentA.address, endpoint, 'task-42');
    expect(getResult.task.id).toBe('task-42');
    expect(getResult.task.status.state).toBe('working');

    const cancelResult = await agentB.cancelTask(agentA.address, endpoint, 'task-42');
    expect(cancelResult.task.id).toBe('task-42');
    expect(cancelResult.task.status.state).toBe('canceled');

    expect(callLog).toEqual(['message/send', 'tasks/get', 'tasks/cancel']);
  });

  it('handles concurrent sends from multiple agents', async () => {
    const httpA = new HttpTransport({ port: 0 });
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Concurrent Agent') });
    agentA.transport(httpA);

    let counter = 0;
    agentA.handle('message/send', async (payload) => {
      counter++;
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: `task-${counter}`,
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [msg],
        },
      };
    });

    await agentA.start();
    agents.push(agentA);

    const endpoint = `http://127.0.0.1:${httpA.port}`;

    const senderKeys = [
      AGENT_B_KEY,
      '0000000000000000000000000000000000000000000000000000000000000003',
      '0000000000000000000000000000000000000000000000000000000000000004',
      '0000000000000000000000000000000000000000000000000000000000000005',
      '0000000000000000000000000000000000000000000000000000000000000006',
    ];

    const promises = senderKeys.map((key, i) => {
      const sender = new SnapAgent({ privateKey: key, card: makeCard(`Sender ${i}`) });
      sender.transport(new HttpTransport());
      agents.push(sender);
      return sender.sendMessage(agentA.address, endpoint, {
        messageId: `msg-concurrent-${i}`, role: 'user', parts: [{ type: 'text', text: `Hello ${i}` }],
      });
    });

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(counter).toBe(5);

    for (const result of results) {
      expect(result.task.status.state).toBe('completed');
    }
  });
});
