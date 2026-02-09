# SNAP: Signed Network Agent Protocol

[![License: CC BY 4.0](https://img.shields.io/badge/License-CC_BY_4.0-lightgrey.svg)](https://creativecommons.org/licenses/by/4.0/)

**An open protocol for secure agent-to-agent communication using self-sovereign identity.**

SNAP lets AI agents identify themselves, find each other, and communicate — without API keys, OAuth, or central registries. Inspired by [A2A](https://github.com/a2aproject/A2A) concepts, built on Bitcoin P2TR identity and Nostr discovery.

> **New to SNAP?** Read [Use Cases & Design Thinking](docs/use-cases.md) to understand why agents need their own identity system.

## Why SNAP?

Today's AI agents live in silos. They can't find each other, can't verify who they're talking to, and depend on centralized platforms for discovery. SNAP changes that.

```
Traditional:  Agent ←→ Central Platform ←→ Agent
SNAP:         Agent ←→ Agent (decentralized discovery)
```

SNAP gives every agent:
- **A self-sovereign identity** — Bitcoin P2TR addresses that agents control
- **Decentralized discovery** — Find agents via Nostr, no central registry
- **Cryptographic authentication** — Schnorr signatures, no OAuth dance
- **Familiar concepts** — Task/Message/Artifact semantics inspired by A2A

## Quick Example

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
  "sig": "schnorr-signature..."
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

| Resource                | Description                                              |
|-------------------------|----------------------------------------------------------|
| [Agent Skills](skills/) | Skills for AI coding agents (Claude Code, Cursor, etc.)  |

## Relationship to A2A

SNAP is **inspired by** [Google's A2A Protocol](https://github.com/a2aproject/A2A) and adopts similar semantic concepts:

- Task, Message, Artifact, Part — similar structures
- AgentCard, Skill — extended with identity fields
- Task lifecycle states — similar state machine

**Note**: SNAP is not wire-compatible with A2A. They use different message formats and authentication mechanisms.

### Key Differences

| Aspect | A2A | SNAP |
|--------|-----|------|
| Wire format | JSON-RPC 2.0 | Custom envelope with signature |
| Identity | URL/Domain | Bitcoin P2TR address |
| Discovery | `/.well-known/agent.json` | Nostr events |
| Authentication | HTTP layer (OAuth/API Key) | Message layer (Schnorr signature) |
| Transport | HTTP | HTTP, WebSocket, Nostr |

If you know A2A concepts, you'll find SNAP familiar — but the protocols do not interoperate directly.

## Project Status

🚧 **v0.1 Draft** — This is an early draft. Expect breaking changes. Feedback welcome!

- [x] Core message format
- [x] Identity layer (P2TR)
- [x] Discovery layer (Nostr)
- [x] Authentication (Schnorr)
- [x] Transport (HTTP/WS/Nostr)
- [x] TypeScript SDK ([`implementations/typescript/`](implementations/typescript/))
- [x] Test suite (217 tests)

## Contributing

We'd love your input. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This specification is released under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

---

*SNAP is not affiliated with Google or the A2A Protocol project. We simply build on their excellent work.*
