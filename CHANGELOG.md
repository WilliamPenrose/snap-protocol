# Changelog

All notable changes to the SNAP Protocol specification will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

> Protocol v0.1 has not been officially released yet. All entries below are pre-release development changes.

### Protocol Specification

- Core message format with Schnorr signatures
- Identity layer using Bitcoin P2TR addresses (BIP-341 taproot tweak)
- Discovery layer via Nostr (kind 31337 agent cards)
- Dual Nostr event kinds: ephemeral kind 21339 (default, real-time) and storable kind 4339 (persist=true, offline)
- Encrypted messaging via Nostr with NIP-44 encryption
- Authentication via message-level signatures
- Transport specs for HTTP, WebSocket, and Nostr
- Agent Card schema with skills and capabilities
- Error codes and constraint validation rules
- Security best practices guide

### TypeScript SDK (`implementations/typescript/`)

- `SnapAgent` unified peer abstraction
- `KeyManager` for P2TR ↔ public key conversion with BIP-341 taproot tweak
- `MessageBuilder`, `MessageSigner`, `MessageValidator`
- HTTP transport with SSE streaming
- WebSocket transport with full-duplex streaming
- Nostr transport with NIP-44 encryption, dual-kind support (ephemeral 21339 + storable 4339), and `persist` send option
- In-memory replay and task stores
- 470 unit tests + 31 integration tests (fuzz, property-based)

### Documentation

- Use cases and design thinking (`docs/use-cases.md`)
- Core concepts guide
- Implementation guide
- Security practices guide
- FAQ with P2TR design rationale
- Testing guide (`TESTING.md`)

### Notes

- This is a draft specification. Breaking changes expected.
- Nostr event kinds (31337, 21339, 4339) are not yet officially registered with the Nostr community.
