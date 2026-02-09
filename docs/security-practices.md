# Security Best Practices

This document provides security guidance for implementing and deploying SNAP Protocol agents.

## Key Management

### Private Key Storage

**Development:**
```
✓ Use environment variables
✓ Encrypted files with strong passwords
✓ Never commit keys to version control
```

**Production:**
```
✓ Hardware Security Modules (HSM)
✓ Cloud key management services (AWS KMS, Google Cloud KMS, Azure Key Vault)
✓ Secure enclaves (Intel SGX, ARM TrustZone)
✗ Plain text files
✗ Database storage without encryption
✗ Application memory for extended periods
```

### Mnemonic Backup

**BIP-39 mnemonics must be:**
- Stored offline (paper, metal)
- Encrypted if stored digitally
- Never transmitted over networks
- Split using Shamir's Secret Sharing for high-value identities

**Example backup procedure:**
```
1. Generate 24-word mnemonic
2. Write on paper (or engrave on metal)
3. Store in secure location (safe, safety deposit box)
4. Optional: Split using Shamir's Secret Sharing
   - Generate 3-of-5 shares
   - Distribute to trusted locations
```

### Key Rotation

**v0.1 Limitation:** No protocol-level key rotation.

**Workarounds:**
- Generate new identity, publish new Agent Card
- For domain-verified agents: Update DNS TXT record
- Maintain list of old identities for backwards compatibility

**Future:** Key rotation may be added in v2.0+.

## Message Security

### Signature Verification

**ALWAYS verify signatures before processing:**

```python
def process_request(message):
    # 1. Verify signature FIRST
    if not verify_signature(message):
        raise SignatureInvalidError()

    # 2. Then process business logic
    return handle_request(message)
```

**Never trust:**
- Messages without signatures
- Messages with invalid signatures
- Messages with expired timestamps
- Messages from unknown sources (without allowlist)

### Timestamp Validation

**Implement strict timestamp checks:**

```python
def validate_timestamp(timestamp):
    now = int(time.time())
    diff = abs(now - timestamp)

    # Allow ±60 seconds (adjust based on your requirements)
    if diff > 60:
        raise TimestampExpiredError(
            f"Timestamp {timestamp} is {diff}s off from current time {now}"
        )
```

**Clock synchronization:**
- Use NTP (Network Time Protocol) on servers
- Monitor clock drift
- Alert on clock skew > 30 seconds

### Replay Protection

**Implement message deduplication:**

```python
class MessageDeduplicator:
    def __init__(self, ttl=120):  # Track for 120 seconds
        self.cache = {}  # {from_address: {msg_id: timestamp}}
        self.ttl = ttl

    def check_duplicate(self, from_addr, msg_id):
        self.cleanup()  # Remove expired entries

        if from_addr in self.cache:
            if msg_id in self.cache[from_addr]:
                return True  # Duplicate

        # Track this message
        if from_addr not in self.cache:
            self.cache[from_addr] = {}
        self.cache[from_addr][msg_id] = time.time()

        return False  # Not a duplicate

    def cleanup(self):
        now = time.time()
        for addr in list(self.cache.keys()):
            self.cache[addr] = {
                mid: ts for mid, ts in self.cache[addr].items()
                if now - ts < self.ttl
            }
            if not self.cache[addr]:
                del self.cache[addr]
```

### Response Signing

**When to require signed responses:**

| Scenario | Require Signature |
|----------|-------------------|
| Financial operations | ✓ Yes |
| Sensitive data access | ✓ Yes |
| Nostr transport (no TLS) | ✓ Yes |
| Untrusted networks | ✓ Yes |
| Regular requests over HTTPS | Optional |

**Implementation:**
```python
def handle_sensitive_request(request):
    response = process_request(request)

    # ALWAYS sign responses for sensitive operations
    response["sig"] = sign_message(response, my_private_key)

    return response
```

## Transport Security

### HTTPS Requirements

**Always use HTTPS in production:**

```
✓ Valid TLS certificate (Let's Encrypt, commercial CA)
✓ TLS 1.2 or higher
✓ Strong cipher suites (AEAD ciphers)
✓ HSTS headers enabled
✗ Self-signed certificates (except localhost development)
✗ TLS 1.0/1.1
✗ Weak ciphers (RC4, DES, 3DES)
```

**HTTP is only acceptable for:**
- Localhost development (`http://localhost:3000`)
- Private networks (isolated from internet)
- Testing environments

### WebSocket Security

**Secure WebSocket connections:**

```
✓ Use WSS (WebSocket Secure), not WS
✓ Verify origin headers
✓ Implement connection limits per client
✓ Set reasonable timeout values
✓ Implement heartbeat/ping-pong
✗ Allow connections without authentication
✗ Keep connections open indefinitely
```

### Nostr Security

**Risks when using Nostr:**
- Relays can observe message metadata
- Relays can drop or delay messages
- Malicious relays can return fake Agent Cards

**Mitigations:**
```
✓ Use multiple relays
✓ Verify Agent Card signatures
✓ Use NIP-44 encryption for direct messages
✓ Verify domain ownership when available
✓ Maintain allowlist of trusted agents
```

## Input Validation

### Validate Everything

**Defense in depth - validate at multiple layers:**

```python
def process_message(raw_input):
    # Layer 1: Parse JSON
    try:
        message = json.loads(raw_input)
    except json.JSONDecodeError:
        raise InvalidMessageError("Malformed JSON")

    # Layer 2: Check structure
    required_fields = ["id", "version", "from", "to", "type",
                       "method", "payload", "timestamp", "sig"]
    for field in required_fields:
        if field not in message:
            raise InvalidMessageError(f"Missing field: {field}")

    # Layer 3: Validate types and constraints
    validate_constraints(message)

    # Layer 4: Verify signature
    verify_signature(message)

    # Layer 5: Verify recipient (is this message for me?)
    if message["to"] != my_identity:
        raise InvalidMessageError("Message not addressed to me")

    # Now safe to process
    return handle_message(message)
```

### Size Limits

**Enforce size limits to prevent DoS:**

```python
# HTTP server config
MAX_REQUEST_SIZE = 10 * 1024 * 1024  # 10 MB

@app.before_request
def check_content_length():
    if request.content_length > MAX_REQUEST_SIZE:
        abort(413, "Request too large")

# Message validation
def validate_size(message):
    serialized = json.dumps(message)
    if len(serialized) > MAX_REQUEST_SIZE:
        raise PayloadTooLargeError()

    if len(message.get("payload", {})) > 1024 * 1024:  # 1 MB
        raise PayloadTooLargeError("Payload exceeds 1 MB")
```

### Constraint Validation

**Validate all fields according to [constraints.md](constraints.md):**

```python
import re

def validate_message_id(msg_id):
    if not isinstance(msg_id, str):
        raise ValidationError("id must be string")
    if not (1 <= len(msg_id) <= 128):
        raise ValidationError("id length must be 1-128")
    if not re.match(r'^[a-zA-Z0-9_-]+$', msg_id):
        raise ValidationError("id contains invalid characters")

def validate_p2tr_address(address):
    if not isinstance(address, str):
        raise ValidationError("address must be string")
    if len(address) != 62:
        raise ValidationError("P2TR address must be 62 chars")
    if not (address.startswith("bc1p") or address.startswith("tb1p")):
        raise ValidationError("Invalid P2TR prefix")

    # Verify bech32m checksum
    try:
        decoded = bech32m.decode(address)
        if decoded.words[0] != 1:  # witness version
            raise ValidationError("Invalid witness version")
    except Exception:
        raise ValidationError("Invalid bech32m checksum")
```

## Rate Limiting

### Implement Rate Limits

**Protect against DoS attacks:**

```python
from collections import defaultdict
from time import time

class RateLimiter:
    def __init__(self, max_requests=60, window=60):
        self.max_requests = max_requests
        self.window = window  # seconds
        self.requests = defaultdict(list)  # {identity: [timestamps]}

    def check_limit(self, identity):
        now = time()

        # Clean old entries
        self.requests[identity] = [
            ts for ts in self.requests[identity]
            if now - ts < self.window
        ]

        # Check limit
        if len(self.requests[identity]) >= self.max_requests:
            raise RateLimitExceededError(
                f"Rate limit: {self.max_requests} requests per {self.window}s"
            )

        # Track this request
        self.requests[identity].append(now)

# Usage
rate_limiter = RateLimiter(max_requests=60, window=60)

@app.post("/snap")
def handle_request(request):
    message = parse_message(request)

    # Rate limit by sender identity
    rate_limiter.check_limit(message["from"])

    return process_message(message)
```

**Rate limit tiers:**
```
Unknown agents:     10 req/min
Known agents:       60 req/min
Trusted agents:    300 req/min
```

## Trust Management

### Allowlist Approach

**Maintain an allowlist of trusted agents:**

```python
class TrustManager:
    def __init__(self):
        self.trusted_agents = set()  # {P2TR addresses}
        self.blocked_agents = set()

    def is_trusted(self, identity):
        if identity in self.blocked_agents:
            return False
        return identity in self.trusted_agents

    def add_trusted(self, identity, verify_domain=True):
        if verify_domain:
            # Verify domain ownership via DNS TXT record
            if not self.verify_domain_ownership(identity):
                raise TrustError("Domain verification failed")

        self.trusted_agents.add(identity)

    def verify_domain_ownership(self, identity):
        # Get agent card
        agent_card = discover_agent(identity)

        if "trust" not in agent_card or "domain" not in agent_card["trust"]:
            return False

        domain = agent_card["trust"]["domain"]

        # Query DNS TXT record for _snap.<domain>
        txt_records = dns.resolve(f"_snap.{domain}", "TXT")

        for record in txt_records:
            if record.startswith("snap=") and record[5:] == identity:
                return True

        return False
```

### Reputation Tracking

**Track agent behavior (application-specific):**

```python
class ReputationTracker:
    def __init__(self):
        self.scores = {}  # {identity: score}

    def record_success(self, identity):
        self.scores[identity] = self.scores.get(identity, 0) + 1

    def record_failure(self, identity):
        self.scores[identity] = self.scores.get(identity, 0) - 5

    def get_score(self, identity):
        return self.scores.get(identity, 0)

    def is_reputable(self, identity, threshold=10):
        return self.get_score(identity) >= threshold
```

## Monitoring & Logging

### Security Logging

**Log security-relevant events:**

```python
import logging

security_logger = logging.getLogger("security")

# Log authentication failures
def verify_signature(message):
    try:
        # ... verification logic ...
        security_logger.info(
            f"Signature verified: from={message['from']}, id={message['id']}"
        )
        return True
    except SignatureError as e:
        security_logger.warning(
            f"Signature verification failed: from={message['from']}, "
            f"id={message['id']}, error={str(e)}"
        )
        raise

# Log rate limiting
def check_rate_limit(identity):
    try:
        rate_limiter.check_limit(identity)
    except RateLimitExceededError:
        security_logger.warning(
            f"Rate limit exceeded: identity={identity}"
        )
        raise

# Log replay attempts
def check_duplicate(msg_id, from_addr):
    if is_duplicate(msg_id, from_addr):
        security_logger.warning(
            f"Replay attack detected: from={from_addr}, id={msg_id}"
        )
        raise DuplicateMessageError()
```

**What to log:**
- Authentication failures (signature, timestamp)
- Rate limit violations
- Replay attempts
- Malformed requests
- Suspicious patterns

**What NOT to log:**
- Private keys
- Full message payloads (may contain sensitive data)
- User personal information

### Monitoring Metrics

**Track these metrics:**

```
- Request rate per identity
- Signature verification failures
- Timestamp expired errors
- Duplicate message attempts
- Average response time
- Error rate by type
```

## Incident Response

### Compromised Key Response

**If your private key is compromised:**

```
1. IMMEDIATELY stop using the compromised identity
2. Generate new identity
3. Publish new Agent Card with new identity
4. Update DNS TXT record (if domain-verified)
5. Notify users/partners via out-of-band channels
6. Post-mortem: How was the key compromised?
```

### Suspicious Activity

**If you detect suspicious activity:**

```
1. Block the suspicious identity temporarily
2. Review logs for patterns
3. Check if other agents are affected
4. Report to community (GitHub issue) if protocol-level issue
5. Update your allowlist/blocklist
```

## Security Checklist

### Development Phase
- [ ] Private keys never in source code
- [ ] All inputs validated (structure, types, constraints)
- [ ] Signature verification implemented correctly
- [ ] Timestamp validation implemented
- [ ] Replay protection implemented
- [ ] Rate limiting implemented
- [ ] Security logging enabled
- [ ] Error messages don't leak sensitive info

### Pre-Production
- [ ] Security audit completed
- [ ] Keys stored in HSM or secure key store
- [ ] TLS certificates valid and properly configured
- [ ] HTTPS enforced (HSTS enabled)
- [ ] Rate limits tuned
- [ ] Monitoring and alerting configured
- [ ] Incident response plan documented
- [ ] Backup and recovery procedures tested

### Production
- [ ] Private keys secured in HSM
- [ ] HTTPS only (no HTTP endpoints)
- [ ] All validations active
- [ ] Rate limiting active
- [ ] Monitoring dashboards reviewed daily
- [ ] Security logs retained for audit
- [ ] Regular security updates applied
- [ ] Key backup verified and accessible

## Additional Resources

- [authentication.md](authentication.md) - Signature verification details
- [constraints.md](constraints.md) - Validation rules
- [errors.md](errors.md) - Error codes
- [implementation-guide.md](implementation-guide.md) - Implementation steps

## Reporting Security Issues

**Found a security vulnerability?**

1. **Do NOT** open a public GitHub issue
2. Email: [Insert security contact email]
3. Include: Description, impact, reproduction steps
4. Allow 90 days for fix before public disclosure

See [CONTRIBUTING.md](../CONTRIBUTING.md) for general contribution guidelines.
