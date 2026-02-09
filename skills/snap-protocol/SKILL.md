---
name: snap-protocol
description: >
  Build SNAP protocol agents, tools, and integrations using the
  @snap-protocol/core TypeScript SDK. Use when building agent-to-agent
  communication with self-sovereign identity (Bitcoin P2TR addresses),
  Schnorr signature authentication, and Nostr-based discovery.
  Covers: creating agents, sending/receiving messages, publishing
  Agent Cards, identity management, and transport configuration
  (HTTP, WebSocket, Nostr). Use when the user mentions SNAP protocol,
  agent identity, P2TR addresses, or agent-to-agent messaging.
---

# SNAP Protocol

Build decentralized agent-to-agent communication with self-sovereign identity.

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

Every agent is identified by a Bitcoin P2TR address derived from a private key using BIP-341 taproot tweak.

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

P2TR address rules:
- Exactly 62 characters
- Prefix: `bc1p` (mainnet) or `tb1p` (testnet)
- Bech32m encoded, witness version 1
- Encodes the BIP-341 tweaked output key (not the internal key)

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

Publish agent capabilities for discovery on Nostr.

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

// Discover agents
const agents = await nostr.discoverAgents({ skills: ['echo'] });
```

## Critical Constraints

| Field | Rule |
|-------|------|
| P2TR address | Exactly 62 chars, prefix `bc1p` or `tb1p` |
| Message ID | 1-128 chars, `[a-zA-Z0-9_-]` only |
| Timestamp | Unix seconds, ±60s from current time |
| Signature | 128 lowercase hex chars (64-byte Schnorr, BIP-340, signs with tweaked key) |
| Version | Must be `"0.1"` |
| Payload | Max 1 MB serialized, max depth 10 |

For complete field constraints, see [references/constraints.md](references/constraints.md).

## Error Handling

| Code | Name | When |
|------|------|------|
| 1003 | InvalidMessageError | Message format invalid |
| 1007 | MethodNotFoundError | Unknown method |
| 2001 | SignatureInvalidError | Schnorr verification failed |
| 2004 | TimestampExpiredError | Outside ±60s window |
| 2006 | DuplicateMessageError | Replay detected |
| 5002 | RateLimitExceededError | Too many requests |

For complete error codes (1xxx-5xxx) and retry logic, see [references/error-codes.md](references/error-codes.md).

## Message & Method Types

```typescript
type MessageType = 'request' | 'response' | 'event';

type MethodName =
  | 'message/send'      // Single message exchange
  | 'message/stream'    // Streaming response
  | 'tasks/send'        // Create task
  | 'tasks/get'         // Get task status
  | 'tasks/cancel'      // Cancel task
  | 'tasks/resubscribe' // Resume task stream
  | 'agent/card'        // Get agent card
  | 'agent/ping';       // Health check

type TaskState =
  | 'submitted'       // Queued
  | 'working'         // Processing
  | 'input_required'  // Needs user input
  | 'completed'       // Done
  | 'failed'          // Error
  | 'canceled';       // User canceled
```

## Nostr Integration

Default relay: `wss://snap.onspace.ai`

| Kind | Purpose |
|------|---------|
| 31337 | Agent Card (replaceable event, NIP-33) |
| 21339 | Ephemeral encrypted SNAP message (NIP-16, default for real-time) |
| 4339 | Storable encrypted SNAP message (NIP-44, for offline/persist) |

Messages are encrypted end-to-end using NIP-44. The relay only sees ciphertext. By default, `send()` uses ephemeral kind 21339 (not stored by relays). Set `persist: true` to use storable kind 4339 for offline retrieval.

For Nostr event structure and offline messaging, see [references/nostr-transport.md](references/nostr-transport.md).

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
