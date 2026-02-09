import { describe, it, expect } from 'vitest';
import { MessageValidator } from '../../src/messaging/MessageValidator.js';
import { MessageSigner } from '../../src/messaging/MessageSigner.js';
import { MessageBuilder } from '../../src/messaging/MessageBuilder.js';
import { SnapError } from '../../src/errors/SnapError.js';
import { ErrorCodes } from '../../src/types/errors.js';
import { loadSignatureVectors } from '../helpers/loadVectors.js';

const { valid, invalid } = loadSignatureVectors();

// Deterministic key for building test messages
const TEST_PRIVATE_KEY = '0000000000000000000000000000000000000000000000000000000000000001';
const TEST_SIGNER = new MessageSigner(TEST_PRIVATE_KEY);
const TEST_ADDRESS = TEST_SIGNER.getAddress();
const TEST_PRIVATE_KEY_B = '0000000000000000000000000000000000000000000000000000000000000002';
const TEST_ADDRESS_B = new MessageSigner(TEST_PRIVATE_KEY_B).getAddress();

function buildSignedMessage(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const msg = new MessageBuilder()
    .id('test-msg-001')
    .from(TEST_ADDRESS)
    .to(TEST_ADDRESS_B)
    .method('message/send')
    .payload({ message: { text: 'hi' } })
    .timestamp(now)
    .build();
  const signed = TEST_SIGNER.sign(msg);
  return { ...signed, ...overrides };
}

/** Build a message signed with a specific timestamp (signature matches the timestamp). */
function buildSignedMessageAt(timestamp: number) {
  const msg = new MessageBuilder()
    .id('test-msg-ts')
    .from(TEST_ADDRESS)
    .to(TEST_ADDRESS_B)
    .method('message/send')
    .payload({ message: { text: 'hi' } })
    .timestamp(timestamp)
    .build();
  return TEST_SIGNER.sign(msg);
}

describe('MessageValidator', () => {
  describe('validateStructure', () => {
    it('accepts a valid signed message', () => {
      const v = valid[0];
      const signer = new MessageSigner(v.privateKey);
      const signed = signer.sign(v.message);
      expect(MessageValidator.validateStructure(signed)).toBe(true);
    });

    it('rejects null', () => {
      expect(MessageValidator.validateStructure(null)).toBe(false);
    });

    it('rejects undefined', () => {
      expect(MessageValidator.validateStructure(undefined)).toBe(false);
    });

    it('rejects non-object (string)', () => {
      expect(MessageValidator.validateStructure('hello')).toBe(false);
    });

    it('rejects non-object (number)', () => {
      expect(MessageValidator.validateStructure(42)).toBe(false);
    });

    it('rejects message missing required fields', () => {
      expect(MessageValidator.validateStructure({ id: 'x' })).toBe(false);
    });

    // --- P2TR address pattern ---

    it('rejects invalid from address (wrong prefix)', () => {
      const msg = buildSignedMessage({ from: 'bc1q' + 'a'.repeat(58) });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects from address with wrong length', () => {
      const msg = buildSignedMessage({ from: 'bc1p' + 'a'.repeat(57) });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects from address with uppercase chars', () => {
      const msg = buildSignedMessage({ from: 'bc1p' + 'A'.repeat(58) });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('accepts testnet address (tb1p prefix)', () => {
      const tbAddr = 'tb1p' + 'a'.repeat(58);
      const msg = buildSignedMessage({ from: tbAddr, to: tbAddr });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    it('rejects invalid to address', () => {
      const msg = buildSignedMessage({ to: 'not-an-address' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    // --- Message ID pattern ---

    it('rejects empty message id', () => {
      const msg = buildSignedMessage({ id: '' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('accepts message id with alphanumeric, underscore, and hyphen', () => {
      const msg = buildSignedMessage({ id: 'abc-123_XYZ' });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    it('rejects message id with spaces', () => {
      const msg = buildSignedMessage({ id: 'has space' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects message id with special chars', () => {
      const msg = buildSignedMessage({ id: 'msg@#!' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    // --- Method pattern ---

    it('accepts valid method (namespace/action)', () => {
      const msg = buildSignedMessage({ method: 'message/send' });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    it('accepts method with underscores in action', () => {
      const msg = buildSignedMessage({ method: 'tasks/get_status' });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    it('rejects method without slash', () => {
      const msg = buildSignedMessage({ method: 'messagesend' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects method with uppercase', () => {
      const msg = buildSignedMessage({ method: 'Message/Send' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects method with numbers', () => {
      const msg = buildSignedMessage({ method: 'message/send2' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects method with double slash', () => {
      const msg = buildSignedMessage({ method: 'message//send' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects empty method', () => {
      const msg = buildSignedMessage({ method: '' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    // --- Signature pattern ---

    it('rejects request with missing sig', () => {
      const msg = buildSignedMessage();
      delete (msg as any).sig;
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects request with sig of wrong length', () => {
      const msg = buildSignedMessage({ sig: 'ab'.repeat(63) }); // 126 chars
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects request with sig containing uppercase hex', () => {
      const msg = buildSignedMessage({ sig: 'AB'.repeat(64) }); // 128 chars, uppercase
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('accepts response without sig', () => {
      const msg = buildSignedMessage({ type: 'response' });
      delete (msg as any).sig;
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    it('rejects response with invalid sig format', () => {
      const msg = buildSignedMessage({ type: 'response', sig: 'not-hex' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('accepts event type without sig', () => {
      const msg = buildSignedMessage({ type: 'event' });
      delete (msg as any).sig;
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    // --- Type field ---

    it('rejects invalid type', () => {
      const msg = buildSignedMessage({ type: 'notification' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('accepts type: response', () => {
      const msg = buildSignedMessage({ type: 'response' });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    it('accepts type: event', () => {
      const msg = buildSignedMessage({ type: 'event' });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    // --- Payload ---

    it('rejects null payload', () => {
      const msg = buildSignedMessage({ payload: null });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects non-object payload (string)', () => {
      const msg = buildSignedMessage({ payload: 'text' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('accepts empty object payload', () => {
      const msg = buildSignedMessage({ payload: {} });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    // --- Timestamp ---

    it('rejects non-integer timestamp', () => {
      const msg = buildSignedMessage({ timestamp: 1234.5 });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects negative timestamp', () => {
      const msg = buildSignedMessage({ timestamp: -1 });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects string timestamp', () => {
      const msg = buildSignedMessage({ timestamp: '1234' });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('accepts zero timestamp', () => {
      const msg = buildSignedMessage({ timestamp: 0 });
      expect(MessageValidator.validateStructure(msg)).toBe(true);
    });

    // --- Version field ---

    it('rejects missing version', () => {
      const msg = buildSignedMessage();
      delete (msg as any).version;
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });

    it('rejects non-string version', () => {
      const msg = buildSignedMessage({ version: 1 });
      expect(MessageValidator.validateStructure(msg)).toBe(false);
    });
  });

  describe('verifySignature', () => {
    it('verifies valid signatures', () => {
      const v = valid[0];
      const signer = new MessageSigner(v.privateKey);
      const signed = signer.sign(v.message);
      expect(MessageValidator.verifySignature(signed)).toBe(true);
    });

    it('rejects tampered messages', () => {
      const v = valid[0];
      const signer = new MessageSigner(v.privateKey);
      const signed = signer.sign(v.message);
      const tampered = { ...signed, payload: { tampered: true } };
      expect(MessageValidator.verifySignature(tampered)).toBe(false);
    });

    it('rejects message with tampered timestamp', () => {
      const signed = buildSignedMessage();
      const tampered = { ...signed, timestamp: signed.timestamp + 1 };
      expect(MessageValidator.verifySignature(tampered)).toBe(false);
    });

    it('rejects message with tampered from address', () => {
      const signed = buildSignedMessage();
      const tampered = { ...signed, from: TEST_ADDRESS_B };
      expect(MessageValidator.verifySignature(tampered)).toBe(false);
    });

    it('rejects message with all-zero signature', () => {
      const signed = buildSignedMessage({ sig: '0'.repeat(128) });
      expect(MessageValidator.verifySignature(signed)).toBe(false);
    });
  });

  describe('validate (full)', () => {
    it('passes for valid message with skipTimestampCheck', () => {
      const v = valid[0];
      const signer = new MessageSigner(v.privateKey);
      const signed = signer.sign(v.message);
      expect(() =>
        MessageValidator.validate(signed, { skipTimestampCheck: true }),
      ).not.toThrow();
    });

    it('throws SnapError for invalid structure', () => {
      expect(() => MessageValidator.validate({})).toThrow(SnapError);
    });

    it('throws TIMESTAMP_EXPIRED when message is too old', () => {
      const now = Math.floor(Date.now() / 1000);
      const signed = buildSignedMessage({ timestamp: now - 61 });
      try {
        MessageValidator.validate(signed);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SnapError);
        expect((err as SnapError).code).toBe(ErrorCodes.TIMESTAMP_EXPIRED);
      }
    });

    it('throws TIMESTAMP_EXPIRED when message is too far in future', () => {
      const now = Math.floor(Date.now() / 1000);
      // Use large offset (200s) to avoid timing flake where 1s passes between
      // capturing now here and validate() computing its own now
      const signed = buildSignedMessage({ timestamp: now + 200 });
      try {
        MessageValidator.validate(signed);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SnapError);
        expect((err as SnapError).code).toBe(ErrorCodes.TIMESTAMP_EXPIRED);
      }
    });

    it('passes when timestamp is exactly at maxDrift boundary', () => {
      const now = Math.floor(Date.now() / 1000);
      // diff === 60, maxDrift === 60: Math.abs(now - ts) > maxDrift is false
      // Must sign with the correct timestamp so signature is valid
      const signed = buildSignedMessageAt(now - 60);
      expect(() => MessageValidator.validate(signed)).not.toThrow();
    });

    it('respects custom maxClockDrift', () => {
      const now = Math.floor(Date.now() / 1000);
      const signed = buildSignedMessage({ timestamp: now - 120 });

      // Default 60s drift: should fail
      expect(() => MessageValidator.validate(signed)).toThrow(SnapError);

      // Custom 300s drift: should pass (sig may still fail, but not timestamp)
      try {
        MessageValidator.validate(signed, { maxClockDrift: 300 });
      } catch (err) {
        // If it throws, it should be SIGNATURE_INVALID (not TIMESTAMP_EXPIRED)
        expect((err as SnapError).code).not.toBe(ErrorCodes.TIMESTAMP_EXPIRED);
      }
    });

    it('maxClockDrift of 0 rejects any drift', () => {
      const now = Math.floor(Date.now() / 1000);
      const signed = buildSignedMessage({ timestamp: now - 1 });
      try {
        MessageValidator.validate(signed, { maxClockDrift: 0 });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect((err as SnapError).code).toBe(ErrorCodes.TIMESTAMP_EXPIRED);
      }
    });

    it('throws SIGNATURE_INVALID for message with wrong signature', () => {
      const signed = buildSignedMessage({ sig: 'ab'.repeat(64) });
      try {
        MessageValidator.validate(signed);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(SnapError);
        expect((err as SnapError).code).toBe(ErrorCodes.SIGNATURE_INVALID);
      }
    });

    it('passes for response without signature', () => {
      const now = Math.floor(Date.now() / 1000);
      const msg = {
        id: 'test-resp',
        version: '0.1',
        from: TEST_ADDRESS,
        to: TEST_ADDRESS_B,
        type: 'response' as const,
        method: 'message/send',
        payload: {},
        timestamp: now,
      };
      expect(() => MessageValidator.validate(msg)).not.toThrow();
    });

    it('skipTimestampCheck bypasses timestamp validation', () => {
      const signed = buildSignedMessage({ timestamp: 1000000 });
      // Without skip: fails on timestamp
      expect(() => MessageValidator.validate(signed)).toThrow();
      // With skip: fails on signature (timestamp is part of signing input), not timestamp
      try {
        MessageValidator.validate(signed, { skipTimestampCheck: true });
        expect.unreachable('Should throw for bad sig');
      } catch (err) {
        expect((err as SnapError).code).toBe(ErrorCodes.SIGNATURE_INVALID);
      }
    });
  });
});
