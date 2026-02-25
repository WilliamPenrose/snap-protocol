# Frequently Asked Questions

## General Questions

### What is SNAP?

SNAP (Signed Network Agent Protocol) is an open protocol for decentralized agent-to-agent communication. It enables AI agents to discover each other, verify identities, and communicate securely without relying on centralized platforms.

### How is SNAP different from A2A?

SNAP is inspired by Google's A2A Protocol but uses different infrastructure:

| Aspect | A2A | SNAP |
|--------|-----|------|
| Wire format | JSON-RPC 2.0 | Custom envelope with signature |
| Identity | URL/Domain | Bitcoin P2TR address |
| Discovery | `.well-known/agent.json` | Nostr events |
| Authentication | HTTP layer (OAuth/API Key) | Message layer (Schnorr signature) |
| Transport | HTTP | HTTP, WebSocket, Nostr |

SNAP and A2A are **not wire-compatible**, but they share similar concepts (Task, Message, Artifact).

### How is SNAP different from MCP?

MCP (Model Context Protocol) and SNAP solve different problems:

| Aspect | MCP | SNAP |
|--------|-----|------|
| Scope | Intra-agent (model ↔ tools) | Inter-agent (agent ↔ agent) |
| Purpose | Connect an AI model to local tools and data sources | Enable independent agents to discover and communicate |
| Identity | None (runs inside a single process) | Bitcoin P2TR address per agent |
| Trust model | Implicit (same system) | Cryptographic (Schnorr signatures) |
| Discovery | Local configuration | Nostr relays, HTTP well-known |

They are **complementary**: an agent might use MCP internally to access tools, and use SNAP externally to talk to other agents.

### Can SNAP be used inside an enterprise?

Yes. A typical enterprise setup:

1. Deploy an internal Nostr relay (data stays within the network)
2. Assign each employee a P2TR identity (managed by the company)
3. Tool agents publish Agent Cards to the internal relay
4. Employee agents discover and call tool agents via SNAP
5. Tool agents check the requester's P2TR address against a permission list

This gives you agent discovery, structured communication, and identity-based access control — without distributing API keys or managing OAuth tokens.

**Note:** If you only need authentication (no agent discovery or task management), using Schnorr signatures alone may be simpler than the full SNAP protocol. See the [Design Principles](concepts.md#design-principles) section.

### Is SNAP production-ready?

No. SNAP is currently in **v0.1 draft**. Expect breaking changes. Do not use in production yet.

### When will v1.0 be released?

No fixed timeline. SNAP is evolving based on real-world usage and community feedback. Follow the GitHub repository for updates.

## Identity & Security

### Why Bitcoin P2TR addresses instead of hex public keys?

SNAP could have used raw hex public keys (like Nostr does) or DIDs. P2TR was chosen for these reasons:

1. **Self-sovereign identity** — Generate a private key, derive an address, you have an identity. No registration, no CA, no DNS required.
2. **Nostr-compatible** — The same secp256k1 key pair derives both the P2TR address and the Nostr hex pubkey, bridging both ecosystems with a single key.
3. **Error detection** — Bech32m encoding includes a checksum. Copying a P2TR address with a typo is caught automatically. Hex strings have no such protection.
4. **Network distinction** — `bc1p` (mainnet) vs `tb1p` (testnet) makes the environment immediately visible.
5. **Tapscript extensibility** — P2TR supports BIP-341 script trees. Future versions could enable multi-sig agent governance, time-locked key rotation, or other programmable identity policies via Tapscript.
6. **Optional payment capability** — A P2TR address is a valid Bitcoin address. This opens the *possibility* of agents paying each other directly (e.g., micro-payments for API calls), without introducing an external payment system.

**Important clarifications:**

- SNAP is a **communication protocol**, not a payment network. Payment capability is not part of the v0.1 specification.
- Agents should **not** treat their identity address as a long-term wallet. If payment features are added in the future, they should involve temporary, small-amount, purpose-specific transactions — not persistent asset holding.
- The BIP-341 taproot tweak adds complexity (two related keys: internal key P and tweaked output key Q). This is the cost of P2TR's benefits. See [discovery.md](discovery.md#key-encoding) for details.

### Does publishing the Nostr pubkey weaken P2TR security?

No. The P2TR address already encodes the tweaked output key Q in cleartext (bech32m is an encoding, not a hash). Publishing the internal key P via Nostr does not provide any additional advantage to an attacker — breaking either P or Q requires solving the Elliptic Curve Discrete Logarithm Problem (~2^128 operations), regardless of how many public keys are known. See [authentication.md](authentication.md) for the security model.

### What happens if I lose my private key?

Your identity is **permanently inaccessible**. There is no recovery mechanism in v0.1.

For production agents:
- Store keys in Hardware Security Modules (HSM)
- Maintain encrypted offline backups
- Consider domain-anchored recovery (see [concepts.md](concepts.md#domain-anchored-recovery))

### What happens if my key is compromised?

Your identity is **permanently compromised** in v0.1. You must:
1. Generate a new identity
2. Publish new Agent Card
3. Notify users to stop trusting the old identity

For domain-verified agents, you can update the DNS TXT record to point to the new identity.

### Are response signatures required?

**Recommended but not required.**

- If a response has a `sig` field, it MUST be valid
- If a response lacks a `sig` field, rely on TLS

Require signed responses for:
- Financial operations
- Nostr transport (no TLS)
- Untrusted networks

### How does SNAP prevent replay attacks?

SNAP uses two mechanisms:
1. **Timestamp validation**: Messages must be within ±60 seconds of current time
2. **Message deduplication**: Recipients track message IDs for 120 seconds

See [authentication.md](authentication.md#replay-protection) for details.

## Discovery & Nostr

### What are Nostr event kinds 31337, 21339, and 4339?

- **31337**: Agent Card (addressable replaceable event, range 30000-39999)
- **21339**: Ephemeral encrypted SNAP message (NIP-16 range 20000-29999) — default for real-time messaging, relays forward but do not store
- **4339**: Storable encrypted SNAP message (regular range 1000-9999) — used when `persist: true` is set, enables offline message retrieval

**Note**: These numbers are not yet officially registered with the Nostr community but do not conflict with any known NIP.

### When should I use persist=true?

Use `persist: true` when you need the recipient to receive the message even if they are currently offline. Without it, messages use the ephemeral kind (21339) which relays forward in real-time but do not store. If the recipient is not listening when an ephemeral message is sent, it is lost.

### Will these kind numbers change?

Unlikely. They may be formally registered via a NIP proposal in the future. Monitor the [CHANGELOG.md](../CHANGELOG.md).

### Which Nostr relays should I use?

Recommended relays (as of v0.1):
```
wss://relay.damus.io
wss://relay.nostr.band
wss://nos.lol
wss://relay.primal.net
```

These may change. Check [discovery.md](discovery.md#recommended-relays) for updates.

### Aren't Nostr relays centralized?

No. Relays are **interchangeable infrastructure**, not central authorities:

- Any relay can forward SNAP messages — no relay is special
- Agents can use multiple relays simultaneously for redundancy
- If a relay goes down, switch to another without changing identity or protocol
- No relay controls agent identity, message format, or discovery semantics
- Anyone can run their own relay

A single relay is a centralized service, but the relay *network* is decentralized — the same way no single HTTP server makes the web centralized.

### Can agents work without Nostr?

Yes. Nostr is only used for **discovery**. Direct communication uses:

1. HTTP (default, supports SSE streaming)
2. WebSocket (full-duplex streaming)
3. Nostr (fallback/offline)

If you know an agent's endpoints and identity, you can skip discovery.

### Is Nostr discovery private?

No. Agent Cards published to Nostr are **public**. Anyone can see:
- Agent name and description
- Skills and capabilities
- Transport endpoints

Use NIP-44 encryption for private direct messages.

## Messages & Tasks

### What is the difference between a Message and a Task?

- **Message**: A single communication turn (like a chat message)
- **Task**: A unit of work that may require multiple message turns

A task contains a history of messages and produces artifacts (outputs).

### Are task IDs requester-generated or responder-generated?

In v0.1, task IDs are **responder-generated** (by the responding agent).

For idempotent task creation, requesters can include an `idempotencyKey` in the payload (optional support in v0.1).

### What are the task states?

```
submitted       → Task received, queued
working         → Task in progress
input_required  → Waiting for user input
completed       → Finished successfully
failed          → Failed with error
canceled        → Canceled by user
```

**Note**: State transitions are implementation-defined in v0.1. A formal state machine may be added in v0.2.

### What is the maximum message size?

| Scope | Limit |
|-------|-------|
| Single message (serialized JSON) | 10 MB |
| Message payload | 1 MB |
| Agent Card | 64 KB |
| Single Part content | 10 MB |

See [constraints.md](constraints.md#size-limits) for full details.

## Transport

### Which transport should I use?

- **HTTP**: Default. Simple and firewall-friendly.
- **WebSocket**: Use for streaming responses or real-time updates.
- **Nostr**: Fallback when HTTP endpoint is unreachable, or for offline messaging.

### Can I use SNAP over plain HTTP (not HTTPS)?

**Not recommended.** HTTPS (TLS) is required for production use. Plain HTTP should only be used for:
- Localhost development
- Testing on private networks

### Does SNAP work behind firewalls?

Yes. HTTP and WebSocket are firewall-friendly. Nostr can work even without a public IP address.

## Trust & Reputation

### How do I know if an agent is trustworthy?

SNAP v0.1 does **not** include a trust or reputation system. You are responsible for:
- Maintaining an allowlist of trusted agents
- Verifying domain ownership when available
- Implementing your own reputation tracking

### What does domain verification prove?

Domain verification proves the agent **controls the domain**, not that the agent is trustworthy or safe.

It provides:
- Association with a known organization
- Recovery path if keys are lost (update DNS record)

### Can malicious agents impersonate others?

Not without compromising private keys. Every message is signed, and signatures are verified against the sender's identity.

However, a malicious agent can:
- Create a new identity and claim to be someone else (social engineering)
- Be listed on Nostr with misleading names

Always verify agent identities via trusted channels.

## Implementation

### Which programming languages are supported?

Reference implementations are planned for:
- TypeScript/JavaScript
- Python

Community implementations in other languages are welcome.

### Where can I find code examples?

Code examples will be available in v0.5+. For now, the specification includes pseudocode in the documentation.

### How do I implement signature verification?

See [authentication.md](authentication.md#verifying-a-message) for detailed steps and pseudocode.

Key steps:
1. Extract public key from P2TR address
2. Reconstruct canonical signature input (using JCS for payload)
3. Hash the input with SHA-256
4. Verify Schnorr signature

### Are there test vectors available?

Test vectors are available in `test-vectors/`. See the [implementation guide](implementation-guide.md) for usage.

## Contributing

### How can I contribute to SNAP?

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines. Ways to contribute:
- Provide feedback on the specification
- Report ambiguities or inconsistencies
- Suggest improvements
- Contribute code examples or implementations

### Where do I ask questions?

- **Specification questions**: Open a GitHub issue
- **General discussion**: GitHub Discussions (if enabled)
- **Implementation help**: GitHub Discussions or issues

### Can I propose new features?

Yes! Open a GitHub issue with:
- Clear description of the feature
- Use case and motivation
- Potential trade-offs

For v0.1, we prioritize feedback on existing features over new features.

## Versioning

### What does v0.1 mean?

v0.1 is a **draft specification**. Breaking changes are expected.

### When can I rely on stability?

Starting with v1.0 (estimated Q1 2026), the protocol will be stable. v1.x releases will only include backward-compatible changes.

### How are breaking changes communicated?

- All changes documented in [CHANGELOG.md](../CHANGELOG.md)
- Major changes announced via GitHub releases
- Breaking changes only in major version bumps (v1 → v2)

## Other

### Is SNAP affiliated with Bitcoin or Nostr projects?

No. SNAP uses Bitcoin's cryptography standards and Nostr's relay network, but is an independent project.

### Is SNAP affiliated with Google or the A2A project?

No. SNAP is inspired by A2A's concepts but is an independent project.

### What license is SNAP under?

- **Specification**: CC BY 4.0
- **Reference implementations**: MIT License
- **Test vectors and schemas**: CC0 (Public Domain)

See [LICENSE](../LICENSE) for details.

### How do I stay updated?

- Watch the GitHub repository for releases
- Read [CHANGELOG.md](../CHANGELOG.md) for updates
