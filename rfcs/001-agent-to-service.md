# RFC 001: Agent-to-Service Communication

- **Status:** Draft
- **Author:** William Penrose
- **Created:** 2026-02-25
- **Related:** [#6](https://github.com/WilliamPenrose/snap-protocol/issues/6)

## Motivation

SNAP v0.1 defines only Agent-to-Agent communication, where both parties have P2TR identities. In practice, agents need to call HTTP services (e.g., MCP servers) that do not have SNAP identities. These services only need to verify the caller's identity — they do not need their own P2TR address.

## Summary of Changes

| Item | Current (v0.1) | Proposed |
| ---- | -------------- | -------- |
| `to` field | Required (P2TR) | Optional |
| `method` field | 5 hardcoded methods | Extensible + new `service/call` |
| Signature input | 7 NULL-separated fields | Unchanged (empty string when `to` is absent) |
| Verification step 6 | Check `to` matches self | Skip when `to` is absent |

**Version:** This change is backward-compatible. The protocol version remains `0.1`. Existing messages with `to` present are unaffected. The `to` field is newly optional, and `service/call` is a new method — both are additive changes.

## 1. Optional `to` Field

### Message Structure

```json
{
  "id": "msg-001",
  "version": "0.1",
  "from": "bc1p...sender",
  "to": "bc1p...recipient",
  "type": "request",
  "method": "message/send",
  "payload": { "..." : "..." },
  "timestamp": 1770163200,
  "sig": "e5b7a9c3..."
}
```

When the recipient is an HTTP service rather than a SNAP agent, the `to` field is omitted:

```json
{
  "id": "msg-002",
  "version": "0.1",
  "from": "bc1p...sender",
  "type": "request",
  "method": "service/call",
  "payload": { "..." : "..." },
  "timestamp": 1770163200,
  "sig": "a1b2c3d4..."
}
```

| `to` value | Meaning |
| ---------- | ------- |
| P2TR address | Message is directed to a specific agent |
| Omitted | Message is directed to an HTTP service (no P2TR identity required) |

### Signature Input

When `to` is absent, its position in the signature input uses an **empty string**. The 7-field format is preserved:

```
Agent-to-Agent:
  id \x00 from \x00 to \x00 type \x00 method \x00 canonical_payload \x00 timestamp

Agent-to-Service (empty string in the to position):
  id \x00 from \x00 \x00 type \x00 method \x00 canonical_payload \x00 timestamp
```

The number of fields (7) and separators (6 NULL bytes) remains constant, ensuring consistent signing and verification logic.

### Constraint Changes

The `to` row in `constraints.md` becomes:

| Field | Type | Constraints |
| ----- | ---- | ----------- |
| `to` | string \| undefined | **Optional.** If present, MUST be a valid P2TR address (62 chars). |

Network policy: when `to` is present, `from` and `to` MUST belong to the same network (mainnet/testnet). When `to` is absent, no network check is performed.

### Authentication Changes

Verification step 6 in `authentication.md` becomes:

> 6. **Check recipient** — If `to` is present, it MUST match the recipient's own identity. If `to` is absent, skip this check.

## 2. Extensible `method` Field

### Current Definition

```
message/send | message/stream | tasks/get | tasks/cancel | tasks/resubscribe
```

### Proposed

The five existing Agent-to-Agent methods are retained. A new Agent-to-Service method is added:

| Method | Category | Description |
| ------ | -------- | ----------- |
| `message/send` | Agent↔Agent | Send a message to start or continue a task |
| `message/stream` | Agent↔Agent | Send a message with streaming response |
| `tasks/get` | Agent↔Agent | Get the current state of a task |
| `tasks/cancel` | Agent↔Agent | Cancel a running task |
| `tasks/resubscribe` | Agent↔Agent | Resume streaming updates for a task |
| `service/call` | Agent→Service | **Call a service capability** |

The `method` field constraint is unchanged: `^[a-z]+/[a-z_]+$` (1–64 chars). The protocol defines the methods listed above. Implementations MAY support additional custom methods as long as they match the pattern.

### `service/call` Definition

**Request payload:**

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| `name` | string | Yes | The name of the service capability to invoke |
| `arguments` | object | No | Arguments for the capability |

**Full message example:**

```json
{
  "id": "svc-001",
  "version": "0.1",
  "from": "bc1p...agent",
  "type": "request",
  "method": "service/call",
  "payload": {
    "name": "query_database",
    "arguments": {
      "sql": "SELECT * FROM users LIMIT 10"
    }
  },
  "timestamp": 1770163200,
  "sig": "a1b2c3d4..."
}
```

**Response:** The response format is defined by the service, not by the SNAP protocol. Since the response comes from a plain HTTP service rather than a SNAP agent, it is not a SNAP message.

## 3. Usage Example

**Client (agent calling a service):**

```typescript
import { MessageBuilder, MessageSigner } from '@snap-protocol/core';
import { randomUUID } from 'node:crypto';

const signer = new MessageSigner(myPrivateKey);

const signed = signer.sign(
  new MessageBuilder()
    .id(randomUUID())
    .from(signer.getAddress())
    .method('service/call')
    .payload({ name: 'query_database', arguments: { sql: 'SELECT ...' } })
    .timestamp(Math.floor(Date.now() / 1000))
    .build()
);

const res = await fetch('https://mcp.internal.corp/rpc', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(signed),
});
```

**Server (SNAP middleware for an HTTP service):**

```typescript
import { MessageValidator } from '@snap-protocol/core';

const allowlist = new Set(['bc1p...alice', 'bc1p...bob']);

app.post('/rpc', (req, res) => {
  try {
    MessageValidator.validate(req.body);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
  if (!allowlist.has(req.body.from)) {
    return res.status(403).json({ error: 'Address not authorized' });
  }
  const { name, arguments: args } = req.body.payload;
  const result = executeTool(name, args);
  res.json({ result });
});
```

## 4. Service Discovery

Agent-to-Service communication does not define a discovery mechanism. Services are discovered through out-of-band means:

- **Enterprise:** Internal configuration, service registries, documentation
- **Public:** An organization's SNAP agent can publish service capabilities via its Agent Card on Nostr

## 5. Impact on Existing Functionality

### Backward Compatibility

- All existing Agent-to-Agent messages (where `to` is present) behave exactly as before.
- Signing and verification logic is unchanged for messages with `to`.
- The five existing methods are unaffected.

### SnapAgent Behavior

| Scenario | Behavior |
| -------- | -------- |
| Inbound message with `to` matching agent's address | Process normally (unchanged) |
| Inbound message with `to` not matching agent's address | Reject (unchanged) |
| Inbound message with `to` absent | Process normally (**new**) |

## 6. Security Considerations

### Agent-to-Service Threat Model

| Threat | Mitigation |
| ------ | ---------- |
| Request forgery | Schnorr signature verification (`from` cannot be spoofed) |
| Unauthorized access | Service-side allowlist of `from` addresses |
| Replay attacks | Timestamp ±60s window + message ID deduplication |
| Man-in-the-middle tampering | Signature covers all fields including payload |

### Differences from Agent-to-Agent Security

| | Agent↔Agent | Agent→Service |
| --- | --- | --- |
| Request signature | Required | Required |
| Response signature | Recommended | N/A (response is plain HTTP) |
| Mutual authentication | Yes | No (one-way: client → service) |
| `to` binding | Signature includes `to` | Signature includes empty string for `to` |
