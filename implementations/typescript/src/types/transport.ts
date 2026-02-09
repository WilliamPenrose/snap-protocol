import type { SnapMessage } from './message.js';
import type { TransportPlugin, TransportSendOptions } from './plugin.js';
import type { Artifact } from './artifact.js';

/** Extends TransportPlugin with streaming capability. */
export interface StreamTransportPlugin extends TransportPlugin {
  /** Send a request and receive a stream of responses (events + final response). */
  sendStream(
    message: SnapMessage,
    options: TransportSendOptions,
  ): AsyncIterable<SnapMessage>;

  /** Listen for incoming stream requests. Handler returns a stream of responses. */
  listenStream?(
    handler: (message: SnapMessage) => AsyncIterable<SnapMessage>,
  ): Promise<void>;
}

/** Progress update during streaming. */
export interface TaskProgressEvent {
  taskId: string;
  progress?: number;
  message?: string;
}

/** Partial artifact during streaming. */
export interface TaskArtifactEvent {
  taskId: string;
  artifact: Artifact & { partial?: boolean };
}
