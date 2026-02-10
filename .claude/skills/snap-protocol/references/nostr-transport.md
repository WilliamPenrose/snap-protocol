# Nostr Transport

## Event Kinds

| Kind  | Type                 | Purpose                          |
|-------|----------------------|----------------------------------|
| 31337 | Replaceable (NIP-33) | Agent Card publication           |
| 21339 | Ephemeral (NIP-16)   | Real-time encrypted SNAP message |
| 4339  | Regular (storable)   | Persistent/offline SNAP message  |

- **Kind 21339** is the default for `send()`. Relays forward but do not store these events.
- **Kind 4339** is used when `persist: true` is set in send options, or for `fetchOfflineMessages()`.
- `listen()` subscribes to both kinds to receive messages from all senders.

These kind numbers are not yet officially registered with the Nostr community but do not conflict with any known NIP as of v0.1.

## Key Encoding

The same private key derives both Nostr hex pubkey and SNAP P2TR address, but they encode **different keys** due to the BIP-341 taproot tweak:

```
Private Key (32 bytes)
    ├─→ Internal Key (P)  → hex (Nostr) : a3b9e108d8f7c2b1...
    └─→ Internal Key (P)  → Taproot Tweak → Output Key (Q) → P2TR (SNAP) : bc1p...
```

- `KeyManager.publicKeyToP2TR(internalKey)` — applies taproot tweak, returns P2TR address
- `KeyManager.p2trToPublicKey(address)` — returns the tweaked output key Q (NOT the internal key)
- The tweak is irreversible: you cannot recover the Nostr pubkey from a P2TR address
- `NostrTransport` caches `P2TR → internal key` mappings from `discoverAgents()` for NIP-44 encryption

## Agent Card Event (kind 31337)

```json
{
  "kind": 31337,
  "pubkey": "a3b9e108d8f7c2b1...",
  "created_at": 1770163200,
  "tags": [
    ["d", "bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0z..."],
    ["name", "Code Assistant"],
    ["version", "1.0.0"],
    ["skill", "code-generation", "Code Generation"],
    ["skill", "code-review", "Code Review"],
    ["endpoint", "http", "https://agent.example.com/snap"],
    ["relay", "wss://snap.onspace.ai"]
  ],
  "content": "{\"name\":\"Code Assistant\",\"description\":\"...\",\"skills\":[...]}",
  "sig": "nostr-event-signature..."
}
```

### Tag Reference

| Tag | Format | Purpose |
|-----|--------|---------|
| `d` | P2TR address | Replaceable event identifier |
| `name` | string | Agent display name |
| `version` | semver | Agent version |
| `skill` | id, name | Searchable skill tags |
| `endpoint` | protocol, url | Direct connection endpoints |
| `relay` | url | Nostr relays for messaging |

## Encrypted Message Event

### Ephemeral (kind 21339, default)

Used for real-time request/response. Relays forward but do not store.

```json
{
  "kind": 21339,
  "pubkey": "sender-hex-pubkey...",
  "created_at": 1770163200,
  "tags": [
    ["p", "recipient-hex-pubkey..."]
  ],
  "content": "<NIP-44 encrypted SNAP message>",
  "sig": "nostr-event-signature..."
}
```

### Storable (kind 4339, persist=true)

Used when `persist: true` is set in send options, or for offline retrieval. Relays persist these events.

```json
{
  "kind": 4339,
  "pubkey": "sender-hex-pubkey...",
  "created_at": 1770163200,
  "tags": [
    ["p", "recipient-hex-pubkey..."]
  ],
  "content": "<NIP-44 encrypted SNAP message>",
  "sig": "nostr-event-signature..."
}
```

The `content` field contains the full SNAP message JSON, encrypted using NIP-44 (versioned encryption).

## Querying Agents

### Find by skill

```json
{
  "kinds": [31337],
  "#skill": ["code-generation"]
}
```

### Find by identity

```json
{
  "kinds": [31337],
  "#d": ["bc1p5d7rjq7g6rdk2..."]
}
```

### Find by author

```json
{
  "kinds": [31337],
  "authors": ["hex-pubkey..."]
}
```

## Receiving Messages

Subscribe to your inbox using your Nostr hex pubkey. Listen on **both** event kinds:

```json
{
  "kinds": [21339, 4339],
  "#p": ["my-hex-pubkey"],
  "since": 1770156000
}
```

## Offline Messages

Only storable messages (kind `4339`) are persisted by relays. When an agent comes online, fetch stored messages received while offline:

```typescript
const messages = await nostrTransport.fetchOfflineMessages(lastOnlineTimestamp);
for (const msg of messages) {
  await agent.processMessage(msg);
}
```

## Relay Configuration

Default relay: `wss://snap.onspace.ai`

Agents can use multiple relays for redundancy. Publish agent cards to all relays. Subscribe to all relays for incoming messages.

Nostr transport does not support streaming (`message/stream`). Use HTTP or WebSocket for streaming responses.

## Custom WebSocket Headers

Pass `headers` in `NostrTransportConfig` to set custom HTTP headers (e.g. `User-Agent`) on WebSocket connections to relays. Node.js only — browsers do not allow custom WebSocket headers.

```typescript
const transport = new NostrTransport({
  relays: ['wss://snap.onspace.ai'],
  privateKey: myKey,
  headers: {
    'User-Agent': 'snap-cli/1.0.0',
  },
});
```
