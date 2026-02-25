# Authentication

SNAP uses **Schnorr signatures** for authentication. Every message is signed, and recipients verify signatures before processing.

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Sender                              Recipient             │
│                                                             │
│   1. Build message                                          │
│   2. Create signature payload                               │
│   3. Sign with private key                                  │
│   4. Add sig to message ──────────────→ 5. Extract sig      │
│                                         6. Rebuild payload  │
│                                         7. Verify signature │
│                                         8. Process message  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Signature Computation

### Canonical Signature Input

The signature is computed over a canonical byte string, not raw JSON. This ensures all implementations produce identical signatures.

**Construction:**

```
signature_input = id || '\x00' || from || '\x00' || to || '\x00' || type || '\x00' || method || '\x00' || canonical_payload || '\x00' || timestamp
```

Where:
- `||` denotes byte concatenation
- `'\x00'` is a NULL byte separator (0x00)
- All string fields (`id`, `from`, `to`, `type`, `method`, `timestamp`) are encoded as **UTF-8 bytes**
- If `to` is absent (Agent-to-Service), use an **empty string** in its position. The 7-field format and 6 NULL separators remain constant.
- `canonical_payload` is the payload serialized using [JCS (RFC 8785)](https://www.rfc-editor.org/rfc/rfc8785), then encoded as UTF-8 bytes
- `timestamp` is the decimal string representation (e.g., `"1770163200"`)
- The concatenated byte string is then hashed with **SHA-256** before signing

### Signing a Message

```javascript
import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';

function computeSignatureInput(message) {
  const parts = [
    message.id,
    message.from,
    message.to,
    message.type,
    message.method,
    canonicalize(message.payload),
    message.timestamp.toString()
  ];
  return parts.join('\x00');
}

function signMessage(message, privateKey) {
  // Use the BIP-341 tweaked private key for signing.
  // The tweaked key signs messages that verify against the tweaked output key
  // encoded in the P2TR address.
  const tweakedKey = tweakPrivateKey(privateKey);
  const input = computeSignatureInput(message);
  const hash = sha256(new TextEncoder().encode(input));
  const sig = schnorr.sign(hash, tweakedKey);
  return Buffer.from(sig).toString('hex');
}
```

### Verifying a Message

```javascript
import canonicalize from 'canonicalize';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr } from '@noble/curves/secp256k1';
import { bech32m } from 'bech32';

function verifyMessage(message) {
  const pubkey = extractPubkeyFromP2TR(message.from);
  const input = computeSignatureInput(message);
  const hash = sha256(new TextEncoder().encode(input));
  const sig = Buffer.from(message.sig, 'hex');
  return schnorr.verify(sig, hash, pubkey);
}

// Returns the BIP-341 tweaked output key (Q), not the internal key (P).
// This is the correct key for verifying SNAP message signatures.
function extractPubkeyFromP2TR(address) {
  const { words } = bech32m.decode(address);
  const data = bech32m.fromWords(words.slice(1));
  return new Uint8Array(data);
}
```

### Signature Format

The `sig` field is a **128-character lowercase hex string** encoding the 64-byte Schnorr signature (BIP-340). The signing key is the BIP-341 tweaked private key, and the verification key is the tweaked output key Q decoded from the sender's P2TR address.

## Timestamp Validation

To prevent replay attacks, recipients must verify the timestamp:

```javascript
function validateTimestamp(timestamp) {
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - timestamp);
  
  // Allow ±60 seconds
  if (diff > 60) {
    throw new Error('Timestamp expired');
  }
}
```

**Note**: Timestamp validation alone is insufficient. See [Replay Protection](#replay-protection) for complete requirements.

## Verification Steps

Recipients must perform these checks in order:

1. **Parse message** — Valid JSON with required fields
2. **Check timestamp** — Within ±60 seconds of current time
3. **Check duplicate** — Message ID not seen before (within 120s window)
4. **Extract public key** — From the `from` P2TR address
5. **Verify signature** — Against the reconstructed payload
6. **Check recipient** — If `to` is present, it MUST match the recipient's own identity. If `to` is absent, skip this check.

If any check fails, reject the message with the appropriate error code.

## Response Authentication

Response signatures are **RECOMMENDED** but not required.

### Signature Levels

| Level | Response `sig` | Security | Use Case |
|-------|----------------|----------|----------|
| **Signed** | Present, verified | Highest | Sensitive operations, untrusted networks |
| **Unsigned** | Absent | TLS only | Trusted networks, performance-critical |

### Requester Behavior

| Scenario | Action |
|----------|--------|
| Response has valid `sig` | Accept |
| Response has invalid `sig` | **Reject** (treat as attack) |
| Response has no `sig` | Accept (rely on TLS) |

### When to Require Signatures

Clients SHOULD require signed responses for:

- Financial or high-value operations
- Operations over Nostr transport (no TLS)
- Untrusted network environments

### Risk Acknowledgment

Unsigned responses rely on TLS for security. Potential risks:

- Compromised CDN/proxy could inject responses
- DNS/BGP hijacking with valid TLS cert (rare but possible)

For most use cases, TLS provides sufficient protection.

## Replay Protection

SNAP uses timestamp validation combined with message deduplication to prevent replay attacks.

### Requirements

Recipients MUST implement both checks:

1. **Timestamp validation**: Reject messages with timestamp outside ±60s window
2. **Deduplication**: Reject messages with previously seen `id` within the time window

### Deduplication Rules

| Rule | Requirement |
|------|-------------|
| Tracking duration | At least 120 seconds |
| Uniqueness scope | Per sender (`from` address) |
| ID format | UUID v4 recommended |

### Implementation

```javascript
const recentMessages = new Map(); // from -> Set<id>

function validateReplay(msg) {
  const now = Math.floor(Date.now() / 1000);
  
  // 1. Timestamp check
  if (Math.abs(now - msg.timestamp) > 60) {
    throw { code: 2004, message: 'Timestamp expired' };
  }
  
  // 2. Deduplication check
  const senderIds = recentMessages.get(msg.from) || new Set();
  
  if (senderIds.has(msg.id)) {
    throw { code: 2006, message: 'Duplicate message' };
  }
  
  // 3. Track this message
  senderIds.add(msg.id);
  recentMessages.set(msg.from, senderIds);
  
  // 4. Cleanup old IDs (run periodically)
  // Remove IDs older than 120 seconds
}
```

### Sender Requirements

- Generate unique `id` for each message (UUID v4 recommended)
- Never reuse `id` within 120 seconds
- Use accurate system time (consider NTP sync)

## Security Considerations

**Why Schnorr?**

- Native to Bitcoin ([BIP-340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki))
- Efficient verification
- Compatible with Nostr
- Well-audited implementations available

**Why sign the full payload?**

- Prevents tampering with any field
- `from` and `to` are signed, preventing spoofing
- Timestamp is signed, preventing replay

**Why ±60 seconds?**

The timestamp window balances three constraints:

| Concern | Effect |
| ------- | ------ |
| Clock skew tolerance | Agents without NTP may drift several seconds; 60s accommodates this |
| Replay attack window | Shorter than AWS (5 min) and Stripe (5 min); tighter security |
| Network latency | Allows for high-latency transports like Nostr relay routing |

The ±60s window alone does not prevent replay — an attacker could replay within the window. Agents MUST also maintain a replay store (message ID deduplication) to reject duplicate messages within the 120s tracking period. Together, timestamp + replay store provide complete replay protection.

## Error Codes

| Code | Error | Description |
|------|-------|-------------|
| 2001 | SignatureInvalidError | Signature verification failed |
| 2002 | SignatureMissingError | No signature provided |
| 2003 | IdentityMismatchError | Signer doesn't match `from` field |
| 2004 | TimestampExpiredError | Timestamp outside valid window |

## Threat Model

### In Scope

SNAP authentication defends against:

| Threat | Mitigation |
|--------|------------|
| Message forgery | Schnorr signature verification |
| Identity spoofing | Signature bound to `from` address |
| Replay attacks | Timestamp + message ID deduplication |
| Message tampering | Signature covers all fields |

### Out of Scope

SNAP authentication does **not** defend against:

| Threat | Notes |
|--------|-------|
| DDoS attacks | Rate limiting is implementation-defined |
| Traffic analysis | Message metadata is visible |
| Compromised private keys | No revocation mechanism in v0.1 |
| Compromised endpoints | TLS protects transport, not application |
| Malicious agents | Trust is out of scope (see [Trust Considerations](agent-card.md#trust-considerations)) |
| Nostr relay attacks | Relays can drop, delay, or observe messages |

### Assumptions

SNAP assumes:

- Private keys are securely stored
- System clocks are reasonably synchronized (±60s)
- TLS is used for HTTP/WebSocket transport
- Implementations correctly verify signatures before processing

### Nostr-Specific Risks

When using Nostr transport:

| Risk | Impact |
|------|--------|
| Relay censorship | Messages may not be delivered |
| Relay observation | Message metadata visible to relay operators |
| Fake Agent Cards | Malicious relays could return fake cards |

**Mitigations**:
- Use multiple relays
- Verify Agent Card signatures
- Use domain verification when available

## Libraries

**JavaScript:**

- [@noble/curves](https://github.com/paulmillr/noble-curves) — Schnorr signatures (secp256k1)
- [@noble/hashes](https://github.com/paulmillr/noble-hashes) — SHA-256
- [bech32](https://github.com/bitcoinjs/bech32) — Address encoding
- [canonicalize](https://www.npmjs.com/package/canonicalize) — JCS (RFC 8785)

**Python:**

- [secp256k1](https://github.com/rustyrussell/secp256k1-py) — Schnorr support
- [bech32](https://github.com/sipa/bech32/tree/master/ref/python) — Address encoding
- [canonicaljson](https://pypi.org/project/canonicaljson/) — JCS (RFC 8785)

**Rust:**

- [secp256k1](https://github.com/rust-bitcoin/rust-secp256k1) — Bitcoin's secp256k1 bindings
- [serde_jcs](https://crates.io/crates/serde_jcs) — JCS (RFC 8785)

**Go:**

- [go-jcs](https://github.com/cyberphone/json-canonicalization) — JCS (RFC 8785)

## Next Steps

- [Transport](transport.md) — How to send authenticated messages
- [Errors](errors.md) — Full error reference
