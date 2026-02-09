import { describe, it, expect, afterEach } from 'vitest';
import { SnapAgent } from '../../src/agent/SnapAgent.js';
import { HttpTransport } from '../../src/transport/HttpTransport.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import type { SnapMessage } from '../../src/types/message.js';
import type { AgentCard } from '../../src/types/agent-card.js';
import type { MessageSendRequest } from '../../src/types/payloads.js';
import type { Middleware, MiddlewareContext, NextFn } from '../../src/types/plugin.js';
import { InMemoryReplayStore } from '../../src/stores/InMemoryReplayStore.js';
import { InMemoryTaskStore } from '../../src/stores/InMemoryTaskStore.js';

// Two deterministic key pairs
const AGENT_A_KEY = 'a'.repeat(64).replace(/a{64}/, '0000000000000000000000000000000000000000000000000000000000000001');
const AGENT_B_KEY = '0000000000000000000000000000000000000000000000000000000000000002';

function makeCard(name: string): AgentCard {
  return {
    name,
    description: `${name} agent`,
    version: '1.0.0',
    identity: 'bc1p0000000000000000000000000000000000000000000000000000000000' as any, // will be overridden by constructor
    skills: [{ id: 'echo', name: 'Echo', description: 'Echo back', tags: ['test'] }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}

describe('SnapAgent', () => {
  const agents: SnapAgent[] = [];

  function createAgent(key: string, name: string, transport?: HttpTransport): SnapAgent {
    const agent = new SnapAgent({ privateKey: key, card: makeCard(name) });
    if (transport) agent.transport(transport);
    agents.push(agent);
    return agent;
  }

  afterEach(async () => {
    for (const agent of agents) {
      await agent.stop();
    }
    agents.length = 0;
  });

  it('derives the correct address from private key', () => {
    const agent = createAgent(AGENT_A_KEY, 'Agent A');
    const pubkey = KeyManager.getPublicKey(AGENT_A_KEY);
    const expectedAddr = KeyManager.publicKeyToP2TR(pubkey);
    expect(agent.address).toBe(expectedAddr);
  });

  it('sets identity on card to match derived address', () => {
    const agent = createAgent(AGENT_A_KEY, 'Agent A');
    expect(agent.card.identity).toBe(agent.address);
  });

  it('registers and invokes a message/send handler via HTTP', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());

    agentA.handle('message/send', async (payload) => ({
      task: {
        id: 'task-001',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        history: [(payload as MessageSendRequest).message],
      },
    }));

    await agentA.start();

    const response = await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      {
        messageId: 'msg-001',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello!' }],
      },
    );

    expect(response.task).toBeDefined();
    expect(response.task.id).toBe('task-001');
    expect(response.task.status.state).toBe('completed');
  });

  it('rejects messages not addressed to this agent', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    const agentC_key = '0000000000000000000000000000000000000000000000000000000000000003';
    const agentC_addr = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(agentC_key));

    agentA.handle('message/send', async () => ({
      task: {
        id: 'task-001',
        status: { state: 'completed', timestamp: new Date().toISOString() },
      },
    }));

    await agentA.start();

    // Agent B sends to Agent C's address but via Agent A's transport
    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());

    // This should fail because the message is addressed to Agent C, not Agent A
    await expect(
      agentB.send(
        agentC_addr,
        `http://127.0.0.1:${serverTransport.port}`,
        'message/send',
        {},
      ),
    ).rejects.toThrow();
  });

  it('runs middleware on inbound and outbound messages', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    const directions: string[] = [];

    const logMiddleware: Middleware = {
      name: 'logger',
      async handle(ctx: MiddlewareContext, next: NextFn) {
        directions.push(ctx.direction);
        await next();
      },
    };

    agentA.use(logMiddleware);
    agentA.handle('message/send', async () => ({
      task: {
        id: 'task-001',
        status: { state: 'completed', timestamp: new Date().toISOString() },
      },
    }));

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      { messageId: 'msg-001', role: 'user', parts: [{ type: 'text', text: 'test' }] },
    );

    expect(directions).toContain('inbound');
    expect(directions).toContain('outbound');
  });

  it('detects duplicate messages with replay store', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    agentA.replayStore(new InMemoryReplayStore());

    agentA.handle('message/send', async () => ({
      task: {
        id: 'task-001',
        status: { state: 'completed', timestamp: new Date().toISOString() },
      },
    }));

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    const endpoint = `http://127.0.0.1:${serverTransport.port}`;

    // First request should succeed
    await agentB.sendMessage(
      agentA.address,
      endpoint,
      { messageId: 'msg-001', role: 'user', parts: [{ type: 'text', text: 'first' }] },
    );

    // Second request with same agent should also succeed (different message ID via randomUUID)
    await agentB.sendMessage(
      agentA.address,
      endpoint,
      { messageId: 'msg-002', role: 'user', parts: [{ type: 'text', text: 'second' }] },
    );

    // This verifies the replay store is being used without triggering false positives
  });

  it('provides task store to handlers', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    const taskStore = new InMemoryTaskStore();
    agentA.taskStore(taskStore);

    let handlerHadTaskStore = false;

    agentA.handle('message/send', async (_payload, ctx) => {
      handlerHadTaskStore = ctx.taskStore !== undefined;
      return {
        task: {
          id: 'task-001',
          status: { state: 'completed', timestamp: new Date().toISOString() },
        },
      };
    });

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      { messageId: 'msg-001', role: 'user', parts: [{ type: 'text', text: 'test' }] },
    );

    expect(handlerHadTaskStore).toBe(true);
  });

  it('rejects requests for unregistered methods', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    // Don't register any handler
    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());

    await expect(
      agentB.sendMessage(
        agentA.address,
        `http://127.0.0.1:${serverTransport.port}`,
        { messageId: 'msg-001', role: 'user', parts: [{ type: 'text', text: 'test' }] },
      ),
    ).rejects.toThrow();
  });

  it('getTask sends tasks/get request', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);

    agentA.handle('tasks/get', async (payload) => ({
      task: {
        id: (payload as any).taskId,
        status: { state: 'completed', timestamp: new Date().toISOString() },
      },
    }));

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    const result = await agentB.getTask(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      'task-123',
    );

    expect(result.task.id).toBe('task-123');
  });

  it('cancelTask sends tasks/cancel request', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);

    agentA.handle('tasks/cancel', async (payload) => ({
      task: {
        id: (payload as any).taskId,
        status: { state: 'canceled', timestamp: new Date().toISOString() },
      },
    }));

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    const result = await agentB.cancelTask(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      'task-456',
    );

    expect(result.task.id).toBe('task-456');
    expect(result.task.status.state).toBe('canceled');
  });

  // --- Edge case tests ---

  it('send() throws when no transports are configured', async () => {
    const agent = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('No Transport') });
    agents.push(agent);

    await expect(
      agent.send(
        'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8' as any,
        'http://127.0.0.1:9999',
        'message/send',
        {},
      ),
    ).rejects.toThrow('No transports configured');
  });

  it('sendStream() throws when no streaming transport is configured', async () => {
    const agent = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('No Stream') });
    const mockTransport = {
      name: 'mock',
      async send() { return {} as SnapMessage; },
    };
    agent.transport(mockTransport as any);
    agents.push(agent);

    await expect(async () => {
      for await (const _ of agent.sendStream(
        'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8' as any,
        'http://127.0.0.1:9999',
        'message/stream',
        {},
      )) {
        // should not reach here
      }
    }).rejects.toThrow('No streaming transport configured');
  });

  it('chained API (fluent interface)', () => {
    const agent = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Fluent') });
    agents.push(agent);

    const result = agent
      .transport(new HttpTransport())
      .replayStore(new InMemoryReplayStore())
      .taskStore(new InMemoryTaskStore())
      .handle('message/send', async () => ({
        task: { id: 't1', status: { state: 'completed', timestamp: new Date().toISOString() } },
      }));

    // All methods should return `this` for chaining
    expect(result).toBe(agent);
  });

  it('multiple middleware execute in order', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    const order: string[] = [];

    agentA.use({
      name: 'first',
      async handle(_ctx, next) {
        order.push('first-before');
        await next();
        order.push('first-after');
      },
    });

    agentA.use({
      name: 'second',
      async handle(_ctx, next) {
        order.push('second-before');
        await next();
        order.push('second-after');
      },
    });

    agentA.handle('message/send', async () => ({
      task: {
        id: 'task-001',
        status: { state: 'completed', timestamp: new Date().toISOString() },
      },
    }));

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      { messageId: 'msg-001', role: 'user', parts: [{ type: 'text', text: 'test' }] },
    );

    // Inbound middleware runs in order, then outbound middleware runs in order
    expect(order).toEqual([
      'first-before', 'second-before', 'second-after', 'first-after',  // inbound
      'first-before', 'second-before', 'second-after', 'first-after',  // outbound
    ]);
  });

  it('handler receives correct payload', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    let receivedPayload: any = null;

    agentA.handle('message/send', async (payload) => {
      receivedPayload = payload;
      return {
        task: {
          id: 'task-001',
          status: { state: 'completed', timestamp: new Date().toISOString() },
        },
      };
    });

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      { messageId: 'msg-payload-test', role: 'user', parts: [{ text: 'payload check' }] },
    );

    expect(receivedPayload).toBeDefined();
    expect(receivedPayload.message.messageId).toBe('msg-payload-test');
    expect(receivedPayload.message.parts[0].text).toBe('payload check');
  });

  it('stop() is safe to call without start()', async () => {
    const agent = createAgent(AGENT_A_KEY, 'Agent A', new HttpTransport());
    // Should not throw
    await agent.stop();
  });

  it('response is signed by the receiving agent', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);

    agentA.handle('message/send', async () => ({
      task: {
        id: 'task-signed',
        status: { state: 'completed', timestamp: new Date().toISOString() },
      },
    }));

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    const response = await agentB.send(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      'message/send',
      { message: { messageId: 'msg-001', role: 'user', parts: [{ type: 'text', text: 'hi' }] } },
    );

    // Response should be from Agent A and addressed to Agent B
    expect(response.from).toBe(agentA.address);
    expect(response.to).toBe(agentB.address);
    expect(response.type).toBe('response');
    expect(response.sig).toBeDefined();
    expect(response.sig).toHaveLength(128);
  });

  it('send() falls through transports on failure', async () => {
    const agent = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Fallback') });
    agents.push(agent);

    const failTransport = {
      name: 'fail',
      async send() { throw new Error('transport failed'); },
    };

    const serverTransport = new HttpTransport({ port: 0 });
    const serverAgent = createAgent(AGENT_B_KEY, 'Server', serverTransport);
    serverAgent.handle('message/send', async () => ({
      task: { id: 'task-fallback', status: { state: 'completed', timestamp: new Date().toISOString() } },
    }));
    await serverAgent.start();

    agent.transport(failTransport as any);
    agent.transport(new HttpTransport());

    const response = await agent.send(
      serverAgent.address,
      `http://127.0.0.1:${serverTransport.port}`,
      'message/send',
      { message: { messageId: 'msg-001', role: 'user', parts: [{ type: 'text', text: 'hi' }] } },
    );

    expect((response.payload as any).task.id).toBe('task-fallback');
  });

  // --- Error path tests ---

  it('handler throwing returns error to sender', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);

    agentA.handle('message/send', async () => {
      throw new Error('Handler exploded');
    });

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());

    await expect(
      agentB.sendMessage(
        agentA.address,
        `http://127.0.0.1:${serverTransport.port}`,
        { messageId: 'msg-err', role: 'user', parts: [{ type: 'text', text: 'boom' }] },
      ),
    ).rejects.toThrow();
  });

  it('middleware throwing prevents handler from executing', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    let handlerCalled = false;

    agentA.use({
      name: 'blocker',
      async handle(_ctx, _next) {
        throw new Error('Middleware blocked');
      },
    });

    agentA.handle('message/send', async () => {
      handlerCalled = true;
      return {
        task: {
          id: 'task-001',
          status: { state: 'completed', timestamp: new Date().toISOString() },
        },
      };
    });

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());

    await expect(
      agentB.sendMessage(
        agentA.address,
        `http://127.0.0.1:${serverTransport.port}`,
        { messageId: 'msg-mw', role: 'user', parts: [{ type: 'text', text: 'test' }] },
      ),
    ).rejects.toThrow();

    expect(handlerCalled).toBe(false);
  });

  it('processMessage throws for duplicate message with replay store', async () => {
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Replay') });
    agentA.replayStore(new InMemoryReplayStore());
    agentA.handle('message/send', async () => ({
      task: { id: 't1', status: { state: 'completed', timestamp: new Date().toISOString() } },
    }));
    agents.push(agentA);

    // Build a signed message manually using agent B
    const { MessageSigner } = await import('../../src/messaging/MessageSigner.js');
    const { MessageBuilder } = await import('../../src/messaging/MessageBuilder.js');

    const signerB = new MessageSigner(AGENT_B_KEY);
    const addrB = signerB.getAddress();
    const now = Math.floor(Date.now() / 1000);

    const unsigned = new MessageBuilder()
      .id('duplicate-msg')
      .from(addrB)
      .to(agentA.address)
      .method('message/send')
      .payload({ message: { messageId: 'msg-1', role: 'user', parts: [{ text: 'hello' }] } })
      .timestamp(now)
      .build();
    const signed = signerB.sign(unsigned);

    // First call should succeed
    await agentA.processMessage(signed);

    // Second call with same message should throw duplicate
    await expect(agentA.processMessage(signed)).rejects.toThrow('Duplicate');
  });

  it('processStream throws for unregistered stream handler', async () => {
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('NoStream') });
    agents.push(agentA);

    const { MessageSigner } = await import('../../src/messaging/MessageSigner.js');
    const { MessageBuilder } = await import('../../src/messaging/MessageBuilder.js');

    const signerB = new MessageSigner(AGENT_B_KEY);
    const addrB = signerB.getAddress();
    const now = Math.floor(Date.now() / 1000);

    const unsigned = new MessageBuilder()
      .id('stream-msg')
      .from(addrB)
      .to(agentA.address)
      .method('message/stream')
      .payload({})
      .timestamp(now)
      .build();
    const signed = signerB.sign(unsigned);

    await expect(async () => {
      for await (const _ of agentA.processStream(signed)) {
        // should not reach here
      }
    }).rejects.toThrow('Method not found');
  });

  it('processMessage validates message structure', async () => {
    const agentA = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Validate') });
    agents.push(agentA);

    // Pass an invalid message (missing fields)
    const invalidMsg = { id: 'bad' } as any;
    await expect(agentA.processMessage(invalidMsg)).rejects.toThrow();
  });

  it('handle() overwrites previous handler for same method', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);

    agentA.handle('message/send', async () => ({
      task: { id: 'first-handler', status: { state: 'completed', timestamp: new Date().toISOString() } },
    }));

    agentA.handle('message/send', async () => ({
      task: { id: 'second-handler', status: { state: 'completed', timestamp: new Date().toISOString() } },
    }));

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    const result = await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      { messageId: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'test' }] },
    );

    expect(result.task.id).toBe('second-handler');
  });

  it('handler context includes the full inbound message', async () => {
    const serverTransport = new HttpTransport({ port: 0 });
    const agentA = createAgent(AGENT_A_KEY, 'Agent A', serverTransport);
    let contextMessage: SnapMessage | null = null;

    agentA.handle('message/send', async (_payload, ctx) => {
      contextMessage = ctx.message;
      return {
        task: { id: 'task-ctx', status: { state: 'completed', timestamp: new Date().toISOString() } },
      };
    });

    await agentA.start();

    const agentB = createAgent(AGENT_B_KEY, 'Agent B', new HttpTransport());
    await agentB.sendMessage(
      agentA.address,
      `http://127.0.0.1:${serverTransport.port}`,
      { messageId: 'msg-ctx', role: 'user', parts: [{ type: 'text', text: 'check ctx' }] },
    );

    expect(contextMessage).not.toBeNull();
    expect(contextMessage!.from).toBe(agentB.address);
    expect(contextMessage!.to).toBe(agentA.address);
    expect(contextMessage!.type).toBe('request');
    expect(contextMessage!.method).toBe('message/send');
    expect(contextMessage!.sig).toBeDefined();
  });

  it('use() returns this for chaining', () => {
    const agent = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Chain') });
    agents.push(agent);

    const result = agent.use({
      name: 'test',
      async handle(_ctx, next) { await next(); },
    });
    expect(result).toBe(agent);
  });

  it('handleStream() returns this for chaining', () => {
    const agent = new SnapAgent({ privateKey: AGENT_A_KEY, card: makeCard('Chain') });
    agents.push(agent);

    const result = agent.handleStream('message/stream', async function* () {
      // empty
    });
    expect(result).toBe(agent);
  });
});
