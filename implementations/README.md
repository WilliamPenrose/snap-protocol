# Reference Implementations

This directory contains reference implementations of the SNAP Protocol in multiple languages.

## Available Implementations

| Language | Status | Directory | Package |
|----------|--------|-----------|---------|
| TypeScript | 📋 Planned | [typescript/](typescript/) | `@snap-protocol/core` |
| Python | 📋 Planned | [python/](python/) | `snap-protocol` |

## Implementation Status

### v0.1 (Current)
- ❌ No implementations yet
- Focus is on stabilizing the specification

### v0.5 (Planned)
- 🚧 Experimental implementations begin
- TypeScript and Python implementations

### v0.9 (Planned)
- ✅ Production-ready reference implementations
- Full compliance with test vectors

## Choosing an Implementation

**For production use:**
- Wait for v1.0 stable release
- Use official reference implementations
- Ensure implementations pass all compliance tests

**For development/experimentation:**
- Use v0.5+ implementations
- Be prepared for breaking changes
- Test against test vectors regularly

## Implementation Requirements

All reference implementations MUST:

1. **Spec Compliance**
   - Implement all required features from the specification
   - Pass all test vectors
   - Handle all error codes appropriately

2. **Security**
   - Verify all signatures before processing
   - Implement timestamp validation
   - Implement replay protection (message deduplication)
   - Use secure random number generation

3. **Validation**
   - Validate all fields according to [constraints.md](../docs/constraints.md)
   - Reject invalid messages with appropriate errors
   - Support JSON Schema validation

4. **Transport**
   - HTTP transport (required)
   - WebSocket transport (optional)
   - Nostr transport (optional)

5. **Documentation**
   - API documentation
   - Usage examples
   - Integration guide

## Community Implementations

Community implementations in other languages are welcome! Please:

1. Follow the specification in [../docs/](../docs/)
2. Pass all test vectors
3. Document your implementation
4. Submit a PR to list it here

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to reference implementations.

## License

Reference implementations are released under the [MIT License](../LICENSE).
