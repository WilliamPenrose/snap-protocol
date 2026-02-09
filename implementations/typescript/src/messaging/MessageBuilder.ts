import type { UnsignedMessage, MessageType, MethodName } from '../types/message.js';
import type { P2TRAddress } from '../types/keys.js';

export class MessageBuilder {
  private _id?: string;
  private _version: string = '0.1';
  private _from?: P2TRAddress;
  private _to?: P2TRAddress;
  private _type: MessageType = 'request';
  private _method?: MethodName;
  private _payload: Record<string, unknown> = {};
  private _timestamp?: number;

  id(id: string): this {
    this._id = id;
    return this;
  }

  version(version: string): this {
    this._version = version;
    return this;
  }

  from(from: P2TRAddress): this {
    this._from = from;
    return this;
  }

  to(to: P2TRAddress): this {
    this._to = to;
    return this;
  }

  type(type: MessageType): this {
    this._type = type;
    return this;
  }

  method(method: MethodName): this {
    this._method = method;
    return this;
  }

  payload(payload: Record<string, unknown>): this {
    this._payload = payload;
    return this;
  }

  timestamp(timestamp: number): this {
    this._timestamp = timestamp;
    return this;
  }

  /**
   * Build the unsigned message. Throws if required fields are missing.
   */
  build(): UnsignedMessage {
    if (!this._id) throw new Error('id is required');
    if (!this._from) throw new Error('from is required');
    if (!this._to) throw new Error('to is required');
    if (!this._method) throw new Error('method is required');
    if (this._timestamp === undefined) throw new Error('timestamp is required');

    return {
      id: this._id,
      version: this._version,
      from: this._from,
      to: this._to,
      type: this._type,
      method: this._method,
      payload: this._payload,
      timestamp: this._timestamp,
    };
  }
}
