# Implementation Guide

This guide helps you implement SNAP Protocol support in your application.

## Overview

Implementing SNAP involves three main components:
1. **Cryptography** - Key management and signature verification
2. **Messaging** - Message construction and validation
3. **Transport** - HTTP, WebSocket, or Nostr communication

## Prerequisites

### Required Libraries

**Cryptography:**
- Schnorr signature implementation (BIP-340)
- SHA-256 hashing
- Bech32m encoding/decoding
- BIP-39 (mnemonic generation)
- BIP-86 (key derivation)

**Serialization:**
- JSON parser
- JCS (JSON Canonicalization Scheme, RFC 8785)

**Transport:**
- HTTP client/server
- WebSocket client/server (optional)
- Nostr client library (optional)

### Recommended Libraries

**JavaScript/TypeScript:**
```json
{
  "@noble/curves": "^2.0.0",
  "@noble/hashes": "^1.7.0",
  "bech32": "^2.0.0",
  "canonicalize": "^2.0.0",
  "nostr-tools": "^2.0.0"
}
```

**Python:**
```txt
secp256k1>=0.14.0
bech32>=1.2.0
canonicaljson>=2.0.0
nostr-sdk>=0.30.0
```

## Implementation Steps

### Step 1: Key Generation

Generate a P2TR identity for your agent.

**Pseudocode:**
```python
# 1. Generate or load BIP-39 mnemonic
mnemonic = generate_mnemonic(24)  # 24 words

# 2. Derive master key
master_key = mnemonic_to_master_key(mnemonic)

# 3. Derive agent key using BIP-86 path
path = "m/86'/0'/0'/0/0"  # First agent
private_key = derive_key(master_key, path)

# 4. Compute internal public key (x-only)
internal_key = get_public_key(private_key)  # P

# 5. Apply BIP-341 taproot tweak: Q = P + tagged_hash("TapTweak", P) * G
output_key = taproot_tweak(internal_key)  # Q

# 6. Encode tweaked output key as P2TR address
identity = encode_p2tr(output_key)  # bc1p...
```

**Key Storage:**
- Store mnemonic securely (encrypted, HSM, or offline)
- Never expose private key in logs or API responses
- Use environment variables or secure key stores

### Step 2: Create Agent Card

Define your agent's capabilities.

**Pseudocode:**
```python
agent_card = {
    "name": "My Code Assistant",
    "description": "An AI agent for code generation",
    "version": "1.0.0",
    "identity": identity,  # bc1p...
    "endpoints": [
        {"protocol": "http", "url": "https://my-agent.example.com/snap"}
    ],
    "skills": [
        {
            "id": "code-generation",
            "name": "Code Generation",
            "description": "Generate code from descriptions",
            "tags": ["code", "typescript", "python"]
        }
    ],
    "defaultInputModes": ["text/plain"],
    "defaultOutputModes": ["text/plain", "application/json"]
}
```

Validate against [constraints.md](constraints.md) before publishing.

### Step 3: Publish to Nostr

Make your agent discoverable.

**Pseudocode:**
```python
# 1. Create Nostr event
nostr_event = {
    "kind": 31337,
    "pubkey": get_public_key(private_key),  # Internal key (hex), NOT the tweaked key from P2TR
    "created_at": current_timestamp(),
    "tags": [
        ["d", identity],  # P2TR address as identifier
        ["name", "My Code Assistant"],
        ["version", "1.0.0"],
        ["skill", "code-generation", "Code Generation"],
        ["endpoint", "http", "https://my-agent.example.com/snap"]
    ],
    "content": json_stringify(agent_card)
}

# 2. Sign event (Nostr signature, not SNAP)
nostr_event["id"] = compute_nostr_event_id(nostr_event)
nostr_event["sig"] = sign_nostr_event(nostr_event, private_key)

# 3. Publish to relays
relays = ["wss://relay.damus.io", "wss://relay.nostr.band"]
for relay in relays:
    publish_event(relay, nostr_event)
```

### Step 4: Sign SNAP Messages

Sign outgoing messages.

**Pseudocode:**
```python
def sign_snap_message(message, private_key):
    # 1. Compute the BIP-341 tweaked private key
    tweaked_key = tweak_private_key(private_key)

    # 2. Build canonical signature input
    parts = [
        message["id"],
        message["from"],
        message["to"],
        message["type"],
        message["method"],
        canonicalize_jcs(message["payload"]),  # RFC 8785
        str(message["timestamp"])
    ]

    canonical_input = '\x00'.join(parts)  # NULL byte separator

    # 3. Hash the input
    hash = sha256(canonical_input.encode('utf-8'))

    # 4. Sign with Schnorr (BIP-340) using the tweaked private key
    signature = schnorr_sign(hash, tweaked_key)

    return signature.hex()  # 128 hex chars

# Usage
message = {
    "id": "msg-001",
    "version": "0.1",
    "from": my_identity,
    "to": recipient_identity,
    "type": "request",
    "method": "message/send",
    "payload": {"message": {...}},
    "timestamp": current_timestamp()
}

message["sig"] = sign_snap_message(message, my_private_key)
```

**Critical**: Use JCS (RFC 8785) for payload canonicalization, not regular JSON serialization.

### Step 5: Verify Incoming Messages

Verify signatures before processing.

**Pseudocode:**
```python
def verify_snap_message(message):
    # 1. Check timestamp
    now = current_timestamp()
    if abs(now - message["timestamp"]) > 60:
        raise TimestampExpiredError()

    # 2. Check for duplicate (replay protection)
    if is_duplicate(message["from"], message["id"]):
        raise DuplicateMessageError()

    # 3. Extract tweaked public key from P2TR address
    #    This returns the BIP-341 tweaked output key (Q), which is
    #    the correct key for verifying signatures made with the tweaked private key.
    public_key = extract_pubkey_from_p2tr(message["from"])

    # 4. Rebuild canonical input
    parts = [
        message["id"],
        message["from"],
        message["to"],
        message["type"],
        message["method"],
        canonicalize_jcs(message["payload"]),
        str(message["timestamp"])
    ]
    canonical_input = '\x00'.join(parts)

    # 5. Hash the input
    hash = sha256(canonical_input.encode('utf-8'))

    # 6. Verify Schnorr signature
    signature = bytes.fromhex(message["sig"])
    if not schnorr_verify(signature, hash, public_key):
        raise SignatureInvalidError()

    # 7. Track message ID (for deduplication)
    track_message_id(message["from"], message["id"])

    return True
```

### Step 6: Implement HTTP Transport

Handle incoming SNAP requests.

**Pseudocode (Server):**
```python
@app.post("/snap")
def handle_snap_request(request):
    # 1. Parse JSON
    message = parse_json(request.body)

    # 2. Verify signature
    try:
        verify_snap_message(message)
    except SignatureError as e:
        return error_response(2001, str(e))

    # 3. Validate message structure
    try:
        validate_message(message)
    except ValidationError as e:
        return error_response(1004, str(e))

    # 4. Route to handler
    if message["method"] == "message/send":
        return handle_message_send(message)
    elif message["method"] == "tasks/get":
        return handle_tasks_get(message)
    else:
        return error_response(1007, "Method not found")
```

**Pseudocode (Client):**
```python
def send_snap_request(endpoint, message, private_key):
    # 1. Sign message
    message["sig"] = sign_snap_message(message, private_key)

    # 2. Send HTTP POST
    response = http_post(
        endpoint,
        headers={
            "Content-Type": "application/json",
            "SNAP-Version": "0.1"
        },
        body=json_stringify(message)
    )

    # 3. Parse response
    response_message = parse_json(response.body)

    # 4. Verify response signature (if present)
    if "sig" in response_message:
        verify_snap_message(response_message)

    return response_message
```

### Step 7: Implement Discovery

Find agents on Nostr.

**Pseudocode:**
```python
def discover_agents_by_skill(skill_id):
    relays = ["wss://relay.damus.io", "wss://relay.nostr.band"]
    agents = []

    for relay in relays:
        # Query for Agent Cards with the skill
        events = relay.query({
            "kinds": [31337],
            "#skill": [skill_id]
        })

        for event in events:
            # Parse Agent Card from event content
            agent_card = parse_json(event["content"])

            # Verify event signature (Nostr)
            if not verify_nostr_event(event):
                continue

            agents.append(agent_card)

    # Deduplicate by identity
    return deduplicate(agents, key="identity")
```

## Validation Checklist

Implement these validations:

### Message Validation
- [ ] Required fields present (`id`, `version`, `from`, `to`, `type`, `method`, `payload`, `timestamp`, `sig`)
- [ ] `id` matches pattern `^[a-zA-Z0-9_-]+$`, length 1-128
- [ ] `version` matches pattern `^\d+\.\d+$`
- [ ] `from` and `to` are valid P2TR addresses (62 chars, checksum)
- [ ] `type` is `request`, `response`, or `event`
- [ ] `method` matches pattern `^[a-z]+/[a-z_]+$`
- [ ] `timestamp` is integer, within ±60 seconds
- [ ] `sig` is 128 hex characters
- [ ] `payload` is valid JSON object, max 1 MB

### Signature Verification
- [ ] Public key extracted from `from` address
- [ ] Canonical input computed correctly (JCS for payload)
- [ ] SHA-256 hash computed
- [ ] Schnorr signature verified (BIP-340)
- [ ] Timestamp within ±60 seconds
- [ ] Message ID not seen before (120s window)

### Agent Card Validation
- [ ] All required fields present
- [ ] `identity` is valid P2TR address
- [ ] `endpoints` entries have valid protocol and URL (if present)
- [ ] At least one skill defined
- [ ] Skills have valid IDs (pattern `^[a-z0-9-]+$`)
- [ ] Total size under 64 KB

## Error Handling

Return appropriate error codes:

```python
def error_response(code, message, data=None):
    return {
        "type": "response",
        "method": original_method,
        "payload": {
            "error": {
                "code": code,
                "message": message,
                "data": data or {}
            }
        },
        "timestamp": current_timestamp()
        # Optional: sign the response
    }
```

Common errors:
- `2001` - Signature verification failed
- `2004` - Timestamp expired
- `2006` - Duplicate message (replay)
- `1004` - Invalid payload
- `1007` - Method not found

See [errors.md](errors.md) for full list.

## Testing

Test your implementation with:

1. **Unit tests** - Test each component (signing, verification, validation)
2. **Integration tests** - Test full request/response flow
3. **Compliance tests** - Use test vectors in `test-vectors/`
4. **Interop tests** - Test against other implementations

## Security Considerations

See [security-practices.md](security-practices.md) for detailed guidance.

Key points:
- Store private keys securely (HSM for production)
- Validate all inputs before processing
- Implement rate limiting
- Use HTTPS for HTTP transport
- Require signed responses for sensitive operations

## Performance Tips

- Cache Nostr relay connections
- Reuse HTTP connections (keep-alive)
- Batch Nostr queries when possible
- Implement message deduplication efficiently (time-bounded cache)
- Validate message structure before signature verification (fail fast)

## Next Steps

1. Read [security-practices.md](security-practices.md)
2. Review [constraints.md](constraints.md) for validation rules
3. Check [examples/](../examples/) for code samples (coming soon)
4. Review test vectors in `test-vectors/` for compliance

## Getting Help

- Open a GitHub issue for specification questions
- Check [faq.md](faq.md) for common questions
- Review existing implementations (reference implementations coming in v0.5)
