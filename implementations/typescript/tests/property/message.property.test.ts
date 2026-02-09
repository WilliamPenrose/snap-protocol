/**
 * Property-based tests for message construction and validation.
 *
 * Verify invariants for MessageBuilder and MessageValidator:
 *   - Builder always produces valid structure
 *   - Signed messages always pass full validation
 *   - validateStructure is consistent with validate()
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import { MessageValidator } from '../../src/messaging/MessageValidator.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';

/**
 * Arbitrary: valid secp256k1 private key.
 */
const arbPrivateKey = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .filter((bytes) => {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) + BigInt(b);
    return n > 0n && n < schnorr.Point.Fn.ORDER;
  })
  .map((bytes) => bytesToHex(bytes));

/**
 * Arbitrary: valid method name matching /^[a-z]+\/[a-z_]+$/.
 */
const arbMethod = fc
  .tuple(
    fc.stringMatching(/^[a-z]{1,10}$/),
    fc.stringMatching(/^[a-z_]{1,10}$/),
  )
  .map(([a, b]) => `${a}/${b}`);

/**
 * Arbitrary: valid message ID matching /^[a-zA-Z0-9_-]+$/.
 */
const arbMessageId = fc.stringMatching(/^[a-zA-Z0-9_-]{1,30}$/);

/**
 * Arbitrary: JSON-safe payload.
 */
const arbPayload = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 15 }).filter((s) => /^[a-zA-Z_]/.test(s)),
  fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
  { minKeys: 1, maxKeys: 5 },
);

describe('MessageBuilder Properties', () => {
  it('build() always produces structurally valid messages', () => {
    fc.assert(
      fc.property(
        arbPrivateKey,
        arbPrivateKey,
        arbMessageId,
        arbMethod,
        arbPayload,
        (keyFrom, keyTo, id, method, payload) => {
          const addrFrom = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(keyFrom));
          const addrTo = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(keyTo));

          const msg = new MessageBuilder()
            .id(id)
            .from(addrFrom)
            .to(addrTo)
            .method(method)
            .payload(payload)
            .timestamp(Math.floor(Date.now() / 1000))
            .build();

          // Add a dummy sig so validateStructure can pass
          const withSig = { ...msg, sig: '0'.repeat(128) };
          expect(MessageValidator.validateStructure(withSig)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('build() preserves all field values', () => {
    fc.assert(
      fc.property(
        arbPrivateKey,
        arbMessageId,
        arbMethod,
        arbPayload,
        fc.integer({ min: 0, max: 2000000000 }),
        (key, id, method, payload, ts) => {
          const addr = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(key));

          const msg = new MessageBuilder()
            .id(id)
            .from(addr)
            .to(addr)
            .method(method)
            .payload(payload)
            .timestamp(ts)
            .build();

          expect(msg.id).toBe(id);
          expect(msg.from).toBe(addr);
          expect(msg.to).toBe(addr);
          expect(msg.method).toBe(method);
          expect(msg.timestamp).toBe(ts);
          expect(msg.version).toBe('0.1');
          expect(msg.type).toBe('request');
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('MessageValidator Properties', () => {
  it('signed messages always pass full validation', () => {
    fc.assert(
      fc.property(
        arbPrivateKey,
        arbPrivateKey,
        arbMessageId,
        arbMethod,
        arbPayload,
        (keyFrom, keyTo, id, method, payload) => {
          const addrFrom = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(keyFrom));
          const addrTo = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(keyTo));
          const signer = new MessageSigner(keyFrom);

          const msg = new MessageBuilder()
            .id(id)
            .from(addrFrom)
            .to(addrTo)
            .method(method)
            .payload(payload)
            .timestamp(Math.floor(Date.now() / 1000))
            .build();

          const signed = signer.sign(msg);

          // Full validation must pass
          expect(() => MessageValidator.validate(signed)).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('validateStructure(signed) is always true when validate() does not throw', () => {
    fc.assert(
      fc.property(
        arbPrivateKey,
        arbMessageId,
        arbMethod,
        arbPayload,
        (key, id, method, payload) => {
          const addr = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(key));
          const signer = new MessageSigner(key);

          const msg = new MessageBuilder()
            .id(id)
            .from(addr)
            .to(addr)
            .method(method)
            .payload(payload)
            .timestamp(Math.floor(Date.now() / 1000))
            .build();

          const signed = signer.sign(msg);

          // validate() should not throw
          MessageValidator.validate(signed);
          // Therefore validateStructure must be true
          expect(MessageValidator.validateStructure(signed)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('responses without sig pass validateStructure but skip signature verification in validate', () => {
    fc.assert(
      fc.property(
        arbPrivateKey,
        arbPrivateKey,
        arbMessageId,
        arbMethod,
        arbPayload,
        (keyFrom, keyTo, id, method, payload) => {
          const addrFrom = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(keyFrom));
          const addrTo = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(keyTo));

          const msg = new MessageBuilder()
            .id(id)
            .from(addrFrom)
            .to(addrTo)
            .type('response')
            .method(method)
            .payload(payload)
            .timestamp(Math.floor(Date.now() / 1000))
            .build();

          // Response without sig — structure valid, full validate should also pass (no sig check)
          expect(MessageValidator.validateStructure(msg as any)).toBe(true);
          expect(() => MessageValidator.validate(msg as any)).not.toThrow();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('flipping any single byte in the signature always causes verification failure', () => {
    fc.assert(
      fc.property(
        arbPrivateKey,
        arbPayload,
        fc.integer({ min: 0, max: 63 }),
        (key, payload, byteIndex) => {
          const addr = KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(key));
          const signer = new MessageSigner(key);

          const msg = new MessageBuilder()
            .id('flip-test')
            .from(addr)
            .to(addr)
            .method('message/send')
            .payload(payload)
            .timestamp(Math.floor(Date.now() / 1000))
            .build();

          const signed = signer.sign(msg);
          const sigChars = signed.sig.split('');

          // Flip one hex char (0→f, f→0, etc.)
          const hexPos = byteIndex * 2;
          const original = parseInt(sigChars[hexPos], 16);
          sigChars[hexPos] = ((original + 1) % 16).toString(16);
          const tamperedSig = sigChars.join('');

          if (tamperedSig !== signed.sig) {
            const tampered = { ...signed, sig: tamperedSig };
            expect(MessageValidator.verifySignature(tampered)).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
