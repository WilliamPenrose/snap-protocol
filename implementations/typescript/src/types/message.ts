import type { P2TRAddress } from './keys.js';

export type MessageType = 'request' | 'response' | 'event';

export type MethodName =
  | 'message/send'
  | 'message/stream'
  | 'tasks/get'
  | 'tasks/cancel'
  | 'tasks/resubscribe'
  | 'service/call'
  | (string & {});

export type TaskState =
  | 'submitted'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'canceled';

/** 128 hex characters representing a 64-byte Schnorr signature. */
export type SchnorrSignatureHex = string;

/** Message without signature — the input to signing. */
export interface UnsignedMessage {
  id: string;
  version: string;
  from: P2TRAddress;
  to?: P2TRAddress;
  type: MessageType;
  method: MethodName;
  payload: Record<string, unknown>;
  timestamp: number;
}

/** Fully signed SNAP message. */
export interface SnapMessage extends UnsignedMessage {
  sig: SchnorrSignatureHex;
}

/** Intermediate signing artifacts for debugging. */
export interface SigningIntermediates {
  canonicalPayload: string;
  signatureInput: string;
  signatureInputHex: string;
  sha256Hash: string;
}
