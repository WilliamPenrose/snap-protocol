# SNAP Protocol TypeScript SDK - Architecture

## Overview

`@snap-protocol/core` is the TypeScript reference implementation of the **SNAP (Secure Native Agent Protocol)**. SNAP enables decentralized agent-to-agent communication using **Bitcoin P2TR (Pay-to-Taproot) identities** for authentication and **Schnorr signatures** for message integrity.

**Core principle**: every participant is a `SnapAgent` — a unified peer that can both send and receive messages. There is no client-server split.

```
┌──────────────────────────────────────────────────────────┐
│                       SnapAgent                          │
│                                                          │
│  Identity: bc1p...  (P2TR address derived from privkey)  │
│                                                          │
│  Outbound: send(), sendStream(), sendMessage()           │
│  Inbound:  processMessage(), processStream()             │
│                                                          │
│  ┌─────────┐  ┌─────────┐  ┌──────────────┐             │
│  │  HTTP   │  │   WS    │  │    Nostr     │             │
│  │Transport│  │Transport│  │  Transport   │             │
│  └─────────┘  └─────────┘  └──────────────┘             │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐            │
│  │Middleware│  │ReplayStore│  │ TaskStore   │            │
│  └──────────┘  └───────────┘  └────────────┘            │
└──────────────────────────────────────────────────────────┘
```

## Directory Structure

```
src/
├── agent/                  # High-level agent abstraction
│   ├── SnapAgent.ts        # Unified peer: send + receive + stream
│   └── AgentCardBuilder.ts # Fluent builder for AgentCard metadata
│
├── crypto/                 # Cryptographic primitives
│   ├── KeyManager.ts       # P2TR address ↔ x-only pubkey ↔ private key
│   ├── Signer.ts           # Schnorr sign/verify over secp256k1
│   └── Canonicalizer.ts    # RFC 8785 JSON Canonicalization
│
├── messaging/              # Message lifecycle
│   ├── MessageBuilder.ts   # Fluent builder for UnsignedMessage
│   ├── MessageSigner.ts    # Canonicalize → hash → sign a message
│   └── MessageValidator.ts # Structure + signature verification
│
├── transport/              # Network transports
│   ├── HttpTransport.ts    # HTTP POST + SSE streaming
│   ├── WebSocketTransport.ts # WebSocket full-duplex
│   └── NostrTransport.ts   # Nostr relay: NIP-44 encrypted + discovery
│
├── stores/                 # In-memory storage implementations
│   ├── InMemoryReplayStore.ts # Message deduplication
│   └── InMemoryTaskStore.ts   # Task state management
│
├── plugins/                # Plugin registry (extensibility)
│   └── PluginRegistry.ts
│
├── errors/                 # Protocol error types
│   └── SnapError.ts
│
├── types/                  # TypeScript type definitions
│   ├── keys.ts             # P2TRAddress, PrivateKeyHex, KeyPair
│   ├── message.ts          # SnapMessage, UnsignedMessage, MethodName
│   ├── handler.ts          # MethodPayloadMap, MethodHandler, StreamMethodHandler
│   ├── plugin.ts           # TransportPlugin, Middleware, ReplayStore, TaskStore
│   ├── transport.ts        # StreamTransportPlugin, streaming event types
│   ├── agent-card.ts       # AgentCard, Skill, Capabilities
│   ├── task.ts             # Task, InnerMessage, TaskStatus
│   ├── payloads.ts         # Request/response payload types per method
│   ├── part.ts             # TextPart, RawPart, UrlPart, DataPart
│   ├── artifact.ts         # Artifact (output attachments)
│   └── errors.ts           # ErrorCode, SnapErrorData
│
└── index.ts                # Public API barrel exports
```

## Layer Architecture

The SDK is organized in four layers, with strict dependency direction (upper layers depend on lower layers, never the reverse):

```
┌─────────────────────────────────────────────┐
│  Layer 4: Agent                             │
│  SnapAgent, AgentCardBuilder                │
├─────────────────────────────────────────────┤
│  Layer 3: Transport                         │
│  HttpTransport, WebSocketTransport,         │
│  NostrTransport                             │
├─────────────────────────────────────────────┤
│  Layer 2: Messaging                         │
│  MessageBuilder, MessageSigner,             │
│  MessageValidator                           │
├─────────────────────────────────────────────┤
│  Layer 1: Crypto + Types                    │
│  KeyManager, Signer, Canonicalizer,         │
│  all type definitions                       │
└─────────────────────────────────────────────┘
```

**Layer 1 (Crypto + Types)** — Zero protocol knowledge. Pure cryptographic operations and type definitions. `KeyManager` handles P2TR ↔ hex pubkey conversion, `Signer` wraps Schnorr sign/verify, `Canonicalizer` implements RFC 8785 for deterministic JSON serialization.

**Layer 2 (Messaging)** — Knows message structure but not transports. `MessageBuilder` constructs `UnsignedMessage`, `MessageSigner` canonicalizes + hashes + signs, `MessageValidator` verifies structure and signature.

**Layer 3 (Transport)** — Network I/O. Each transport implements `TransportPlugin` (or `StreamTransportPlugin`) and handles serialization/encryption for its protocol. Transports are stateless with respect to application logic — they just move `SnapMessage` objects.

**Layer 4 (Agent)** — Orchestration. `SnapAgent` wires together transports, middleware, stores, and handlers into a working peer. It owns the inbound/outbound pipelines.

## Identity Model

Every agent's identity is a **Bitcoin P2TR address** derived from a secp256k1 private key:

```
Private Key (32 bytes hex)
    │
    ▼
x-only Public Key (32 bytes hex)    ← schnorr.getPublicKey()
    │
    ▼
P2TR Address (bech32m)              ← bech32m.encode('bc', [1, ...words])
    bc1p5d7rjq7g6rdk2yhzqnt9dp8...
```

The same key pair is used for:
1. **SNAP message signing** — Schnorr signatures over canonicalized message content
2. **Nostr event signing** — Nostr events use the same secp256k1 key (hex pubkey format)
3. **NIP-44 encryption** — Nostr transport encrypts message payloads with the shared secret

`KeyManager` provides bidirectional conversion between P2TR addresses and hex public keys, which bridges the SNAP identity model with the Nostr identity model.

## Message Flow

### SNAP Message Structure

```typescript
interface SnapMessage {
  id: string;              // UUID
  version: string;         // "0.1"
  from: P2TRAddress;       // Sender identity
  to: P2TRAddress;         // Recipient identity
  type: MessageType;       // "request" | "response" | "event"
  method: MethodName;      // "message/send" | "message/stream" | "tasks/get" | ...
  payload: Record<string, unknown>;
  timestamp: number;       // Unix seconds
  sig: string;             // 128 hex chars (64-byte Schnorr signature)
}
```

### Signing Process

```
UnsignedMessage
    │
    ├─ 1. Canonicalize payload (RFC 8785)
    │     → deterministic JSON string
    │
    ├─ 2. Build signature input string
    │     → "id|version|from|to|type|method|canonicalPayload|timestamp"
    │
    ├─ 3. SHA-256 hash
    │     → 32-byte digest
    │
    └─ 4. Schnorr sign (secp256k1)
          → 64-byte signature → 128 hex chars
```

### Inbound Pipeline (processMessage)

When a `SnapAgent` receives a message:

```
Inbound SnapMessage
    │
    ├─ 1. MessageValidator.validate()    ← Structure + signature check
    │
    ├─ 2. Destination check              ← message.to === this.address?
    │
    ├─ 3. ReplayStore check              ← Deduplicate by (from, id)
    │
    ├─ 4. Inbound middleware chain       ← Pre-processing hooks
    │
    ├─ 5. Route to handler               ← handlers.get(message.method)
    │
    ├─ 6. Build + sign response          ← MessageBuilder → MessageSigner
    │
    ├─ 7. Outbound middleware chain      ← Post-processing hooks
    │
    └─ Return signed response
```

### Outbound Pipeline (send)

When a `SnapAgent` sends a message:

```
agent.send(to, endpoint, method, payload)
    │
    ├─ 1. Build UnsignedMessage          ← Auto-generate ID + timestamp
    │
    ├─ 2. Sign                           ← MessageSigner.sign()
    │
    ├─ 3. Outbound middleware chain
    │
    ├─ 4. Try transports in order        ← Fallback on failure
    │     ├─ transport[0].send()
    │     ├─ transport[1].send()         ← If [0] fails
    │     └─ ...
    │
    └─ Return response SnapMessage
```

## Transport Design

All transports implement `TransportPlugin`:

```typescript
interface TransportPlugin {
  readonly name: string;
  send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage>;
  listen?(handler: (message: SnapMessage) => Promise<SnapMessage | void>): Promise<void>;
  close?(): Promise<void>;
}
```

Streaming transports additionally implement `StreamTransportPlugin`:

```typescript
interface StreamTransportPlugin extends TransportPlugin {
  sendStream(message: SnapMessage, options: TransportSendOptions): AsyncIterable<SnapMessage>;
  listenStream?(handler: (message: SnapMessage) => AsyncIterable<SnapMessage>): Promise<void>;
}
```

### Transport Comparison

| Capability | HTTP | WebSocket | Nostr |
|---|---|---|---|
| Request-response | POST → JSON | Message → reply | Encrypted event → event |
| Streaming | POST → SSE | Message → multiple replies | Not supported |
| Server mode | `node:http` server | `ws` WebSocket server | Relay subscription |
| Discovery | — | — | Kind 31337 agent cards |
| Encryption | TLS (external) | TLS (external) | NIP-44 (built-in) |
| Offline delivery | No | No | Yes (relay stores events) |

### HTTP Transport

- **Send**: `POST` with `Content-Type: application/json`, receives JSON response
- **Stream send**: `POST` with `Accept: text/event-stream`, receives SSE events (`data: {json}\n\n`)
- **Listen**: Node.js HTTP server, routes by path and `Accept` header
- **Dependencies**: `node:http`, global `fetch`

### WebSocket Transport

- **Send**: Open connection → send JSON → receive one JSON reply → close
- **Stream send**: Open connection → send JSON → receive multiple replies → close on `type: "response"`
- **Listen**: `ws` WebSocket server with ping/pong heartbeat
- **Stream routing**: Methods `message/stream` and `tasks/resubscribe` go to stream handler; others go to request-response handler
- **Dependencies**: `ws`

### Nostr Transport

- **Send**: Encrypt with NIP-44 → publish event (kind 21339 ephemeral by default, or 4339 storable with `persist: true`) → subscribe for response on both kinds → decrypt response
- **Listen**: Subscribe to both kind 21339 and 4339 events tagged with our pubkey → decrypt → handle → encrypt response → publish (mirroring request kind)
- **Discovery**: Publish agent card as kind 31337 replaceable event; query by skill/identity/name tags
- **Offline**: `fetchOfflineMessages(since)` queries relay for storable kind 4339 events only
- **Dependencies**: `nostr-tools`

## Middleware System

Middleware intercepts messages in both directions:

```typescript
interface Middleware {
  readonly name: string;
  handle(ctx: MiddlewareContext, next: NextFn): Promise<void>;
}

interface MiddlewareContext {
  message: SnapMessage;
  direction: 'inbound' | 'outbound';
}
```

Middleware runs as a chain — each middleware calls `next()` to pass control. This enables logging, rate limiting, access control, metrics, etc.

## Storage Interfaces

### ReplayStore

Prevents message replay attacks. The in-memory implementation uses a `Map<string, Set<string>>` keyed by sender address.

```typescript
interface ReplayStore {
  hasSeen(from: string, id: string): Promise<boolean>;
  markSeen(from: string, id: string, timestamp: number): Promise<void>;
}
```

### TaskStore

Manages task state across multi-turn conversations.

```typescript
interface TaskStore {
  get(taskId: string): Promise<Task | undefined>;
  set(taskId: string, task: Task): Promise<void>;
  delete(taskId: string): Promise<void>;
}
```

Both interfaces are async to support future persistent storage implementations (Redis, SQLite, etc.).

## Handler System

Handlers are typed by method name via `MethodPayloadMap`:

```typescript
// Request-response handler
agent.handle('message/send', async (payload, context) => {
  // payload: MessageSendRequest (typed)
  // return: MessageSendResponse (typed)
});

// Streaming handler
agent.handleStream('message/stream', async function* (payload, context) {
  yield eventMessage;   // type: "event"
  yield eventMessage;   // type: "event"
  yield finalResponse;  // type: "response"
});
```

The `HandlerContext` provides access to the full inbound `SnapMessage` and the optional `TaskStore`.

## Agent Card

An `AgentCard` describes an agent's identity, capabilities, and contact methods:

```typescript
interface AgentCard {
  name: string;
  description: string;
  version: string;
  identity: P2TRAddress;           // The agent's Bitcoin identity
  endpoints?: AgentEndpoint[];      // HTTP/WS endpoints
  nostrRelays?: string[];           // Nostr relay URLs
  skills: Skill[];                  // Capabilities the agent offers
  capabilities?: Capabilities;      // Feature flags (streaming, push)
  defaultInputModes: MediaType[];   // Accepted input types
  defaultOutputModes: MediaType[];  // Produced output types
  // ... optional: trust, provider, iconUrl, documentationUrl
}
```

`AgentCardBuilder` provides a fluent API for construction. On Nostr, agent cards are published as kind 31337 replaceable events with searchable tags (`skill`, `name`, `endpoint`, `relay`).

## Dependencies

| Package | Purpose |
|---|---|
| `@noble/curves` | secp256k1 Schnorr signatures |
| `@noble/hashes` | SHA-256, hex/bytes conversion |
| `bech32` | P2TR address encoding (bech32m) |
| `canonicalize` | RFC 8785 JSON Canonicalization |
| `ws` | WebSocket server (Node.js) |
| `nostr-tools` | Nostr event signing, relay pool, NIP-44 encryption |

All crypto dependencies are audited, pure-JS implementations from the `@noble` family. No native bindings required.

## Test Structure

Tests mirror the source directory structure. The suite runs on **Vitest** with 217 tests across 14 files:

```
tests/
├── crypto/           # KeyManager, Signer, Canonicalizer
├── messaging/        # MessageBuilder, MessageSigner, MessageValidator
├── agent/            # SnapAgent, AgentCardBuilder
├── transport/        # HttpTransport, WebSocketTransport, NostrTransport
├── stores/           # InMemoryReplayStore, InMemoryTaskStore
├── integration/      # Agent-to-agent end-to-end tests
└── helpers/          # Test vector loader utility
```

Transport tests use real TCP servers on ephemeral ports (`port: 0`). Nostr tests mock the `SimplePool` to avoid real relay connections.
