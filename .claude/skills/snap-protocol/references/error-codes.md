# Error Codes

## Error Response Format

```json
{
  "type": "response",
  "payload": {
    "error": {
      "code": 2001,
      "message": "Signature verification failed",
      "data": { "field": "sig" }
    }
  }
}
```

## Task/Message Errors (1xxx)

| Code | Name | Description |
|------|------|-------------|
| 1001 | TaskNotFoundError | Task ID doesn't exist |
| 1002 | TaskNotCancelableError | Task can't be canceled in current state |
| 1003 | InvalidMessageError | Message format is invalid |
| 1004 | InvalidPayloadError | Payload fails validation |
| 1005 | ContentTypeNotSupportedError | Unsupported media type |
| 1006 | PushNotificationError | Failed to deliver push notification |
| 1007 | MethodNotFoundError | Unknown method |

## Authentication Errors (2xxx)

| Code | Name | Description |
|------|------|-------------|
| 2001 | SignatureInvalidError | Signature verification failed |
| 2002 | SignatureMissingError | No signature in message |
| 2003 | IdentityMismatchError | Signer doesn't match `from` field |
| 2004 | TimestampExpiredError | Timestamp outside ±60s window |
| 2005 | IdentityInvalidError | P2TR address is malformed |
| 2006 | DuplicateMessageError | Message ID already processed |

## Discovery Errors (3xxx)

| Code | Name | Description |
|------|------|-------------|
| 3001 | AgentNotFoundError | Agent not found on Nostr |
| 3002 | AgentCardInvalidError | Agent Card is malformed |
| 3003 | AgentCardExpiredError | Agent Card is too old |
| 3004 | RelayConnectionError | Can't connect to Nostr relay |
| 3005 | SkillNotFoundError | Agent doesn't have requested skill |

## Transport Errors (4xxx)

| Code | Name | Description |
|------|------|-------------|
| 4001 | TransportUnavailableError | No transport available |
| 4002 | ConnectionTimeoutError | Connection timed out |
| 4003 | ConnectionRefusedError | Connection refused |
| 4004 | TLSError | TLS handshake failed |
| 4005 | WebSocketError | WebSocket error |
| 4006 | NostrDeliveryError | Failed to deliver via Nostr |

## System Errors (5xxx)

| Code | Name | Description |
|------|------|-------------|
| 5001 | InternalError | Unexpected internal error |
| 5002 | RateLimitExceededError | Too many requests |
| 5003 | ServiceUnavailableError | Agent temporarily unavailable |
| 5004 | VersionNotSupportedError | Protocol version not supported |
| 5005 | MaintenanceError | Agent under maintenance |

## HTTP Status Mapping

SNAP authenticates at the message layer, not the HTTP layer. All SNAP errors are returned as HTTP 200 with the error in the payload. HTTP-level errors are only for transport failures:

| HTTP Status | When                                                            |
|-------------|-----------------------------------------------------------------|
| 200         | All SNAP responses (check `payload.error` for app-level errors) |
| 400         | Malformed request (unparseable JSON, missing headers)           |
| 429         | Rate limited (respect `Retry-After` header)                     |
| 500         | Server error                                                    |

## Retry Logic

```javascript
async function sendWithRetry(message, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await send(message);

      if (response.payload.error) {
        const { code } = response.payload.error;

        // Don't retry client errors (1xxx, 2xxx)
        if (code >= 1000 && code < 3000) {
          throw new Error(response.payload.error.message);
        }

        // Retry transport and system errors
        if (code >= 4000 || code === 5001 || code === 5003) {
          await sleep(Math.pow(2, i) * 1000);
          continue;
        }

        // Rate limited — use retryAfter
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
