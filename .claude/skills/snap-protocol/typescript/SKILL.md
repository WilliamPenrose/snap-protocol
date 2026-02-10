---
name: typescript
description: "TypeScript SDK for the SNAP protocol (@snap-protocol/core). Covers: creating agents, sending/receiving messages, publishing Agent Cards, identity management, and transport configuration (HTTP, WebSocket, Nostr). Use when building SNAP agents in TypeScript/Node.js."
---

# SNAP Protocol — TypeScript SDK

## Install & Import

```bash
npm install @snap-protocol/core
```

```typescript
import {
  SnapAgent,
  KeyManager,
  NostrTransport,
  HttpTransport,
  WebSocketTransport,
  MessageBuilder,
  MessageSigner,
  MessageValidator,
  AgentCardBuilder,
  SnapError,
  ErrorCodes,
  InMemoryReplayStore,
  InMemoryTaskStore,
} from '@snap-protocol/core';

import type {
  SnapMessage,
  UnsignedMessage,
  P2TRAddress,
  KeyPair,
  AgentCard,
  Task,
  TaskState,
  Part,
  MethodHandler,
  StreamMethodHandler,
  TransportPlugin,
} from '@snap-protocol/core';
```

## Identity

```typescript
import { randomBytes } from 'crypto';
import { KeyManager } from '@snap-protocol/core';

// Generate new identity
const privateKey = randomBytes(32).toString('hex');
const keyPair = KeyManager.deriveKeyPair(privateKey);

console.log(keyPair.address);   // "bc1p..." (62 chars) - agent identity (encodes tweaked output key)
console.log(keyPair.publicKey); // 64-char hex - internal x-only public key (used by Nostr)

// Convert between formats
const tweakedKey = KeyManager.p2trToPublicKey('bc1p...');  // Returns tweaked output key, NOT internal key
const address = KeyManager.publicKeyToP2TR(internalKey);   // Applies taproot tweak, then encodes
const isValid = KeyManager.validateP2TR('bc1p...');

// Taproot tweak functions
const tweakedPubkey = KeyManager.taprootTweak(internalKeyBytes);  // Q = P + t*G
const tweakedPrivkey = KeyManager.tweakPrivateKey(privateKey);     // For signing
```

## Create an Agent

```typescript
import { SnapAgent, NostrTransport, KeyManager } from '@snap-protocol/core';
import { randomBytes } from 'crypto';

const privateKey = randomBytes(32).toString('hex');
const keyPair = KeyManager.deriveKeyPair(privateKey);

const agent = new SnapAgent({
  keyPair,
  transports: [
    new NostrTransport({
      relays: ['wss://snap.onspace.ai'],
      privateKey,
    }),
  ],
});

// Handle incoming messages
agent.handle('message/send', async (payload, ctx) => {
  const userText = payload.message.parts[0].text;
  return {
    message: {
      role: 'assistant',
      parts: [{ text: `You said: ${userText}` }],
    },
  };
});

// Start listening
await agent.listen();
console.log(`Agent running at ${keyPair.address}`);
```

### Transport Options

```typescript
// HTTP transport
new HttpTransport({ port: 3000, host: '0.0.0.0' })

// WebSocket transport
new WebSocketTransport({ port: 8080 })

// Nostr transport (default relay)
new NostrTransport({
  relays: ['wss://snap.onspace.ai'],
  privateKey,
})
```

Multiple transports can be combined. Nostr is the default for discovery and fallback messaging.

## Send Messages

```typescript
// Request-response
const response = await agent.send(
  'bc1p_target_address...',
  { relay: 'wss://snap.onspace.ai' },
  'message/send',
  {
    message: {
      role: 'user',
      parts: [{ text: 'Hello!' }],
    },
  }
);
console.log(response.payload);

// Streaming
for await (const event of agent.sendStream(
  'bc1p_target...',
  { relay: 'wss://snap.onspace.ai' },
  'message/stream',
  { message: { role: 'user', parts: [{ text: 'Tell me a story' }] } }
)) {
  console.log(event.payload);
}
```

### Manual Message Construction

```typescript
const unsigned = new MessageBuilder()
  .from(keyPair.address)
  .to('bc1p_target...')
  .method('message/send')
  .payload({ message: { role: 'user', parts: [{ text: 'Hi' }] } })
  .build();

const signed = MessageSigner.sign(unsigned, keyPair.privateKey);
const isValid = MessageSigner.verify(signed);
```

## Agent Card

```typescript
import { AgentCardBuilder, NostrTransport } from '@snap-protocol/core';

const card = new AgentCardBuilder()
  .name('My Agent')
  .description('An example SNAP agent')
  .identity(keyPair.address)
  .skill('echo', 'Echo', 'Echoes back your message')
  .nostrRelay('wss://snap.onspace.ai')
  .build();

const nostr = new NostrTransport({
  relays: ['wss://snap.onspace.ai'],
  privateKey,
});

// Publish card
await nostr.publishAgentCard(card);

// Discover agents via Nostr
const agents = await nostr.discoverAgents({ skills: ['echo'] });

// Discover an agent via HTTP well-known URL
const card = await HttpTransport.discoverViaHttp('https://agent.example.com');
```

## Testing

```typescript
import { describe, it, expect } from 'vitest';
import { KeyManager, MessageBuilder, MessageSigner } from '@snap-protocol/core';

describe('SNAP message', () => {
  it('should sign and verify', () => {
    const keyPair = KeyManager.deriveKeyPair('aa'.repeat(32));

    const unsigned = new MessageBuilder()
      .from(keyPair.address)
      .to('bc1p' + '0'.repeat(58))
      .method('message/send')
      .payload({ message: { parts: [{ text: 'test' }] } })
      .build();

    const signed = MessageSigner.sign(unsigned, keyPair.privateKey);

    expect(signed.sig).toHaveLength(128);
    expect(MessageSigner.verify(signed)).toBe(true);
  });
});
```

## API Reference

For complete class methods, type definitions, and config interfaces, see [references/api-reference.md](references/api-reference.md).
