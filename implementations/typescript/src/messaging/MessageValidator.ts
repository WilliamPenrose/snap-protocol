import { Signer } from '../crypto/Signer.js';
import { KeyManager } from '../crypto/KeyManager.js';
import { SnapError } from '../errors/SnapError.js';
import type { SnapMessage } from '../types/message.js';

export interface ValidationOptions {
  /** Skip timestamp check (useful for test vectors with fixed timestamps). */
  skipTimestampCheck?: boolean;
  /** Custom max clock drift in seconds. Default: 60. */
  maxClockDrift?: number;
  /** Skip replay check. Default: false. */
  skipReplayCheck?: boolean;
}

export interface ValidationResult {
  valid: boolean;
  error?: SnapError;
}

const P2TR_PATTERN = /^(bc1p|tb1p)[a-z0-9]{58}$/;
const MESSAGE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const METHOD_PATTERN = /^[a-z]+\/[a-z_]+$/;
const SIG_PATTERN = /^[0-9a-f]{128}$/;
const VALID_TYPES = new Set(['request', 'response', 'event']);

export class MessageValidator {
  /**
   * Validate message structure (required fields, types, patterns).
   * Does NOT verify signature.
   */
  static validateStructure(message: unknown): message is SnapMessage {
    if (typeof message !== 'object' || message === null) return false;

    const msg = message as Record<string, unknown>;

    // Required fields
    if (typeof msg.id !== 'string' || !MESSAGE_ID_PATTERN.test(msg.id)) return false;
    if (typeof msg.version !== 'string') return false;
    if (typeof msg.from !== 'string' || !P2TR_PATTERN.test(msg.from)) return false;
    if (msg.to !== undefined && (typeof msg.to !== 'string' || !P2TR_PATTERN.test(msg.to))) return false;
    if (typeof msg.type !== 'string' || !VALID_TYPES.has(msg.type)) return false;
    if (typeof msg.method !== 'string' || !METHOD_PATTERN.test(msg.method)) return false;
    if (typeof msg.payload !== 'object' || msg.payload === null) return false;
    if (typeof msg.timestamp !== 'number' || !Number.isInteger(msg.timestamp) || msg.timestamp < 0)
      return false;

    // sig: required for requests, optional for responses
    if (msg.type === 'request') {
      if (typeof msg.sig !== 'string' || !SIG_PATTERN.test(msg.sig)) return false;
    } else if (msg.sig !== undefined) {
      if (typeof msg.sig !== 'string' || !SIG_PATTERN.test(msg.sig)) return false;
    }

    return true;
  }

  /**
   * Verify the Schnorr signature on a message.
   * Extracts public key from message.from P2TR address.
   */
  static verifySignature(message: SnapMessage): boolean {
    const publicKey = KeyManager.p2trToPublicKey(message.from);
    return Signer.verify(message, message.sig, publicKey);
  }

  /**
   * Full validation: structure + signature + optional timestamp.
   * @throws SnapError on failure.
   */
  static validate(message: unknown, options?: ValidationOptions): void {
    if (!MessageValidator.validateStructure(message)) {
      throw SnapError.invalidMessage('Message structure validation failed');
    }

    const msg = message as SnapMessage;

    // Timestamp check
    if (!options?.skipTimestampCheck) {
      const maxDrift = options?.maxClockDrift ?? 60;
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - msg.timestamp) > maxDrift) {
        throw SnapError.timestampExpired(msg.timestamp, now);
      }
    }

    // Signature verification (only if sig is present)
    if (msg.sig) {
      if (!MessageValidator.verifySignature(msg)) {
        throw SnapError.signatureInvalid();
      }
    } else if (msg.type === 'request') {
      throw SnapError.signatureMissing();
    }
  }
}
