# SNAP: Signed Network Agent Protocol

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Spec: CC BY 4.0](https://img.shields.io/badge/Spec-CC_BY_4.0-lightgrey.svg)](docs/LICENSE)

**AI agents authenticate themselves with a keypair instead of API keys.**

Agent generates a key. Agent signs its requests. Service verifies the signature. Done. No API keys to provision. No OAuth to configure. No CA to run.

```text
Traditional:  Agent gets credentials from a trusted 3rd party (CA, IdP, admin) → service trusts the 3rd party
SNAP:         Agent generates its own keypair → signs requests → service verifies directly (no 3rd party needed)
```

## How it works

```text
POST /api/tasks
{
  "from": "bc1pabc123...",
  "method": "service/call",
  "payload": { "name": "query_database", "arguments": { "sql": "SELECT 1" } },
  "timestamp": 1770163200,
  "sig": "e5b7a9c3..."
}
```

The service verifies the [Schnorr signature](docs/authentication.md) and checks `from` against an allowlist of public keys. No shared secret ever exists.

> **Why is this better than API keys?** Public keys are not secrets. You can store allowlists in plaintext, commit them to git, even publish them. Leaking an allowlist has no cryptographic impact. Leaking an API key is a security incident. See [Design Decisions](docs/design-decisions.md) for the full trade-off analysis.

> **Does this require Bitcoin?** No. SNAP uses Bitcoin's cryptographic standards (Schnorr signatures, bech32m encoding) but has zero dependency on the Bitcoin network. No blockchain, no transactions. [Details →](docs/design-decisions.md#does-snap-actually-require-bitcoin)

## Quick start

```bash
npm install @snap-protocol/core
```

**Sign a request** (agent side):

```typescript
import { randomBytes, randomUUID } from 'crypto';
import { KeyManager, MessageBuilder, MessageSigner } from '@snap-protocol/core';

const privateKey = randomBytes(32).toString('hex');
const { address } = KeyManager.deriveKeyPair(privateKey);
const signer = new MessageSigner(privateKey);

const signed = signer.sign(
  new MessageBuilder()
    .id(randomUUID())
    .from(address)
    .method('service/call')
    .payload({ name: 'query_database', arguments: { sql: 'SELECT 1' } })
    .timestamp(Math.floor(Date.now() / 1000))
    .build()
);
```

**Verify** (service side):

```typescript
import { MessageValidator } from '@snap-protocol/core';

MessageValidator.validate(signed);   // throws if signature/timestamp invalid

const allowlist = ['bc1p...agent1', 'bc1p...agent2'];
if (!allowlist.includes(signed.from)) throw new Error('Not authorized');
// See security-practices.md for rate limiting and replay protection
```

That's Auth. For the full agent-to-agent experience (discovery, tasks, streaming), see the [Tutorial](docs/tutorial.md).

## Beyond auth: three independent layers

SNAP's core is authentication. Discovery and communication are optional layers you add when you need them:

```text
┌─────────────────────────────────────────────┐
│  Communication (optional)                   │
│  message/send · tasks/* · streaming         │
├─────────────────────────────────────────────┤
│  Discovery (optional)                       │
│  Agent Card · Nostr relays · HTTP well-known│
├─────────────────────────────────────────────┤
│  Auth (core)                                │
│  Keypair identity · Schnorr signatures      │
│  Timestamp freshness · Replay protection    │
└─────────────────────────────────────────────┘
```

**Auth (core)** — Every agent has a cryptographic identity ([P2TR address](docs/concepts.md#identity)). Every message is signed. Services verify the signature and check an allowlist. This layer works standalone via [`service/call`](docs/messages.md#servicecall).

**Discovery (optional)** — Agents publish capability cards to [Nostr relays](docs/discovery.md) or [HTTP well-known](docs/agent-card.md#http-well-known) endpoints. Other agents query by skill, name, or identity.

**Communication (optional)** — Structured methods (`message/send`, `tasks/*`), task lifecycle, and streaming over HTTP, WebSocket, or Nostr. Concepts inspired by [A2A](https://github.com/a2aproject/A2A).

**Use as much as you need.** Auth alone replaces API keys. Add Discovery to find agents. Add Communication for full agent-to-agent collaboration.

## More examples

### Agent-to-agent — discover and collaborate

An agent publishes its card to Nostr:

```json
{
  "kind": 31337,
  "tags": [
    ["d", "bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0z..."],
    ["name", "Code Assistant"],
    ["skill", "code-generation", "Code Generation"],
    ["endpoint", "http", "https://agent.example.com/snap"]
  ],
  "content": "{\"name\":\"Code Assistant\",\"identity\":\"bc1p5d7rjq7g6rdk2...\",\"endpoints\":[...],\"skills\":[...]}"
}
```

Another agent finds it and sends a request:

```json
{
  "id": "msg-001",
  "from": "bc1pabc123...",
  "to": "bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0z...",
  "type": "request",
  "method": "message/send",
  "payload": {
    "message": {
      "messageId": "inner-001",
      "role": "user",
      "parts": [{ "text": "Write a login form in React" }]
    }
  },
  "timestamp": 1770163200,
  "sig": "a1b2c3d4..."
}
```

That's it. No API keys. No OAuth. No central registry.

## Documentation

**Start here:**

| Document | Description |
|----------|-------------|
| [Tutorial](docs/tutorial.md) | Build your first SNAP agent (10 min) |
| [Use Cases](docs/use-cases.md) | Why agents need self-sovereign identity |
| [Core Concepts](docs/concepts.md) | Identity, discovery, and authentication basics |
| [Design Decisions](docs/design-decisions.md) | Why SNAP chose X over Y (mTLS, JWT, DID, etc.) |

**Specification:**

| Document | Description |
|----------|-------------|
| [Agent Card](docs/agent-card.md) | How agents describe themselves |
| [Messages](docs/messages.md) | Request/response format and semantics |
| [Transport](docs/transport.md) | HTTP, WebSocket, and Nostr transport |
| [Authentication](docs/authentication.md) | Schnorr signature authentication |
| [Discovery](docs/discovery.md) | Finding agents on Nostr |
| [Constraints](docs/constraints.md) | Field validation rules and limits |
| [Errors](docs/errors.md) | Error codes and handling |
| [Security Practices](docs/security-practices.md) | Implementation security guidance |

**For AI-assisted development:**

| Resource                                        | Description                                                     |
|-------------------------------------------------|-----------------------------------------------------------------|
| [Agent Skills](.claude/skills/snap-protocol/)   | Skills for AI coding agents (Claude Code, Cursor, Codex, etc.)  |
| [llms.txt](llms.txt)                            | Documentation index for MCP tools (Context7, mcpdoc)            |

Install skills: `npx skills add WilliamPenrose/snap-protocol` — see [skills setup guide](.claude/skills/snap-protocol/) for IDE integration.

## Relationship to other protocols

**MCP** defines how agents discover and call tools. SNAP adds an authentication layer on top — wrap any MCP tool call in a SNAP [`service/call`](docs/messages.md#servicecall) envelope and the service can verify the caller's identity via signature instead of API keys.

**A2A** — SNAP is **inspired by** [Google's A2A Protocol](https://github.com/a2aproject/A2A) and adopts similar semantic concepts (Task, Message, AgentCard) but uses a different wire format with built-in Schnorr authentication. Not wire-compatible. See [Design Decisions](docs/design-decisions.md#relationship-to-a2a) for a detailed comparison.

## Project Status

🚧 **v0.1 Draft** — This is an early draft. Expect breaking changes. Feedback welcome!

- [x] Core message format
- [x] Identity layer (P2TR)
- [x] Discovery layer (Nostr + HTTP Well-Known)
- [x] Authentication (Schnorr)
- [x] Transport (HTTP/WS/Nostr)
- [x] TypeScript SDK ([`implementations/typescript/`](implementations/typescript/))
- [x] Agent-to-Service communication (`service/call`, optional `to`)
- [x] Test suite (510+ unit tests, 31 integration tests)

## Contributing

We'd love your input. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

- Specification documents (`docs/`): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — see [docs/LICENSE](docs/LICENSE)
- Reference implementations (`implementations/`): [MIT](LICENSE)
- Test vectors and schemas: CC0 1.0 (Public Domain)

---

*SNAP is not affiliated with Google or the A2A Protocol project. We simply build on their excellent work.*
