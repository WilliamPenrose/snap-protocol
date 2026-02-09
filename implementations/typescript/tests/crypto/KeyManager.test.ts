import { describe, it, expect } from 'vitest';
import { KeyManager } from '../../src/crypto/KeyManager.js';
import { loadKeyVectors } from '../helpers/loadVectors.js';

const { vectors } = loadKeyVectors();

describe('KeyManager', () => {
  describe.each(vectors)('$description', (v: Record<string, string>) => {
    it('derives correct x-only public key from private key', () => {
      expect(KeyManager.getPublicKey(v.privateKey)).toBe(v.publicKeyXOnly);
    });

    it('encodes public key to correct P2TR address', () => {
      const network = v.network as 'mainnet' | 'testnet';
      expect(KeyManager.publicKeyToP2TR(v.publicKeyXOnly, network)).toBe(v.p2trAddress);
    });

    it('decodes P2TR address back to tweaked public key', () => {
      expect(KeyManager.p2trToPublicKey(v.p2trAddress)).toBe(v.tweakedPublicKey);
    });

    it('nostrPubkeyHex equals publicKeyXOnly (internal key)', () => {
      expect(v.nostrPubkeyHex).toBe(v.publicKeyXOnly);
    });

    it('tweaked key differs from internal key', () => {
      expect(v.tweakedPublicKey).not.toBe(v.publicKeyXOnly);
    });
  });

  // --- Edge cases ---

  describe('p2trToPublicKey edge cases', () => {
    it('throws on invalid prefix', () => {
      expect(() => KeyManager.p2trToPublicKey('ltc1p' + 'a'.repeat(58))).toThrow();
    });

    it('throws on bech32 (not bech32m) encoded address', () => {
      // bc1q addresses are segwit v0, not P2TR
      expect(() => KeyManager.p2trToPublicKey('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toThrow();
    });
  });

  describe('validateP2TR', () => {
    it('returns true for valid mainnet address', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const addr = KeyManager.publicKeyToP2TR(pub, 'mainnet');
      expect(KeyManager.validateP2TR(addr)).toBe(true);
    });

    it('returns true for valid testnet address', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const addr = KeyManager.publicKeyToP2TR(pub, 'testnet');
      expect(KeyManager.validateP2TR(addr)).toBe(true);
    });

    it('returns false for wrong length', () => {
      expect(KeyManager.validateP2TR('bc1p' + 'a'.repeat(57))).toBe(false);
      expect(KeyManager.validateP2TR('bc1p' + 'a'.repeat(59))).toBe(false);
    });

    it('returns false for wrong prefix', () => {
      expect(KeyManager.validateP2TR('bc1q' + 'a'.repeat(58))).toBe(false);
    });

    it('returns false for empty string', () => {
      expect(KeyManager.validateP2TR('')).toBe(false);
    });

    it('returns false for random garbage', () => {
      expect(KeyManager.validateP2TR('not-an-address-at-all')).toBe(false);
    });

    it('returns false for address with invalid bech32m checksum', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const addr = KeyManager.publicKeyToP2TR(pub, 'mainnet');
      const corrupted = addr.slice(0, -1) + (addr.endsWith('q') ? 'p' : 'q');
      expect(KeyManager.validateP2TR(corrupted)).toBe(false);
    });
  });

  describe('detectNetwork', () => {
    it('detects mainnet from bc1p prefix', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const addr = KeyManager.publicKeyToP2TR(pub, 'mainnet');
      expect(KeyManager.detectNetwork(addr)).toBe('mainnet');
    });

    it('detects testnet from tb1p prefix', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const addr = KeyManager.publicKeyToP2TR(pub, 'testnet');
      expect(KeyManager.detectNetwork(addr)).toBe('testnet');
    });

    it('throws for unknown prefix', () => {
      expect(() => KeyManager.detectNetwork('ltc1p' + 'a'.repeat(58))).toThrow('Cannot detect network');
    });

    it('throws for bc1q prefix', () => {
      expect(() => KeyManager.detectNetwork('bc1q' + 'a'.repeat(58))).toThrow('Cannot detect network');
    });
  });

  describe('deriveKeyPair', () => {
    it('returns complete key pair for mainnet', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pair = KeyManager.deriveKeyPair(key);

      expect(pair.privateKey).toBe(key);
      expect(pair.publicKey).toBe(KeyManager.getPublicKey(key));
      expect(pair.address).toBe(KeyManager.publicKeyToP2TR(pair.publicKey, 'mainnet'));
      expect(pair.network).toBe('mainnet');
      expect(pair.address).toMatch(/^bc1p/);
    });

    it('returns complete key pair for testnet', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000002';
      const pair = KeyManager.deriveKeyPair(key, 'testnet');

      expect(pair.privateKey).toBe(key);
      expect(pair.publicKey).toBe(KeyManager.getPublicKey(key));
      expect(pair.address).toMatch(/^tb1p/);
      expect(pair.network).toBe('testnet');
    });

    it('different private keys produce different key pairs', () => {
      const pair1 = KeyManager.deriveKeyPair('0000000000000000000000000000000000000000000000000000000000000001');
      const pair2 = KeyManager.deriveKeyPair('0000000000000000000000000000000000000000000000000000000000000002');

      expect(pair1.publicKey).not.toBe(pair2.publicKey);
      expect(pair1.address).not.toBe(pair2.address);
    });
  });

  describe('taprootTweak', () => {
    it('produces a different key than the input', async () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const { hexToBytes, bytesToHex } = await import('@noble/hashes/utils');
      const pubBytes = hexToBytes(pub);
      const tweaked = KeyManager.taprootTweak(pubBytes);
      expect(bytesToHex(tweaked)).not.toBe(pub);
    });

    it('is deterministic', async () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const { hexToBytes, bytesToHex } = await import('@noble/hashes/utils');
      const pubBytes = hexToBytes(pub);
      const tweaked1 = KeyManager.taprootTweak(pubBytes);
      const tweaked2 = KeyManager.taprootTweak(pubBytes);
      expect(bytesToHex(tweaked1)).toBe(bytesToHex(tweaked2));
    });
  });

  describe('tweakPrivateKey', () => {
    it('produces a different key than the input', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const tweaked = KeyManager.tweakPrivateKey(key);
      expect(tweaked).not.toBe(key);
      expect(tweaked).toHaveLength(64);
      expect(tweaked).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const t1 = KeyManager.tweakPrivateKey(key);
      const t2 = KeyManager.tweakPrivateKey(key);
      expect(t1).toBe(t2);
    });

    it('different keys produce different tweaked keys', () => {
      const t1 = KeyManager.tweakPrivateKey('0000000000000000000000000000000000000000000000000000000000000001');
      const t2 = KeyManager.tweakPrivateKey('0000000000000000000000000000000000000000000000000000000000000002');
      expect(t1).not.toBe(t2);
    });
  });

  describe('publicKeyToP2TR', () => {
    it('defaults to mainnet', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const addr = KeyManager.publicKeyToP2TR(pub);
      expect(addr).toMatch(/^bc1p/);
      expect(addr).toHaveLength(62);
    });

    it('produces valid bech32m for testnet', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const addr = KeyManager.publicKeyToP2TR(pub, 'testnet');
      expect(addr).toMatch(/^tb1p/);
      expect(addr).toHaveLength(62);
    });

    it('same key produces different addresses for mainnet vs testnet', () => {
      const key = '0000000000000000000000000000000000000000000000000000000000000001';
      const pub = KeyManager.getPublicKey(key);
      const mainAddr = KeyManager.publicKeyToP2TR(pub, 'mainnet');
      const testAddr = KeyManager.publicKeyToP2TR(pub, 'testnet');
      expect(mainAddr).not.toBe(testAddr);
    });
  });
});
