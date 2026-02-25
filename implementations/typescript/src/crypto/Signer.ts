import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { Canonicalizer } from './Canonicalizer.js';
import type { UnsignedMessage, SigningIntermediates, SchnorrSignatureHex } from '../types/message.js';
import type { PublicKeyXOnly, PrivateKeyHex } from '../types/keys.js';

export interface SignResult {
  signature: SchnorrSignatureHex;
  intermediates: SigningIntermediates;
}

export interface SignOptions {
  /** Auxiliary randomness for Schnorr signing. Defaults to 32 zero bytes (deterministic). */
  auxRand?: Uint8Array;
}

export class Signer {
  /**
   * Build the canonical signature input string from a message.
   * Concatenates 7 fields with NULL byte (0x00) separators.
   */
  static buildSignatureInput(message: UnsignedMessage): string {
    const parts = [
      message.id,
      message.from,
      message.to ?? '',
      message.type,
      message.method,
      Canonicalizer.canonicalize(message.payload),
      message.timestamp.toString(),
    ];
    return parts.join('\x00');
  }

  /**
   * Hash the UTF-8 encoded signature input with SHA-256.
   */
  static hashSignatureInput(signatureInput: string): Uint8Array {
    const inputBytes = new TextEncoder().encode(signatureInput);
    return sha256(inputBytes);
  }

  /**
   * Sign a message. Returns signature hex and intermediates for debugging.
   * Uses deterministic signing (zero aux randomness) by default.
   */
  static sign(message: UnsignedMessage, privateKey: PrivateKeyHex, options?: SignOptions): SignResult {
    const signatureInput = Signer.buildSignatureInput(message);
    const inputBytes = new TextEncoder().encode(signatureInput);
    const hash = sha256(inputBytes);
    const auxRand = options?.auxRand ?? new Uint8Array(32);
    const sig = schnorr.sign(hash, hexToBytes(privateKey), auxRand);

    return {
      signature: bytesToHex(sig),
      intermediates: {
        canonicalPayload: Canonicalizer.canonicalize(message.payload),
        signatureInput,
        signatureInputHex: bytesToHex(inputBytes),
        sha256Hash: bytesToHex(hash),
      },
    };
  }

  /**
   * Verify a Schnorr signature against a message and public key.
   */
  static verify(
    message: UnsignedMessage,
    signature: SchnorrSignatureHex,
    publicKey: PublicKeyXOnly,
  ): boolean {
    try {
      const signatureInput = Signer.buildSignatureInput(message);
      const inputBytes = new TextEncoder().encode(signatureInput);
      const hash = sha256(inputBytes);
      return schnorr.verify(hexToBytes(signature), hash, hexToBytes(publicKey));
    } catch {
      return false;
    }
  }
}
