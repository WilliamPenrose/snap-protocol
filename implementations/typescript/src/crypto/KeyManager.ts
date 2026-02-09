import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { bech32m } from 'bech32';
import type { Network, P2TRAddress, PublicKeyXOnly, PrivateKeyHex, KeyPair } from '../types/keys.js';

const PREFIXES: Record<Network, string> = {
  mainnet: 'bc',
  testnet: 'tb',
};

/** Convert a big-endian byte array to a bigint. */
function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

/** Convert a bigint to a big-endian byte array of the given length. */
function bigIntToBytes(num: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let n = num;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

export class KeyManager {
  /**
   * Derive x-only (internal) public key from a private key.
   * This is the untweaked key, suitable for Nostr pubkey usage.
   * @returns 64-char lowercase hex string.
   */
  static getPublicKey(privateKey: PrivateKeyHex): PublicKeyXOnly {
    const pubBytes = schnorr.getPublicKey(hexToBytes(privateKey));
    return bytesToHex(pubBytes);
  }

  /**
   * Apply BIP-341 taproot tweak to an internal public key (key-path only, no script tree).
   * Computes Q = P + tagged_hash("TapTweak", P) * G.
   * @returns 32-byte x-only tweaked output key.
   */
  static taprootTweak(internalPubKey: Uint8Array): Uint8Array {
    const t = schnorr.utils.taggedHash('TapTweak', internalPubKey);
    const tScalar = bytesToBigInt(t);

    const n = schnorr.Point.Fn.ORDER;
    if (tScalar >= n) {
      throw new Error('Taproot tweak exceeds curve order');
    }

    // Lift x-only key to a point with even y
    const P = schnorr.utils.lift_x(bytesToBigInt(internalPubKey));

    // Q = P + t*G
    const tG = schnorr.Point.BASE.multiply(tScalar);
    const Q = P.add(tG);

    // Return x-coordinate of Q as 32 bytes
    const Qaff = Q.toAffine();
    return bigIntToBytes(Qaff.x, 32);
  }

  /**
   * Compute the BIP-341 tweaked private key for key-path signing.
   * The tweaked private key signs messages that verify against the tweaked output key
   * encoded in the P2TR address.
   */
  static tweakPrivateKey(privateKey: PrivateKeyHex): PrivateKeyHex {
    const privBytes = hexToBytes(privateKey);
    let d = bytesToBigInt(privBytes);
    const n = schnorr.Point.Fn.ORDER;

    // Compute the full point P = d*G
    const P = schnorr.Point.BASE.multiply(d);
    const Paff = P.toAffine();

    // If P has odd y, negate d (BIP-341 requires even-y internal key)
    if (Paff.y % 2n !== 0n) {
      d = n - d;
    }

    // Internal public key (x-only, 32 bytes)
    const internalPubKey = bigIntToBytes(Paff.x, 32);

    // Compute tweak: t = tagged_hash("TapTweak", internal_key)
    const t = schnorr.utils.taggedHash('TapTweak', internalPubKey);
    const tScalar = bytesToBigInt(t);

    if (tScalar >= n) {
      throw new Error('Taproot tweak exceeds curve order');
    }

    // Tweaked private key: d' = (d + t) mod n
    const tweakedD = (d + tScalar) % n;

    return bytesToHex(bigIntToBytes(tweakedD, 32));
  }

  /**
   * Encode an internal (untweaked) x-only public key as a P2TR bech32m address.
   * Applies BIP-341 taproot tweak before encoding (key-path only, no script tree).
   * The address encodes the tweaked output key Q, not the internal key P.
   */
  static publicKeyToP2TR(internalPublicKey: PublicKeyXOnly, network: Network = 'mainnet'): P2TRAddress {
    const pubBytes = typeof internalPublicKey === 'string' ? hexToBytes(internalPublicKey) : internalPublicKey;
    const tweakedKey = KeyManager.taprootTweak(pubBytes);
    const words = bech32m.toWords(tweakedKey);
    return bech32m.encode(PREFIXES[network], [1, ...words]);
  }

  /**
   * Decode a P2TR address to its x-only public key hex.
   * Returns the tweaked output key (what is encoded in the address).
   * This is NOT the internal key — use getPublicKey() for that.
   * Validates bech32m checksum and witness version.
   */
  static p2trToPublicKey(address: P2TRAddress): PublicKeyXOnly {
    const { prefix, words } = bech32m.decode(address);
    if (prefix !== 'bc' && prefix !== 'tb') {
      throw new Error(`Invalid P2TR prefix: ${prefix}`);
    }
    const witnessVersion = words[0];
    if (witnessVersion !== 1) {
      throw new Error(`Invalid witness version: ${witnessVersion}, expected 1`);
    }
    const pubBytes = bech32m.fromWords(words.slice(1));
    return bytesToHex(new Uint8Array(pubBytes));
  }

  /**
   * Detect network from a P2TR address prefix.
   */
  static detectNetwork(address: P2TRAddress): Network {
    if (address.startsWith('bc1p')) return 'mainnet';
    if (address.startsWith('tb1p')) return 'testnet';
    throw new Error(`Cannot detect network from address: ${address}`);
  }

  /**
   * Validate that a P2TR address is well-formed.
   */
  static validateP2TR(address: P2TRAddress): boolean {
    try {
      if (address.length !== 62) return false;
      if (!address.startsWith('bc1p') && !address.startsWith('tb1p')) return false;
      const { words } = bech32m.decode(address);
      if (words[0] !== 1) return false;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Derive a full KeyPair from a private key.
   * publicKey is the internal (untweaked) key, suitable for Nostr.
   * address encodes the tweaked output key per BIP-341.
   */
  static deriveKeyPair(privateKey: PrivateKeyHex, network: Network = 'mainnet'): KeyPair {
    const publicKey = KeyManager.getPublicKey(privateKey);
    const address = KeyManager.publicKeyToP2TR(publicKey, network);
    return { privateKey, publicKey, address, network };
  }
}
