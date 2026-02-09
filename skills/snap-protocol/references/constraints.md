# Field Constraints

## Message Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | 1-128 chars, pattern: `^[a-zA-Z0-9_-]+$` |
| `version` | string | Pattern: `^\d+\.\d+$`, current: `"0.1"` |
| `from` | string | Valid P2TR address (62 chars) |
| `to` | string | Valid P2TR address (62 chars) |
| `type` | string | Enum: `request`, `response`, `event` |
| `method` | string | 1-64 chars, pattern: `^[a-z]+/[a-z_]+$` |
| `payload` | object | Max 1 MB serialized, max depth 10 |
| `timestamp` | integer | Unix seconds (UTC), range: 0 to 2^53-1 |
| `sig` | string | 128 hex chars (64 bytes Schnorr signature) |

## P2TR Address Validation

- Prefix: `bc1p` (mainnet) or `tb1p` (testnet)
- Length: exactly 62 characters
- Encoding: bech32m, witness version 1

```javascript
import { bech32m } from 'bech32';

function validateP2TR(address) {
  if (!address.startsWith('bc1p') && !address.startsWith('tb1p')) return false;
  if (address.length !== 62) return false;
  try {
    const { words } = bech32m.decode(address);
    return words[0] === 1;
  } catch {
    return false;
  }
}
```

### Network Policy

Mixed networks in a single message MUST be rejected:

| `from` | `to` | Valid |
|--------|------|-------|
| mainnet (bc1p) | mainnet (bc1p) | Yes |
| testnet (tb1p) | testnet (tb1p) | Yes |
| mainnet | testnet | No |
| testnet | mainnet | No |

## Task Fields

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | string | 1-128 chars, `^[a-zA-Z0-9_-]+$` |
| `contextId` | string | 1-128 chars, `^[a-zA-Z0-9_-]+$` |
| `status.state` | string | Enum: `submitted`, `working`, `input_required`, `completed`, `failed`, `canceled` |
| `status.timestamp` | string | ISO 8601 with timezone |

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
| `name` | string | Yes | 1-128 chars |
| `description` | string | Yes | 1-1024 chars |
| `version` | string | Yes | Semver: `^\d+\.\d+\.\d+$` |
| `identity` | string | Yes | Valid P2TR address |
| `skills` | array | Yes | 1-100 skills |
| `defaultInputModes` | array | Yes | 1-20 MIME types |
| `defaultOutputModes` | array | Yes | 1-20 MIME types |
| `endpoints` | array | No | Max 10 entries |

## Skill Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `id` | string | Yes | 1-64 chars, `^[a-z0-9-]+$` |
| `name` | string | Yes | 1-128 chars |
| `description` | string | Yes | 1-1024 chars |
| `tags` | array | Yes | 1-20 items, each 1-32 chars |

## Size Limits

| Scope | Limit |
|-------|-------|
| Single message (serialized) | 10 MB |
| Message payload | 1 MB |
| Agent Card (serialized) | 64 KB |
| Nostr event content | 64 KB |
| Skills per agent | 100 |
| Parts per artifact | 100 |

## Validation Order

1. **Syntax** — Valid JSON
2. **Structure** — Required fields present
3. **Types** — Correct field types
4. **Constraints** — Length, pattern, enum
5. **Semantics** — P2TR checksum, URL format
6. **Authentication** — Signature verification
