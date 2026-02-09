# JSON Schema Definitions

This directory contains [JSON Schema (2020-12)](https://json-schema.org/draft/2020-12/release-notes) definitions for SNAP Protocol data structures.

## Design Principles

- **Two-step validation**: Envelope schema validates the outer message structure; per-method payload schemas validate the inner payload separately.
- **Flat `$ref` tree**: All schemas reference `common.schema.json` directly (max 2 levels deep).
- **Hybrid strictness**: Unknown fields are rejected unless prefixed with `x-` (extension fields).
- **Closed enums**: Enum values are strict for v0.1. They may become open in v1.0+.
- **Schema does not validate**: Bech32m checksums, signature correctness, timestamp freshness, or cross-field rules (e.g. `from` and `to` must be on the same network). These are code-level validations.

## Structure

```text
schemas/
├── common.schema.json                    # Shared type definitions
├── envelope.schema.json                  # Message outer structure
├── agent-card.schema.json                # Agent Card
├── error.schema.json                     # Error object
│
├── types/                                # Reusable data structures
│   ├── task.schema.json                  #   Task + TaskStatus + InnerMessage
│   ├── artifact.schema.json              #   Artifact
│   └── part.schema.json                  #   Part (text/raw/url/data variants)
│
├── payloads/                             # Per-method payload schemas
│   ├── message-send.request.schema.json
│   ├── message-send.response.schema.json
│   ├── tasks-get.request.schema.json
│   ├── tasks-get.response.schema.json
│   ├── tasks-cancel.request.schema.json
│   └── tasks-cancel.response.schema.json
│
└── tests/                                # Schema test cases
    ├── envelope.test.json
    └── agent-card.test.json
```

## Validation Flow

Validate a SNAP message in two steps:

```text
Step 1: Validate envelope
  envelope.schema.json
  ├── Checks: id, version, from, to, type, method, timestamp, sig
  ├── sig required for type=request, optional for type=response
  └── Rejects unknown fields (except x-* extensions)

Step 2: Validate payload (by method + type)
  payloads/{method}.{type}.schema.json
  ├── e.g. payloads/message-send.request.schema.json
  └── e.g. payloads/tasks-get.response.schema.json

Step 3: Code-level validation (not schema)
  ├── Bech32m checksum
  ├── Schnorr signature verification
  ├── Timestamp within ±60s
  ├── Message ID deduplication
  └── from/to same network (bc1p/tb1p)
```

## Usage

### JavaScript (Ajv)

```javascript
import Ajv from 'ajv';
import envelopeSchema from './envelope.schema.json';
import commonSchema from './common.schema.json';

const ajv = new Ajv();
ajv.addSchema(commonSchema);
const validate = ajv.compile(envelopeSchema);

const message = {
  id: 'msg-001',
  version: '0.1',
  from: 'bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8',
  to: 'bc1p4qhjn9zdvkux4e44uhx8tc55atqq8xey38e93agfvrg4qkkgs5qsg58g80',
  type: 'request',
  method: 'message/send',
  payload: { message: { messageId: 'inner-001', role: 'user', parts: [{ text: 'Hello' }] } },
  timestamp: 1770163200,
  sig: 'e5b7a9c3d2f1e4b5a6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8'
};

if (validate(message)) {
  console.log('Valid envelope');
} else {
  console.error('Errors:', validate.errors);
}
```

### Python (jsonschema)

```python
import json
from jsonschema import validate, ValidationError
from referencing import Registry, Resource

# Load schemas
with open('common.schema.json') as f:
    common = json.load(f)
with open('envelope.schema.json') as f:
    envelope = json.load(f)

# Build registry for $ref resolution
registry = Registry().with_resource(
    common["$id"], Resource.from_contents(common)
)

# Validate
message = {
    "id": "msg-001",
    "version": "0.1",
    # ...
}

try:
    validate(instance=message, schema=envelope, registry=registry)
    print("Valid envelope")
except ValidationError as e:
    print(f"Error: {e.message}")
```

## Test Cases

Test case files in `tests/` follow this format:

```json
{
  "description": "Test cases for <schema>",
  "schema": "../<schema-file>",
  "tests": [
    {
      "description": "human-readable test name",
      "data": { ... },
      "valid": true
    }
  ]
}
```

Run tests against your validator to ensure schema compliance.

## Schema Version

These schemas correspond to **SNAP Protocol v0.1** (draft).

Breaking changes to schemas will be documented in [CHANGELOG.md](../CHANGELOG.md).

## Part Type Validation Note

The `Part` schema defines all possible fields (`text`, `raw`, `url`, `data`) but does **not** enforce the "exactly one of" constraint via `oneOf`. This is intentional — enforce the single-variant rule in code for better error messages.

The `$defs` section in `part.schema.json` provides `TextPart`, `RawPart`, `UrlPart`, and `DataPart` variants for implementations that want per-variant validation.

## Contributing

When updating schemas:
1. Ensure they match the specification in [../docs/](../docs/)
2. Add test cases in `tests/` for new fields or constraints
3. Keep `$ref` depth to 2 levels max
4. Add `title` and `description` to all definitions
5. Update this README if structure changes
