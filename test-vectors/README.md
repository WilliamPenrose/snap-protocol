# Test Vectors

This directory contains test vectors for SNAP Protocol compliance testing.

## Purpose

Test vectors are **language-agnostic data** that define correct behavior. They ensure different implementations (TypeScript, Python, Rust, etc.) produce identical results for:

- Key encoding (P2TR address, Nostr hex)
- JCS canonicalization (RFC 8785)
- Signature computation (BIP-340 Schnorr)

Test vectors are NOT unit tests. Unit tests are implementation-specific code that *consumes* these vectors.

## Structure

```text
test-vectors/
├── keys/
│   └── key-encoding.json          # Private key → P2TR + Nostr hex (4 vectors)
├── canonical/
│   └── jcs-payloads.json          # JCS canonicalization of SNAP payloads (7 vectors)
├── signatures/
│   └── schnorr-signatures.json    # Signing and verification (7 valid + 3 invalid)
└── .generator/                    # Generator script (not part of the spec)
    ├── generate.mjs
    └── package.json
```

## Test Vector Formats

### Key Encoding (`keys/key-encoding.json`)

```json
{
  "description": "Agent A - mainnet",
  "privateKey": "0a0a0a0a...",
  "publicKeyXOnly": "f76a39d0...",
  "p2trAddress": "bc1p7a4rn5...",
  "nostrPubkeyHex": "f76a39d0...",
  "network": "mainnet"
}
```

Verify: `privateKey → publicKeyXOnly → p2trAddress` and `publicKeyXOnly == nostrPubkeyHex`.

### JCS Canonicalization (`canonical/jcs-payloads.json`)

```json
{
  "description": "key ordering",
  "input": { "z": "last", "a": "first" },
  "expected": "{\"a\":\"first\",\"z\":\"last\"}"
}
```

Verify: `canonicalize(input) == expected`.

### Signature Vectors (`signatures/schnorr-signatures.json`)

**Valid vectors** include every intermediate step for debugging:

```json
{
  "description": "message/send with text message",
  "privateKey": "0a0a...",
  "publicKey": "f76a...",
  "message": { "id": "msg-002", "from": "bc1p...", ... },
  "intermediates": {
    "canonicalPayload": "{\"message\":{...}}",
    "signatureInput": "msg-002\u0000bc1p...\u0000...",
    "signatureInputHex": "6d73672d...",
    "sha256Hash": "0e4e9506..."
  },
  "expectedSignature": "393dc61b..."
}
```

**Invalid vectors** include reason for failure:

```json
{
  "description": "tampered payload",
  "message": { ... },
  "signature": "710c7a50...",
  "publicKey": "f76a...",
  "reason": "Payload was modified after signing."
}
```

## Using Test Vectors

### TypeScript

```typescript
import { readFileSync } from 'fs';
import { signMessage, verifyMessage } from './snap-protocol';

const data = JSON.parse(readFileSync('test-vectors/signatures/schnorr-signatures.json', 'utf-8'));

// Valid vectors: sign and compare
for (const v of data.valid) {
  const sig = signMessage(v.message, v.privateKey);
  console.assert(sig === v.expectedSignature, `FAILED: ${v.description}`);
}

// Invalid vectors: verify must return false
for (const v of data.invalid) {
  const result = verifyMessage({ ...v.message, sig: v.signature });
  console.assert(!result, `SHOULD FAIL: ${v.description}`);
}
```

### Python

```python
import json

with open('test-vectors/signatures/schnorr-signatures.json') as f:
    data = json.load(f)

for v in data['valid']:
    sig = sign_message(v['message'], v['privateKey'])
    assert sig == v['expectedSignature'], f"FAILED: {v['description']}"

for v in data['invalid']:
    result = verify_message({**v['message'], 'sig': v['signature']})
    assert not result, f"SHOULD FAIL: {v['description']}"
```

### Debugging Failures

If your signature doesn't match, check intermediates in order:

```text
1. canonicalPayload    ← Is your JCS output identical?
2. signatureInput      ← Are NULL byte separators correct?
3. signatureInputHex   ← Is your UTF-8 encoding correct?
4. sha256Hash          ← Is your hash input correct?
5. expectedSignature   ← Is your Schnorr signing correct?
```

The first intermediate that differs reveals where your implementation diverges.

## Compliance Checklist

To claim SNAP Protocol compliance, an implementation MUST:

- [ ] All key encoding vectors: `privateKey → p2trAddress` matches
- [ ] All key encoding vectors: `privateKey → nostrPubkeyHex` matches
- [ ] All JCS vectors: `canonicalize(input) == expected`
- [ ] All valid signature vectors: `sign(message, privateKey) == expectedSignature`
- [ ] All valid signature vectors: `verify(message, expectedSignature) == true`
- [ ] All invalid signature vectors: `verify(message, signature) == false`

## Generation

Test vectors were generated using `@noble/curves/secp256k1` (BIP-340 Schnorr), `@noble/hashes` (SHA-256), and `canonicalize` (JCS RFC 8785).

To regenerate:

```bash
cd test-vectors/.generator
npm install
node generate.mjs
```

**Note**: Regenerating will produce identical output (deterministic keys and signatures with fixed auxiliary randomness from the library).

## Contributing

When adding test vectors:

1. Use the generator script or provide a reproducible generation method
2. Cross-validate with at least one other library
3. Include clear descriptions
4. Add edge cases (unicode, empty payloads, boundary values)
