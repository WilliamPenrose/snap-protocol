import type { InnerMessage } from './task.js';
import type { Task } from './task.js';
import type { SnapErrorData } from './errors.js';

// ---------- message/send ----------

/** Payload for message/send requests. */
export interface MessageSendRequest {
  message: InnerMessage;
  taskId?: string;
  idempotencyKey?: string;
}

/** Payload for message/send responses. */
export interface MessageSendResponse {
  task?: Task;
  error?: SnapErrorData;
  deduplicated?: boolean;
}

// ---------- tasks/get ----------

/** Payload for tasks/get requests. */
export interface TasksGetRequest {
  taskId: string;
  historyLength?: number;
}

/** Payload for tasks/get responses. */
export interface TasksGetResponse {
  task?: Task;
  error?: SnapErrorData;
}

// ---------- tasks/cancel ----------

/** Payload for tasks/cancel requests. */
export interface TasksCancelRequest {
  taskId: string;
}

/** Payload for tasks/cancel responses. */
export interface TasksCancelResponse {
  task?: Task;
  error?: SnapErrorData;
}
