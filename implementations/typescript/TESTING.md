# SNAP Protocol — Testing Guide

This document describes the testing strategy, categories, and conventions for the TypeScript SDK (`@snap-protocol/core`).

## Quick Reference

```bash
npm run test        # Unit + integration (local) + fuzz + property tests
npm run test:relay  # Nostr relay integration tests (requires SNAP_RELAY_URL)
npm run test:all    # Everything
npm run build       # Build before testing if types changed
```

## Test Categories

### 1. Unit Tests

**Purpose**: Verify individual modules in isolation with deterministic inputs.

| Directory | Module | Tests |
|-----------|--------|-------|
| `tests/crypto/` | Signer, KeyManager, Canonicalizer | 107 |
| `tests/messaging/` | MessageValidator, MessageBuilder, MessageSigner | 83 |
| `tests/agent/` | SnapAgent, AgentCardBuilder | 48 |
| `tests/stores/` | InMemoryReplayStore, InMemoryTaskStore | 30 |
| `tests/plugins/` | PluginRegistry | 18 |
| `tests/errors/` | SnapError, ErrorCodes | 17 |
| `tests/transport/` | HttpTransport, WebSocketTransport, NostrTransport | 96 |

**Run**: `npm run test`

### 2. Integration Tests

**Purpose**: Verify end-to-end behavior across module boundaries with real transport layers.

| File | Scope | Tests | Requires |
|------|-------|-------|----------|
| `agent-to-agent.test.ts` | HTTP/WS agent round-trip, streaming, middleware, replay, concurrency | 14 | Nothing |
| `nostr-relay.integration.test.ts` | NostrTransport send/receive via live relay | 16 | `SNAP_RELAY_URL` |
| `agent-nostr.integration.test.ts` | Agent-to-agent via Nostr relay | 10 | `SNAP_RELAY_URL` |

The HTTP/WS integration tests start local servers on ephemeral ports (`port: 0`) — no external infrastructure needed. Nostr tests require a running relay:

```bash
SNAP_RELAY_URL=wss://snap.onspace.ai npm run test:relay
```

### 3. Fuzz Tests

**Purpose**: Feed random / malformed inputs to parsers and validators. Catch crashes, uncaught exceptions, and security issues that handwritten cases miss.

| File | Target | What It Fuzzes |
|------|--------|---------------|
| `MessageValidator.fuzz.test.ts` | `validateStructure()`, `validate()` | Arbitrary JSON, random strings for addresses/IDs/methods/sigs |
| `Canonicalizer.fuzz.test.ts` | `canonicalize()` | Arbitrary JSON, nested objects, unicode, extreme numbers |
| `KeyManager.fuzz.test.ts` | `validateP2TR()`, `p2trToPublicKey()`, `detectNetwork()`, etc. | Random strings, random byte-like bech32 |
| `TransportParsing.fuzz.test.ts` | HTTP/WS JSON parsing | Random string/JSON bodies sent to live transport servers |

**Invariants verified**:
- `validateStructure()` **never throws**, always returns boolean
- `validate()` only throws `SnapError`, never raw exceptions
- `validateP2TR()` **never throws**, always returns boolean
- Transport servers **never crash** on malformed input

**Run**: Included in `npm run test`. Uses [fast-check](https://github.com/dubzzz/fast-check) with 200–1000 runs per property.

### 4. Property-Based Tests

**Purpose**: Verify algebraic invariants that must hold for ALL valid inputs, not just specific examples.

| File | Properties Verified |
|------|-------------------|
| `crypto.property.test.ts` | sign→verify round-trip, tampered payload fails, wrong key fails, deriveKeyPair determinism, different keys→different addresses, taproot tweak determinism, canonicalize idempotency/determinism/key-order-independence |
| `message.property.test.ts` | Builder always produces valid structure, signed messages always pass full validation, responses without sig are valid, flipping any signature byte causes failure |

**Key arbitraries** (defined in test files):
- `arbPrivateKey` — valid secp256k1 private key (32 bytes, 1 ≤ k < curve order)
- `arbMethod` — method matching `/^[a-z]+\/[a-z_]+$/`
- `arbMessageId` — ID matching `/^[a-zA-Z0-9_-]+$/`
- `arbPayload` — JSON-safe dictionary

**Run**: Included in `npm run test`. 30–500 runs per property.

### 5. Test Vectors

**Purpose**: Cross-implementation conformance. JSON fixtures that any SNAP implementation must pass.

| Vector File | What It Tests |
|-------------|---------------|
| `test-vectors/keys/key-encoding.json` | Private key → public key → P2TR address derivation |
| `test-vectors/canonical/jcs-payloads.json` | JSON Canonicalization Scheme (RFC 8785) output |
| `test-vectors/signatures/schnorr-signatures.json` | Schnorr signature generation and verification |

Loaded via `tests/helpers/loadVectors.ts`. Consumed by unit tests in `tests/crypto/`.

**Generator**: `test-vectors/.generator/generate.mjs` produces the JSON fixtures from known inputs.

## Conventions

### File Naming

```
tests/<module>/            — unit tests
tests/fuzz/                — fuzz tests (*.fuzz.test.ts)
tests/property/            — property-based tests (*.property.test.ts)
tests/integration/         — integration tests
tests/helpers/             — shared test utilities
```

### Test Isolation

- **No shared state** between tests. Each test creates its own agents, transports, and stores.
- **Ephemeral ports**: All transport tests use `port: 0` for automatic port allocation.
- **Fresh keys**: Nostr integration tests use `freshKey()` to generate random keypairs per test.
- **afterEach cleanup**: Every describe block cleans up transports/agents to prevent port leaks.

### Timing-Sensitive Tests

SNAP message timestamps are in **seconds** (`Math.floor(Date.now() / 1000)`), not milliseconds. When testing clock drift:

- Use large offsets (e.g., `now + 200`) instead of boundary values (e.g., `now + 61`) to avoid flakiness from 1-second timing variance between test setup and validation.
- Use `buildSignedMessageAt(timestamp)` to sign with the correct timestamp (sign-then-override breaks the signature).

### Nostr-Specific

- Default send uses ephemeral kind 21339 (NIP-16 range 20000–29999) — relays forward but don't store. Use `persist: true` or kind 4339 (regular storable range 1000–9999) for `fetchOfflineMessages` tests.
- Add `await sleep(500)` after `listen()`/`start()` for subscription setup.
- Add `await sleep(500)` between sequential `send()` calls for relay pool state reset.
- Stagger `start()` calls with `sleep(500)` for bidirectional tests.

## Coverage Map

Which test category covers which concern:

| Concern | Unit | Integration | Fuzz | Property | Vectors |
|---------|:----:|:-----------:|:----:|:--------:|:-------:|
| Message structure validation | x | | x | x | |
| Schnorr signing & verification | x | | | x | x |
| BIP-341 taproot tweak | x | | | x | x |
| P2TR address encoding | x | | x | | x |
| JSON canonicalization (JCS) | x | | x | x | x |
| Replay protection | x | x | | | |
| HTTP transport | x | x | x | | |
| WebSocket transport | x | x | x | | |
| Nostr transport | x | x | | | |
| Middleware chain | x | x | | | |
| Agent method routing | x | x | | | |
| Streaming (SSE / WS) | x | x | | | |
| Error propagation | x | x | | | |
| Concurrent requests | | x | | | |

## Adding New Tests

1. **Bug fix** → Add a regression test in the relevant unit test file.
2. **New module** → Create `tests/<module>/<Module>.test.ts` with unit tests. If the module parses external input, add a fuzz test in `tests/fuzz/`.
3. **New cryptographic operation** → Add property-based tests in `tests/property/` and a test vector in `test-vectors/`.
4. **New transport** → Add unit tests in `tests/transport/` and an integration test in `tests/integration/agent-to-agent.test.ts`.
5. **Protocol change** → Update test vectors first (`test-vectors/.generator/generate.mjs`), then update code to pass.

## Future: Cross-Implementation Conformance

When a second language implementation exists (e.g., Python, Rust), the test vectors in `test-vectors/` become the interoperability contract. The recommended evolution path:

1. **Current** (single implementation) — Test vectors as JSON, consumed by unit tests
2. **Two implementations** — Each implementation runs the same test vector suite. Add a CI matrix.
3. **Mature** — Separate conformance test repository (similar to [libp2p/test-plans](https://github.com/libp2p/test-plans) or [MCP conformance](https://github.com/modelcontextprotocol/conformance)) with expected-failure baselines per implementation.
