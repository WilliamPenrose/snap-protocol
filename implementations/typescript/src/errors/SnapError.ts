import { ErrorCodes, type SnapErrorData } from '../types/errors.js';

export class SnapError extends Error {
  readonly code: number;
  readonly data?: Record<string, unknown>;

  constructor(code: number, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = 'SnapError';
    this.code = code;
    this.data = data;
  }

  toJSON(): SnapErrorData {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined ? { data: this.data } : {}),
    };
  }

  static signatureInvalid(details?: Record<string, unknown>): SnapError {
    return new SnapError(ErrorCodes.SIGNATURE_INVALID, 'Signature verification failed', details);
  }

  static signatureMissing(): SnapError {
    return new SnapError(ErrorCodes.SIGNATURE_MISSING, 'Signature is required for requests');
  }

  static timestampExpired(provided: number, serverTime: number): SnapError {
    return new SnapError(ErrorCodes.TIMESTAMP_EXPIRED, 'Timestamp outside acceptable window', {
      provided,
      serverTime,
      maxDrift: 60,
    });
  }

  static invalidMessage(reason: string): SnapError {
    return new SnapError(ErrorCodes.INVALID_MESSAGE, reason);
  }

  static invalidPayload(reason: string): SnapError {
    return new SnapError(ErrorCodes.INVALID_PAYLOAD, reason);
  }

  static duplicateMessage(id: string, from: string): SnapError {
    return new SnapError(ErrorCodes.DUPLICATE_MESSAGE, 'Duplicate message ID', { id, from });
  }

  static identityInvalid(address: string): SnapError {
    return new SnapError(ErrorCodes.IDENTITY_INVALID, 'Invalid P2TR address', { address });
  }

  static methodNotFound(method: string): SnapError {
    return new SnapError(ErrorCodes.METHOD_NOT_FOUND, `Method not found: ${method}`, { method });
  }
}
