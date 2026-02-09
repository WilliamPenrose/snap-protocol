# Errors

SNAP uses numeric error codes organized by category. Errors are returned in the response payload.

## Error Response Format

```json
{
  "type": "response",
  "method": "message/send",
  "payload": {
    "error": {
      "code": 2001,
      "message": "Signature verification failed",
      "data": {
        "field": "sig",
        "expected": "valid Schnorr signature"
      }
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `code` | number | Numeric error code |
| `message` | string | Human-readable description |
| `data` | object | Optional additional context |

## Error Code Ranges

| Range | Category |
|-------|----------|
| 1xxx | Task/Message errors (similar to [A2A](https://github.com/a2aproject/A2A)) |
| 2xxx | Authentication errors |
| 3xxx | Discovery errors |
| 4xxx | Transport errors |
| 5xxx | System errors |

## Task/Message Errors (1xxx)

| Code | Name | Description |
|------|------|-------------|
| 1001 | TaskNotFoundError | Task ID doesn't exist |
| 1002 | TaskNotCancelableError | Task can't be canceled in current state |
| 1003 | InvalidMessageError | Message format is invalid |
| 1004 | InvalidPayloadError | Payload fails validation (type, constraint, or semantic) |
| 1005 | ContentTypeNotSupportedError | Unsupported media type |
| 1006 | PushNotificationError | Failed to deliver push notification |
| 1007 | MethodNotFoundError | Unknown method |

**Examples:**

```json
{
  "code": 1001,
  "message": "Task not found",
  "data": { "taskId": "task-123" }
}
```

```json
{
  "code": 1004,
  "message": "Invalid payload",
  "data": { 
    "field": "id",
    "constraint": "pattern",
    "expected": "^[a-zA-Z0-9_-]+$",
    "received": "msg@001"
  }
}
```

```json
{
  "code": 1005,
  "message": "Content type not supported",
  "data": { 
    "provided": "video/mp4",
    "supported": ["text/plain", "application/json"]
  }
}
```

## Authentication Errors (2xxx)

| Code | Name | Description |
|------|------|-------------|
| 2001 | SignatureInvalidError | Signature verification failed |
| 2002 | SignatureMissingError | No signature in message |
| 2003 | IdentityMismatchError | Signer doesn't match `from` field |
| 2004 | TimestampExpiredError | Timestamp outside valid window |
| 2005 | IdentityInvalidError | P2TR address is malformed |
| 2006 | DuplicateMessageError | Message ID already processed |

**Examples:**

```json
{
  "code": 2001,
  "message": "Signature verification failed",
  "data": { "field": "sig", "reason": "signature does not match payload" }
}
```

```json
{
  "code": 2002,
  "message": "Signature missing",
  "data": { "required": true }
}
```

```json
{
  "code": 2003,
  "message": "Identity mismatch",
  "data": { "from": "bc1p...claimed", "signer": "bc1p...actual" }
}
```

```json
{
  "code": 2004,
  "message": "Timestamp expired",
  "data": {
    "provided": 1770156000,
    "serverTime": 1770163200,
    "maxDrift": 60
  }
}
```

```json
{
  "code": 2005,
  "message": "Identity invalid",
  "data": { "field": "from", "value": "bc1q...", "reason": "not a valid P2TR address" }
}
```

```json
{
  "code": 2006,
  "message": "Duplicate message",
  "data": {
    "id": "msg-001",
    "firstSeen": 1770163190
  }
}
```

## Discovery Errors (3xxx)

| Code | Name | Description |
|------|------|-------------|
| 3001 | AgentNotFoundError | Agent not found on Nostr |
| 3002 | AgentCardInvalidError | Agent Card is malformed |
| 3003 | AgentCardExpiredError | Agent Card is too old |
| 3004 | RelayConnectionError | Can't connect to Nostr relay |
| 3005 | SkillNotFoundError | Agent doesn't have requested skill |

**Examples:**

```json
{
  "code": 3001,
  "message": "Agent not found",
  "data": { "identity": "bc1p..." }
}
```

```json
{
  "code": 3005,
  "message": "Skill not found",
  "data": { 
    "skill": "image-generation",
    "available": ["code-generation", "code-review"]
  }
}
```

## Transport Errors (4xxx)

| Code | Name | Description |
|------|------|-------------|
| 4001 | TransportUnavailableError | No transport available |
| 4002 | ConnectionTimeoutError | Connection timed out |
| 4003 | ConnectionRefusedError | Connection refused |
| 4004 | TLSError | TLS handshake failed |
| 4005 | WebSocketError | WebSocket error |
| 4006 | NostrDeliveryError | Failed to deliver via Nostr |

**Examples:**

```json
{
  "code": 4001,
  "message": "No transport available",
  "data": { 
    "tried": ["http", "websocket", "nostr"],
    "endpoint": "https://agent.example.com/snap"
  }
}
```

```json
{
  "code": 4002,
  "message": "Connection timed out",
  "data": { 
    "timeout": 30000,
    "endpoint": "https://agent.example.com/snap"
  }
}
```

## System Errors (5xxx)

| Code | Name | Description |
|------|------|-------------|
| 5001 | InternalError | Unexpected internal error |
| 5002 | RateLimitExceededError | Too many requests |
| 5003 | ServiceUnavailableError | Agent temporarily unavailable |
| 5004 | VersionNotSupportedError | Protocol version not supported |
| 5005 | MaintenanceError | Agent under maintenance |

**Examples:**

```json
{
  "code": 5002,
  "message": "Rate limit exceeded",
  "data": { 
    "limit": 60,
    "window": "1m",
    "retryAfter": 45
  }
}
```

```json
{
  "code": 5004,
  "message": "Version not supported",
  "data": { 
    "requested": "1.0",
    "supported": ["0.1"]
  }
}
```

## HTTP Status Code Mapping

| SNAP Error Range | HTTP Status |
|------------------|-------------|
| 1xxx (Task) | 400 Bad Request |
| 2xxx (Auth) | 401 Unauthorized |
| 3xxx (Discovery) | 404 Not Found |
| 4xxx (Transport) | 502 Bad Gateway |
| 5001-5003 | 500/503 Server Error |
| 5002 (Rate limit) | 429 Too Many Requests |
| 5004 (Version) | 400 Bad Request |

## Handling Errors

**Retry logic:**

```javascript
async function sendWithRetry(message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await send(message);
      
      if (response.payload.error) {
        const { code } = response.payload.error;
        
        // Don't retry client errors
        if (code >= 1000 && code < 3000) {
          throw new Error(response.payload.error.message);
        }
        
        // Retry transport and some system errors
        if (code >= 4000 || code === 5001 || code === 5003) {
          await sleep(Math.pow(2, i) * 1000);
          continue;
        }
        
        // Rate limited — wait and retry
        if (code === 5002) {
          const wait = response.payload.error.data?.retryAfter || 60;
          await sleep(wait * 1000);
          continue;
        }
        
        throw new Error(response.payload.error.message);
      }
      
      return response;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
    }
  }
}
```

## Next Steps

- [Messages](messages.md) — Message format reference
- [Transport](transport.md) — Transport-specific errors
