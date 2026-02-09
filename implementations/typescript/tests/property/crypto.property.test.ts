/**
 * Property-based tests for cryptographic operations.
 *
 * Verify algebraic invariants that must hold for ALL valid inputs:
 *   - sign → verify round-trip
 *   - key derivation round-trip
 *   - taproot tweak determinism
 *   - canonicalization idempotency
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils';
import { Signer } from '../../src/crypto/Signer.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import { Canonicalizer } from '../../src/crypto/Canonicalizer.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageValidator } from '../../src/messaging/MessageValidator.js';
import type { UnsignedMessage } from '../../src/types/message.js';

/**
 * Arbitrary: valid secp256k1 private key (32 bytes, 1 ≤ key < curve order).
 */
const arbPrivateKey = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .filter((bytes) => {
    // Must be non-zero and less than curve order
    let n = 0n;
    for (const b of bytes) n = (n << 8n) + BigInt(b);
    return n > 0n && n < schnorr.Point.Fn.ORDER;
  })
  .map((bytes) => bytesToHex(bytes));

/**
 * Arbitrary: JSON-safe payload (object with string/number/boolean/null values).
 */
const arbPayload = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-zA-Z_]/.test(s)),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  { minKeys: 1, maxKeys: 5 },
);

/**
 * Build an unsigned message from a key pair and a payload.
 */
function buildMessage(privateKey: string, payload: Record<string, unknown>): { msg: UnsignedMessage; address: string } {
  const publicKey = KeyManager.getPublicKey(privateKey);
  const address = KeyManager.publicKeyToP2TR(publicKey);
  // Use a second deterministic address as 'to'
  const toAddress = address; // self-send for simplicity
  const msg = new MessageBuilder()
    .id('prop-test-id')
    .from(address)
    .to(toAddress)
    .method('message/send')
    .payload(payload)
    .timestamp(Math.floor(Date.now() / 1000))
    .build();
  return { msg, address };
}

describe('Crypto Properties', () => {
  // ── Sign → Verify round-trip ──

  it('sign → verify always succeeds for any valid key and payload', () => {
    fc.assert(
      fc.property(arbPrivateKey, arbPayload, (privateKey, payload) => {
        const signer = new MessageSigner(privateKey);
        const { msg } = buildMessage(privateKey, payload);
        const signed = signer.sign(msg);

        // Signature must be present and 128 hex chars
        expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);

        // Verify must pass
        expect(MessageValidator.verifySignature(signed)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('sign → validate (full) always succeeds for any valid key and payload', () => {
    fc.assert(
      fc.property(arbPrivateKey, arbPayload, (privateKey, payload) => {
        const signer = new MessageSigner(privateKey);
        const { msg } = buildMessage(privateKey, payload);
        const signed = signer.sign(msg);

        // Full validate should pass
        expect(() => MessageValidator.validate(signed)).not.toThrow();
      }),
      { numRuns: 50 },
    );
  });

  it('tampered payload always fails verification', () => {
    fc.assert(
      fc.property(arbPrivateKey, arbPayload, (privateKey, payload) => {
        const signer = new MessageSigner(privateKey);
        const { msg } = buildMessage(privateKey, payload);
        const signed = signer.sign(msg);

        // Tamper with the payload
        const tampered = { ...signed, payload: { ...signed.payload, _tampered: true } };

        expect(MessageValidator.verifySignature(tampered)).toBe(false);
      }),
      { numRuns: 50 },
    );
  });

  it('wrong key always fails verification', () => {
    fc.assert(
      fc.property(arbPrivateKey, arbPrivateKey, arbPayload, (key1, key2, payload) => {
        fc.pre(key1 !== key2);

        const signer1 = new MessageSigner(key1);
        const { msg } = buildMessage(key1, payload);
        const signed = signer1.sign(msg);

        // Change from address to key2's address
        const addr2 = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(key2));
        const wrongSender = { ...signed, from: addr2 };

        expect(MessageValidator.verifySignature(wrongSender)).toBe(false);
      }),
      { numRuns: 30 },
    );
  });

  // ── Key derivation properties ──

  it('deriveKeyPair is deterministic: same key always produces same address', () => {
    fc.assert(
      fc.property(arbPrivateKey, (privateKey) => {
        const kp1 = KeyManager.deriveKeyPair(privateKey);
        const kp2 = KeyManager.deriveKeyPair(privateKey);

        expect(kp1.publicKey).toBe(kp2.publicKey);
        expect(kp1.address).toBe(kp2.address);
      }),
      { numRuns: 50 },
    );
  });

  it('different private keys produce different addresses', () => {
    fc.assert(
      fc.property(arbPrivateKey, arbPrivateKey, (key1, key2) => {
        fc.pre(key1 !== key2);

        const addr1 = KeyManager.deriveKeyPair(key1).address;
        const addr2 = KeyManager.deriveKeyPair(key2).address;

        expect(addr1).not.toBe(addr2);
      }),
      { numRuns: 50 },
    );
  });

  it('all generated P2TR addresses pass validateP2TR', () => {
    fc.assert(
      fc.property(arbPrivateKey, (privateKey) => {
        const address = KeyManager.deriveKeyPair(privateKey).address;
        expect(KeyManager.validateP2TR(address as any)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('p2trToPublicKey → publicKeyToP2TR is NOT an identity (tweak applied twice)', () => {
    fc.assert(
      fc.property(arbPrivateKey, (privateKey) => {
        const kp = KeyManager.deriveKeyPair(privateKey);
        // address encodes tweaked key
        const tweakedPubHex = KeyManager.p2trToPublicKey(kp.address as any);
        // Encoding tweaked key would apply tweak AGAIN → different address
        const doubleAddr = KeyManager.publicKeyToP2TR(tweakedPubHex);
        expect(doubleAddr).not.toBe(kp.address);
      }),
      { numRuns: 30 },
    );
  });

  // ── Taproot tweak properties ──

  it('taprootTweak is deterministic', () => {
    fc.assert(
      fc.property(arbPrivateKey, (privateKey) => {
        const pubKey = KeyManager.getPublicKey(privateKey);
        const { hexToBytes } = require('@noble/hashes/utils');
        const pubBytes = hexToBytes(pubKey);

        const tweak1 = KeyManager.taprootTweak(pubBytes);
        const tweak2 = KeyManager.taprootTweak(pubBytes);

        expect(bytesToHex(tweak1)).toBe(bytesToHex(tweak2));
      }),
      { numRuns: 50 },
    );
  });

  it('tweakPrivateKey is deterministic', () => {
    fc.assert(
      fc.property(arbPrivateKey, (privateKey) => {
        const t1 = KeyManager.tweakPrivateKey(privateKey);
        const t2 = KeyManager.tweakPrivateKey(privateKey);
        expect(t1).toBe(t2);
      }),
      { numRuns: 50 },
    );
  });

  it('tweaked private key signs messages verifiable against tweaked public key in address', () => {
    fc.assert(
      fc.property(arbPrivateKey, (privateKey) => {
        const kp = KeyManager.deriveKeyPair(privateKey);
        const tweakedPriv = KeyManager.tweakPrivateKey(privateKey);
        const tweakedPub = KeyManager.p2trToPublicKey(kp.address as any);

        // Sign with tweaked private key
        const msg: UnsignedMessage = {
          id: 'tweak-test',
          version: '0.1',
          from: kp.address,
          to: kp.address,
          type: 'request',
          method: 'message/send',
          payload: { text: 'hello' },
          timestamp: Math.floor(Date.now() / 1000),
        };

        const { signature } = Signer.sign(msg, tweakedPriv);
        // Verify against the tweaked public key extracted from address
        expect(Signer.verify(msg, signature, tweakedPub)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

describe('Canonicalizer Properties', () => {
  it('canonicalize is idempotent: c(parse(c(x))) === c(x)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        const first = Canonicalizer.canonicalize(input);
        const second = Canonicalizer.canonicalize(JSON.parse(first));
        expect(second).toBe(first);
      }),
      { numRuns: 500 },
    );
  });

  it('canonicalize is deterministic: same input → same output', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (input) => {
        const a = Canonicalizer.canonicalize(input);
        const b = Canonicalizer.canonicalize(input);
        expect(a).toBe(b);
      }),
      { numRuns: 500 },
    );
  });

  it('key order does not affect canonical output', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.oneof(fc.string(), fc.integer(), fc.boolean()),
          { minKeys: 2, maxKeys: 10 },
        ),
        (obj) => {
          // Reverse key order
          const reversed = Object.fromEntries(Object.entries(obj).reverse());
          expect(Canonicalizer.canonicalize(obj)).toBe(Canonicalizer.canonicalize(reversed));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('canonical output key order is consistent regardless of input order', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ minLength: 1, maxLength: 10 }),
          fc.oneof(fc.string(), fc.integer()),
          { minKeys: 2, maxKeys: 10 },
        ),
        (obj) => {
          // Shuffle keys into a different order
          const entries = Object.entries(obj);
          const shuffled = Object.fromEntries([...entries].reverse());
          const canonical1 = Canonicalizer.canonicalize(obj);
          const canonical2 = Canonicalizer.canonicalize(shuffled);
          // Both produce identical output regardless of insertion order
          expect(canonical1).toBe(canonical2);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('Signer Properties', () => {
  it('buildSignatureInput is deterministic', () => {
    fc.assert(
      fc.property(arbPrivateKey, arbPayload, (privateKey, payload) => {
        const { msg } = buildMessage(privateKey, payload);
        const input1 = Signer.buildSignatureInput(msg);
        const input2 = Signer.buildSignatureInput(msg);
        expect(input1).toBe(input2);
      }),
      { numRuns: 100 },
    );
  });

  it('signature input contains all 7 message fields separated by NULL bytes', () => {
    fc.assert(
      fc.property(arbPrivateKey, arbPayload, (privateKey, payload) => {
        const { msg } = buildMessage(privateKey, payload);
        const input = Signer.buildSignatureInput(msg);
        const parts = input.split('\x00');
        expect(parts).toHaveLength(7);
        expect(parts[0]).toBe(msg.id);
        expect(parts[1]).toBe(msg.from);
        expect(parts[2]).toBe(msg.to);
        expect(parts[3]).toBe(msg.type);
        expect(parts[4]).toBe(msg.method);
        // parts[5] = canonical payload
        expect(parts[6]).toBe(msg.timestamp.toString());
      }),
      { numRuns: 100 },
    );
  });

  it('hashSignatureInput produces 32-byte SHA-256 output', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (input) => {
        const hash = Signer.hashSignatureInput(input);
        expect(hash).toBeInstanceOf(Uint8Array);
        expect(hash.length).toBe(32);
      }),
      { numRuns: 200 },
    );
  });

  it('hashSignatureInput is deterministic', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 500 }), (input) => {
        const h1 = Signer.hashSignatureInput(input);
        const h2 = Signer.hashSignatureInput(input);
        expect(bytesToHex(h1)).toBe(bytesToHex(h2));
      }),
      { numRuns: 200 },
    );
  });
});
