/**
 * Fuzz tests for KeyManager.
 *
 * Feed random inputs to address decoding / validation functions
 * and verify they never crash with uncaught exceptions.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { KeyManager } from '../../src/crypto/KeyManager.js';

describe('KeyManager — Fuzz', () => {
  it('validateP2TR never throws on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (addr) => {
        const result = KeyManager.validateP2TR(addr as any);
        expect(typeof result).toBe('boolean');
      }),
      { numRuns: 500 },
    );
  });

  it('validateP2TR never throws on random byte-like strings', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 100 }).map((bytes) =>
          'bc1p' + Array.from(bytes).map((b) => String.fromCharCode(97 + (b % 26))).join(''),
        ),
        (addr) => {
          const result = KeyManager.validateP2TR(addr as any);
          expect(typeof result).toBe('boolean');
        },
      ),
      { numRuns: 300 },
    );
  });

  it('p2trToPublicKey throws cleanly on invalid addresses', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (addr) => {
        try {
          KeyManager.p2trToPublicKey(addr as any);
        } catch (e) {
          // Should always be a clean Error, never undefined/null
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('detectNetwork throws cleanly on arbitrary strings', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (addr) => {
        try {
          const result = KeyManager.detectNetwork(addr as any);
          expect(['mainnet', 'testnet']).toContain(result);
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('getPublicKey throws cleanly on invalid private key hex', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (key) => {
        try {
          const result = KeyManager.getPublicKey(key as any);
          expect(typeof result).toBe('string');
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('publicKeyToP2TR throws cleanly on invalid public key hex', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (key) => {
        try {
          const result = KeyManager.publicKeyToP2TR(key as any);
          expect(typeof result).toBe('string');
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('deriveKeyPair throws cleanly on invalid private keys', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 100 }), (key) => {
        try {
          const kp = KeyManager.deriveKeyPair(key as any);
          expect(kp.publicKey).toBeDefined();
          expect(kp.address).toBeDefined();
        } catch (e) {
          expect(e).toBeInstanceOf(Error);
        }
      }),
      { numRuns: 200 },
    );
  });
});
