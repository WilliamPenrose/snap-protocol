/**
 * Integration tests for NostrTransport against a real Nostr relay.
 *
 * These tests require a running relay. Set the SNAP_RELAY_URL environment variable:
 *
 *   SNAP_RELAY_URL=wss://snap.onspace.ai npm run test:relay
 *
 * All tests are skipped when SNAP_RELAY_URL is not set.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes, randomUUID } from 'crypto';
import { NostrTransport } from '../../src/transport/NostrTransport.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import { AgentCardBuilder } from '../../src/agent/AgentCardBuilder.js';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import type { SnapMessage, MessageType, MethodName } from '../../src/types/message.js';
import type { AgentCard } from '../../src/types/agent-card.js';

const RELAY_URL = process.env.SNAP_RELAY_URL;
const TIMEOUT = 15_000;

/** Generate a fresh random key pair for test isolation. */
function freshKey() {
  const privateKey = randomBytes(32).toString('hex');
  return KeyManager.deriveKeyPair(privateKey);
}

function createTransport(privateKey: string, logger?: boolean) {
  return new NostrTransport({
    relays: [RELAY_URL!],
    privateKey,
    timeout: TIMEOUT,
    logger: logger ? (level, msg) => console.log(`  [nostr:${level}] ${msg}`) : undefined,
  });
}

type KeyInfo = ReturnType<typeof freshKey>;

/** Build and sign a SNAP message with all required fields. */
function buildSignedMessage(opts: {
  from: KeyInfo;
  to: KeyInfo;
  method?: MethodName;
  type?: MessageType;
  text?: string;
}): SnapMessage {
  const msg = new MessageBuilder()
    .id(randomUUID())
    .from(opts.from.address)
    .to(opts.to.address)
    .type(opts.type ?? 'request')
    .method(opts.method ?? 'message/send')
    .timestamp(Math.floor(Date.now() / 1000))
    .payload({
      message: {
        messageId: randomUUID(),
        role: opts.type === 'response' ? 'agent' : 'user',
        parts: [{ text: opts.text ?? 'test message' }],
      },
    })
    .build();
  return new MessageSigner(opts.from.privateKey).sign(msg);
}

/** Build a minimal agent card with all required fields. */
function buildCard(key: KeyInfo, overrides?: Partial<AgentCard>): AgentCard {
  return new AgentCardBuilder()
    .name(overrides?.name ?? `Agent-${key.publicKey.slice(0, 8)}`)
    .description(overrides?.description ?? 'Test agent')
    .version(overrides?.version ?? '1.0.0')
    .identity(key.address)
    .defaultInputModes(['text/plain'])
    .defaultOutputModes(['text/plain'])
    .nostrRelay(RELAY_URL!)
    .skill({ id: 'echo', name: 'Echo', description: 'Echo messages', tags: [] })
    .build();
}

/** Create an echo handler that responds to every inbound message. */
function echoHandler(receiver: KeyInfo) {
  return async (inbound: SnapMessage): Promise<SnapMessage> => {
    const text = (inbound.payload as any).message?.parts?.[0]?.text ?? '';
    return buildSignedMessage({
      from: receiver,
      to: { ...receiver, address: inbound.from } as any,
      type: 'response',
      method: inbound.method,
      text: `echo: ${text}`,
    });
  };
}

describe.skipIf(!RELAY_URL)('NostrTransport relay integration', () => {
  const transports: NostrTransport[] = [];

  afterEach(async () => {
    await Promise.allSettled(transports.map(t => t.close()));
    transports.length = 0;
  });

  it('publishAgentCard + discoverAgents round-trip', async () => {
    const key = freshKey();
    const transport = createTransport(key.privateKey);
    transports.push(transport);

    const card = new AgentCardBuilder()
      .name(`Test-${key.publicKey.slice(0, 8)}`)
      .description('Integration test agent')
      .version('1.0.0')
      .identity(key.address)
      .defaultInputModes(['text/plain'])
      .defaultOutputModes(['text/plain'])
      .nostrRelay(RELAY_URL!)
      .skill({ id: 'echo', name: 'Echo', description: 'Echo messages back', tags: [] })
      .build();

    // Publish
    await transport.publishAgentCard(card);

    // Delay for relay indexing (replaceable events need more time)
    await sleep(2000);

    // Discover by identity
    const found = await transport.discoverAgents({ identity: key.address as any });
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].name).toBe(card.name);
    expect(found[0].identity).toBe(key.address);
  }, TIMEOUT);

  it('discoverAgents by skill', async () => {
    const key = freshKey();
    const transport = createTransport(key.privateKey);
    transports.push(transport);

    const uniqueSkill = `test-skill-${Date.now()}`;
    const card = new AgentCardBuilder()
      .name(`Skill-${key.publicKey.slice(0, 8)}`)
      .description('Skill lookup test')
      .version('1.0.0')
      .identity(key.address)
      .defaultInputModes(['text/plain'])
      .defaultOutputModes(['text/plain'])
      .nostrRelay(RELAY_URL!)
      .skill({ id: uniqueSkill, name: 'Unique Skill', description: 'For testing skill discovery', tags: [] })
      .build();

    await transport.publishAgentCard(card);
    await sleep(2000);

    const found = await transport.discoverAgents({ skills: [uniqueSkill] });
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.some(c => c.identity === key.address)).toBe(true);
  }, TIMEOUT);

  it('send + listen message round-trip', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(senderTransport, receiverTransport);

    // Receiver listens and echoes back
    await receiverTransport.listen(async (inbound) => {
      const text = (inbound.payload as any).message?.parts?.[0]?.text ?? '';
      const response = new MessageBuilder()
        .id(randomUUID())
        .from(receiver.address)
        .to(sender.address)
        .type('response')
        .method(inbound.method)
        .timestamp(Math.floor(Date.now() / 1000))
        .payload({
          message: {
            messageId: 'resp-1',
            role: 'agent',
            parts: [{ text: `echo: ${text}` }],
          },
        })
        .build();

      const signer = new MessageSigner(receiver.privateKey);
      return signer.sign(response);
    });

    // Small delay for subscription to be established on relay
    await sleep(500);

    // Sender sends a message
    const outbound = new MessageBuilder()
      .id(randomUUID())
      .from(sender.address)
      .to(receiver.address)
      .method('message/send')
      .timestamp(Math.floor(Date.now() / 1000))
      .payload({
        message: {
          messageId: 'msg-1',
          role: 'user',
          parts: [{ text: 'hello relay' }],
        },
      })
      .build();

    const signer = new MessageSigner(sender.privateKey);
    const signed = signer.sign(outbound);

    const response = await senderTransport.send(signed, {
      endpoint: 'nostr',
      nostrPubkey: receiver.publicKey,
    });

    expect(response.type).toBe('response');
    expect(response.from).toBe(receiver.address);
    const text = (response.payload as any).message?.parts?.[0]?.text;
    expect(text).toBe('echo: hello relay');
  }, TIMEOUT * 2);

  it('fetchOfflineMessages retrieves messages sent while offline', async () => {
    // SNAP message kind 4339 is in the regular (storable) range, so relays
    // persist these events and fetchOfflineMessages can retrieve them.
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = new NostrTransport({
      relays: [RELAY_URL!],
      privateKey: sender.privateKey,
      timeout: TIMEOUT,
    });
    transports.push(senderTransport);

    const beforeSend = Math.floor(Date.now() / 1000) - 1;

    // Send a message while receiver is NOT listening
    const outbound = new MessageBuilder()
      .id(randomUUID())
      .from(sender.address)
      .to(receiver.address)
      .method('message/send')
      .timestamp(Math.floor(Date.now() / 1000))
      .payload({
        message: {
          messageId: 'offline-1',
          role: 'user',
          parts: [{ text: 'offline message' }],
        },
      })
      .build();

    const signer = new MessageSigner(sender.privateKey);
    const signed = signer.sign(outbound);

    // Publish directly (send() would wait for response and timeout)
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const { finalizeEvent } = await import('nostr-tools');

    const senderBytes = hexToBytes(sender.privateKey);
    const conversationKey = nip44.v2.utils.getConversationKey(senderBytes, receiver.publicKey);
    const encrypted = nip44.v2.encrypt(JSON.stringify(signed), conversationKey);

    const { SNAP_MESSAGE_KIND } = await import('../../src/transport/NostrTransport.js');
    const event = finalizeEvent({
      kind: SNAP_MESSAGE_KIND,
      tags: [['p', receiver.publicKey]],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    }, senderBytes);

    await (senderTransport as any).publishToRelays(event);
    await sleep(2000);

    // Now receiver comes online and fetches offline messages
    const receiverTransport = new NostrTransport({
      relays: [RELAY_URL!],
      privateKey: receiver.privateKey,
      timeout: TIMEOUT,
    });
    transports.push(receiverTransport);

    const messages = await receiverTransport.fetchOfflineMessages(beforeSend);
    expect(messages.length).toBeGreaterThanOrEqual(1);

    const offlineMsg = messages.find(m => m.id === signed.id);
    expect(offlineMsg).toBeDefined();
    expect(offlineMsg!.from).toBe(sender.address);
  }, TIMEOUT);

  it('publishAgentCard updates replace previous card', async () => {
    const key = freshKey();
    const transport = createTransport(key.privateKey);
    transports.push(transport);

    // Publish v1
    const card1 = new AgentCardBuilder()
      .name('Agent V1')
      .description('First version')
      .version('1.0.0')
      .identity(key.address)
      .defaultInputModes(['text/plain'])
      .defaultOutputModes(['text/plain'])
      .nostrRelay(RELAY_URL!)
      .skill({ id: 'echo', name: 'Echo', description: 'Echo messages', tags: [] })
      .build();

    await transport.publishAgentCard(card1);
    await sleep(2000);

    // Publish v2 (same identity → replaces via NIP-33 d-tag)
    const card2 = new AgentCardBuilder()
      .name('Agent V2')
      .description('Updated version')
      .version('2.0.0')
      .identity(key.address)
      .defaultInputModes(['text/plain'])
      .defaultOutputModes(['text/plain'])
      .nostrRelay(RELAY_URL!)
      .skill({ id: 'echo', name: 'Echo', description: 'Echo messages', tags: [] })
      .skill({ id: 'translate', name: 'Translate', description: 'Translate text', tags: [] })
      .build();

    await transport.publishAgentCard(card2);
    await sleep(2000);

    // Should find the updated card
    const found = await transport.discoverAgents({ identity: key.address as any });
    expect(found.length).toBe(1);
    expect(found[0].name).toBe('Agent V2');
    expect(found[0].version).toBe('2.0.0');
    expect(found[0].skills).toHaveLength(2);
  }, TIMEOUT);

  // ========== A. Security — Identity & Encryption ==========

  it('listen() drops messages with forged from address', async () => {
    const attacker = freshKey();
    const receiver = freshKey();

    const attackerTransport = createTransport(attacker.privateKey);
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(attackerTransport, receiverTransport);

    let handlerCalled = false;
    await receiverTransport.listen(async () => {
      handlerCalled = true;
      return undefined as any;
    });

    await sleep(500);

    // Attacker sends a message with their own key, but forges the `from` field
    // to a victim's address (different from attacker's actual P2TR address)
    const victim = freshKey();
    const forgedMsg = new MessageBuilder()
      .id(randomUUID())
      .from(victim.address)  // Forged! Doesn't match attacker's Nostr pubkey
      .to(receiver.address)
      .method('message/send')
      .timestamp(Math.floor(Date.now() / 1000))
      .payload({ message: { messageId: 'forged', role: 'user', parts: [{ text: 'forged' }] } })
      .build();
    const signed = new MessageSigner(attacker.privateKey).sign(forgedMsg);

    // Publish the forged event via Nostr (encrypted with attacker's key)
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const { finalizeEvent } = await import('nostr-tools');

    const attackerBytes = hexToBytes(attacker.privateKey);
    const convKey = nip44.v2.utils.getConversationKey(attackerBytes, receiver.publicKey);
    const encrypted = nip44.v2.encrypt(JSON.stringify(signed), convKey);

    const { SNAP_EPHEMERAL_MESSAGE_KIND } = await import('../../src/transport/NostrTransport.js');
    const event = finalizeEvent({
      kind: SNAP_EPHEMERAL_MESSAGE_KIND,
      tags: [['p', receiver.publicKey]],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    }, attackerBytes);

    await (attackerTransport as any).publishToRelays(event);

    // Wait for event to be delivered and identity check to fire
    await sleep(2000);

    // Handler should NOT have been called — identity mismatch
    expect(handlerCalled).toBe(false);
  }, TIMEOUT);

  it('send() ignores responses with forged from address', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const SHORT_TIMEOUT = 3000;
    const senderTransport = new NostrTransport({
      relays: [RELAY_URL!],
      privateKey: sender.privateKey,
      timeout: SHORT_TIMEOUT,
    });
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(senderTransport, receiverTransport);

    // Receiver listens but sends response with a forged `from` address
    const impersonated = freshKey();
    await receiverTransport.listen(async (inbound) => {
      // Build response with forged `from` (impersonated identity)
      const resp = new MessageBuilder()
        .id(randomUUID())
        .from(impersonated.address)  // Forged!
        .to(sender.address)
        .type('response')
        .method(inbound.method)
        .timestamp(Math.floor(Date.now() / 1000))
        .payload({ message: { messageId: 'resp', role: 'agent', parts: [{ text: 'forged' }] } })
        .build();
      return new MessageSigner(receiver.privateKey).sign(resp);
    });

    await sleep(500);

    const outbound = buildSignedMessage({ from: sender, to: receiver });

    // send() should timeout because the forged response is rejected
    await expect(
      senderTransport.send(outbound, { endpoint: 'nostr', nostrPubkey: receiver.publicKey }),
    ).rejects.toThrow('Nostr response timed out');
  }, TIMEOUT);

  it('third party cannot decrypt NIP-44 messages', async () => {
    const sender = freshKey();
    const receiver = freshKey();
    const eavesdropper = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    const receiverTransport = createTransport(receiver.privateKey);
    const eavesdropperTransport = createTransport(eavesdropper.privateKey);
    transports.push(senderTransport, receiverTransport, eavesdropperTransport);

    // Set up receiver echo so send() doesn't timeout
    await receiverTransport.listen(echoHandler(receiver));
    await sleep(500);

    const outbound = buildSignedMessage({ from: sender, to: receiver, text: 'secret message' });
    // Use persist=true so the message is stored on the relay for the eavesdropper to find
    await senderTransport.send(outbound, { endpoint: 'nostr', nostrPubkey: receiver.publicKey, persist: true });

    // Eavesdropper queries the relay for stored events tagged with receiver's pubkey
    const eavesdropperPool = (eavesdropperTransport as any).pool;
    const events = await eavesdropperPool.querySync([RELAY_URL!], {
      kinds: [4339],  // Only storable kind — ephemeral events are not persisted
      '#p': [receiver.publicKey],
      since: Math.floor(Date.now() / 1000) - 10,
    });

    // Eavesdropper tries to decrypt with their own key — should fail
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');

    // If events are found, decryption by eavesdropper must fail
    for (const evt of events) {
      const wrongConvKey = nip44.v2.utils.getConversationKey(
        hexToBytes(eavesdropper.privateKey),
        evt.pubkey,
      );
      expect(() => {
        const decrypted = nip44.v2.decrypt(evt.content, wrongConvKey);
        // Even if nip44.decrypt doesn't throw, the content should be garbage
        JSON.parse(decrypted);
      }).toThrow();
    }
  }, TIMEOUT * 2);

  // ========== B. Discovery ==========

  it('discoverAgents() populates pubkey cache from relay events', async () => {
    const agent = freshKey();
    const client = freshKey();

    const agentTransport = createTransport(agent.privateKey);
    const clientTransport = createTransport(client.privateKey);
    transports.push(agentTransport, clientTransport);

    // Agent publishes its card
    const card = buildCard(agent);
    await agentTransport.publishAgentCard(card);
    await sleep(3000);

    // Before discovery, cache should be empty
    expect((clientTransport as any).internalKeyCache.get(agent.address)).toBeUndefined();

    // send() without nostrPubkey should throw before discovery
    const outbound = buildSignedMessage({ from: client, to: agent });
    await expect(
      clientTransport.send(outbound, { endpoint: 'nostr' }),
    ).rejects.toThrow('Cannot determine Nostr pubkey');

    // After discovery, cache should be populated with correct internal key
    const found = await clientTransport.discoverAgents({ identity: agent.address as any });
    expect(found.length).toBeGreaterThanOrEqual(1);

    const cachedKey = (clientTransport as any).internalKeyCache.get(agent.address);
    expect(cachedKey).toBe(agent.publicKey);
  }, TIMEOUT);

  it('discoverAgents() returns empty for non-existent identity', async () => {
    const key = freshKey();
    const transport = createTransport(key.privateKey);
    transports.push(transport);

    const nonExistent = freshKey();
    const found = await transport.discoverAgents({ identity: nonExistent.address as any });
    expect(found).toEqual([]);
  }, TIMEOUT);

  it('discoverAgents() by name', async () => {
    const key = freshKey();
    const transport = createTransport(key.privateKey);
    transports.push(transport);

    const uniqueName = `NameTest-${Date.now()}`;
    const card = new AgentCardBuilder()
      .name(uniqueName)
      .description('Name lookup test')
      .version('1.0.0')
      .identity(key.address)
      .defaultInputModes(['text/plain'])
      .defaultOutputModes(['text/plain'])
      .nostrRelay(RELAY_URL!)
      .skill({ id: 'test', name: 'Test', description: 'Test skill', tags: [] })
      .build();

    await transport.publishAgentCard(card);
    await sleep(2000);

    const found = await transport.discoverAgents({ name: uniqueName });
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0].name).toBe(uniqueName);
  }, TIMEOUT);

  // ========== C. Messaging Edge Cases ==========

  it('send() times out when recipient is not listening', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const SHORT_TIMEOUT = 3000;
    const senderTransport = new NostrTransport({
      relays: [RELAY_URL!],
      privateKey: sender.privateKey,
      timeout: SHORT_TIMEOUT,
    });
    transports.push(senderTransport);

    const outbound = buildSignedMessage({ from: sender, to: receiver });

    await expect(
      senderTransport.send(outbound, { endpoint: 'nostr', nostrPubkey: receiver.publicKey }),
    ).rejects.toThrow('Nostr response timed out');
  }, TIMEOUT);

  it('listen() handler returning void sends no response back', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const SHORT_TIMEOUT = 3000;
    const senderTransport = new NostrTransport({
      relays: [RELAY_URL!],
      privateKey: sender.privateKey,
      timeout: SHORT_TIMEOUT,
    });
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(senderTransport, receiverTransport);

    let receivedMessage: SnapMessage | null = null;
    await receiverTransport.listen(async (inbound) => {
      receivedMessage = inbound;
      // Return void — no response should be sent
    });

    await sleep(500);

    const outbound = buildSignedMessage({ from: sender, to: receiver, text: 'fire-and-forget' });

    // send() should timeout because no response is sent back
    await expect(
      senderTransport.send(outbound, { endpoint: 'nostr', nostrPubkey: receiver.publicKey }),
    ).rejects.toThrow('Nostr response timed out');

    // But the handler WAS called
    expect(receivedMessage).not.toBeNull();
    expect((receivedMessage!.payload as any).message?.parts?.[0]?.text).toBe('fire-and-forget');
  }, TIMEOUT);

  it('multiple sequential messages are all delivered', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(senderTransport, receiverTransport);

    await receiverTransport.listen(echoHandler(receiver));
    await sleep(500);

    const responses: string[] = [];

    for (let i = 1; i <= 3; i++) {
      const msg = buildSignedMessage({ from: sender, to: receiver, text: `msg-${i}` });
      const resp = await senderTransport.send(msg, {
        endpoint: 'nostr',
        nostrPubkey: receiver.publicKey,
      });
      const text = (resp.payload as any).message?.parts?.[0]?.text;
      responses.push(text);
      // Small delay between sequential sends to let the pool reset subscription state
      if (i < 3) await sleep(500);
    }

    expect(responses).toEqual(['echo: msg-1', 'echo: msg-2', 'echo: msg-3']);
  }, TIMEOUT * 3);

  it('listen() continues processing after handler throws', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(senderTransport, receiverTransport);

    let callCount = 0;
    await receiverTransport.listen(async (inbound) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('handler error on first message');
      }
      // Second message gets a normal response
      return buildSignedMessage({
        from: receiver,
        to: { ...receiver, address: inbound.from } as any,
        type: 'response',
        method: inbound.method,
        text: 'recovered',
      });
    });

    await sleep(500);

    // First message — handler throws, send() should timeout
    const msg1 = buildSignedMessage({ from: sender, to: receiver, text: 'trigger-error' });
    await expect(
      senderTransport.send(msg1, {
        endpoint: 'nostr',
        nostrPubkey: receiver.publicKey,
        timeout: 3000,
      } as any),
    ).rejects.toThrow('Nostr response timed out');

    // Second message — handler succeeds
    const msg2 = buildSignedMessage({ from: sender, to: receiver, text: 'after-error' });
    const resp = await senderTransport.send(msg2, {
      endpoint: 'nostr',
      nostrPubkey: receiver.publicKey,
    });

    expect(resp.type).toBe('response');
    expect((resp.payload as any).message?.parts?.[0]?.text).toBe('recovered');
    expect(callCount).toBe(2);
  }, TIMEOUT * 3);

  // ========== Dual-kind (ephemeral / storable) ==========

  it('ephemeral messages (default) are NOT retrievable via fetchOfflineMessages', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    transports.push(senderTransport);

    // Publish a message using ephemeral kind 21339 (default)
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const { finalizeEvent } = await import('nostr-tools');
    const { SNAP_EPHEMERAL_MESSAGE_KIND } = await import('../../src/transport/NostrTransport.js');

    const beforeSend = Math.floor(Date.now() / 1000) - 1;

    const outbound = buildSignedMessage({ from: sender, to: receiver, text: 'ephemeral test' });
    const senderBytes = hexToBytes(sender.privateKey);
    const convKey = nip44.v2.utils.getConversationKey(senderBytes, receiver.publicKey);
    const encrypted = nip44.v2.encrypt(JSON.stringify(outbound), convKey);

    const event = finalizeEvent({
      kind: SNAP_EPHEMERAL_MESSAGE_KIND,  // 21339 — ephemeral
      tags: [['p', receiver.publicKey]],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    }, senderBytes);

    await (senderTransport as any).publishToRelays(event);
    await sleep(2000);

    // Receiver tries to fetch offline messages — should NOT find it
    // because fetchOfflineMessages queries storable kind (4339) only
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(receiverTransport);

    const messages = await receiverTransport.fetchOfflineMessages(beforeSend);
    const found = messages.find(m => m.id === outbound.id);
    expect(found).toBeUndefined();
  }, TIMEOUT);

  it('persist=true messages ARE retrievable via fetchOfflineMessages', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    transports.push(senderTransport);

    // Publish a message using storable kind 4339 (simulating persist=true)
    const nip44 = await import('nostr-tools/nip44');
    const { hexToBytes } = await import('@noble/hashes/utils');
    const { finalizeEvent } = await import('nostr-tools');
    const { SNAP_MESSAGE_KIND } = await import('../../src/transport/NostrTransport.js');

    const beforeSend = Math.floor(Date.now() / 1000) - 1;

    const outbound = buildSignedMessage({ from: sender, to: receiver, text: 'persist test' });
    const senderBytes = hexToBytes(sender.privateKey);
    const convKey = nip44.v2.utils.getConversationKey(senderBytes, receiver.publicKey);
    const encrypted = nip44.v2.encrypt(JSON.stringify(outbound), convKey);

    const event = finalizeEvent({
      kind: SNAP_MESSAGE_KIND,  // 4339 — storable
      tags: [['p', receiver.publicKey]],
      content: encrypted,
      created_at: Math.floor(Date.now() / 1000),
    }, senderBytes);

    await (senderTransport as any).publishToRelays(event);
    await sleep(2000);

    // Receiver fetches offline messages — SHOULD find it
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(receiverTransport);

    const messages = await receiverTransport.fetchOfflineMessages(beforeSend);
    const found = messages.find(m => m.id === outbound.id);
    expect(found).toBeDefined();
    expect(found!.from).toBe(sender.address);
  }, TIMEOUT);

  it('send() with persist=true completes round-trip and is offline-retrievable', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(senderTransport, receiverTransport);

    await receiverTransport.listen(echoHandler(receiver));
    await sleep(500);

    const outbound = buildSignedMessage({ from: sender, to: receiver, text: 'persist round-trip' });

    // send() with persist=true → kind 4339 (storable)
    const response = await senderTransport.send(outbound, {
      endpoint: 'nostr',
      nostrPubkey: receiver.publicKey,
      persist: true,
    });

    expect(response.type).toBe('response');
    expect((response.payload as any).message?.parts?.[0]?.text).toBe('echo: persist round-trip');

    // The request was stored by the relay — verify via fetchOfflineMessages on the receiver's transport
    await sleep(1000);
    const offlineMessages = await receiverTransport.fetchOfflineMessages(
      Math.floor(Date.now() / 1000) - 10,
    );
    const found = offlineMessages.find(m => m.id === outbound.id);
    expect(found).toBeDefined();
    expect(found!.from).toBe(sender.address);
  }, TIMEOUT * 2);

  it('concurrent send() calls to same recipient get correctly correlated responses', async () => {
    const sender = freshKey();
    const receiver = freshKey();

    const senderTransport = createTransport(sender.privateKey);
    const receiverTransport = createTransport(receiver.privateKey);
    transports.push(senderTransport, receiverTransport);

    await receiverTransport.listen(echoHandler(receiver));
    await sleep(500);

    // Send two messages concurrently — #e tag correlation must route each response
    // to the correct send() call
    const msg1 = buildSignedMessage({ from: sender, to: receiver, text: 'alpha' });
    const msg2 = buildSignedMessage({ from: sender, to: receiver, text: 'beta' });

    const [resp1, resp2] = await Promise.all([
      senderTransport.send(msg1, { endpoint: 'nostr', nostrPubkey: receiver.publicKey }),
      senderTransport.send(msg2, { endpoint: 'nostr', nostrPubkey: receiver.publicKey }),
    ]);

    expect((resp1.payload as any).message?.parts?.[0]?.text).toBe('echo: alpha');
    expect((resp2.payload as any).message?.parts?.[0]?.text).toBe('echo: beta');
  }, TIMEOUT * 2);

  // ========== D. Agent Card Fidelity ==========

  it('publishAgentCard preserves all card fields through round-trip', async () => {
    const key = freshKey();
    const transport = createTransport(key.privateKey);
    transports.push(transport);

    const fullCard: AgentCard = {
      name: `Full-${key.publicKey.slice(0, 8)}`,
      description: 'Agent with all fields populated',
      version: '3.2.1',
      identity: key.address,
      endpoints: [
        { protocol: 'http', url: 'https://example.com/api' },
        { protocol: 'wss', url: 'wss://example.com/ws' },
      ],
      nostrRelays: [RELAY_URL!, 'wss://backup-relay.example.com'],
      protocolVersion: '0.2.0',
      supportedVersions: ['0.1.0', '0.2.0'],
      capabilities: { streaming: true, pushNotifications: false },
      skills: [
        { id: 'echo', name: 'Echo', description: 'Echo messages', tags: ['utility'] },
        { id: 'translate', name: 'Translate', description: 'Translate text', tags: ['nlp', 'i18n'], examples: ['Translate "hello" to Spanish'] },
      ],
      defaultInputModes: ['text/plain', 'application/json'],
      defaultOutputModes: ['text/plain'],
      trust: { domain: 'example.com' },
      provider: { organization: 'Test Corp', url: 'https://example.com' },
      iconUrl: 'https://example.com/icon.png',
      documentationUrl: 'https://example.com/docs',
    };

    await transport.publishAgentCard(fullCard);
    await sleep(2000);

    const found = await transport.discoverAgents({ identity: key.address as any });
    expect(found.length).toBe(1);

    const card = found[0];
    expect(card.name).toBe(fullCard.name);
    expect(card.description).toBe(fullCard.description);
    expect(card.version).toBe(fullCard.version);
    expect(card.identity).toBe(fullCard.identity);
    expect(card.endpoints).toEqual(fullCard.endpoints);
    expect(card.nostrRelays).toEqual(fullCard.nostrRelays);
    expect(card.protocolVersion).toBe(fullCard.protocolVersion);
    expect(card.supportedVersions).toEqual(fullCard.supportedVersions);
    expect(card.capabilities).toEqual(fullCard.capabilities);
    expect(card.skills).toEqual(fullCard.skills);
    expect(card.defaultInputModes).toEqual(fullCard.defaultInputModes);
    expect(card.defaultOutputModes).toEqual(fullCard.defaultOutputModes);
    expect(card.trust).toEqual(fullCard.trust);
    expect(card.provider).toEqual(fullCard.provider);
    expect(card.iconUrl).toBe(fullCard.iconUrl);
    expect(card.documentationUrl).toBe(fullCard.documentationUrl);
  }, TIMEOUT);
});

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
