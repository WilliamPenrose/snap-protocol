import { describe, it, expect } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { Signer } from '../../src/crypto/Signer.js';
import { Canonicalizer } from '../../src/crypto/Canonicalizer.js';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import { loadSignatureVectors } from '../helpers/loadVectors.js';

const { valid, invalid } = loadSignatureVectors();

describe('Signer — valid signatures', () => {
  describe.each(valid)('$description', (v: Record<string, any>) => {
    it('produces correct canonical payload', () => {
      expect(Canonicalizer.canonicalize(v.message.payload)).toBe(
        v.intermediates.canonicalPayload,
      );
    });

    it('produces correct signature input', () => {
      expect(Signer.buildSignatureInput(v.message)).toBe(v.intermediates.signatureInput);
    });

    it('produces correct SHA-256 hash', () => {
      const hash = Signer.hashSignatureInput(v.intermediates.signatureInput);
      expect(bytesToHex(hash)).toBe(v.intermediates.sha256Hash);
    });

    it('signs to expected signature (with tweaked private key)', () => {
      const tweakedPrivateKey = KeyManager.tweakPrivateKey(v.privateKey);
      const result = Signer.sign(v.message, tweakedPrivateKey);
      expect(result.signature).toBe(v.expectedSignature);
    });

    it('verifies the signature against tweaked public key', () => {
      expect(Signer.verify(v.message, v.expectedSignature, v.tweakedPublicKey)).toBe(true);
    });
  });
});

describe('Signer — invalid signatures', () => {
  describe.each(invalid)('$description', (v: Record<string, any>) => {
    it('verification returns false', () => {
      expect(Signer.verify(v.message, v.signature, v.tweakedPublicKey)).toBe(false);
    });
  });
});
