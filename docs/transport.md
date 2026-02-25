# Transport

SNAP supports three transport mechanisms: HTTP, WebSocket, and Nostr. Agents should implement HTTP at minimum.

## Overview

| Transport | Request-Response | Streaming | Offline | Firewall-friendly |
|-----------|------------------|-----------|---------|-------------------|
| HTTP      | Yes              | SSE       | No      | Yes               |
| WebSocket | Yes              | Yes       | No      | Yes               |
| Nostr     | Yes              | No        | Yes     | Yes               |

## Endpoints

Agents declare their transport endpoints in the Agent Card `endpoints` array. Each entry specifies a protocol and URL:

```json
{
  "endpoints": [
    { "protocol": "http", "url": "https://agent.example.com/snap" },
    { "protocol": "wss", "url": "wss://agent.example.com/snap" }
  ],
  "nostrRelays": ["wss://relay.damus.io"]
}
```

Callers MUST try endpoints in declared order and fall back to the next on failure. See [Fallback Strategy](#fallback-strategy).

## HTTP Transport

Request-response over HTTPS. Also supports streaming via Server-Sent Events (SSE).

### Request

```http
POST /snap HTTP/1.1
Host: agent.example.com
Content-Type: application/json
SNAP-Version: 0.1

{
  "id": "msg-001",
  "version": "0.1",
  "from": "bc1p...sender",
  "to": "bc1p...agent",
  "type": "request",
  "method": "message/send",
  "payload": { ... },
  "timestamp": 1770163200,
  "sig": "e5b7a9c3..."
}
```

**Note:** The `to` field is optional. For Agent-to-Service requests (e.g., `service/call`), omit `to` — the service verifies the sender's identity from `from` and does not need its own P2TR address.

### Response

```http
HTTP/1.1 200 OK
Content-Type: application/json
SNAP-Version: 0.1

{
  "id": "msg-002",
  "version": "0.1",
  "from": "bc1p...agent",
  "to": "bc1p...sender",
  "type": "response",
  "method": "message/send",
  "payload": { ... },
  "timestamp": 1770163205,
  "sig": "a1b2c3d4..."
}
```

### HTTP SSE Streaming

For streaming methods (`message/stream`, `tasks/resubscribe`), the caller sends a POST with `Accept: text/event-stream`. The responder replies with an SSE event stream:

```http
POST /snap HTTP/1.1
Host: agent.example.com
Content-Type: application/json
Accept: text/event-stream
SNAP-Version: 0.1

{ ... request message ... }
```

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"id":"evt-001","version":"0.1","from":"bc1p...agent","to":"bc1p...sender","type":"event","method":"message/stream","payload":{"taskId":"task-001","progress":0.5,"message":"Generating..."},"timestamp":1770163203,"sig":"..."}

data: {"id":"evt-002","version":"0.1","from":"bc1p...agent","to":"bc1p...sender","type":"event","method":"message/stream","payload":{"taskId":"task-001","progress":1.0},"timestamp":1770163204,"sig":"..."}

data: {"id":"resp-001","version":"0.1","from":"bc1p...agent","to":"bc1p...sender","type":"response","method":"message/stream","payload":{"task":{...}},"timestamp":1770163205,"sig":"..."}
```

Each SSE event is a `data:` line containing a complete JSON-encoded SnapMessage, followed by a blank line. The stream ends after the final `type: "response"` message.

If the responder does not support SSE, it MAY fall back to a standard JSON response.

### HTTP Headers

| Header         | Description                                        |
|----------------|----------------------------------------------------|
| `Content-Type` | `application/json` (request and non-SSE response)  |
| `Accept`       | `text/event-stream` to request SSE streaming       |
| `SNAP-Version` | Protocol version                                   |

### HTTP Status Codes

| Status | Meaning                                                        |
|--------|----------------------------------------------------------------|
| 200    | Success (check payload for app-level errors)                   |
| 400    | Malformed request (unparseable JSON, missing required headers) |
| 429    | Rate limited (respect `Retry-After` header)                    |
| 500    | Server error                                                   |

**Note:** SNAP authenticates at the message layer (Schnorr signatures), not the HTTP layer. Authentication failures (invalid signature, expired timestamp) return HTTP 200 with an error in the payload. There is no HTTP 401 or 403.

**Exception — Agent-to-Service:** When an HTTP service uses SNAP messages purely for authentication (e.g., `service/call`), the service MAY use standard HTTP status codes (401, 403) since it is not a full SNAP agent. See [messages.md](messages.md#servicecall) for details.

## WebSocket Transport

Full-duplex transport supporting both request-response and streaming.

### Connection

Connect to the `wss` endpoint declared in the Agent Card:

```javascript
const ws = new WebSocket('wss://agent.example.com/snap');

ws.onopen = () => {
  ws.send(JSON.stringify({
    id: 'msg-001',
    version: '0.1',
    from: 'bc1p...sender',
    to: 'bc1p...agent',
    type: 'request',
    method: 'message/stream',
    payload: { ... },
    timestamp: Math.floor(Date.now() / 1000),
    sig: '...'
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  // message.type is 'event' for intermediate updates, 'response' for final
};
```

### Streaming Events

For streaming methods, the agent sends multiple messages in response to a single request. Each message is a full signed SnapMessage:

```json
{
  "id": "evt-001",
  "version": "0.1",
  "from": "bc1p...agent",
  "to": "bc1p...sender",
  "type": "event",
  "method": "message/stream",
  "payload": {
    "taskId": "task-001",
    "progress": 0.5,
    "message": "Generating code..."
  },
  "timestamp": 1770163203,
  "sig": "f1e2d3c4..."
}
```

```json
{
  "id": "evt-002",
  "version": "0.1",
  "from": "bc1p...agent",
  "to": "bc1p...sender",
  "type": "event",
  "method": "message/stream",
  "payload": {
    "taskId": "task-001",
    "artifact": {
      "artifactId": "artifact-001",
      "parts": [{ "text": "export function LoginForm() { ... }" }],
      "partial": true
    }
  },
  "timestamp": 1770163204,
  "sig": "a2b3c4d5..."
}
```

The stream ends with a final `type: "response"` message:

```json
{
  "id": "resp-001",
  "version": "0.1",
  "from": "bc1p...agent",
  "to": "bc1p...sender",
  "type": "response",
  "method": "message/stream",
  "payload": {
    "task": {
      "id": "task-001",
      "status": { "state": "completed", "timestamp": "2026-02-04T10:00:05Z" },
      "artifacts": [...]
    }
  },
  "timestamp": 1770163205,
  "sig": "b3c4d5e6..."
}
```

### Stream Recovery (tasks/resubscribe)

When a streaming connection is interrupted (WebSocket disconnect, SSE timeout), the requester can resume using `tasks/resubscribe`:

```json
{
  "method": "tasks/resubscribe",
  "payload": {
    "taskId": "task-001"
  }
}
```

**Resume behavior:**

1. Requester calls `tasks/get` to check if the task is still in a non-terminal state.
2. If `state` is `working` or `input_required`, requester sends `tasks/resubscribe`.
3. Responder SHOULD resume from the point of interruption, not replay from the beginning.
4. If the responder cannot determine the resume point, it MAY replay all events for the current task state.
5. The responder sends events followed by a final `type: "response"` message, identical to `message/stream`.

Responders are not required to buffer past events. If events were lost during disconnection and the responder has no replay buffer, the requester relies on the final response (which contains the complete task with artifacts).

### Heartbeat

WebSocket connections use **protocol-level ping/pong frames** (not JSON messages) to detect dead connections. Implementations SHOULD send pings every 30 seconds and terminate connections that do not respond.

### Request-Response over WebSocket

Non-streaming methods (`message/send`, `tasks/get`, `tasks/cancel`) can also be sent over WebSocket. The responder sends a single `type: "response"` message in reply. The method name determines whether the responder routes to a streaming or request-response handler:

- `message/stream`, `tasks/resubscribe` → streaming handler (multiple events + final response)
- `message/send`, `tasks/get`, `tasks/cancel` → request-response handler (single response)

## Nostr Transport

Fallback transport using encrypted Nostr direct messages. Useful when the agent's HTTP/WebSocket endpoints are unreachable, or for offline messaging.

Nostr does not support streaming. It is request-response only.

### Event Kinds

SNAP uses two Nostr event kinds for messaging:

- **Kind 21339** (ephemeral, NIP-16 range 20000-29999): Default for real-time messaging. Relays forward but do not store these events.
- **Kind 4339** (storable, regular range 1000-9999): Used when `persist: true` is set in send options, or for offline message retrieval via `fetchOfflineMessages()`.

Agents MUST subscribe to both kinds when listening for incoming messages, to ensure compatibility with senders using either kind.

### Sending via Nostr

Wrap the SNAP message in a Nostr event. The `pubkey` and `p` tag use **hex format** (Nostr protocol requirement).

```json
{
  "kind": 21339,
  "pubkey": "a3b9e108d8f7c2b1...",
  "created_at": 1770163200,
  "tags": [
    ["p", "b4c2d3e5f6a7b8c9..."]
  ],
  "content": "<NIP-44 encrypted SNAP message>",
  "sig": "nostr-event-signature"
}
```

The `content` is encrypted using [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md).

To convert P2TR address to hex pubkey, see [Discovery - Key Encoding](discovery.md#key-encoding).

To store the message on the relay (for offline retrieval), use kind `4339` instead of `21339` and set `persist: true` in the send options.

### Receiving via Nostr

Agents subscribe to their inbox on **both** event kinds:

```json
{
  "kinds": [21339, 4339],
  "#p": ["my-nostr-pubkey"],
  "since": 1770156000
}
```

### Offline Messages

Only storable messages (kind `4339`) are persisted by relays. Ephemeral messages (kind `21339`) are forwarded in real-time but not stored.

When an agent comes online, it queries for stored messages received while offline:

```javascript
const filter = {
  kinds: [4339],  // Only storable kind — ephemeral events are not persisted
  '#p': [myNostrPubkey],
  since: lastOnlineTimestamp
};

relay.subscribe(filter, (event) => {
  const snapMessage = decrypt(event.content, myPrivateKey);
  processMessage(snapMessage);
});
```

To ensure a message is available for offline retrieval, the sender must use `persist: true`.

## Fallback Strategy

When sending a message, try the agent's declared `endpoints` in order. If all endpoints fail and `nostrRelays` is configured, fall back to Nostr:

```
1. Try endpoints[0] (with retry + exponential backoff)
   ↓ failed
2. Try endpoints[1] (with retry + exponential backoff)
   ↓ failed
3. ... (continue through declared endpoints)
   ↓ all failed
4. Nostr relay messaging (if nostrRelays configured, 30s timeout)
   ↓ failed or not configured
5. Return TransportUnavailableError
```

Callers MUST NOT attempt protocols that are not declared in the Agent Card. If an agent only declares `endpoints: [{ "protocol": "http", ... }]`, callers MUST only use HTTP.

Retry guidance per transport:

- **HTTP**: 3 retries with exponential backoff (1s, 2s, 4s)
- **WebSocket**: Reconnect once on disconnect, then fail
- **Nostr**: Publish to all configured relays, wait up to 30 seconds for response

## Implementation Notes

**HTTP:**
- Use keep-alive connections
- Set reasonable timeouts (30s default)
- Implement retry with exponential backoff

**WebSocket:**
- Reconnect automatically on disconnect
- Buffer messages during reconnection
- Use protocol-level ping/pong for heartbeat

**Nostr:**
- Connect to multiple relays for reliability
- Cache relay connections
- Handle relay disconnections gracefully
- Pass `headers` in `NostrTransportConfig` to set custom HTTP headers (e.g. `User-Agent`) on WebSocket connections (Node.js only)

## Next Steps

- [Discovery](discovery.md) — Finding agents on Nostr
- [Errors](errors.md) — Transport error codes
