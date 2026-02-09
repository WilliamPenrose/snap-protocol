import { Signer, type SignOptions, type SignResult } from '../crypto/Signer.js';
import { KeyManager } from '../crypto/KeyManager.js';
import type { UnsignedMessage, SnapMessage, SigningIntermediates } from '../types/message.js';
import type { PrivateKeyHex, P2TRAddress, Network } from '../types/keys.js';

export class MessageSigner {
  private readonly originalPrivateKey: PrivateKeyHex;
  private readonly tweakedPrivateKey: PrivateKeyHex;
  private readonly signOptions: SignOptions;

  constructor(privateKey: PrivateKeyHex, options?: SignOptions) {
    this.originalPrivateKey = privateKey;
    this.tweakedPrivateKey = KeyManager.tweakPrivateKey(privateKey);
    this.signOptions = options ?? {};
  }

  /**
   * Sign an unsigned message. Returns a full SnapMessage with sig field.
   * Uses the BIP-341 tweaked private key for signing.
   */
  sign(message: UnsignedMessage): SnapMessage {
    const result = Signer.sign(message, this.tweakedPrivateKey, this.signOptions);
    return { ...message, sig: result.signature };
  }

  /**
   * Sign and return intermediates for debugging.
   * Uses the BIP-341 tweaked private key for signing.
   */
  signWithIntermediates(message: UnsignedMessage): {
    message: SnapMessage;
    intermediates: SigningIntermediates;
  } {
    const result = Signer.sign(message, this.tweakedPrivateKey, this.signOptions);
    return {
      message: { ...message, sig: result.signature },
      intermediates: result.intermediates,
    };
  }

  /**
   * Get the P2TR address for this signer's key pair.
   * Uses the original (untweaked) key — publicKeyToP2TR applies the taproot tweak internally.
   */
  getAddress(network: Network = 'mainnet'): P2TRAddress {
    return KeyManager.publicKeyToP2TR(KeyManager.getPublicKey(this.originalPrivateKey), network);
  }
}
