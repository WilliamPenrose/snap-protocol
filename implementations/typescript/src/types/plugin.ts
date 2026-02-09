import type { SnapMessage } from './message.js';
import type { Task } from './task.js';

// ---------- Transport Logger ----------

/** Logger callback for transport-level diagnostic events. */
export type TransportLogger = (level: 'debug' | 'warn' | 'error', message: string, data?: unknown) => void;

// ---------- Transport Plugin ----------

export interface TransportSendOptions {
  endpoint: string;
  timeout?: number;
  /** Internal (untweaked) Nostr pubkey hex of the recipient. Required for Nostr transport. */
  nostrPubkey?: string;
  /** When true, use storable Nostr event kind (4339) instead of ephemeral (21339). Enables offline message retrieval. Default: false. */
  persist?: boolean;
}

export interface TransportPlugin {
  readonly name: string;
  send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage>;
  listen?(handler: (message: SnapMessage) => Promise<SnapMessage | void>): Promise<void>;
  close?(): Promise<void>;
}

// ---------- Storage Plugin (future) ----------

export interface ReplayStore {
  hasSeen(from: string, id: string): Promise<boolean>;
  markSeen(from: string, id: string, timestamp: number): Promise<void>;
}

export interface TaskStore {
  get(taskId: string): Promise<Task | undefined>;
  set(taskId: string, task: Task): Promise<void>;
  delete(taskId: string): Promise<void>;
}

// ---------- Middleware (future) ----------

export interface MiddlewareContext {
  message: SnapMessage;
  direction: 'inbound' | 'outbound';
}

export type NextFn = () => Promise<void>;

export interface Middleware {
  readonly name: string;
  handle(ctx: MiddlewareContext, next: NextFn): Promise<void>;
}
