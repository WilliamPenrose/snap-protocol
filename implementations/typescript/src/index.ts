// Core crypto
export { KeyManager } from './crypto/KeyManager.js';
export { Canonicalizer } from './crypto/Canonicalizer.js';
export { Signer } from './crypto/Signer.js';
export type { SignResult, SignOptions } from './crypto/Signer.js';

// Messaging
export { MessageBuilder } from './messaging/MessageBuilder.js';
export { MessageSigner } from './messaging/MessageSigner.js';
export { MessageValidator } from './messaging/MessageValidator.js';
export type { ValidationOptions, ValidationResult } from './messaging/MessageValidator.js';

// Errors
export { SnapError } from './errors/SnapError.js';

// Plugins
export { PluginRegistry } from './plugins/PluginRegistry.js';

// Types
export type {
  Network,
  HexString,
  PublicKeyXOnly,
  PrivateKeyHex,
  P2TRAddress,
  KeyPair,
} from './types/keys.js';

export type {
  MessageType,
  MethodName,
  TaskState,
  SchnorrSignatureHex,
  UnsignedMessage,
  SnapMessage,
  SigningIntermediates,
} from './types/message.js';

export type { SnapErrorData, ErrorCode } from './types/errors.js';
export { ErrorCodes } from './types/errors.js';

export type {
  TransportLogger,
  TransportPlugin,
  TransportSendOptions,
  ReplayStore,
  TaskStore,
  Middleware,
  MiddlewareContext,
  NextFn,
} from './types/plugin.js';

export type {
  MediaType,
  TextPart,
  RawPart,
  UrlPart,
  DataPart,
  Part,
} from './types/part.js';

export type { Artifact } from './types/artifact.js';

export type {
  MessageRole,
  TaskStatus,
  InnerMessage,
  Task,
} from './types/task.js';

export type {
  Skill,
  RateLimit,
  Capabilities,
  Trust,
  Provider,
  EndpointProtocol,
  AgentEndpoint,
  AgentCard,
} from './types/agent-card.js';

export type {
  MessageSendRequest,
  MessageSendResponse,
  TasksGetRequest,
  TasksGetResponse,
  TasksCancelRequest,
  TasksCancelResponse,
} from './types/payloads.js';

export type {
  MethodPayloadMap,
  HandlerContext,
  MethodHandler,
  StreamMethodHandler,
} from './types/handler.js';

export type {
  StreamTransportPlugin,
  TaskProgressEvent,
  TaskArtifactEvent,
} from './types/transport.js';

// Stores
export { InMemoryReplayStore } from './stores/InMemoryReplayStore.js';
export { InMemoryTaskStore } from './stores/InMemoryTaskStore.js';

// Agent
export { AgentCardBuilder } from './agent/AgentCardBuilder.js';
export { SnapAgent } from './agent/SnapAgent.js';
export type { SnapAgentConfig } from './agent/SnapAgent.js';

// Transports
export { HttpTransport } from './transport/HttpTransport.js';
export type { HttpTransportConfig } from './transport/HttpTransport.js';

export { WebSocketTransport } from './transport/WebSocketTransport.js';
export type { WebSocketTransportConfig } from './transport/WebSocketTransport.js';

export { NostrTransport, SNAP_MESSAGE_KIND, SNAP_EPHEMERAL_MESSAGE_KIND, SNAP_AGENT_CARD_KIND } from './transport/NostrTransport.js';
export type { NostrTransportConfig, AgentDiscoveryFilter } from './transport/NostrTransport.js';
