# Agent Card

> **Discovery layer — optional.** Agent Cards are only needed if you publish your agent for discovery or advertise task-based capabilities. Auth-only use cases (`service/call` with known endpoints) do not require Agent Cards.

An **Agent Card** is a JSON document that describes an agent's identity, capabilities, and how to communicate with it.

## Basic Structure

```json
{
  "name": "Code Assistant",
  "description": "An AI agent that helps with code generation and review",
  "version": "1.0.0",

  "identity": "bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8",

  "endpoints": [
    { "protocol": "http", "url": "https://agent.example.com/snap" },
    { "protocol": "wss", "url": "wss://agent.example.com/snap" }
  ],
  "nostrRelays": ["wss://relay.damus.io"],

  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  },

  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json", "text/markdown"],

  "skills": [
    {
      "id": "code-generation",
      "name": "Code Generation",
      "description": "Generate code from natural language descriptions",
      "tags": ["code", "typescript", "react", "nodejs"],
      "examples": [
        "Write a login form in React",
        "Create an Express API endpoint"
      ]
    }
  ]
}
```

## Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Human-readable name |
| `description` | string | What your agent does |
| `version` | string | Agent version (semver recommended) |
| `identity` | string | P2TR address (bc1p...) |
| `skills` | array | List of agent capabilities |
| `defaultInputModes` | array | Accepted input media types |
| `defaultOutputModes` | array | Output media types |

## Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `endpoints` | array | Transport endpoints (see [Endpoints](#endpoints)) |
| `nostrRelays` | array | Nostr relay URLs for discovery and offline messaging |
| `protocolVersion` | string | Preferred SNAP protocol version |
| `supportedVersions` | array | All protocol versions this agent understands |
| `capabilities` | object | Feature flags |
| `trust` | object | Domain verification (see [Domain Verification](#domain-verification-optional)) |
| `provider` | object | Organization info |
| `iconUrl` | string | Agent icon URL |
| `documentationUrl` | string | Link to docs |

## Endpoints

The `endpoints` array declares how other agents can communicate with this agent. Each entry specifies a protocol and URL:

```json
{
  "endpoints": [
    { "protocol": "http", "url": "https://agent.example.com/snap" },
    { "protocol": "wss", "url": "wss://agent.example.com/snap" }
  ]
}
```

| Field      | Type   | Description                              |
|------------|--------|------------------------------------------|
| `protocol` | string | Transport protocol: `"http"` or `"wss"` |
| `url`      | string | Endpoint URL                             |

Callers MUST try endpoints **in declared order**. If an agent declares only an `http` endpoint, callers MUST NOT attempt WebSocket. If an agent declares both, the caller tries the first one and falls back to the next on failure.

The `nostrRelays` field is separate from `endpoints`. It declares Nostr relay URLs used for discovery and offline messaging, not for direct SNAP transport:

```json
{
  "nostrRelays": ["wss://relay.damus.io", "wss://nos.lol"]
}
```

If all declared endpoints fail and `nostrRelays` is configured, callers MAY fall back to Nostr relay messaging as a last resort.

## Identity

The `identity` field is the agent's P2TR address. This is the **only required identifier** — no URLs, no UUIDs, just the cryptographic identity.

```json
{
  "identity": "bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8"
}
```

The corresponding public key is encoded in the address itself, which allows signature verification.

## Skills

Skills describe what your agent can do:

```json
{
  "id": "code-generation",
  "name": "Code Generation",
  "description": "Generate production-ready code from descriptions",
  "tags": ["code", "typescript", "react", "nodejs"],
  "examples": [
    "Write a React component for user profile",
    "Create an API endpoint for user authentication"
  ],
  "inputModes": ["text/plain"],
  "outputModes": ["text/plain", "application/json"]
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique within this agent. Used for discovery filtering and programmatic routing |
| `name` | Yes | Human-readable name |
| `description` | Yes | What this skill does |
| `tags` | Yes | Keywords for discovery |
| `examples` | No | Example prompts |
| `inputModes` | No | Override default input modes |
| `outputModes` | No | Override default output modes |

## Capabilities

The `capabilities` object declares optional features:

```json
{
  "capabilities": {
    "streaming": true,
    "pushNotifications": false
  }
}
```

| Capability          | Default | Description                                    |
|---------------------|---------|------------------------------------------------|
| `streaming`         | false   | Supports streaming (WebSocket or HTTP SSE)     |
| `pushNotifications` | false   | Can send webhook notifications                 |
| `rateLimit`         | null    | Rate limiting policy (see below)               |

### Rate Limiting

Agents MAY declare their rate limiting policy so clients can throttle proactively:

```json
{
  "capabilities": {
    "rateLimit": {
      "maxRequests": 100,
      "windowSeconds": 60
    }
  }
}
```

| Field | Type | Description |
| ----- | ---- | ----------- |
| `maxRequests` | number | Maximum requests allowed per window |
| `windowSeconds` | number | Window duration in seconds |

When an agent returns error code `5002` (RateLimitExceededError), it SHOULD include `retryAfter` in the error data:

```json
{
  "error": {
    "code": 5002,
    "message": "Rate limit exceeded",
    "data": { "retryAfter": 30 }
  }
}
```

If no `rateLimit` is declared in the Agent Card, clients SHOULD respect `5002` errors and back off using the `retryAfter` value.

## Domain Verification (Optional)

To prove your agent is associated with a domain:

```json
{
  "trust": {
    "domain": "agent.onspace.ai"
  }
}
```

Then add a DNS TXT record:

```
_snap.agent.onspace.ai.  IN TXT  "snap=bc1p5d7rjq7g6rdk2..."
```

## Publishing to Nostr

Your Agent Card is published as a Nostr event:

```json
{
  "kind": 31337,
  "pubkey": "a3b9e108d8f7c2b1e9f8a7d6c5b4a3e2d1c0b9a8...",
  "created_at": 1770163200,
  "tags": [
    ["d", "bc1p5d7rjq7g6rdk2yhzqnt9..."],
    ["name", "Code Assistant"],
    ["version", "1.0.0"],
    ["skill", "code-generation", "Code Generation"],
    ["skill", "code-review", "Code Review"],
    ["endpoint", "http", "https://agent.example.com/snap"],
    ["endpoint", "wss", "wss://agent.example.com/snap"],
    ["relay", "wss://relay.damus.io"]
  ],
  "content": "{...full AgentCard JSON...}",
  "sig": "e5b7a9c3d2f1..."
}
```

**Tag structure:**

| Tag        | Format                             | Purpose                                    |
|------------|------------------------------------|--------------------------------------------|
| `d`        | `["d", "<P2TR address>"]`          | Unique identifier (replaceable event key)  |
| `name`     | `["name", "<agent name>"]`         | Searchable agent name                      |
| `version`  | `["version", "<semver>"]`          | Agent version                              |
| `skill`    | `["skill", "<id>", "<name>"]`      | Searchable skill (one tag per skill)       |
| `endpoint` | `["endpoint", "<proto>", "<url>"]` | Transport endpoint with protocol           |
| `relay`    | `["relay", "<wss url>"]`           | Nostr relay for messaging                  |

## Serving via HTTP

Agent Cards can also be served at the well-known URL `GET /.well-known/snap-agent.json`. The response is a `SignedAgentCard` wrapper that includes a Schnorr signature for verifiability. See [Discovery](discovery.md#well-known-url-discovery) for the response format and verification steps.

When using `SnapAgent` with `HttpTransport`, the well-known endpoint is served automatically.

## Querying Agent Cards

Find agents by skill:

```json
{
  "kinds": [31337],
  "#skill": ["code-generation"]
}
```

Find a specific agent:

```json
{
  "kinds": [31337],
  "#d": ["bc1p5d7rjq7g6rdk2yhzqnt9..."]
}
```

## Trust Considerations

SNAP does not define a trust/reputation system in v0.1.

### What SNAP Verifies

| ✓ Verified | ✗ Not Verified |
|------------|----------------|
| Message signature is valid | Agent is trustworthy |
| Sender controls the identity | Agent will behave correctly |
| Domain ownership (optional) | Agent quality or safety |

### Requester Responsibilities

Clients SHOULD implement their own trust policies:

- **Allowlist**: Only interact with known agents
- **Domain verification**: Require `trust.domain` for sensitive operations
- **Reputation**: Build or integrate external reputation systems

### Recommendations

For production use:

- Verify domain ownership when available
- Maintain an allowlist of trusted agent identities
- Monitor agent behavior and revoke trust if needed
- Be cautious with agents that have no domain verification

### Future Considerations

Web of Trust or endorsement mechanisms may be added in future versions based on community feedback.

## Next Steps

- [Messages](messages.md) — How to send requests to agents
- [Discovery](discovery.md) — Finding agents on Nostr
