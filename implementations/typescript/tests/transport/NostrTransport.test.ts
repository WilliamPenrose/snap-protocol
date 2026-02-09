import { describe, it, expect } from 'vitest';
import { NostrTransport } from '../../src/transport/NostrTransport.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import type { SnapMessage } from '../../src/types/message.js';
import type { AgentCard } from '../../src/types/agent-card.js';

// Two deterministic key pairs for sender/receiver
const SENDER_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
const RECEIVER_KEY = '0000000000000000000000000000000000000000000000000000000000000002';
const SENDER_PUBKEY = KeyManager.getPublicKey(SENDER_KEY);
const RECEIVER_PUBKEY = KeyManager.getPublicKey(RECEIVER_KEY);
const SENDER_ADDR = KeyManager.publicKeyToP2TR(SENDER_PUBKEY);
const RECEIVER_ADDR = KeyManager.publicKeyToP2TR(RECEIVER_PUBKEY);

const DUMMY_SIG = '0'.repeat(128);

function makeMessage(overrides: Partial<SnapMessage> = {}): SnapMessage {
  return {
    id: 'msg-001',
    version: '0.1',
    from: SENDER_ADDR as SnapMessage['from'],
    to: RECEIVER_ADDR as SnapMessage['to'],
    type: 'request',
    method: 'message/send',
    payload: { message: { messageId: 'im-1', role: 'user', parts: [{ text: 'hello' }] } },
    timestamp: Math.floor(Date.now() / 1000),
    sig: DUMMY_SIG,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<SnapMessage> = {}): SnapMessage {
  return {
    id: 'resp-001',
    version: '0.1',
    from: RECEIVER_ADDR as SnapMessage['from'],
    to: SENDER_ADDR as SnapMessage['to'],
    type: 'response',
    method: 'message/send',
    payload: { task: { id: 'task-1', status: { state: 'completed', timestamp: new Date().toISOString() } } },
    timestamp: Math.floor(Date.now() / 1000),
    sig: DUMMY_SIG,
    ...overrides,
  };
}

function makeAgentCard(): AgentCard {
  return {
    name: 'Test Agent',
    description: 'A test agent',
    version: '1.0.0',
    identity: RECEIVER_ADDR as any,
    endpoints: [{ protocol: 'http', url: 'https://agent.example.com/snap' }],
    nostrRelays: ['wss://relay.example.com'],
    skills: [
      { id: 'echo', name: 'Echo', description: 'Echo messages', tags: ['test'] },
      { id: 'code', name: 'Code', description: 'Generate code', tags: ['code', 'ts'] },
    ],
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
  };
}

describe('NostrTransport', () => {
  // --- Basic construction ---

  it('has name "nostr"', () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });
    expect(transport.name).toBe('nostr');
  });

  it('constructs with default timeout', () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });
    expect(transport).toBeDefined();
  });

  it('constructs with custom timeout', () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 60_000,
    });
    expect(transport).toBeDefined();
  });

  it('constructs with multiple relays', () => {
    const transport = new NostrTransport({
      relays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
      privateKey: SENDER_KEY,
    });
    expect(transport).toBeDefined();
  });

  it('close does not throw when no subscriptions are active', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });
    await expect(transport.close()).resolves.toBeUndefined();
  });

  it('derives the correct public key from private key', () => {
    const expectedPubkey = KeyManager.getPublicKey(SENDER_KEY);
    expect(SENDER_PUBKEY).toBe(expectedPubkey);
  });

  // --- NIP-44 Encryption round-trip ---

  it('encrypts and decrypts messages symmetrically via NIP-44', async () => {
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    const senderSecret = hexToBytes(SENDER_KEY);
    const receiverSecret = hexToBytes(RECEIVER_KEY);

    // Sender encrypts for receiver
    const conversationKeyForSender = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);
    const message = makeMessage();
    const encrypted = nip44.v2.encrypt(JSON.stringify(message), conversationKeyForSender);

    // Receiver decrypts from sender
    const conversationKeyForReceiver = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);
    const decrypted = nip44.v2.decrypt(encrypted, conversationKeyForReceiver);
    const parsed = JSON.parse(decrypted) as SnapMessage;

    expect(parsed.id).toBe(message.id);
    expect(parsed.from).toBe(message.from);
    expect(parsed.to).toBe(message.to);
    expect(parsed.method).toBe(message.method);
  });

  it('NIP-44 decryption fails with wrong key', async () => {
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    const senderSecret = hexToBytes(SENDER_KEY);
    const wrongKey = '0000000000000000000000000000000000000000000000000000000000000003';
    const wrongSecret = hexToBytes(wrongKey);

    const conversationKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);
    const encrypted = nip44.v2.encrypt('test message', conversationKey);

    // Try to decrypt with a wrong key pair
    const wrongPubkey = KeyManager.getPublicKey(wrongKey);
    const wrongConvKey = nip44.v2.utils.getConversationKey(wrongSecret, wrongPubkey);

    expect(() => {
      nip44.v2.decrypt(encrypted, wrongConvKey);
    }).toThrow();
  });

  // --- Agent Card publication tags ---

  it('publishAgentCard builds correct Nostr event tags', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    const publishedEvents: any[] = [];
    (transport as any).pool.publish = (_relays: string[], event: any) => {
      publishedEvents.push({ relays: _relays, event });
      return [Promise.resolve()];
    };

    const card = makeAgentCard();
    await transport.publishAgentCard(card);

    expect(publishedEvents).toHaveLength(1);
    const { relays, event } = publishedEvents[0];

    expect(relays).toEqual(['wss://relay.example.com']);
    expect(event.kind).toBe(31337);

    // Verify tags
    const tags = event.tags as string[][];
    const dTag = tags.find((t: string[]) => t[0] === 'd');
    expect(dTag).toEqual(['d', card.identity]);

    const nameTag = tags.find((t: string[]) => t[0] === 'name');
    expect(nameTag).toEqual(['name', 'Test Agent']);

    const versionTag = tags.find((t: string[]) => t[0] === 'version');
    expect(versionTag).toEqual(['version', '1.0.0']);

    const skillTags = tags.filter((t: string[]) => t[0] === 'skill');
    expect(skillTags).toHaveLength(2);
    expect(skillTags[0]).toEqual(['skill', 'echo', 'Echo']);
    expect(skillTags[1]).toEqual(['skill', 'code', 'Code']);

    const endpointTags = tags.filter((t: string[]) => t[0] === 'endpoint');
    expect(endpointTags).toHaveLength(1);
    expect(endpointTags[0]).toEqual(['endpoint', 'http', 'https://agent.example.com/snap']);

    const relayTags = tags.filter((t: string[]) => t[0] === 'relay');
    expect(relayTags).toHaveLength(1);
    expect(relayTags[0]).toEqual(['relay', 'wss://relay.example.com']);

    // Content is the full Agent Card JSON
    const content = JSON.parse(event.content);
    expect(content.name).toBe('Test Agent');
    expect(content.skills).toHaveLength(2);

    await transport.close();
  });

  it('publishAgentCard omits endpoint and relay tags when not present', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    const publishedEvents: any[] = [];
    (transport as any).pool.publish = (_relays: string[], event: any) => {
      publishedEvents.push(event);
      return [Promise.resolve()];
    };

    const card: AgentCard = {
      name: 'Minimal Agent',
      description: 'No endpoints',
      version: '0.1.0',
      identity: RECEIVER_ADDR as any,
      skills: [{ id: 'test', name: 'Test', description: 'Testing', tags: ['test'] }],
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
    };

    await transport.publishAgentCard(card);

    const tags = publishedEvents[0].tags as string[][];
    expect(tags.filter((t: string[]) => t[0] === 'endpoint')).toHaveLength(0);
    expect(tags.filter((t: string[]) => t[0] === 'relay')).toHaveLength(0);

    await transport.close();
  });

  it('publishAgentCard throws when all relays reject', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    (transport as any).pool.publish = () => [Promise.reject(new Error('connection failed'))];

    await expect(transport.publishAgentCard(makeAgentCard())).rejects.toThrow(
      'Failed to publish to any relay',
    );

    await transport.close();
  });

  it('send throws when all relays reject before waiting for response', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 5000,
    });

    (transport as any).pool.publish = () => [Promise.reject(new Error('connection failed'))];

    await expect(
      transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY }),
    ).rejects.toThrow('Failed to publish to any relay');

    await transport.close();
  });

  it('listen logs warning when response publish fails', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };
    (transport as any).pool.publish = () => [Promise.reject(new Error('relay down'))];

    await transport.listen(async () => makeResponse());

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);
    const encrypted = nip44.v2.encrypt(JSON.stringify(makeMessage()), convKey);

    await capturedOnevent({
      kind: 4339,
      pubkey: SENDER_PUBKEY,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'inbound-fail',
      sig: '0'.repeat(128),
    });

    expect(logs.some((l) => l.level === 'warn' && l.message.includes('Failed to publish response'))).toBe(true);

    await transport.close();
  });

  // --- Discovery filter construction ---

  it('discoverAgents builds filter for identity lookup', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });

    let capturedFilter: any;
    (transport as any).pool.querySync = async (_relays: string[], filter: any) => {
      capturedFilter = filter;
      return [];
    };

    await transport.discoverAgents({ identity: RECEIVER_ADDR as any });

    expect(capturedFilter.kinds).toEqual([31337]);
    expect(capturedFilter['#d']).toEqual([RECEIVER_ADDR]);

    await transport.close();
  });

  it('discoverAgents builds filter for skill lookup', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });

    let capturedFilter: any;
    (transport as any).pool.querySync = async (_relays: string[], filter: any) => {
      capturedFilter = filter;
      return [];
    };

    await transport.discoverAgents({ skills: ['code-gen', 'review'] });

    expect(capturedFilter.kinds).toEqual([31337]);
    expect(capturedFilter['#skill']).toEqual(['code-gen', 'review']);

    await transport.close();
  });

  it('discoverAgents builds filter for name lookup', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });

    let capturedFilter: any;
    (transport as any).pool.querySync = async (_relays: string[], filter: any) => {
      capturedFilter = filter;
      return [];
    };

    await transport.discoverAgents({ name: 'Code Assistant' });

    expect(capturedFilter.kinds).toEqual([31337]);
    expect(capturedFilter['#name']).toEqual(['Code Assistant']);

    await transport.close();
  });

  it('discoverAgents parses agent cards from event content', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });

    const card = makeAgentCard();
    (transport as any).pool.querySync = async () => [
      { content: JSON.stringify(card), kind: 31337, pubkey: RECEIVER_PUBKEY, tags: [], created_at: 0, id: 'abc', sig: '123' },
    ];

    const results = await transport.discoverAgents({ skills: ['echo'] });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Test Agent');
    expect(results[0].skills).toHaveLength(2);

    await transport.close();
  });

  it('discoverAgents skips events with invalid JSON content', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });

    (transport as any).pool.querySync = async () => [
      { content: 'not-json', kind: 31337, pubkey: RECEIVER_PUBKEY, tags: [], created_at: 0, id: 'abc', sig: '123' },
      { content: JSON.stringify(makeAgentCard()), kind: 31337, pubkey: RECEIVER_PUBKEY, tags: [], created_at: 0, id: 'def', sig: '456' },
    ];

    const results = await transport.discoverAgents({});

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Test Agent');

    await transport.close();
  });

  // --- send() with mocked pool ---

  it('send encrypts message and publishes to relays', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay1.example.com', 'wss://relay2.example.com'],
      privateKey: SENDER_KEY,
    });

    const publishedEvents: any[] = [];
    (transport as any).pool.publish = (relays: string[], event: any) => {
      publishedEvents.push({ relays, event });
      return [Promise.resolve(), Promise.resolve()];
    };

    // Mock subscribeMany to return an encrypted response
    const response = makeResponse();
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      const receiverSecret = hexToBytes(RECEIVER_KEY);
      const convKey = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);
      const encrypted = nip44.v2.encrypt(JSON.stringify(response), convKey);

      setTimeout(() => {
        opts.onevent({
          kind: 4339,
          pubkey: RECEIVER_PUBKEY,
          content: encrypted,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'evt-1',
          sig: '0'.repeat(128),
        });
      }, 10);

      return { close: () => {} };
    };

    const result = await transport.send(makeMessage(), {
      endpoint: 'nostr',
      timeout: 5000,
      nostrPubkey: RECEIVER_PUBKEY,
    });

    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0].relays).toEqual(['wss://relay1.example.com', 'wss://relay2.example.com']);
    expect(publishedEvents[0].event.kind).toBe(21339);

    expect(result.id).toBe('resp-001');
    expect(result.type).toBe('response');

    await transport.close();
  });

  it('send times out when no response arrives', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 100,
    });

    (transport as any).pool.publish = () => [Promise.resolve()];
    (transport as any).pool.subscribeMany = () => ({
      close: () => {},
    });

    await expect(
      transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY }),
    ).rejects.toThrow('Nostr response timed out');

    await transport.close();
  });

  it('send ignores messages that cannot be decrypted', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 500,
    });

    (transport as any).pool.publish = () => [Promise.resolve()];

    const response = makeResponse();
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      // First: send an undecryptable message
      setTimeout(() => {
        opts.onevent({
          kind: 4339,
          pubkey: 'aaaa',
          content: 'garbage-content',
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          id: 'bad',
          sig: '0'.repeat(128),
        });
      }, 10);

      // Then: send a valid encrypted response
      setTimeout(() => {
        const receiverSecret = hexToBytes(RECEIVER_KEY);
        const convKey = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);
        const encrypted = nip44.v2.encrypt(JSON.stringify(response), convKey);

        opts.onevent({
          kind: 4339,
          pubkey: RECEIVER_PUBKEY,
          content: encrypted,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'good',
          sig: '0'.repeat(128),
        });
      }, 30);

      return { close: () => {} };
    };

    const result = await transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY });
    expect(result.id).toBe('resp-001');

    await transport.close();
  });

  it('send ignores event messages (only resolves on type=response)', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 500,
    });

    (transport as any).pool.publish = () => [Promise.resolve()];

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      const receiverSecret = hexToBytes(RECEIVER_KEY);
      const convKey = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);

      // First: send an event type (should be ignored)
      setTimeout(() => {
        const eventMsg = makeResponse({ type: 'event', id: 'evt-mid' });
        opts.onevent({
          kind: 4339,
          pubkey: RECEIVER_PUBKEY,
          content: nip44.v2.encrypt(JSON.stringify(eventMsg), convKey),
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'nostr-evt-1',
          sig: '0'.repeat(128),
        });
      }, 10);

      // Then: send a proper response
      setTimeout(() => {
        const resp = makeResponse({ id: 'final-resp' });
        opts.onevent({
          kind: 4339,
          pubkey: RECEIVER_PUBKEY,
          content: nip44.v2.encrypt(JSON.stringify(resp), convKey),
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'nostr-evt-2',
          sig: '0'.repeat(128),
        });
      }, 30);

      return { close: () => {} };
    };

    const result = await transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY });
    expect(result.id).toBe('final-resp');

    await transport.close();
  });

  // --- listen() with mocked pool ---

  it('listen decrypts inbound messages and calls handler', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };
    (transport as any).pool.publish = () => [Promise.resolve()];

    let receivedMessage: SnapMessage | null = null;
    await transport.listen(async (msg) => {
      receivedMessage = msg;
      return makeResponse();
    });

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);
    const encrypted = nip44.v2.encrypt(JSON.stringify(makeMessage()), convKey);

    await capturedOnevent({
      kind: 4339,
      pubkey: SENDER_PUBKEY,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'inbound-1',
      sig: '0'.repeat(128),
    });

    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage!.id).toBe('msg-001');
    expect(receivedMessage!.from).toBe(SENDER_ADDR);

    await transport.close();
  });

  it('listen publishes encrypted response back to sender', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };

    const publishedResponses: any[] = [];
    (transport as any).pool.publish = (relays: string[], event: any) => {
      publishedResponses.push({ relays, event });
      return [Promise.resolve()];
    };

    await transport.listen(async () => makeResponse());

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);
    const encrypted = nip44.v2.encrypt(JSON.stringify(makeMessage()), convKey);

    await capturedOnevent({
      kind: 4339,
      pubkey: SENDER_PUBKEY,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'inbound-1',
      sig: '0'.repeat(128),
    });

    expect(publishedResponses).toHaveLength(1);
    expect(publishedResponses[0].event.kind).toBe(4339);
    // The p tag should point back to the sender
    const pTag = publishedResponses[0].event.tags.find((t: string[]) => t[0] === 'p');
    expect(pTag[1]).toBe(SENDER_PUBKEY);

    await transport.close();
  });

  it('listen does not publish when handler returns void', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };

    const publishedResponses: any[] = [];
    (transport as any).pool.publish = (_relays: string[], event: any) => {
      publishedResponses.push(event);
      return [Promise.resolve()];
    };

    await transport.listen(async () => undefined);

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);
    const encrypted = nip44.v2.encrypt(JSON.stringify(makeMessage()), convKey);

    await capturedOnevent({
      kind: 4339,
      pubkey: SENDER_PUBKEY,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'inbound-1',
      sig: '0'.repeat(128),
    });

    expect(publishedResponses).toHaveLength(0);

    await transport.close();
  });

  it('listen silently ignores malformed messages', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };

    let handlerCalled = false;
    await transport.listen(async () => {
      handlerCalled = true;
      return undefined;
    });

    await capturedOnevent({
      kind: 4339,
      pubkey: 'bad-pubkey',
      content: 'not-encrypted',
      created_at: 0,
      tags: [],
      id: 'bad',
      sig: '0'.repeat(128),
    });

    expect(handlerCalled).toBe(false);

    await transport.close();
  });

  // --- fetchOfflineMessages ---

  it('fetchOfflineMessages decrypts and returns messages', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);

    const msg1 = makeMessage({ id: 'offline-1' });
    const msg2 = makeMessage({ id: 'offline-2' });

    (transport as any).pool.querySync = async () => [
      {
        kind: 4339, pubkey: SENDER_PUBKEY,
        content: nip44.v2.encrypt(JSON.stringify(msg1), convKey),
        created_at: 1000, tags: [['p', RECEIVER_PUBKEY]], id: 'evt-1', sig: '0'.repeat(128),
      },
      {
        kind: 4339, pubkey: SENDER_PUBKEY,
        content: nip44.v2.encrypt(JSON.stringify(msg2), convKey),
        created_at: 1001, tags: [['p', RECEIVER_PUBKEY]], id: 'evt-2', sig: '0'.repeat(128),
      },
    ];

    const messages = await transport.fetchOfflineMessages(999);

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('offline-1');
    expect(messages[1].id).toBe('offline-2');

    await transport.close();
  });

  it('fetchOfflineMessages skips undecryptable messages', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);

    const validMsg = makeMessage({ id: 'valid-msg' });

    (transport as any).pool.querySync = async () => [
      { kind: 4339, pubkey: 'unknown', content: 'garbage', created_at: 1000, tags: [], id: 'bad', sig: '0'.repeat(128) },
      {
        kind: 4339, pubkey: SENDER_PUBKEY,
        content: nip44.v2.encrypt(JSON.stringify(validMsg), convKey),
        created_at: 1001, tags: [['p', RECEIVER_PUBKEY]], id: 'good', sig: '0'.repeat(128),
      },
    ];

    const messages = await transport.fetchOfflineMessages(999);

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('valid-msg');

    await transport.close();
  });

  // --- close ---

  it('close terminates active subscription', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let subClosed = false;
    (transport as any).pool.subscribeMany = () => ({
      close: () => { subClosed = true; },
    });

    await transport.listen(async () => undefined);
    await transport.close();

    expect(subClosed).toBe(true);
  });

  it('close can be called multiple times safely', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });

    await transport.close();
    await transport.close();
    // Should not throw
  });

  // --- Custom config options ---

  it('uses custom messageKind in send()', async () => {
    const CUSTOM_KIND = 99999;
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      messageKind: CUSTOM_KIND,
    });

    const publishedEvents: any[] = [];
    (transport as any).pool.publish = (_relays: string[], event: any) => {
      publishedEvents.push(event);
      return [Promise.resolve()];
    };

    // Mock subscribeMany to verify filter uses custom kind
    let capturedFilter: any;
    const response = makeResponse();
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    (transport as any).pool.subscribeMany = (_relays: string[], filter: any, opts: any) => {
      capturedFilter = filter;
      const receiverSecret = hexToBytes(RECEIVER_KEY);
      const convKey = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);
      const encrypted = nip44.v2.encrypt(JSON.stringify(response), convKey);

      setTimeout(() => {
        opts.onevent({
          kind: CUSTOM_KIND,
          pubkey: RECEIVER_PUBKEY,
          content: encrypted,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'evt-custom',
          sig: '0'.repeat(128),
        });
      }, 10);

      return { close: () => {} };
    };

    await transport.send(makeMessage(), { endpoint: 'nostr', timeout: 5000, nostrPubkey: RECEIVER_PUBKEY });

    // Published event should use custom kind
    expect(publishedEvents[0].kind).toBe(CUSTOM_KIND);
    // Subscription filter should include custom kind and default storable kind
    expect(capturedFilter.kinds).toEqual([CUSTOM_KIND, 4339]);

    await transport.close();
  });

  it('uses custom agentCardKind in publishAgentCard()', async () => {
    const CUSTOM_CARD_KIND = 77777;
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      agentCardKind: CUSTOM_CARD_KIND,
    });

    const publishedEvents: any[] = [];
    (transport as any).pool.publish = (_relays: string[], event: any) => {
      publishedEvents.push(event);
      return [Promise.resolve()];
    };

    await transport.publishAgentCard(makeAgentCard());

    expect(publishedEvents[0].kind).toBe(CUSTOM_CARD_KIND);

    await transport.close();
  });

  it('uses custom agentCardKind in discoverAgents()', async () => {
    const CUSTOM_CARD_KIND = 77777;
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      agentCardKind: CUSTOM_CARD_KIND,
    });

    let capturedFilter: any;
    (transport as any).pool.querySync = async (_relays: string[], filter: any) => {
      capturedFilter = filter;
      return [];
    };

    await transport.discoverAgents({ skills: ['echo'] });

    expect(capturedFilter.kinds).toEqual([CUSTOM_CARD_KIND]);

    await transport.close();
  });

  it('uses custom responseLookbackSeconds in send() subscription', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      responseLookbackSeconds: 60,
      timeout: 200,
    });

    (transport as any).pool.publish = () => [Promise.resolve()];

    let capturedFilter: any;
    (transport as any).pool.subscribeMany = (_relays: string[], filter: any, _opts: any) => {
      capturedFilter = filter;
      return { close: () => {} };
    };

    // Will timeout but we just need to capture the filter
    try {
      await transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY });
    } catch {
      // Expected timeout
    }

    const now = Math.floor(Date.now() / 1000);
    // With 60s lookback, `since` should be ~now - 60
    expect(capturedFilter.since).toBeGreaterThanOrEqual(now - 62);
    expect(capturedFilter.since).toBeLessThanOrEqual(now - 58);

    await transport.close();
  });

  it('uses custom messageKind in listen() subscription', async () => {
    const CUSTOM_KIND = 55555;
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      messageKind: CUSTOM_KIND,
    });

    let capturedFilter: any;
    (transport as any).pool.subscribeMany = (_relays: string[], filter: any, _opts: any) => {
      capturedFilter = filter;
      return { close: () => {} };
    };

    await transport.listen(async () => undefined);

    // listen() subscribes to both ephemeral (custom) and storable (default 4339) kinds
    expect(capturedFilter.kinds).toEqual([CUSTOM_KIND, 4339]);

    await transport.close();
  });

  it('uses custom storableMessageKind in fetchOfflineMessages()', async () => {
    const CUSTOM_STORABLE_KIND = 55555;
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      storableMessageKind: CUSTOM_STORABLE_KIND,
    });

    let capturedFilter: any;
    (transport as any).pool.querySync = async (_relays: string[], filter: any) => {
      capturedFilter = filter;
      return [];
    };

    await transport.fetchOfflineMessages(1000);

    // fetchOfflineMessages uses only the storable kind (not ephemeral)
    expect(capturedFilter.kinds).toEqual([CUSTOM_STORABLE_KIND]);

    await transport.close();
  });

  // --- Logger tests ---

  it('logger is called when decryption fails in send()', async () => {
    const logs: Array<{ level: string; message: string; data: unknown }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 500,
      logger: (level, message, data) => {
        logs.push({ level, message, data });
      },
    });

    (transport as any).pool.publish = () => [Promise.resolve()];

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      // Send an undecryptable message first
      setTimeout(() => {
        opts.onevent({
          kind: 4339,
          pubkey: 'aaaa',
          content: 'garbage-content',
          created_at: Math.floor(Date.now() / 1000),
          tags: [],
          id: 'bad-evt',
          sig: '0'.repeat(128),
        });
      }, 10);

      // Then send a valid response
      setTimeout(() => {
        const receiverSecret = hexToBytes(RECEIVER_KEY);
        const convKey = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);
        const encrypted = nip44.v2.encrypt(JSON.stringify(makeResponse()), convKey);

        opts.onevent({
          kind: 4339,
          pubkey: RECEIVER_PUBKEY,
          content: encrypted,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'good-evt',
          sig: '0'.repeat(128),
        });
      }, 50);

      return { close: () => {} };
    };

    await transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY });

    // Logger should have been called for the bad event
    const decryptLog = logs.find((l) => l.level === 'debug' && l.message.includes('decrypt'));
    expect(decryptLog).toBeDefined();

    await transport.close();
  });

  it('logger is called when listen() fails to process a message', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };

    await transport.listen(async () => undefined);

    // Send undecryptable message
    await capturedOnevent({
      kind: 4339,
      pubkey: 'bad-pubkey',
      content: 'not-encrypted',
      created_at: 0,
      tags: [],
      id: 'bad',
      sig: '0'.repeat(128),
    });

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].level).toBe('warn');
    expect(logs[0].message).toContain('inbound');

    await transport.close();
  });

  it('logger is called when discoverAgents() encounters invalid JSON', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    (transport as any).pool.querySync = async () => [
      { content: 'not-json', kind: 31337, pubkey: RECEIVER_PUBKEY, tags: [], created_at: 0, id: 'abc', sig: '123' },
    ];

    const results = await transport.discoverAgents({});
    expect(results).toHaveLength(0);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].level).toBe('warn');
    expect(logs[0].message).toContain('agent card');

    await transport.close();
  });

  it('logger is called when fetchOfflineMessages() fails to decrypt', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    (transport as any).pool.querySync = async () => [
      { kind: 4339, pubkey: 'unknown', content: 'garbage', created_at: 1000, tags: [], id: 'bad', sig: '0'.repeat(128) },
    ];

    const messages = await transport.fetchOfflineMessages(999);
    expect(messages).toHaveLength(0);

    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].level).toBe('debug');
    expect(logs[0].message).toContain('offline');

    await transport.close();
  });

  // --- Identity verification tests ---

  it('listen() rejects message with forged from address', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };
    (transport as any).pool.publish = () => [Promise.resolve()];

    let handlerCalled = false;
    await transport.listen(async () => {
      handlerCalled = true;
      return makeResponse();
    });

    // Encrypt a message with SENDER_KEY but forge the `from` field to a third party
    const THIRD_KEY = '0000000000000000000000000000000000000000000000000000000000000003';
    const THIRD_ADDR = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(THIRD_KEY));

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);

    // Message claims to be from THIRD_ADDR but is actually encrypted by SENDER_KEY
    const forgedMessage = makeMessage({ from: THIRD_ADDR as any });
    const encrypted = nip44.v2.encrypt(JSON.stringify(forgedMessage), convKey);

    await capturedOnevent({
      kind: 4339,
      pubkey: SENDER_PUBKEY, // Real sender
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'forged-1',
      sig: '0'.repeat(128),
    });

    // Handler should NOT have been called due to identity mismatch
    expect(handlerCalled).toBe(false);
    expect(logs.some((l) => l.level === 'warn' && l.message.includes('Identity mismatch'))).toBe(true);

    await transport.close();
  });

  it('listen() accepts message with matching from address', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };
    (transport as any).pool.publish = () => [Promise.resolve()];

    let handlerCalled = false;
    await transport.listen(async () => {
      handlerCalled = true;
      return makeResponse();
    });

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);

    // Message from is SENDER_ADDR, which correctly matches SENDER_PUBKEY
    const validMessage = makeMessage({ from: SENDER_ADDR as any });
    const encrypted = nip44.v2.encrypt(JSON.stringify(validMessage), convKey);

    await capturedOnevent({
      kind: 4339,
      pubkey: SENDER_PUBKEY,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'valid-1',
      sig: '0'.repeat(128),
    });

    expect(handlerCalled).toBe(true);

    await transport.close();
  });

  it('send() rejects response with forged from address', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 500,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    (transport as any).pool.publish = () => [Promise.resolve()];

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      // Send a response encrypted by RECEIVER_KEY but with forged `from`
      setTimeout(() => {
        const THIRD_KEY = '0000000000000000000000000000000000000000000000000000000000000003';
        const THIRD_ADDR = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(THIRD_KEY));

        const receiverSecret = hexToBytes(RECEIVER_KEY);
        const convKey = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);
        const forgedResp = makeResponse({ from: THIRD_ADDR as any });
        const encrypted = nip44.v2.encrypt(JSON.stringify(forgedResp), convKey);

        opts.onevent({
          kind: 4339,
          pubkey: RECEIVER_PUBKEY,
          content: encrypted,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'forged-resp',
          sig: '0'.repeat(128),
        });
      }, 10);

      return { close: () => {} };
    };

    // Should timeout because the forged response is rejected
    await expect(
      transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY }),
    ).rejects.toThrow('timed out');

    expect(logs.some((l) => l.level === 'warn' && l.message.includes('Identity mismatch'))).toBe(true);

    await transport.close();
  });

  // --- Dual-kind (ephemeral / storable) tests ---

  it('send() uses storable kind when persist=true', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });

    const publishedEvents: any[] = [];
    (transport as any).pool.publish = (_relays: string[], event: any) => {
      publishedEvents.push(event);
      return [Promise.resolve()];
    };

    const response = makeResponse();
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      const receiverSecret = hexToBytes(RECEIVER_KEY);
      const convKey = nip44.v2.utils.getConversationKey(receiverSecret, SENDER_PUBKEY);
      const encrypted = nip44.v2.encrypt(JSON.stringify(response), convKey);

      setTimeout(() => {
        opts.onevent({
          kind: 4339,
          pubkey: RECEIVER_PUBKEY,
          content: encrypted,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['p', SENDER_PUBKEY]],
          id: 'evt-persist',
          sig: '0'.repeat(128),
        });
      }, 10);

      return { close: () => {} };
    };

    await transport.send(makeMessage(), {
      endpoint: 'nostr',
      timeout: 5000,
      nostrPubkey: RECEIVER_PUBKEY,
      persist: true,
    });

    // persist=true should use storable kind 4339
    expect(publishedEvents[0].kind).toBe(4339);

    await transport.close();
  });

  it('send() response filter includes both ephemeral and storable kinds', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      timeout: 200,
    });

    (transport as any).pool.publish = () => [Promise.resolve()];

    let capturedFilter: any;
    (transport as any).pool.subscribeMany = (_relays: string[], filter: any, _opts: any) => {
      capturedFilter = filter;
      return { close: () => {} };
    };

    try {
      await transport.send(makeMessage(), { endpoint: 'nostr', nostrPubkey: RECEIVER_PUBKEY });
    } catch {
      // Expected timeout
    }

    // Response filter should include both kinds
    expect(capturedFilter.kinds).toEqual([21339, 4339]);

    await transport.close();
  });

  it('listen() subscribes to both ephemeral and storable kinds', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedFilter: any;
    (transport as any).pool.subscribeMany = (_relays: string[], filter: any, _opts: any) => {
      capturedFilter = filter;
      return { close: () => {} };
    };

    await transport.listen(async () => undefined);

    expect(capturedFilter.kinds).toEqual([21339, 4339]);

    await transport.close();
  });

  it('listen() mirrors request kind in response event', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedOnevent: any;
    (transport as any).pool.subscribeMany = (_relays: string[], _filter: any, opts: any) => {
      capturedOnevent = opts.onevent;
      return { close: () => {} };
    };

    const publishedResponses: any[] = [];
    (transport as any).pool.publish = (_relays: string[], event: any) => {
      publishedResponses.push(event);
      return [Promise.resolve()];
    };

    await transport.listen(async () => makeResponse());

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);
    const encrypted = nip44.v2.encrypt(JSON.stringify(makeMessage()), convKey);

    // Send request as ephemeral kind 21339
    await capturedOnevent({
      kind: 21339,
      pubkey: SENDER_PUBKEY,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'inbound-ephemeral',
      sig: '0'.repeat(128),
    });

    // Response should mirror the ephemeral kind
    expect(publishedResponses).toHaveLength(1);
    expect(publishedResponses[0].kind).toBe(21339);

    // Now send request as storable kind 4339
    await capturedOnevent({
      kind: 4339,
      pubkey: SENDER_PUBKEY,
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', RECEIVER_PUBKEY]],
      id: 'inbound-storable',
      sig: '0'.repeat(128),
    });

    // Response should mirror the storable kind
    expect(publishedResponses).toHaveLength(2);
    expect(publishedResponses[1].kind).toBe(4339);

    await transport.close();
  });

  it('fetchOfflineMessages() uses only storable kind, not ephemeral', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
    });

    let capturedFilter: any;
    (transport as any).pool.querySync = async (_relays: string[], filter: any) => {
      capturedFilter = filter;
      return [];
    };

    await transport.fetchOfflineMessages(1000);

    // Should only query storable kind (ephemeral events are not persisted)
    expect(capturedFilter.kinds).toEqual([4339]);

    await transport.close();
  });

  it('kinds array is deduplicated when messageKind equals storableMessageKind', async () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      messageKind: 4339,
      storableMessageKind: 4339,
    });

    let capturedFilter: any;
    (transport as any).pool.subscribeMany = (_relays: string[], filter: any, _opts: any) => {
      capturedFilter = filter;
      return { close: () => {} };
    };

    await transport.listen(async () => undefined);

    // Should be deduplicated to a single entry
    expect(capturedFilter.kinds).toEqual([4339]);

    await transport.close();
  });

  // --- Headers config tests ---

  it('constructs with custom headers', () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      headers: { 'User-Agent': 'snap-cli/1.0.0' },
    });
    expect(transport).toBeDefined();
  });

  it('constructs without headers (uses default WebSocket)', () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
    });
    expect(transport).toBeDefined();
  });

  it('constructs with empty headers object (uses default WebSocket)', () => {
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: SENDER_KEY,
      headers: {},
    });
    expect(transport).toBeDefined();
  });

  it('fetchOfflineMessages() filters out messages with forged from address', async () => {
    const logs: Array<{ level: string; message: string }> = [];
    const transport = new NostrTransport({
      relays: ['wss://relay.example.com'],
      privateKey: RECEIVER_KEY,
      logger: (level, message) => {
        logs.push({ level, message });
      },
    });

    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const senderSecret = hexToBytes(SENDER_KEY);
    const convKey = nip44.v2.utils.getConversationKey(senderSecret, RECEIVER_PUBKEY);

    const THIRD_KEY = '0000000000000000000000000000000000000000000000000000000000000003';
    const THIRD_ADDR = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(THIRD_KEY));

    // One forged message (from doesn't match pubkey) and one valid
    const forgedMsg = makeMessage({ id: 'forged', from: THIRD_ADDR as any });
    const validMsg = makeMessage({ id: 'valid', from: SENDER_ADDR as any });

    (transport as any).pool.querySync = async () => [
      {
        kind: 4339, pubkey: SENDER_PUBKEY,
        content: nip44.v2.encrypt(JSON.stringify(forgedMsg), convKey),
        created_at: 1000, tags: [['p', RECEIVER_PUBKEY]], id: 'evt-forged', sig: '0'.repeat(128),
      },
      {
        kind: 4339, pubkey: SENDER_PUBKEY,
        content: nip44.v2.encrypt(JSON.stringify(validMsg), convKey),
        created_at: 1001, tags: [['p', RECEIVER_PUBKEY]], id: 'evt-valid', sig: '0'.repeat(128),
      },
    ];

    const messages = await transport.fetchOfflineMessages(999);

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('valid');
    expect(logs.some((l) => l.level === 'warn' && l.message.includes('Identity mismatch'))).toBe(true);

    await transport.close();
  });
});
