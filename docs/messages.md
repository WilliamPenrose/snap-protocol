# Messages

SNAP messages are JSON objects that carry requests and responses between agents.

## Message Structure

Every SNAP message has this structure:

```json
{
  "id": "msg-001",
  "version": "0.1",
  "from": "bc1p...sender",
  "to": "bc1p...recipient",
  "type": "request",
  "method": "message/send",
  "payload": { ... },
  "timestamp": 1770163200,
  "sig": "schnorr-signature..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique message identifier (UUID v4 recommended, must be unique per sender within 120s) |
| `version` | string | Protocol version (e.g., "0.1") |
| `from` | string | Sender's P2TR address |
| `to` | string | Recipient's P2TR address |
| `type` | string | `request`, `response`, or `event` |
| `method` | string | The operation being performed |
| `payload` | object | Method-specific data |
| `timestamp` | number | Unix timestamp (seconds) |
| `sig` | string | Schnorr signature (hex) — **required** for requests, **optional** for responses |

See [Constraints](constraints.md) for detailed validation rules and size limits.

## Message Types

| Type       | Description                                                                              |
|------------|------------------------------------------------------------------------------------------|
| `request`  | A request from one agent to another. Signature is **required**.                          |
| `response` | The final response to a request. Signature is **recommended**.                           |
| `event`    | An intermediate streaming update (progress, partial artifact). Signature is **recommended**. |

The `event` type is only used during streaming. See [Transport - Streaming Events](transport.md#streaming-events) for details.

## Methods

SNAP supports the following request methods (inspired by [A2A](https://github.com/a2aproject/A2A)):

| Method              | Description                                |
|---------------------|--------------------------------------------|
| `message/send`      | Send a message to start or continue a task |
| `message/stream`    | Send a message with streaming response     |
| `tasks/get`         | Get the current state of a task            |
| `tasks/cancel`      | Cancel a running task                      |
| `tasks/resubscribe` | Resume streaming updates for a task        |

Streaming methods (`message/stream`, `tasks/resubscribe`) return a stream of `event` messages followed by a final `response`. Non-streaming methods return a single `response`.

## message/send

Send a message to an agent:

**Request:**

```json
{
  "id": "msg-001",
  "version": "0.1",
  "from": "bc1p...client",
  "to": "bc1p...agent",
  "type": "request",
  "method": "message/send",
  "payload": {
    "message": {
      "messageId": "inner-001",
      "role": "user",
      "parts": [
        { "text": "Write a login form in React" }
      ]
    }
  },
  "timestamp": 1770163200,
  "sig": "e5b7a9c3..."
}
```

**Response:**

```json
{
  "id": "msg-002",
  "version": "0.1",
  "from": "bc1p...agent",
  "to": "bc1p...client",
  "type": "response",
  "method": "message/send",
  "payload": {
    "task": {
      "id": "task-001",
      "contextId": "ctx-001",
      "status": {
        "state": "completed",
        "timestamp": "2026-02-04T10:00:05Z"
      },
      "artifacts": [
        {
          "artifactId": "artifact-001",
          "name": "LoginForm.tsx",
          "parts": [
            { "text": "export function LoginForm() { ... }" }
          ]
        }
      ]
    }
  },
  "timestamp": 1770163205,
  "sig": "a1b2c3d4..."
}
```

## Continuing a Task

To continue an existing task, include `taskId`:

```json
{
  "method": "message/send",
  "payload": {
    "taskId": "task-001",
    "message": {
      "messageId": "inner-002",
      "role": "user",
      "parts": [
        { "text": "Add form validation" }
      ]
    }
  }
}
```

## Context

A **context** groups related tasks into a logical conversation. The `contextId` field links tasks that share a common thread.

### Ownership

The **agent** (server) generates and assigns `contextId`. Clients do not create or suggest context IDs.

- When a client sends `message/send` without a `taskId`, the agent creates a new task. The agent decides whether to assign it to an existing context or create a new one.
- When a client continues a task (with `taskId`), the task's existing `contextId` is preserved.

### Lifecycle

| Event | Effect on Context |
| ----- | ----------------- |
| New task created | Agent assigns a `contextId` (new or existing) |
| Task completes/fails/cancels | Context remains valid; new tasks can join it |
| All tasks in context reach terminal state | Context is eligible for cleanup |
| No activity for implementation-defined period | Agent MAY expire the context |

### Rules

1. A task belongs to exactly one context.
2. A context can contain multiple tasks.
3. Different sender-recipient pairs MUST NOT share a context.
4. Agents SHOULD return `contextId` in every task response so clients can reference it for diagnostics and logging.
5. Agents MAY use `contextId` to maintain conversational memory across tasks.

## tasks/get

Get the current state of a task:

| Field           | Type   | Required | Description                                                                                                                     |
|-----------------|--------|----------|---------------------------------------------------------------------------------------------------------------------------------|
| `taskId`        | string | Yes      | The task to retrieve                                                                                                            |
| `historyLength` | number | No       | Max number of history messages to include. If omitted, the agent returns the full history. Set to `0` to omit history entirely. |

**Request:**

```json
{
  "method": "tasks/get",
  "payload": {
    "taskId": "task-001",
    "historyLength": 10
  }
}
```

**Response:**

```json
{
  "method": "tasks/get",
  "payload": {
    "task": {
      "id": "task-001",
      "contextId": "ctx-001",
      "status": {
        "state": "working",
        "timestamp": "2026-02-04T10:00:03Z"
      },
      "history": [...],
      "artifacts": [...]
    }
  }
}
```

## tasks/cancel

Cancel a running task:

**Request:**

```json
{
  "method": "tasks/cancel",
  "payload": {
    "taskId": "task-001"
  }
}
```

**Response:**

```json
{
  "method": "tasks/cancel",
  "payload": {
    "task": {
      "id": "task-001",
      "status": {
        "state": "canceled",
        "timestamp": "2026-02-04T10:00:10Z"
      }
    }
  }
}
```

## message/stream

Send a message with a streaming response. The request payload is identical to `message/send`. The response is a sequence of `event` messages followed by a final `response`.

**Request:**

```json
{
  "method": "message/stream",
  "payload": {
    "message": {
      "messageId": "inner-003",
      "role": "user",
      "parts": [
        { "text": "Write a login form in React" }
      ]
    }
  }
}
```

**Intermediate Events** (`type: "event"`):

```json
{
  "type": "event",
  "method": "message/stream",
  "payload": {
    "taskId": "task-001",
    "progress": 0.5,
    "message": "Generating code..."
  }
}
```

```json
{
  "type": "event",
  "method": "message/stream",
  "payload": {
    "taskId": "task-001",
    "artifact": {
      "artifactId": "artifact-001",
      "parts": [{ "text": "export function LoginForm() { ... }" }],
      "partial": true
    }
  }
}
```

**Final Response** (`type: "response"`):

```json
{
  "type": "response",
  "method": "message/stream",
  "payload": {
    "task": {
      "id": "task-001",
      "status": { "state": "completed" },
      "artifacts": [...]
    }
  }
}
```

See [Transport - Streaming Events](transport.md#streaming-events) for transport-specific details (HTTP SSE and WebSocket).

## tasks/resubscribe

Resume streaming updates for a task after a connection interruption. The request and response formats are the same as `message/stream`, but the agent resumes from the point of interruption rather than starting over.

**Request:**

```json
{
  "method": "tasks/resubscribe",
  "payload": {
    "taskId": "task-001"
  }
}
```

**Response:** Same as `message/stream` — a sequence of `event` messages followed by a final `response`.

See [Transport - Stream Recovery](transport.md#stream-recovery-tasksresubscribe) for resume behavior.

## Task States

| State | Description |
|-------|-------------|
| `submitted` | Task received, not yet started |
| `working` | Task in progress |
| `input_required` | Waiting for additional input |
| `completed` | Task finished successfully |
| `failed` | Task failed |
| `canceled` | Task was canceled |

### State Transitions

Agents MUST follow these transition rules:

```text
                 ┌──────────────────────────────────┐
                 │                                  ↓
submitted ────→ working ──→ completed
  │              │  ↑
  │              │  └── input_required
  │              │
  │              ├──→ failed
  │              └──→ canceled
  │
  ├──→ failed
  └──→ canceled
```

| From | Allowed To | Notes |
| ---- | ---------- | ----- |
| `submitted` | `working`, `failed`, `canceled` | Initial processing or immediate rejection |
| `working` | `completed`, `failed`, `canceled`, `input_required` | Active processing |
| `input_required` | `working`, `failed`, `canceled` | Returns to `working` after input received |
| `completed` | *(none — terminal)* | |
| `failed` | *(none — terminal)* | |
| `canceled` | *(none — terminal)* | |

**Rules:**

1. Terminal states (`completed`, `failed`, `canceled`) MUST NOT transition to any other state.
2. `submitted` MUST NOT transition directly to `completed` or `input_required` — it must pass through `working` first.
3. Any non-terminal state MAY transition to `failed` or `canceled` at any time.

## Idempotency

### Task ID Generation

| Strategy | Generator | Behavior |
|----------|-----------|----------|
| Server-generated | Agent | Each request creates new task |
| Client-generated | Client | Same `taskId` = same task |

**v0.1**: Task IDs are generated by the Agent (server-generated).

To achieve idempotent task creation, clients SHOULD:

1. Generate a unique `idempotencyKey` in the payload
2. Agent checks if task with that key exists
3. If exists, return existing task instead of creating new one

```json
{
  "method": "message/send",
  "payload": {
    "idempotencyKey": "client-generated-uuid",
    "message": { ... }
  }
}
```

**Note**: `idempotencyKey` support is OPTIONAL for agents in v0.1.

### Duplicate Detection

When a replay store blocks a duplicate message (same `id` from same sender), the agent SHOULD return the original task result with a `deduplicated` flag:

```json
{
  "type": "response",
  "payload": {
    "task": { "id": "task-001", "status": { "state": "completed" } },
    "deduplicated": true
  }
}
```

This tells the client that the request was not processed again — the response is from the original execution. Without this flag, a client retrying after a network timeout cannot distinguish "first request succeeded" from "retry succeeded".

### Method Idempotency

| Method | Idempotent | Notes |
|--------|------------|-------|
| `message/send` | No* | Creates new task or continues existing |
| `tasks/get` | Yes | Read-only |
| `tasks/cancel` | Yes | Canceling twice = same result |

\* Can be made idempotent with `idempotencyKey`

### Retry Guidance

For failed requests due to network issues:

- `tasks/get` — Safe to retry immediately
- `tasks/cancel` — Safe to retry immediately  
- `message/send` — Check task status first, or use `idempotencyKey`

## Parts

Message and artifact content is carried in **Parts**:

**Text Part:**

```json
{
  "text": "Hello, world!",
  "mediaType": "text/plain"
}
```

**Raw Part (Base64):**

```json
{
  "raw": "iVBORw0KGgoAAAANSUhEUgAA...",
  "mediaType": "image/png"
}
```

**URL Part:**

```json
{
  "url": "https://example.com/large-file.pdf",
  "mediaType": "application/pdf"
}
```

**Data Part (Structured):**

```json
{
  "data": {
    "users": [
      { "id": 1, "name": "Alice" },
      { "id": 2, "name": "Bob" }
    ]
  }
}
```

## Error Responses

When an error occurs, the response includes an `error` field:

```json
{
  "type": "response",
  "method": "message/send",
  "payload": {
    "error": {
      "code": 2001,
      "message": "Signature verification failed",
      "data": {
        "field": "sig"
      }
    }
  }
}
```

See [Errors](errors.md) for the complete error code reference.

## Next Steps

- [Authentication](authentication.md) — How to sign messages
- [Transport](transport.md) — How to send messages
- [Constraints](constraints.md) — Field validation rules
