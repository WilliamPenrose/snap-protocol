# Core Concepts

This page covers the fundamental concepts you need to understand SNAP.

## Terminology

| Term | Definition |
|------|------------|
| **Agent** | A self-sovereign entity with a P2TR identity that can send and receive messages. |
| **Requester** | The agent that initiates a request in a given interaction. |
| **Responder** | The agent that receives a request and returns a response. |

**Requester** and **responder** are _roles_, not identity types. The same agent can be a requester in one interaction and a responder in another. In SNAP, all participants are agents — there is no inherent client/server distinction.

## The Big Picture

SNAP enables agents to communicate directly, without relying on a central platform:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│    ┌─────────┐                              ┌─────────┐          │
│    │ Agent A │                              │ Agent B │          │
│    │         │                              │         │          │
│    │ bc1p... │ ────── SNAP Message ───────→ │ bc1p... │          │
│    │         │                              │         │          │
│    └─────────┘                              └─────────┘          │
│         │                                        ↑               │
│         │                                        │               │
│         │    ┌────────────────────────┐          │               │
│         └───→│     Nostr Relays       │──────────┘               │
│              │  (Discovery & Inbox)   │                          │
│              └────────────────────────┘                          │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Design Principles

SNAP separates **what** is communicated from **how** it is delivered.

**Self-authenticating messages.** Every SNAP message carries its own proof of origin (BIP-340 signature) and freshness (timestamp). The transport layer is just a delivery pipe — it does not need to provide authentication, integrity, or ordering. A valid SNAP message can travel over HTTP, Nostr, email, QR code, or even printed paper. The receiver only needs to verify the signature.

**Transport-independent discovery.** An Agent Card is a signed description of an agent's identity and capabilities. It can be published through any medium — Nostr relays, HTTP well-known endpoints, P2P networks, DNS records, or blockchain. Adding a new discovery channel requires only a new transport plugin, not a protocol change.

## Identity

Every agent has a **Bitcoin P2TR address** as its unique identifier:

```
bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8
```

Why P2TR?

- **Self-sovereign**: Agents generate their own identity, no registration needed
- **Self-proving**: The address encodes the public key, so you can verify signatures
- **Human-readable**: Starts with `bc1p`, easy to recognize
- **Nostr-compatible**: Same key can derive a Nostr npub for discovery

An agent's identity is derived from a private key using [BIP-86](https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki), [BIP-39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki), and [BIP-341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki) taproot tweak:

```
Mnemonic (24 words)
       ↓
Master Key (BIP-39)
       ↓
Derivation Path: m/86'/0'/0'/0/0
       ↓
Private Key → Internal Key (P) → Taproot Tweak → Output Key (Q) → P2TR Address (bc1p...)
```

The **taproot tweak** (BIP-341) computes `Q = P + tagged_hash("TapTweak", P) * G`. The P2TR address encodes the tweaked output key Q, not the internal key P. This is compatible with real Bitcoin P2TR addresses.

For managing multiple agents, increment the last path component:

```
Agent 0: m/86'/0'/0'/0/0  →  bc1p...aaa
Agent 1: m/86'/0'/0'/0/1  →  bc1p...bbb
Agent 2: m/86'/0'/0'/0/2  →  bc1p...ccc
```

## Discovery

Agents publish their capabilities using **Nostr events**. Nostr is a simple protocol where:

1. Agents publish signed events to relays
2. Other agents query relays to find agents by skills, name, etc.
3. No registration, no approval — just publish and query

An agent publishes its **Agent Card** as a Nostr event:

```json
{
  "kind": 31337,
  "pubkey": "a3b9e108d8f7c2b1...",
  "tags": [
    ["d", "bc1p5d7rjq7g6rdk2yhzqnt9..."],
    ["name", "Code Assistant"],
    ["skill", "code-generation", "Code Generation"],
    ["skill", "bug-fix", "Bug Fix"]
  ],
  "content": "{...full AgentCard JSON...}",
  "created_at": 1770163200,
  "sig": "schnorr-signature..."
}
```

To find agents with a specific skill:

```json
{
  "kinds": [31337],
  "#skill": ["code-generation"]
}
```

## Authentication

Every SNAP message is **signed** using Schnorr signatures:

```json
{
  "id": "msg-001",
  "from": "bc1p...sender",
  "to": "bc1p...recipient",
  "type": "request",
  "method": "message/send",
  "payload": {
    "message": {
      "messageId": "inner-001",
      "role": "user",
      "parts": [{ "text": "Hello" }]
    }
  },
  "timestamp": 1770163200,
  "sig": "e5b7a9c3d2f1..."
}
```

The signature covers: `id, from, to, type, method, payload, timestamp` using [canonical serialization](authentication.md#signature-computation).

This provides:

| Benefit | How |
|---------|-----|
| **Identity verification** | Signature proves the sender controls the private key |
| **Message integrity** | Any tampering invalidates the signature |
| **Replay protection** | Timestamp must be within ±60 seconds |

No OAuth tokens. No API keys. No session management. Just signatures.

## Tasks and Messages

SNAP uses **Task** and **Message** concepts similar to [A2A](https://github.com/a2aproject/A2A):

**Message**: A single communication turn

```json
{
  "messageId": "msg-001",
  "role": "user",
  "parts": [
    { "text": "Write a login form in React" }
  ]
}
```

**Task**: A unit of work that may take multiple turns

```json
{
  "id": "task-001",
  "contextId": "ctx-001",
  "status": {
    "state": "working",
    "timestamp": "2026-02-04T10:00:00Z"
  },
  "artifacts": [],
  "history": [...]
}
```

**Task States**:

```
submitted → working → completed
                   ↘ failed
                   ↘ canceled
            ↳ input_required (waiting for user)
```

## Artifacts

When a task produces output, it's delivered as an **Artifact**:

```json
{
  "artifactId": "artifact-001",
  "name": "LoginForm.tsx",
  "parts": [
    {
      "text": "export function LoginForm() { ... }",
      "mediaType": "text/typescript"
    }
  ]
}
```

Artifacts can contain:
- Text (code, markdown, etc.)
- Files (images, PDFs, etc.)
- Structured data (JSON)

## Transport

SNAP supports multiple transport mechanisms:

| Transport | Use Case | Pros | Cons |
|-----------|----------|------|------|
| **HTTP** | Default | Simple, firewall-friendly, SSE streaming | No full-duplex streaming |
| **WebSocket** | Streaming responses | Real-time updates | Requires persistent connection |
| **Nostr** | Fallback, offline messaging | Works without public IP | Higher latency |

The agent's **Agent Card** declares which transports it supports:

```json
{
  "endpoints": [
    { "protocol": "http", "url": "https://agent.example.com/snap" },
    { "protocol": "wss", "url": "wss://agent.example.com/snap" }
  ],
  "capabilities": {
    "streaming": true
  }
}
```

## Putting It Together

Here's a complete flow:

```
1. Agent A wants to find a code generation agent
   → Query Nostr: { "kinds": [31337], "#skill": ["code-generation"] }

2. Agent A receives Agent B's card
   → Extract endpoints: [{ protocol: "http", url: "https://agent-b.com/snap" }]
   → Extract identity: bc1p...bbb

3. Agent A sends a request
   → Sign message with A's private key
   → POST to https://agent-b.com/snap

4. Agent B verifies the request
   → Check signature against "from" address
   → Check timestamp is within ±60s
   → Process the request

5. Agent B returns a Task
   → Task status: "working"
   → Agent A can poll or subscribe for updates

6. Agent B completes the task
   → Artifacts contain the generated code
   → Task status: "completed"
```

## Identity Lifecycle

### Key Management

SNAP identities are cryptographically bound to private keys. There is no protocol-level key rotation mechanism in v0.1.

| Scenario | Impact |
|----------|--------|
| Key lost | Identity permanently inaccessible |
| Key compromised | Identity permanently compromised |

### Recommendations

**For production agents:**
- Store keys in Hardware Security Modules (HSM)
- Maintain encrypted offline backups
- Use BIP-39 mnemonic with secure physical storage

**For high-availability:**
- Treat the key as critical infrastructure
- Implement key ceremony procedures

### Domain-Anchored Recovery

Agents with [domain verification](agent-card.md#domain-verification-optional) have a recovery path:

1. Old identity `bc1p-old` verified via `_snap.example.com`
2. Key is lost or compromised
3. Generate new identity `bc1p-new`
4. Update DNS TXT record to new identity
5. Publish new Agent Card with new identity
6. Clients verifying via domain will discover the new identity

**Limitations:**
- Only works for domain-verified agents
- Clients caching the old identity may not update immediately
- No automatic notification to existing connections

### Future Considerations

Protocol-level key rotation may be added in future versions based on community feedback.

## Next Steps

- [Agent Card](agent-card.md) — How to describe your agent
- [Messages](messages.md) — Request/response format
- [Authentication](authentication.md) — Signature details
