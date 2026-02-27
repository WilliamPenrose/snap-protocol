# Design Decisions

This document explains the key trade-offs behind SNAP's design. If you're asking "why not just use X?", you'll likely find the answer here.

## Why message-layer authentication? (vs mTLS, OAuth, JWT)

SNAP signs every message individually rather than authenticating at the transport layer. This is a deliberate choice, and the most fundamental reason is about **trust model**, not technical features.

### The core difference: direct trust vs. mediated trust

Every authentication system answers the same question: "Why should I trust this caller?" The answer reveals the trust model:

- **mTLS / OAuth / JWT**: "Because a **third party** (CA, identity provider, token issuer) vouches for them."
- **SNAP**: "Because I **directly recognize** their public key."

```
mTLS trust chain:         Server trusts CA → CA trusts Client → Server trusts Client
OAuth trust chain:        Service trusts IdP → IdP trusts User → Service trusts User
SNAP trust model:         Service trusts bc1p7x3f... (direct, no intermediary)
```

Mediated trust works well inside a single organization — the company runs the CA or IdP, and all internal services trust it. But it creates hard problems when agents communicate **across organizations**: who runs the CA that both sides trust? This is why the internet ended up with a small oligopoly of certificate authorities (DigiCert, Let's Encrypt, etc.) — cross-organization trust needs a shared third party.

SNAP sidesteps this entirely. Two agents from different organizations can authenticate to each other by exchanging public keys. No shared CA, no federation agreement, no third-party dependency. The cost is that you manage trust directly (via allowlists), but public keys are not secrets — they can be stored in plaintext, committed to git, or published openly.

### vs mTLS (technical differences)

Beyond the trust model, there are practical differences:

| | mTLS | SNAP |
|---|------|------|
| Auth binds to | TLS connection | Individual message |
| Transport-agnostic | No — requires TLS | Yes — HTTP, WebSocket, Nostr, even QR codes |
| Certificate authority | Required (even self-signed needs a CA workflow) | None — agents generate their own keys |
| Key rotation | Requires certificate reissuance + redistribution | Replace address in allowlist |
| Auditability | Must log at TLS termination point | Every message is independently verifiable |

mTLS works well for fixed infrastructure (microservices behind a load balancer). SNAP targets a different scenario: autonomous agents that spin up dynamically, communicate across organizations, and use multiple transports. Binding authentication to TLS means re-authenticating when switching transports and trusting every TLS termination point.

### vs OAuth 2.0

OAuth assumes a **human** who can click "Authorize" and a **centralized issuer** who mints tokens. For AI agents:

- There is no human to click through a consent screen
- Agents may not belong to any single organization that can issue tokens
- Token refresh adds state management that autonomous agents shouldn't need

SNAP's model: the agent **is** its own identity issuer. No token minting, no refresh, no consent flow.

### vs JWT with asymmetric keys

JWT with RS256/ES256 is the closest existing alternative. The differences are subtle but matter:

| | JWT | SNAP |
|---|-----|------|
| Issuer field | Required (`iss` claim) — implies a trusted issuer | None — the key **is** the identity |
| Audience binding | Optional (`aud` claim) | Built-in (`to` field, included in signature) |
| Payload canonicalization | No standard (JSON serialization is not deterministic) | JCS (RFC 8785) for deterministic signatures |
| Key format | PEM/JWK (multiple encodings) | Single format: 32-byte x-only public key → P2TR address |
| Ecosystem | Mature, wide library support | New, limited library support |

JWT's maturity is a real advantage. If you already have JWT infrastructure and a known set of services, JWT may be simpler. SNAP is designed for the case where there is **no pre-existing infrastructure** — agents that generate their own identity and authenticate to services they've never registered with.

## Why BIP-340 Schnorr? (vs Ed25519, ECDSA)

SNAP uses BIP-340 Schnorr signatures on the secp256k1 curve. This is the same scheme used by Bitcoin (Taproot) and Nostr.

### Why not Ed25519?

Ed25519 is excellent cryptography. SNAP chose BIP-340 for ecosystem reasons, not security reasons:

| | Ed25519 | BIP-340 Schnorr |
|---|---------|------------------|
| Curve | Curve25519 | secp256k1 |
| Security level | ~128-bit | ~128-bit |
| Performance | Slightly faster | Slightly slower |
| Nostr compatibility | No — different curve | Yes — same key pair |
| Bitcoin compatibility | No | Yes — same signature scheme |
| Batch verification | Yes | Yes |
| Library maturity | Excellent | Good (growing with Bitcoin/Nostr adoption) |

The deciding factor is not the curve itself — both are ~128-bit secure. It's the **identity infrastructure built on top of secp256k1**:

1. **P2TR address format** — bech32m encoding gives SNAP identities a checksum (copy errors are caught), network prefix (`bc1p` vs `tb1p`), and human recognizability. Ed25519 address formats exist (Solana's base58, `did:key` with multicodec) but none combine checksum, network prefix, and script extensibility in a single standard.
2. **BIP-341 Tapscript** — P2TR supports programmable identity policies (multi-sig, time-locks, delegation) via script trees. Ed25519 has no equivalent extensibility mechanism.
3. **Nostr compatibility** — SNAP's Discovery layer can publish Agent Cards to Nostr relays using the same key pair. This is a bonus, not the primary reason — SNAP's discovery layer is optional and supports other mechanisms (HTTP well-known).
4. **Ecosystem breadth** — secp256k1 is battle-tested across Bitcoin, Ethereum, and Nostr, with extensive library support.

In short: SNAP chose secp256k1 not because the curve is cryptographically superior, but because the Bitcoin ecosystem has spent over a decade building a mature **identity infrastructure** on top of it — P2TR addresses with checksums, network prefixes, and programmable script trees. Ed25519 is fine cryptography, but it lacks an equivalent identity system with these properties.

### Why not ECDSA?

BIP-340 Schnorr has concrete advantages over ECDSA on the same curve:

- **Simpler signatures**: 64 bytes (no DER encoding, no recovery flag)
- **Provably secure**: Schnorr has a security proof in the random oracle model; ECDSA does not
- **Linearity**: Enables future multi-signature schemes (MuSig2) without protocol changes
- **No malleability**: Schnorr signatures have a unique valid form; ECDSA has (r, s) / (r, n-s) ambiguity

## Why P2TR addresses? (vs raw public keys, DIDs)

### vs raw hex public keys

Nostr uses raw 32-byte hex public keys. SNAP wraps them in P2TR addresses:

| | Raw hex pubkey | P2TR address |
|---|----------------|--------------|
| Format | `a3b9e108d8f7c2b1...` (64 hex chars) | `bc1p5d7rjq7g6rdk2...` (62 bech32m chars) |
| Checksum | None | Built-in (bech32m) |
| Network distinction | None | `bc1p` (mainnet) vs `tb1p` (testnet) |
| Human recognition | Looks like any hex string | Immediately recognizable as an identity |
| Tapscript extensibility | None | Future: multi-sig, time-locks via BIP-341 |

The checksum alone justifies the choice — copying a P2TR address with a typo is caught automatically, while a hex string with a wrong character silently resolves to a different identity.

### vs DIDs (Decentralized Identifiers)

DIDs (W3C) are the established standard for decentralized identity. SNAP chose not to use them:

| | DID | SNAP P2TR |
|---|-----|-----------|
| Infrastructure required | Resolver + Method registry | None |
| Identity creation | Depends on DID method | Generate a private key |
| Resolution | `did:key:z...` → resolve → DID Document → extract key | Decode bech32m → 32-byte public key |
| Specification complexity | DID Core + DID method + DID Resolution + VC Data Model | BIP-340 + BIP-341 + bech32m |
| Interop with DID ecosystem | Native | Possible via `did:snap:bc1p...` (future) |

DID's strength is **interoperability across methods** — a system that supports DIDs can work with `did:key`, `did:web`, `did:ion`, etc. SNAP doesn't need that flexibility. It needs one thing: derive a verifiable identity from a private key, with zero infrastructure. P2TR does exactly that.

If the DID ecosystem becomes dominant for AI agents, SNAP identities can be mapped to DIDs without protocol changes.

## Does SNAP actually require Bitcoin?

**No.** SNAP has zero dependency on the Bitcoin network. No blockchain, no transactions, no node, no fees.

SNAP uses Bitcoin's **cryptographic standards**:

| What SNAP uses | What it is | Bitcoin dependency? |
|----------------|------------|---------------------|
| secp256k1 curve | An elliptic curve (also used by Ethereum, Nostr) | No — it's a math curve |
| BIP-340 Schnorr | A signature algorithm specification | No — it's a signing scheme |
| BIP-341 Taproot tweak | A key derivation formula: `Q = P + H(P)*G` | No — it's a hash-to-curve operation |
| bech32m encoding | An address encoding with checksum | No — it's a string encoding |

An agent running SNAP never connects to a Bitcoin node and never creates a Bitcoin transaction. The "Bitcoin P2TR address" is used purely as an **identity format** — the same way you might use a UUID without running a UUID registry.

The name "P2TR" comes from Bitcoin ("Pay to Taproot"), but in SNAP it means "this public key, in this encoding, with this tweak." Future versions may introduce an alias (e.g., "SNAP address") if the Bitcoin naming causes confusion.

## Allowlist vs API key management

A common reaction: "You've replaced managing API keys with managing an allowlist of public keys — is that really simpler?"

The security model is fundamentally different:

| | API keys | SNAP allowlist |
|---|----------|----------------|
| Secret type | **Shared secret** — both parties know it | **Public key** — only agent knows the private key |
| If leaked | Attacker can impersonate the agent | No impact — public keys are public |
| Provisioning | Admin generates key, securely transmits to agent | Agent generates own identity, tells admin the address |
| Rotation | Generate new key, securely transmit, update agent config, revoke old key | Agent generates new identity, admin updates allowlist |
| Compromise radius | Every service sharing that key is compromised | Only messages signed by that key are affected |
| Storage requirements | Must be encrypted at rest, never logged | Can be stored in plaintext, logged freely |

The allowlist is simpler because **public keys are not secrets**. You can store them in a config file, commit them to git, print them on a website. Leaking an allowlist has no cryptographic impact. Leaking an API key is a security incident.

### When direct trust doesn't scale

Direct trust works well for small-scale, cross-organization scenarios. But in large enterprise deployments — 500 agents talking to 200 services — maintaining per-service allowlists becomes unwieldy. This is exactly the problem that mediated trust (CAs, identity providers) was invented to solve.

SNAP acknowledges this trade-off. For large-scale deployments, an **identity bridge** can issue short-lived certificates that bind enterprise identities (SSO/LDAP accounts) to P2TR addresses. Services then trust the bridge's signing key instead of maintaining individual allowlists. This reintroduces a trust intermediary, but with a key difference: the bridge verifies SNAP signatures (message-layer auth), not TLS connections (transport-layer auth), so it remains transport-agnostic and the underlying identity model doesn't change.

## Performance cost of per-message signing

Signing every message has a cost. BIP-340 Schnorr on secp256k1 using [`@noble/curves`](https://github.com/paulmillr/noble-curves) (Apple M4, Node.js):

| Operation | Time | Throughput |
|-----------|------|------------|
| Schnorr sign | ~1ms | ~957 ops/sec |
| secp256k1 verify | ~0.84ms | ~1,188 ops/sec |

For comparison, Ed25519 verify is ~0.71ms (~1,400 ops/sec) — in the same ballpark. JWT with HMAC-SHA256 is <0.01ms, but HMAC is a shared secret scheme (both parties know the key). The fairer comparison is JWT with ES256 (secp256r1 ECDSA verify: ~1ms), which is in the same range as Schnorr.

For most agent-to-agent or agent-to-service workloads (tens to hundreds of requests/second), per-message signing is not a bottleneck. For high-throughput services (1,000+ req/sec), consider verifying signatures asynchronously or using batch verification (BIP-340 supports this).

*Benchmark source: [@noble/curves README](https://github.com/paulmillr/noble-curves), measured on Apple M4.*

## Timestamp-based replay protection

SNAP uses a ±60-second timestamp window for freshness, not sequence numbers or nonces.

**Why not sequence numbers?** Sequence numbers require the recipient to track per-sender state (last seen sequence number). This conflicts with SNAP's stateless verification model — any recipient should be able to verify any message independently, without prior interaction history.

**Why not nonces?** Random nonces require the recipient to store all seen nonces within the validity window (equivalent to what SNAP already does with message ID deduplication). Timestamps enable **immediate rejection of expired messages** — if a message is older than the validity window, it can be rejected without consulting any stored state. Within the window, message ID deduplication provides replay protection.

**NTP concerns**: The ±60s window is deliberately generous. Modern cloud environments (AWS, GCP, Azure) maintain NTP accuracy within single-digit milliseconds. The window accommodates:

- Cross-region clock skew (~10-20ms typical)
- Mobile/edge devices with less precise NTP (~1-5s)
- Network transit delays

For constrained environments, the window is configurable in the SDK (`MessageValidator` constructor).

## Key rotation (or lack thereof)

SNAP v0.1 has **no protocol-level key rotation mechanism**. This is a known limitation, not an oversight.

### Why not include it in v0.1?

Key rotation is a complex problem with multiple valid approaches:

1. **Signed rotation statement**: Old key signs a message endorsing new key
2. **Domain anchoring**: DNS record points to current identity (already supported)
3. **Key hierarchy**: Master key delegates to ephemeral signing keys
4. **Social recovery**: M-of-N trusted agents endorse the new key
5. **Tapscript rotation**: Encode rotation policy in BIP-341 script tree

Each approach has different trust assumptions, complexity, and failure modes. Rather than pick one prematurely, v0.1 keeps the identity model simple (one key = one identity) and defers rotation to a future version with community input.

### What to do today

- **Domain-verified agents**: Update DNS TXT record to new identity (see [Agent Card — Domain Verification](agent-card.md#domain-verification-optional))
- **All agents**: Generate new identity, publish new Agent Card, notify counterparties out-of-band
- **Production agents**: Store keys in HSMs, maintain encrypted backups (see [Security Practices](security-practices.md))

## Discovery is optional — SNAP's core is authentication

SNAP's value proposition is **message-layer authentication**, not discovery. The three-layer architecture makes this explicit:

- **Auth layer (core)**: Sign and verify messages with P2TR identity. Works standalone.
- **Discovery layer (optional)**: Find agents by capability. Pluggable — Nostr, HTTP well-known, or any future mechanism.
- **Communication layer (optional)**: Task management, streaming. Built on top of Auth.

An agent that only uses `service/call` with signed messages never touches the Discovery layer at all.

### Why Nostr is the first discovery mechanism

SNAP does not depend on Nostr. Nostr is currently the most convenient discovery option because:

1. **Key compatibility** — SNAP already uses secp256k1, which is the same curve Nostr uses. A single key pair works for both SNAP identity and Nostr event publishing, with zero key translation.
2. **Mutable metadata** — Nostr's replaceable events (kind 31337) naturally handle agent capabilities that change over time.
3. **Zero infrastructure** — Publishing an Agent Card to Nostr requires no domain, no DNS, no server. Any public relay works.
4. **Redundancy** — Publish to multiple relays; no single relay is authoritative.

### Other discovery mechanisms

SNAP already supports **HTTP well-known** (`/.well-known/snap-agent.json`) as an alternative. Future versions may add additional mechanisms (DNS-SD, DHT, registry APIs, etc.). The protocol is designed so that discovery mechanisms can be added without changing the Auth layer.

### Why not DNS-SD, DHT, or IPFS?

Each has trade-offs that make it less suitable as a **default** discovery mechanism:

| Mechanism | Limitation for SNAP |
|-----------|-------------------|
| DNS-SD | Requires DNS infrastructure; works well locally but not for global discovery |
| DHT (Kademlia) | NAT traversal complexity; unpredictable latency; every participant must run a node |
| IPFS / IPNS | Agent discovery is a mutable data problem; IPNS has slow propagation |

None of these are ruled out as future options — they simply weren't the best default choice for v0.1.

## Relationship to A2A

SNAP is **inspired by** [Google's A2A Protocol](https://github.com/a2aproject/A2A) and adopts similar semantic concepts:

- Task, Message, Artifact, Part — similar structures
- AgentCard, Skill — extended with identity fields
- Task lifecycle states — similar state machine

However, the protocols are not wire-compatible:

| Aspect | A2A | SNAP |
|--------|-----|------|
| Wire format | JSON-RPC 2.0 | Custom envelope with signature |
| Identity | URL/Domain | Bitcoin P2TR address |
| Discovery | `/.well-known/agent.json` | Nostr events + `/.well-known/snap-agent.json` |
| Authentication | HTTP layer (OAuth/API Key) | Message layer (Schnorr signature) |
| Transport | HTTP | HTTP, WebSocket, Nostr |

If you know A2A concepts, you'll find SNAP familiar — but the protocols do not interoperate directly.

## Further reading

- [Core Concepts](concepts.md) — Protocol architecture and design principles
- [Authentication](authentication.md) — Signature scheme details
- [FAQ](faq.md) — Quick answers to common questions
