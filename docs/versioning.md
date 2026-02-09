# Versioning

SNAP uses a simple major.minor versioning scheme. This page explains how versions work and how to negotiate compatibility.

## Version Format

```
MAJOR.MINOR
```

Examples: `1.0`, `1.1`, `2.0`

**MAJOR**: Breaking changes. Clients on v1 may not understand v2 messages.

**MINOR**: Backward-compatible additions. v0.2 agents can talk to v0.1 agents.

## Declaring Version Support

Agents declare supported versions in their Agent Card:

```json
{
  "protocolVersion": "0.1",
  "supportedVersions": ["0.1"]
}
```

| Field | Description |
|-------|-------------|
| `protocolVersion` | Preferred/latest version |
| `supportedVersions` | All versions this agent understands |

## Version in Messages

Every message includes a version field:

```json
{
  "id": "msg-001",
  "version": "0.1",
  "from": "bc1p...",
  "to": "bc1p...",
  ...
}
```

## Version in HTTP

Include the version in HTTP headers:

```http
POST /snap HTTP/1.1
SNAP-Version: 0.1
Content-Type: application/json
```

Response:

```http
HTTP/1.1 200 OK
SNAP-Version: 0.1
Content-Type: application/json
```

## Version Negotiation

When Agent A wants to talk to Agent B:

```
1. A reads B's Agent Card
   → supportedVersions: ["0.1", "0.2"]

2. A checks own supported versions
   → supportedVersions: ["0.1", "0.2", "0.3"]

3. A picks highest common version
   → version: "0.2"

4. A sends message with version: "0.2"

5. B validates it supports version "0.2"
   → If not, returns VersionNotSupportedError
```

## Implementation

```javascript
function negotiateVersion(myVersions, theirVersions) {
  // Find common versions
  const common = myVersions.filter(v => theirVersions.includes(v));
  
  if (common.length === 0) {
    throw new Error('No compatible version');
  }
  
  // Sort and pick highest
  common.sort((a, b) => {
    const [aMajor, aMinor] = a.split('.').map(Number);
    const [bMajor, bMinor] = b.split('.').map(Number);
    if (aMajor !== bMajor) return bMajor - aMajor;
    return bMinor - aMinor;
  });
  
  return common[0];
}
```

## Error Handling

If the requested version isn't supported:

```json
{
  "type": "response",
  "payload": {
    "error": {
      "code": 5004,
      "message": "Version not supported",
      "data": {
        "requested": "1.0",
        "supported": ["0.1"]
      }
    }
  }
}
```

## Backward Compatibility Rules

**Minor version additions must be backward compatible:**

- New optional fields: OK
- New methods: OK (unknown methods return error)
- New error codes: OK
- Changing field types: NOT OK
- Removing fields: NOT OK
- Changing method semantics: NOT OK

**Example: v0.1 → v0.2**

```diff
// v0.1 message
{
  "method": "message/send",
  "payload": {
    "message": { ... }
  }
}

// v0.2 message (new optional field)
{
  "method": "message/send",
  "payload": {
    "message": { ... },
+   "priority": "high"  // Optional, ignored by v0.1 agents
  }
}
```

## Deprecation

To deprecate a feature:

1. Mark as deprecated in docs for at least one minor version
2. Log warnings when deprecated features are used
3. Remove in the next major version

## Current Version

The current SNAP protocol version is **0.1** (draft).

| Version | Status | Notes |
|---------|--------|-------|
| 0.1 | Draft | Initial draft, expect breaking changes |

## Next Steps

- [Messages](messages.md) — Message format with version field
- [Agent Card](agent-card.md) — Declaring version support
