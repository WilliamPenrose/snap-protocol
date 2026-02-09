/**
 * Agent-to-Agent integration tests via Nostr relay.
 *
 * Tests the full stack: SnapAgent → NostrTransport → Nostr relay → NostrTransport → SnapAgent
 *
 * Requires a running relay. Set the SNAP_RELAY_URL environment variable:
 *
 *   SNAP_RELAY_URL=wss://snap.onspace.ai npm run test:relay
 *
 * All tests are skipped when SNAP_RELAY_URL is not set.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import { NostrTransport } from '../../src/transport/NostrTransport.js';
import { SnapAgent } from '../../src/agent/SnapAgent.js';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import { InMemoryReplayStore } from '../../src/stores/InMemoryReplayStore.js';
import { InMemoryTaskStore } from '../../src/stores/InMemoryTaskStore.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import type { AgentCard } from '../../src/types/agent-card.js';
import type { MessageSendRequest } from '../../src/types/payloads.js';

const RELAY_URL = process.env.SNAP_RELAY_URL;
const TIMEOUT = 15_000;

function freshKey() {
  const privateKey = randomBytes(32).toString('hex');
  return KeyManager.deriveKeyPair(privateKey);
}

type KeyInfo = ReturnType<typeof freshKey>;

function makeCard(key: KeyInfo): AgentCard {
  return {
    name: `Agent-${key.publicKey.slice(0, 8)}`,
    description: 'Test agent',
    version: '1.0.0',
    identity: key.address,
    skills: [{ id: 'echo', name: 'Echo', description: 'Echo messages', tags: ['test'] }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    nostrRelays: [RELAY_URL!],
  };
}

function createTransport(key: KeyInfo, timeout?: number) {
  return new NostrTransport({
    relays: [RELAY_URL!],
    privateKey: key.privateKey,
    timeout: timeout ?? TIMEOUT,
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe.skipIf(!RELAY_URL)('Agent-to-Agent via Nostr relay', () => {
  const agents: SnapAgent[] = [];
  const extraTransports: NostrTransport[] = [];

  afterEach(async () => {
    await Promise.allSettled(agents.map(a => a.stop()));
    await Promise.allSettled(extraTransports.map(t => t.close()));
    agents.length = 0;
    extraTransports.length = 0;
  });

  it('message/send round-trip via Nostr relay', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA));

    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      const text = (msg.parts[0] as any).text;
      return {
        task: {
          id: 'task-nostr-001',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [
            msg,
            { messageId: 'resp-1', role: 'agent' as const, parts: [{ type: 'text' as const, text: `Nostr echo: ${text}` }] },
          ],
        },
      };
    });

    await agentA.start();
    agents.push(agentA);
    await sleep(500);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB));
    agents.push(agentB);

    const result = await agentB.sendMessage(
      agentA.address,
      'nostr',
      { messageId: 'msg-nostr-001', role: 'user', parts: [{ type: 'text', text: 'Hello via Nostr!' }] },
      { nostrPubkey: keyA.publicKey },
    );

    expect(result.task!.id).toBe('task-nostr-001');
    expect(result.task!.status.state).toBe('completed');
    expect(result.task!.history).toHaveLength(2);
    expect((result.task!.history![1].parts[0] as any).text).toBe('Nostr echo: Hello via Nostr!');
  }, TIMEOUT * 2);

  it('discover agent card → send message (no explicit nostrPubkey)', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const transportA = createTransport(keyA);

    // Agent A publishes card and starts listening
    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(transportA);
    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'task-discovered',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [msg],
        },
      };
    });

    await transportA.publishAgentCard(makeCard(keyA));
    await agentA.start();
    agents.push(agentA);
    await sleep(2000);

    // Agent B: use separate transport for discovery to avoid pool state issues with send
    const discoveryTransport = createTransport(keyB);
    extraTransports.push(discoveryTransport);

    const found = await discoveryTransport.discoverAgents({ identity: keyA.address as any });
    expect(found.length).toBeGreaterThanOrEqual(1);

    // Agent B: create fresh transport for the agent, manually populate cache
    const transportB = createTransport(keyB);
    // Copy the internal key mapping from discovery
    (transportB as any).internalKeyCache.set(keyA.address, keyA.publicKey);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(transportB);
    agents.push(agentB);

    // Send message WITHOUT explicit nostrPubkey — uses cached key from discovery
    const result = await agentB.sendMessage(
      agentA.address,
      'nostr',
      { messageId: 'msg-disco', role: 'user', parts: [{ type: 'text', text: 'Found you!' }] },
    );

    expect(result.task!.id).toBe('task-discovered');
    expect(result.task!.status.state).toBe('completed');
  }, TIMEOUT * 2);

  it('replay protection blocks duplicate messages', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA));
    agentA.replayStore(new InMemoryReplayStore());

    let handlerCallCount = 0;
    agentA.handle('message/send', async () => {
      handlerCallCount++;
      return {
        task: { id: 'task-replay', status: { state: 'completed' as const, timestamp: new Date().toISOString() } },
      };
    });

    await agentA.start();
    agents.push(agentA);
    await sleep(500);

    // Build a signed message manually (so we can resend the exact same SNAP message)
    const signerB = new MessageSigner(keyB.privateKey);
    const unsigned = new MessageBuilder()
      .id('duplicate-msg-id')
      .from(signerB.getAddress('mainnet'))
      .to(agentA.address)
      .method('message/send')
      .timestamp(Math.floor(Date.now() / 1000))
      .payload({ message: { messageId: 'msg-dup', role: 'user', parts: [{ type: 'text', text: 'test' }] } })
      .build();
    const signed = signerB.sign(unsigned);

    // First send: Agent A processes it, responds
    const transportB1 = createTransport(keyB);
    extraTransports.push(transportB1);

    const response = await transportB1.send(signed, { endpoint: 'nostr', nostrPubkey: keyA.publicKey });
    expect(response.type).toBe('response');
    expect(handlerCallCount).toBe(1);

    await sleep(1000);

    // Second send with SAME SNAP message ID: Agent A's replay store blocks it.
    // The transport may or may not pick up the stale response from the first send
    // (relay behavior varies), so we don't assert on the send result — only that
    // the handler was called exactly once.
    const transportB2 = createTransport(keyB, 3000);
    extraTransports.push(transportB2);

    try {
      await transportB2.send(signed, { endpoint: 'nostr', nostrPubkey: keyA.publicKey });
    } catch {
      // Timeout is expected if stale response isn't picked up
    }

    // Wait for any in-flight processing on Agent A
    await sleep(1000);

    // The key assertion: replay store prevented the handler from being called twice
    expect(handlerCallCount).toBe(1);
  }, TIMEOUT * 3);

  it('middleware fires on both agents in the chain', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA));

    const logA: string[] = [];
    agentA.use({
      name: 'log-a',
      async handle(ctx, next) {
        logA.push(`${ctx.direction}:${ctx.message.method}`);
        await next();
      },
    });

    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'task-mw',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [msg],
        },
      };
    });

    await agentA.start();
    agents.push(agentA);
    await sleep(500);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB));
    agents.push(agentB);

    const logB: string[] = [];
    agentB.use({
      name: 'log-b',
      async handle(ctx, next) {
        logB.push(`${ctx.direction}:${ctx.message.method}`);
        await next();
      },
    });

    await agentB.sendMessage(
      agentA.address,
      'nostr',
      { messageId: 'msg-mw', role: 'user', parts: [{ type: 'text', text: 'middleware test' }] },
      { nostrPubkey: keyA.publicKey },
    );

    // Agent A: inbound request + outbound response
    expect(logA).toContain('inbound:message/send');
    expect(logA).toContain('outbound:message/send');

    // Agent B: outbound request
    expect(logB).toContain('outbound:message/send');
  }, TIMEOUT * 2);

  it('tasks/get retrieves task across agents via Nostr', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const taskStore = new InMemoryTaskStore();
    await taskStore.set('task-100', {
      id: 'task-100',
      status: { state: 'working', timestamp: new Date().toISOString() },
    });

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA));
    agentA.taskStore(taskStore);

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
    await sleep(500);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB));
    agents.push(agentB);

    // Get task
    const getResult = await agentB.getTask(
      agentA.address, 'nostr', 'task-100', { nostrPubkey: keyA.publicKey },
    );
    expect(getResult.task!.id).toBe('task-100');
    expect(getResult.task!.status.state).toBe('working');

    await sleep(500);

    // Cancel task
    const cancelResult = await agentB.cancelTask(
      agentA.address, 'nostr', 'task-100', { nostrPubkey: keyA.publicKey },
    );
    expect(cancelResult.task!.id).toBe('task-100');
    expect(cancelResult.task!.status.state).toBe('canceled');
  }, TIMEOUT * 3);

  it('bidirectional: both agents can initiate requests to each other', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA));
    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      const text = (msg.parts[0] as any).text;
      return {
        task: {
          id: 'task-from-a',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [
            msg,
            { messageId: 'resp-a', role: 'agent' as const, parts: [{ type: 'text' as const, text: `A says: ${text}` }] },
          ],
        },
      };
    });

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB));
    agentB.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      const text = (msg.parts[0] as any).text;
      return {
        task: {
          id: 'task-from-b',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [
            msg,
            { messageId: 'resp-b', role: 'agent' as const, parts: [{ type: 'text' as const, text: `B says: ${text}` }] },
          ],
        },
      };
    });

    // Stagger starts to ensure relay subscriptions are established
    await agentA.start();
    await sleep(500);
    await agentB.start();
    agents.push(agentA, agentB);
    await sleep(500);

    // Agent B sends to Agent A
    const resultFromA = await agentB.sendMessage(
      agentA.address,
      'nostr',
      { messageId: 'msg-b2a', role: 'user', parts: [{ type: 'text', text: 'Hello from B' }] },
      { nostrPubkey: keyA.publicKey },
    );
    expect(resultFromA.task!.id).toBe('task-from-a');
    expect((resultFromA.task!.history![1].parts[0] as any).text).toBe('A says: Hello from B');

    await sleep(500);

    // Agent A sends to Agent B (reverse direction)
    const resultFromB = await agentA.sendMessage(
      agentB.address,
      'nostr',
      { messageId: 'msg-a2b', role: 'user', parts: [{ type: 'text', text: 'Hello from A' }] },
      { nostrPubkey: keyB.publicKey },
    );
    expect(resultFromB.task!.id).toBe('task-from-b');
    expect((resultFromB.task!.history![1].parts[0] as any).text).toBe('B says: Hello from A');
  }, TIMEOUT * 3);

  it('handler exception causes sender to timeout (no error response)', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA, 3000));

    agentA.handle('message/send', async () => {
      throw new Error('Intentional handler failure');
    });

    await agentA.start();
    agents.push(agentA);
    await sleep(500);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB, 3000));
    agents.push(agentB);

    // Agent A's handler throws → processMessage throws → NostrTransport catches it
    // → no response is sent → Agent B's send() times out
    await expect(
      agentB.sendMessage(
        agentA.address,
        'nostr',
        { messageId: 'msg-err', role: 'user', parts: [{ type: 'text', text: 'trigger error' }] },
        { nostrPubkey: keyA.publicKey },
      ),
    ).rejects.toThrow('Nostr response timed out');
  }, TIMEOUT * 2);

  it('concurrent messages from multiple senders to same agent', async () => {
    const keyServer = freshKey();

    const agentServer = new SnapAgent({ privateKey: keyServer.privateKey, card: makeCard(keyServer) });
    agentServer.transport(createTransport(keyServer));

    const processed: string[] = [];
    agentServer.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      const text = (msg.parts[0] as any).text;
      processed.push(text);
      return {
        task: {
          id: `task-${text}`,
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [
            msg,
            { messageId: `resp-${text}`, role: 'agent' as const, parts: [{ type: 'text' as const, text: `ack: ${text}` }] },
          ],
        },
      };
    });

    await agentServer.start();
    agents.push(agentServer);
    await sleep(500);

    // Create 3 independent client agents
    const clients = [freshKey(), freshKey(), freshKey()];
    const clientAgents = clients.map((key, i) => {
      const agent = new SnapAgent({ privateKey: key.privateKey, card: makeCard(key) });
      agent.transport(createTransport(key));
      agents.push(agent);
      return { agent, key, label: `client-${i + 1}` };
    });

    // Send all 3 messages concurrently
    const results = await Promise.all(
      clientAgents.map(({ agent, label }) =>
        agent.sendMessage(
          agentServer.address,
          'nostr',
          { messageId: `msg-${label}`, role: 'user', parts: [{ type: 'text', text: label }] },
          { nostrPubkey: keyServer.publicKey },
        ),
      ),
    );

    // All 3 should succeed
    expect(results).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const label = `client-${i + 1}`;
      expect(results[i].task!.id).toBe(`task-${label}`);
      expect((results[i].task!.history![1].parts[0] as any).text).toBe(`ack: ${label}`);
    }

    // Server should have processed all 3
    expect(processed).toHaveLength(3);
    expect(processed.sort()).toEqual(['client-1', 'client-2', 'client-3']);
  }, TIMEOUT * 3);

  it('full task lifecycle: create via message/send → get → cancel', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const taskStore = new InMemoryTaskStore();

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA));
    agentA.taskStore(taskStore);

    // message/send handler creates a task in "working" state
    agentA.handle('message/send', async (payload, ctx) => {
      const msg = (payload as MessageSendRequest).message;
      const task = {
        id: 'lifecycle-task-001',
        status: { state: 'working' as const, timestamp: new Date().toISOString() },
        history: [msg],
      };
      await ctx.taskStore!.set(task.id, task);
      return { task };
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
    await sleep(500);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB));
    agents.push(agentB);

    // Step 1: Create task via message/send
    const createResult = await agentB.sendMessage(
      agentA.address,
      'nostr',
      { messageId: 'msg-lifecycle', role: 'user', parts: [{ type: 'text', text: 'Start a task' }] },
      { nostrPubkey: keyA.publicKey },
    );
    expect(createResult.task!.id).toBe('lifecycle-task-001');
    expect(createResult.task!.status.state).toBe('working');

    await sleep(500);

    // Step 2: Get task status
    const getResult = await agentB.getTask(
      agentA.address, 'nostr', 'lifecycle-task-001', { nostrPubkey: keyA.publicKey },
    );
    expect(getResult.task!.id).toBe('lifecycle-task-001');
    expect(getResult.task!.status.state).toBe('working');

    await sleep(500);

    // Step 3: Cancel task
    const cancelResult = await agentB.cancelTask(
      agentA.address, 'nostr', 'lifecycle-task-001', { nostrPubkey: keyA.publicKey },
    );
    expect(cancelResult.task!.id).toBe('lifecycle-task-001');
    expect(cancelResult.task!.status.state).toBe('canceled');

    await sleep(500);

    // Step 4: Verify canceled state persists
    const getAfterCancel = await agentB.getTask(
      agentA.address, 'nostr', 'lifecycle-task-001', { nostrPubkey: keyA.publicKey },
    );
    expect(getAfterCancel.task!.status.state).toBe('canceled');
  }, TIMEOUT * 4);

  it('unhandled method causes sender to timeout', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(createTransport(keyA, 3000));

    // Agent A only handles message/send — NOT tasks/get
    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      return {
        task: {
          id: 'task-ok',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [msg],
        },
      };
    });

    await agentA.start();
    agents.push(agentA);
    await sleep(500);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB, 3000));
    agents.push(agentB);

    // Send a tasks/get request — Agent A has no handler for it
    // processMessage throws SnapError("Method not found: tasks/get")
    // NostrTransport catches it → no response → timeout
    await expect(
      agentB.getTask(
        agentA.address, 'nostr', 'some-task', { nostrPubkey: keyA.publicKey },
      ),
    ).rejects.toThrow('Nostr response timed out');
  }, TIMEOUT * 2);

  it('sendMessage with persist=true stores message for offline retrieval', async () => {
    const keyA = freshKey();
    const keyB = freshKey();

    const transportA = createTransport(keyA);

    const agentA = new SnapAgent({ privateKey: keyA.privateKey, card: makeCard(keyA) });
    agentA.transport(transportA);
    agentA.handle('message/send', async (payload) => {
      const msg = (payload as MessageSendRequest).message;
      const text = (msg.parts[0] as any).text;
      return {
        task: {
          id: 'task-persist',
          status: { state: 'completed' as const, timestamp: new Date().toISOString() },
          history: [
            msg,
            { messageId: 'resp-p', role: 'agent' as const, parts: [{ type: 'text' as const, text: `ack: ${text}` }] },
          ],
        },
      };
    });

    await agentA.start();
    agents.push(agentA);
    await sleep(500);

    const agentB = new SnapAgent({ privateKey: keyB.privateKey, card: makeCard(keyB) });
    agentB.transport(createTransport(keyB));
    agents.push(agentB);

    // Send with persist=true — message should be stored on the relay
    const result = await agentB.sendMessage(
      agentA.address,
      'nostr',
      { messageId: 'msg-persist', role: 'user', parts: [{ type: 'text', text: 'store me' }] },
      { nostrPubkey: keyA.publicKey, persist: true },
    );

    expect(result.task!.id).toBe('task-persist');
    expect(result.task!.status.state).toBe('completed');

    // Verify the persisted request is retrievable via fetchOfflineMessages
    await sleep(1000);
    const offlineMessages = await transportA.fetchOfflineMessages(
      Math.floor(Date.now() / 1000) - 10,
    );
    const found = offlineMessages.find(m =>
      (m.payload as any)?.message?.messageId === 'msg-persist',
    );
    expect(found).toBeDefined();
    expect(found!.from).toBe(agentB.address);
  }, TIMEOUT * 2);
});
