import { describe, it, expect } from 'vitest';
import { SnapError } from '../../src/errors/SnapError.js';
import { ErrorCodes } from '../../src/types/errors.js';

describe('SnapError', () => {
  describe('constructor', () => {
    it('creates error with code and message', () => {
      const err = new SnapError(1003, 'Something went wrong');
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(1003);
      expect(err.message).toBe('Something went wrong');
      expect(err.name).toBe('SnapError');
      expect(err.data).toBeUndefined();
    });

    it('creates error with code, message, and data', () => {
      const err = new SnapError(2001, 'Auth failed', { key: 'abc' });
      expect(err.code).toBe(2001);
      expect(err.data).toEqual({ key: 'abc' });
    });

    it('preserves stack trace', () => {
      const err = new SnapError(5001, 'internal');
      expect(err.stack).toBeDefined();
      expect(err.stack).toContain('SnapError');
    });
  });

  describe('toJSON', () => {
    it('serializes without data when data is undefined', () => {
      const err = new SnapError(1003, 'Invalid');
      const json = err.toJSON();
      expect(json).toEqual({ code: 1003, message: 'Invalid' });
      expect('data' in json).toBe(false);
    });

    it('serializes with data when data is present', () => {
      const err = new SnapError(2004, 'Expired', { provided: 100, serverTime: 200 });
      const json = err.toJSON();
      expect(json).toEqual({
        code: 2004,
        message: 'Expired',
        data: { provided: 100, serverTime: 200 },
      });
    });

    it('serializes with empty data object', () => {
      const err = new SnapError(5001, 'Error', {});
      const json = err.toJSON();
      expect(json).toEqual({ code: 5001, message: 'Error', data: {} });
    });
  });

  describe('static factory methods', () => {
    it('signatureInvalid() creates error with code 2001', () => {
      const err = SnapError.signatureInvalid();
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.SIGNATURE_INVALID);
      expect(err.message).toBe('Signature verification failed');
      expect(err.data).toBeUndefined();
    });

    it('signatureInvalid() accepts optional details', () => {
      const err = SnapError.signatureInvalid({ publicKey: 'abc123' });
      expect(err.code).toBe(ErrorCodes.SIGNATURE_INVALID);
      expect(err.data).toEqual({ publicKey: 'abc123' });
    });

    it('signatureMissing() creates error with code 2002', () => {
      const err = SnapError.signatureMissing();
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.SIGNATURE_MISSING);
      expect(err.message).toBe('Signature is required for requests');
    });

    it('timestampExpired() creates error with code 2004 and drift data', () => {
      const err = SnapError.timestampExpired(1000, 2000);
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.TIMESTAMP_EXPIRED);
      expect(err.message).toBe('Timestamp outside acceptable window');
      expect(err.data).toEqual({ provided: 1000, serverTime: 2000, maxDrift: 60 });
    });

    it('invalidMessage() creates error with code 1003 and custom reason', () => {
      const err = SnapError.invalidMessage('bad structure');
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.INVALID_MESSAGE);
      expect(err.message).toBe('bad structure');
    });

    it('invalidPayload() creates error with code 1004 and custom reason', () => {
      const err = SnapError.invalidPayload('missing field');
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.INVALID_PAYLOAD);
      expect(err.message).toBe('missing field');
    });

    it('duplicateMessage() creates error with code 2006 and id/from data', () => {
      const err = SnapError.duplicateMessage('msg-123', 'bc1p...');
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.DUPLICATE_MESSAGE);
      expect(err.message).toBe('Duplicate message ID');
      expect(err.data).toEqual({ id: 'msg-123', from: 'bc1p...' });
    });

    it('identityInvalid() creates error with code 2005 and address data', () => {
      const err = SnapError.identityInvalid('bc1qinvalid');
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.IDENTITY_INVALID);
      expect(err.message).toBe('Invalid P2TR address');
      expect(err.data).toEqual({ address: 'bc1qinvalid' });
    });

    it('methodNotFound() creates error with code 1007 and method data', () => {
      const err = SnapError.methodNotFound('tasks/get');
      expect(err).toBeInstanceOf(SnapError);
      expect(err.code).toBe(ErrorCodes.METHOD_NOT_FOUND);
      expect(err.message).toBe('Method not found: tasks/get');
      expect(err.data).toEqual({ method: 'tasks/get' });
    });
  });

  describe('ErrorCodes values', () => {
    it('has correct task/message codes (1xxx)', () => {
      expect(ErrorCodes.TASK_NOT_FOUND).toBe(1001);
      expect(ErrorCodes.TASK_NOT_CANCELABLE).toBe(1002);
      expect(ErrorCodes.INVALID_MESSAGE).toBe(1003);
      expect(ErrorCodes.INVALID_PAYLOAD).toBe(1004);
      expect(ErrorCodes.CONTENT_TYPE_NOT_SUPPORTED).toBe(1005);
      expect(ErrorCodes.PUSH_NOTIFICATION_ERROR).toBe(1006);
      expect(ErrorCodes.METHOD_NOT_FOUND).toBe(1007);
    });

    it('has correct authentication codes (2xxx)', () => {
      expect(ErrorCodes.SIGNATURE_INVALID).toBe(2001);
      expect(ErrorCodes.SIGNATURE_MISSING).toBe(2002);
      expect(ErrorCodes.IDENTITY_MISMATCH).toBe(2003);
      expect(ErrorCodes.TIMESTAMP_EXPIRED).toBe(2004);
      expect(ErrorCodes.IDENTITY_INVALID).toBe(2005);
      expect(ErrorCodes.DUPLICATE_MESSAGE).toBe(2006);
    });

    it('has correct discovery codes (3xxx)', () => {
      expect(ErrorCodes.AGENT_NOT_FOUND).toBe(3001);
      expect(ErrorCodes.AGENT_CARD_INVALID).toBe(3002);
      expect(ErrorCodes.AGENT_CARD_EXPIRED).toBe(3003);
      expect(ErrorCodes.RELAY_CONNECTION_ERROR).toBe(3004);
      expect(ErrorCodes.SKILL_NOT_FOUND).toBe(3005);
    });

    it('has correct transport codes (4xxx)', () => {
      expect(ErrorCodes.TRANSPORT_UNAVAILABLE).toBe(4001);
      expect(ErrorCodes.CONNECTION_TIMEOUT).toBe(4002);
      expect(ErrorCodes.CONNECTION_REFUSED).toBe(4003);
      expect(ErrorCodes.TLS_ERROR).toBe(4004);
      expect(ErrorCodes.WEBSOCKET_ERROR).toBe(4005);
      expect(ErrorCodes.NOSTR_DELIVERY_ERROR).toBe(4006);
    });

    it('has correct system codes (5xxx)', () => {
      expect(ErrorCodes.INTERNAL_ERROR).toBe(5001);
      expect(ErrorCodes.RATE_LIMIT_EXCEEDED).toBe(5002);
      expect(ErrorCodes.SERVICE_UNAVAILABLE).toBe(5003);
      expect(ErrorCodes.VERSION_NOT_SUPPORTED).toBe(5004);
      expect(ErrorCodes.MAINTENANCE).toBe(5005);
    });
  });
});
