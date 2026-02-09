import type {
  MessageSendRequest,
  MessageSendResponse,
  TasksGetRequest,
  TasksGetResponse,
  TasksCancelRequest,
  TasksCancelResponse,
} from './payloads.js';
import type { SnapMessage } from './message.js';
import type { TaskStore } from './plugin.js';

/** Maps method names to their request/response payload types. */
export interface MethodPayloadMap {
  'message/send': { request: MessageSendRequest; response: MessageSendResponse };
  'message/stream': { request: MessageSendRequest; response: MessageSendResponse };
  'tasks/get': { request: TasksGetRequest; response: TasksGetResponse };
  'tasks/cancel': { request: TasksCancelRequest; response: TasksCancelResponse };
  'tasks/resubscribe': { request: TasksGetRequest; response: TasksGetResponse };
}

/** Context passed to every handler. */
export interface HandlerContext {
  /** The full inbound SNAP message (already validated). */
  message: SnapMessage;
  /** The task store, if configured. */
  taskStore?: TaskStore;
}

/** Request-response handler for a specific method. */
export type MethodHandler<M extends keyof MethodPayloadMap> = (
  payload: MethodPayloadMap[M]['request'],
  context: HandlerContext,
) => Promise<MethodPayloadMap[M]['response']> | MethodPayloadMap[M]['response'];

/** Streaming handler — yields events and a final response. */
export type StreamMethodHandler<M extends keyof MethodPayloadMap> = (
  payload: MethodPayloadMap[M]['request'],
  context: HandlerContext,
) => AsyncIterable<SnapMessage>;
