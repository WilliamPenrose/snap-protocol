# SNAP SDK API Reference

Complete public API for `@snap-protocol/core`.

## KeyManager

```typescript
class KeyManager {
  static getPublicKey(privateKey: string): string              // Internal (untweaked) x-only pubkey
  static publicKeyToP2TR(internalKey: string, network?: 'mainnet' | 'testnet'): string  // Applies BIP-341 tweak
  static p2trToPublicKey(address: string): string              // Returns tweaked output key (NOT internal key)
  static taprootTweak(internalPubKey: Uint8Array): Uint8Array  // Q = P + tagged_hash("TapTweak", P) * G
  static tweakPrivateKey(privateKey: string): string           // Tweaked private key for signing
  static detectNetwork(address: string): 'mainnet' | 'testnet'
  static validateP2TR(address: string): boolean
  static deriveKeyPair(privateKey: string, network?: 'mainnet' | 'testnet'): KeyPair
}

interface KeyPair {
  privateKey: string    // 64 hex chars (original, untweaked)
  publicKey: string     // 64 hex chars (internal x-only key, used by Nostr)
  address: string       // P2TR address (62 chars, encodes tweaked output key)
  network: 'mainnet' | 'testnet'
}
```

**Important**: `publicKeyToP2TR()` and `p2trToPublicKey()` are NOT inverses. `publicKeyToP2TR(internalKey)` applies the taproot tweak before encoding. `p2trToPublicKey(address)` returns the tweaked output key Q.

## MessageBuilder

```typescript
class MessageBuilder {
  id(id: string): this
  version(version: string): this
  from(from: string): this
  to(to: string): this
  type(type: 'request' | 'response' | 'event'): this
  method(method: string): this
  payload(payload: Record<string, unknown>): this
  timestamp(timestamp: number): this
  build(): UnsignedMessage
}
```

## MessageSigner

```typescript
class MessageSigner {
  constructor(privateKey: string)
  sign(message: UnsignedMessage): SnapMessage
  signWithIntermediates(message: UnsignedMessage): {
    message: SnapMessage
    intermediates: SigningIntermediates
  }
  getAddress(network?: 'mainnet' | 'testnet'): string
}
```

## MessageValidator

```typescript
class MessageValidator {
  static validateStructure(message: unknown): message is SnapMessage
  static verifySignature(message: SnapMessage): boolean
  static validate(message: SnapMessage, options?: ValidationOptions): void
}

interface ValidationOptions {
  skipTimestampCheck?: boolean
  maxClockDrift?: number       // Default: 60 seconds
  skipReplayCheck?: boolean
}
```

## SnapAgent

```typescript
class SnapAgent {
  readonly address: string
  readonly card: AgentCard

  constructor(config: SnapAgentConfig)

  handle<M extends MethodName>(method: M, handler: MethodHandler<M>): this
  handleStream<M extends MethodName>(method: M, handler: StreamMethodHandler<M>): this
  transport(plugin: TransportPlugin): this
  use(middleware: Middleware): this
  replayStore(store: ReplayStore): this
  taskStore(store: TaskStore): this

  start(): Promise<void>
  stop(): Promise<void>
  processMessage(inbound: SnapMessage): Promise<SnapMessage>
  processStream(inbound: SnapMessage): AsyncIterable<SnapMessage>
  send(to: string, endpoint: TransportSendOptions, method: string, payload: any): Promise<SnapMessage>
  sendStream(to: string, endpoint: TransportSendOptions, method: string, payload: any): AsyncIterable<SnapMessage>
}

interface SnapAgentConfig {
  privateKey: string
  card: AgentCard
  network?: 'mainnet' | 'testnet'
}
```

## AgentCardBuilder

```typescript
class AgentCardBuilder {
  name(name: string): this
  description(description: string): this
  version(version: string): this
  identity(address: string): this
  endpoint(protocol: 'http' | 'wss', url: string): this
  nostrRelay(url: string): this
  protocolVersion(version: string): this
  capabilities(caps: { streaming?: boolean; pushNotifications?: boolean }): this
  skill(id: string, name: string, description: string): this
  defaultInputModes(modes: string[]): this
  defaultOutputModes(modes: string[]): this
  trust(trust: { domain: string }): this
  provider(provider: { organization?: string; url?: string }): this
  iconUrl(url: string): this
  build(): AgentCard
}
```

## HttpTransport

```typescript
class HttpTransport implements StreamTransportPlugin {
  readonly name: 'http'
  constructor(config?: HttpTransportConfig)
  send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage>
  sendStream(message: SnapMessage, options: TransportSendOptions): AsyncIterable<SnapMessage>
  listen(handler: (message: SnapMessage) => Promise<SnapMessage | void>): Promise<void>
  listenStream(handler: (message: SnapMessage) => AsyncIterable<SnapMessage>): Promise<void>
  close(): Promise<void>
}

interface HttpTransportConfig {
  port?: number          // Default: 3000
  host?: string          // Default: '0.0.0.0'
  path?: string          // Default: '/'
  timeout?: number       // Default: 30000 ms
}
```

## WebSocketTransport

```typescript
class WebSocketTransport implements StreamTransportPlugin {
  readonly name: 'websocket'
  constructor(config?: WebSocketTransportConfig)
  send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage>
  sendStream(message: SnapMessage, options: TransportSendOptions): AsyncIterable<SnapMessage>
  listen(handler: (message: SnapMessage) => Promise<SnapMessage | void>): Promise<void>
  listenStream(handler: (message: SnapMessage) => AsyncIterable<SnapMessage>): Promise<void>
  close(): Promise<void>
}

interface WebSocketTransportConfig {
  port?: number              // Default: 8080
  host?: string              // Default: '0.0.0.0'
  heartbeatInterval?: number // Default: 30000 ms
  timeout?: number           // Default: 30000 ms
}
```

## NostrTransport

```typescript
class NostrTransport implements TransportPlugin {
  readonly name: 'nostr'
  constructor(config: NostrTransportConfig)
  send(message: SnapMessage, options: TransportSendOptions): Promise<SnapMessage>
  listen(handler: (message: SnapMessage) => Promise<SnapMessage | void>): Promise<void>
  close(): Promise<void>
  publishAgentCard(card: AgentCard): Promise<void>
  discoverAgents(filter: AgentDiscoveryFilter): Promise<AgentCard[]>
  fetchOfflineMessages(since: number): Promise<SnapMessage[]>
}

interface NostrTransportConfig {
  relays: string[]                   // Nostr relay URLs
  privateKey: string                 // Hex private key
  timeout?: number                   // Default: 30000 ms
  messageKind?: number               // Default: 21339 (ephemeral, real-time)
  storableMessageKind?: number       // Default: 4339 (storable, persist/offline)
  agentCardKind?: number             // Default: 31337
  responseLookbackSeconds?: number   // Default: 5
  logger?: TransportLogger           // Diagnostic event logger
}

interface TransportSendOptions {
  endpoint: string
  timeout?: number
  nostrPubkey?: string   // Internal (untweaked) Nostr pubkey for NIP-44 encryption
  persist?: boolean      // Use storable kind (4339) instead of ephemeral (21339)
}

interface AgentDiscoveryFilter {
  skills?: string[]
  identity?: string
  name?: string
}
```

## Core Types

```typescript
interface SnapMessage {
  id: string
  version: string
  from: string           // P2TR address
  to?: string            // P2TR address (optional — omit for Agent-to-Service)
  type: 'request' | 'response' | 'event'
  method: string         // Standard or custom (e.g. 'service/call', 'myapp/action')
  payload: Record<string, unknown>
  timestamp: number      // Unix seconds
  sig: string            // 128 hex chars
}

interface AgentCard {
  name: string
  description: string
  version: string
  identity: string       // P2TR address
  endpoints?: Array<{ protocol: 'http' | 'wss'; url: string }>
  nostrRelays?: string[]
  protocolVersion?: string
  capabilities?: { streaming?: boolean; pushNotifications?: boolean }
  skills: Skill[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
  trust?: { domain: string }
  provider?: { organization?: string; url?: string }
  iconUrl?: string
}

interface Skill {
  id: string
  name: string
  description: string
  tags: string[]
  examples?: string[]
  inputModes?: string[]
  outputModes?: string[]
}

interface Task {
  id: string
  contextId?: string
  status: { state: TaskState; timestamp: string; message?: string }
  artifacts?: Artifact[]
  history?: InnerMessage[]
}

type TaskState = 'submitted' | 'working' | 'input_required' | 'completed' | 'failed' | 'canceled'

interface InnerMessage {
  messageId: string
  role: 'user' | 'agent'
  parts: Part[]
}

type Part = { text: string } | { raw: string; mediaType: string } | { url: string } | { data: Record<string, unknown> }

interface Artifact {
  artifactId: string
  name?: string
  parts: Part[]
}
```

## Handler Types

```typescript
type MethodHandler<M extends MethodName> = (
  payload: MethodPayloadMap[M]['request'],
  context: { message: SnapMessage; taskStore?: TaskStore },
) => Promise<MethodPayloadMap[M]['response']> | MethodPayloadMap[M]['response']

type StreamMethodHandler<M extends MethodName> = (
  payload: MethodPayloadMap[M]['request'],
  context: { message: SnapMessage; taskStore?: TaskStore },
) => AsyncIterable<SnapMessage>
```

## Error Class

```typescript
class SnapError extends Error {
  code: number
  data?: Record<string, unknown>

  static invalidMessage(reason: string): SnapError
  static methodNotFound(method: string): SnapError
  static signatureInvalid(reason: string): SnapError
  static timestampExpired(reason: string): SnapError
  static duplicateMessage(id: string, from: string): SnapError
}
```

## Storage Interfaces

```typescript
interface ReplayStore {
  hasSeen(from: string, id: string): Promise<boolean>
  markSeen(from: string, id: string, timestamp: number): Promise<void>
}

interface TaskStore {
  get(taskId: string): Promise<Task | undefined>
  set(taskId: string, task: Task): Promise<void>
  delete(taskId: string): Promise<void>
}
```
