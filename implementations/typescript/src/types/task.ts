import type { Part } from './part.js';
import type { Artifact } from './artifact.js';
import type { TaskState } from './message.js';

/** Role of a message within a task conversation. */
export type MessageRole = 'user' | 'agent';

/** Current status of a task. */
export interface TaskStatus {
  state: TaskState;
  timestamp: string;
  message?: string;
}

/** A single communication turn within a task. */
export interface InnerMessage {
  messageId: string;
  role: MessageRole;
  parts: Part[];
}

/** A unit of work that may span multiple message turns. */
export interface Task {
  id: string;
  contextId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: InnerMessage[];
}
