/**
 * Tests for Agent-to-Service communication (RFC 001).
 *
 * Covers:
 *   - Optional `to` field in MessageBuilder
 *   - Optional `to` field in MessageValidator (structure + signature)
 *   - Signing and verification with absent `to` (empty string placeholder)
 *   - Custom method names (e.g., `service/call`)
 *   - SnapAgent processing messages without `to`
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import { MessageValidator } from '../../src/messaging/MessageValidator.js';
import { Signer } from '../../src/crypto/Signer.js';
import { SnapAgent } from '../../src/agent/SnapAgent.js';
import type { AgentCard } from '../../src/types/agent-card.js';

const TEST_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
const TEST_SIGNER = new MessageSigner(TEST_PRIVATE_KEY);
const TEST_ADDRESS = TEST_SIGNER.getAddress();

const TEST_PRIVATE_KEY_B = '0000000000000000000000000000000000000000000000000000000000000002';
const TEST_ADDRESS_B = new MessageSigner(TEST_PRIVATE_KEY_B).getAddress();

function makeCard(name: string): AgentCard {
  return {
    name,
    description: `${name} agent`,
    version: '1.0.0',
    identity: 'bc1p0000000000000000000000000000000000000000000000000000000000' as any,
    skills: [{ id: 'echo', name: 'Echo', description: 'Echo back', tags: ['test'] }],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}

// ─── MessageBuilder: optional `to` ──────────────────────────────────

describe('MessageBuilder — optional to', () => {
  it('builds a message without to', () => {
    const msg = new MessageBuilder()
      .id('svc-001')
      .from(TEST_ADDRESS)
      .method('service/call')
      .payload({ name: 'query_database', arguments: { sql: 'SELECT 1' } })
      .timestamp(1770163200)
      .build();

    expect(msg.id).toBe('svc-001');
    expect(msg.from).toBe(TEST_ADDRESS);
    expect(msg.to).toBeUndefined();
    expect(msg.method).toBe('service/call');
    expect(msg.type).toBe('request');
  });

  it('still builds a message with to', () => {
    const msg = new MessageBuilder()
      .id('msg-001')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('message/send')
      .payload({})
      .timestamp(1770163200)
      .build();

    expect(msg.to).toBe(TEST_ADDRESS_B);
  });

  it('no longer throws when to is missing', () => {
    expect(() =>
      new MessageBuilder()
        .id('x')
        .from(TEST_ADDRESS)
        .method('message/send')
        .timestamp(1000)
        .build(),
    ).not.toThrow();
  });
});

// ─── Custom method names ────────────────────────────────────────────

describe('Custom method names', () => {
  it('MessageBuilder accepts service/call', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('service/call')
      .timestamp(1000)
      .build();

    expect(msg.method).toBe('service/call');
  });

  it('MessageBuilder accepts arbitrary custom method', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('custom/my_action')
      .timestamp(1000)
      .build();

    expect(msg.method).toBe('custom/my_action');
  });

  it('MessageValidator accepts service/call', () => {
    const msg = new MessageBuilder()
      .id('svc-001')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('service/call')
      .payload({})
      .timestamp(Math.floor(Date.now() / 1000))
      .build();
    const signed = TEST_SIGNER.sign(msg);
    expect(MessageValidator.validateStructure(signed)).toBe(true);
  });

  it('MessageValidator accepts custom methods matching pattern', () => {
    const msg = new MessageBuilder()
      .id('x')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('tools/call_function')
      .payload({})
      .timestamp(Math.floor(Date.now() / 1000))
      .build();
    const signed = TEST_SIGNER.sign(msg);
    expect(MessageValidator.validateStructure(signed)).toBe(true);
  });
});

// ─── MessageValidator: optional `to` ────────────────────────────────

describe('MessageValidator — optional to', () => {
  it('validates structure of message without to', () => {
    const msg = new MessageBuilder()
      .id('svc-001')
      .from(TEST_ADDRESS)
      .method('service/call')
      .payload({ name: 'ping' })
      .timestamp(Math.floor(Date.now() / 1000))
      .build();
    const signed = TEST_SIGNER.sign(msg);
    expect(MessageValidator.validateStructure(signed)).toBe(true);
  });

  it('still validates structure of message with valid to', () => {
    const msg = new MessageBuilder()
      .id('msg-001')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('message/send')
      .payload({})
      .timestamp(Math.floor(Date.now() / 1000))
      .build();
    const signed = TEST_SIGNER.sign(msg);
    expect(MessageValidator.validateStructure(signed)).toBe(true);
  });

  it('rejects message with invalid to (non-P2TR)', () => {
    const now = Math.floor(Date.now() / 1000);
    const msg = new MessageBuilder()
      .id('msg-001')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('message/send')
      .payload({})
      .timestamp(now)
      .build();
    const signed = TEST_SIGNER.sign(msg);
    const tampered = { ...signed, to: 'not-an-address' };
    expect(MessageValidator.validateStructure(tampered)).toBe(false);
  });

  it('full validation passes for signed message without to', () => {
    const now = Math.floor(Date.now() / 1000);
    const msg = new MessageBuilder()
      .id('svc-full')
      .from(TEST_ADDRESS)
      .method('service/call')
      .payload({ name: 'test' })
      .timestamp(now)
      .build();
    const signed = TEST_SIGNER.sign(msg);
    expect(() => MessageValidator.validate(signed)).not.toThrow();
  });

  it('full validation still passes for signed message with to', () => {
    const now = Math.floor(Date.now() / 1000);
    const msg = new MessageBuilder()
      .id('msg-full')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('message/send')
      .payload({})
      .timestamp(now)
      .build();
    const signed = TEST_SIGNER.sign(msg);
    expect(() => MessageValidator.validate(signed)).not.toThrow();
  });
});

// ─── Signing & verification with absent `to` ───────────────────────

describe('Signing — absent to', () => {
  it('signature input uses empty string for absent to', () => {
    const msg = new MessageBuilder()
      .id('svc-001')
      .from(TEST_ADDRESS)
      .method('service/call')
      .payload({})
      .timestamp(1770163200)
      .build();

    const input = Signer.buildSignatureInput(msg);
    const parts = input.split('\x00');

    // 7 fields, 6 separators
    expect(parts).toHaveLength(7);
    // parts[0] = id, parts[1] = from, parts[2] = to (empty), parts[3] = type, ...
    expect(parts[0]).toBe('svc-001');
    expect(parts[1]).toBe(TEST_ADDRESS);
    expect(parts[2]).toBe(''); // empty string for absent to
    expect(parts[3]).toBe('request');
    expect(parts[4]).toBe('service/call');
  });

  it('sign and verify round-trip without to', () => {
    const msg = new MessageBuilder()
      .id('svc-rt')
      .from(TEST_ADDRESS)
      .method('service/call')
      .payload({ name: 'echo', arguments: { x: 1 } })
      .timestamp(Math.floor(Date.now() / 1000))
      .build();

    const signed = TEST_SIGNER.sign(msg);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(MessageValidator.verifySignature(signed)).toBe(true);
  });

  it('sign and verify round-trip with to (unchanged behavior)', () => {
    const msg = new MessageBuilder()
      .id('msg-rt')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('message/send')
      .payload({ message: { text: 'hi' } })
      .timestamp(Math.floor(Date.now() / 1000))
      .build();

    const signed = TEST_SIGNER.sign(msg);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(MessageValidator.verifySignature(signed)).toBe(true);
  });

  it('tampering with to field invalidates signature (absent to)', () => {
    const msg = new MessageBuilder()
      .id('svc-tamper')
      .from(TEST_ADDRESS)
      .method('service/call')
      .payload({})
      .timestamp(Math.floor(Date.now() / 1000))
      .build();

    const signed = TEST_SIGNER.sign(msg);
    // Add a to field to a message that was signed without one
    const tampered = { ...signed, to: TEST_ADDRESS_B };
    expect(MessageValidator.verifySignature(tampered)).toBe(false);
  });

  it('removing to field invalidates signature (present to)', () => {
    const msg = new MessageBuilder()
      .id('msg-tamper')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS_B)
      .method('message/send')
      .payload({})
      .timestamp(Math.floor(Date.now() / 1000))
      .build();

    const signed = TEST_SIGNER.sign(msg);
    // Remove the to field from a message that was signed with one
    const tampered = { ...signed };
    delete (tampered as any).to;
    expect(MessageValidator.verifySignature(tampered)).toBe(false);
  });
});

// ─── SnapAgent: processMessage with absent `to` ────────────────────

describe('SnapAgent — optional to', () => {
  const agents: SnapAgent[] = [];

  function createAgent(key: string, name: string): SnapAgent {
    const agent = new SnapAgent({ privateKey: key, card: makeCard(name) });
    agents.push(agent);
    return agent;
  }

  afterEach(async () => {
    for (const agent of agents) {
      await agent.stop();
    }
    agents.length = 0;
  });

  it('processes message without to (Agent-to-Service scenario)', async () => {
    const agent = createAgent(TEST_PRIVATE_KEY_B, 'Service');
    let receivedPayload: unknown;

    agent.handle('service/call', async (payload) => {
      receivedPayload = payload;
      return { result: 'ok' };
    });

    // Client builds and signs a message without `to`
    const now = Math.floor(Date.now() / 1000);
    const msg = new MessageBuilder()
      .id('svc-agent-001')
      .from(TEST_ADDRESS)
      .method('service/call')
      .payload({ name: 'ping' })
      .timestamp(now)
      .build();
    const signed = TEST_SIGNER.sign(msg);

    const response = await agent.processMessage(signed);
    expect(receivedPayload).toEqual({ name: 'ping' });
    expect(response.type).toBe('response');
    expect(response.method).toBe('service/call');
  });

  it('still processes message with to matching agent address', async () => {
    const agent = createAgent(TEST_PRIVATE_KEY_B, 'Agent B');

    agent.handle('message/send', async (payload) => {
      return {
        task: {
          id: 'task-001',
          contextId: 'ctx-001',
          status: { state: 'completed', timestamp: new Date().toISOString() },
        },
      };
    });

    const now = Math.floor(Date.now() / 1000);
    const msg = new MessageBuilder()
      .id('msg-agent-001')
      .from(TEST_ADDRESS)
      .to(agent.address)
      .method('message/send')
      .payload({ message: { messageId: 'inner-1', role: 'user', parts: [{ text: 'hi' }] } })
      .timestamp(now)
      .build();
    const signed = TEST_SIGNER.sign(msg);

    const response = await agent.processMessage(signed);
    expect(response.type).toBe('response');
  });

  it('still rejects message with to not matching agent address', async () => {
    const agent = createAgent(TEST_PRIVATE_KEY_B, 'Agent B');

    agent.handle('message/send', async () => ({ task: {} }));

    const now = Math.floor(Date.now() / 1000);
    const msg = new MessageBuilder()
      .id('msg-wrong-to')
      .from(TEST_ADDRESS)
      .to(TEST_ADDRESS) // wrong address — not agent B
      .method('message/send')
      .payload({})
      .timestamp(now)
      .build();
    const signed = TEST_SIGNER.sign(msg);

    await expect(agent.processMessage(signed)).rejects.toThrow(/not addressed/);
  });
});
