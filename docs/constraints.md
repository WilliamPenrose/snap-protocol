# Field Constraints

This document defines validation constraints for all SNAP data structures.

## Message Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | 1-128 chars, pattern: `^[a-zA-Z0-9_-]+$` |
| `version` | string | Major.minor format, pattern: `^\d+\.\d+$` |
| `from` | string | Valid P2TR address (62 chars) |
| `to` | string \| undefined | **Optional.** If present, valid P2TR address (62 chars) |
| `type` | string | Enum: `request`, `response`, `event` |
| `method` | string | 1-64 chars, pattern: `^[a-z]+/[a-z_]+$`. Standard methods: `message/send`, `message/stream`, `tasks/get`, `tasks/cancel`, `tasks/resubscribe`, `service/call`. Custom methods MAY be used. |
| `payload` | object | Max 1 MB serialized, max depth 10 |
| `timestamp` | integer | Unix seconds (UTC), range: 0 to 2^53-1 |
| `sig` | string | 128 hex chars (64 bytes Schnorr signature) |

## P2TR Address Validation

Valid P2TR addresses MUST:

- Start with `bc1p` (mainnet) or `tb1p` (testnet)
- Be exactly 62 characters
- Pass bech32m checksum validation

```javascript
import { bech32m } from 'bech32';

function validateP2TR(address) {
  // Check prefix
  if (!address.startsWith('bc1p') && !address.startsWith('tb1p')) {
    return false;
  }
  
  // Check length
  if (address.length !== 62) {
    return false;
  }
  
  // Validate checksum
  try {
    const { prefix, words } = bech32m.decode(address);
    return words[0] === 1; // witness version 1
  } catch {
    return false;
  }
}
```

### Network Policy

When `to` is present, implementations SHOULD reject mixed networks:

| `from` network | `to` network | Valid |
|----------------|--------------|-------|
| mainnet (bc1p) | mainnet (bc1p) | ✓ |
| testnet (tb1p) | testnet (tb1p) | ✓ |
| mainnet (bc1p) | testnet (tb1p) | ✗ |
| testnet (tb1p) | mainnet (bc1p) | ✗ |

## Timestamp

| Property | Value |
|----------|-------|
| Unit | Seconds since Unix epoch |
| Timezone | UTC |
| Precision | Integer (no fractional seconds) |
| Min value | 0 |
| Max value | 2^53 - 1 (JavaScript safe integer) |

Example:
```json
{
  "timestamp": 1770163200
}
```

Corresponds to: `2026-02-04T00:00:00Z`

## Task Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | 1-128 chars, pattern: `^[a-zA-Z0-9_-]+$` |
| `contextId` | string | 1-128 chars, pattern: `^[a-zA-Z0-9_-]+$` |
| `status.state` | string | Enum: `submitted`, `working`, `input_required`, `completed`, `failed`, `canceled` |
| `status.timestamp` | string | ISO 8601 datetime with timezone |

### Task State Enum

```
submitted       Task received, queued for processing
working         Task is being processed
input_required  Waiting for additional user input
completed       Task finished successfully
failed          Task failed with error
canceled        Task was canceled by user
```

## Artifact Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `artifactId` | string | 1-128 chars, pattern: `^[a-zA-Z0-9_-]+$` |
| `name` | string | 1-256 chars, UTF-8 |
| `parts` | array | 1-100 parts |

## Part Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `text` | string | Max 10 MB |
| `raw` | string | Base64 encoded, max 10 MB decoded |
| `url` | string | Valid URL, max 2048 chars |
| `data` | object | Max 1 MB serialized |
| `mediaType` | string | Valid MIME type, max 128 chars |

A Part MUST have exactly one of: `text`, `raw`, `url`, or `data`.

## Agent Card Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `name` | string | Yes | 1-128 chars, UTF-8 |
| `description` | string | Yes | 1-1024 chars, UTF-8 |
| `version` | string | Yes | Semver, pattern: `^\d+\.\d+\.\d+$` |
| `identity` | string | Yes | Valid P2TR address |
| `endpoints` | array | No | Array of `{protocol, url}` objects, max 10 entries |
| `skills` | array | Yes | 1-100 skills |
| `defaultInputModes` | array | Yes | 1-20 MIME types |
| `defaultOutputModes` | array | Yes | 1-20 MIME types |

## Skill Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `id` | string | Yes | 1-64 chars, pattern: `^[a-z0-9-]+$` |
| `name` | string | Yes | 1-128 chars, UTF-8 |
| `description` | string | Yes | 1-1024 chars, UTF-8 |
| `tags` | array | Yes | 1-20 items, each 1-32 chars, pattern: `^[a-z0-9-]+$` |
| `examples` | array | No | 0-10 items, each max 256 chars |

## Size Limits

| Scope | Limit |
|-------|-------|
| Single message (serialized JSON) | 10 MB |
| Message payload | 1 MB |
| Agent Card (serialized JSON) | 64 KB |
| Nostr event content | 64 KB (relay dependent) |
| Single Part content | 10 MB |
| Number of skills per agent | 100 |
| Number of tags per skill | 20 |
| Number of artifacts per task | 100 |
| Number of parts per artifact | 100 |

## Validation Order

Implementations SHOULD validate in this order:

1. **Syntax** — Valid JSON
2. **Structure** — Required fields present
3. **Types** — Field types correct (string, number, object, array)
4. **Constraints** — Length, pattern, enum values
5. **Semantics** — P2TR checksum, URL format, MIME types
6. **Authentication** — Signature verification

Early rejection saves processing time and provides clearer error messages.

## Error Responses

Invalid fields SHOULD return error code 1004 (InvalidPayloadError) with details:

```json
{
  "error": {
    "code": 1004,
    "message": "Invalid payload",
    "data": {
      "field": "id",
      "constraint": "pattern",
      "expected": "^[a-zA-Z0-9_-]+$",
      "received": "msg@001"
    }
  }
}
```

## Extension Fields

Fields not defined in this specification:

- MUST be ignored by receivers (forward compatibility)
- SHOULD use `x-` prefix for custom extensions
- MUST NOT affect signature computation

```json
{
  "id": "msg-001",
  "x-custom-trace-id": "abc123",
  ...
}
```
