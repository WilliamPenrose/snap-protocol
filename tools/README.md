# SNAP Protocol Tools

This directory contains command-line tools for working with SNAP Protocol.

## Available Tools

| Tool | Description | Status |
|------|-------------|--------|
| [key-generator/](key-generator/) | Generate P2TR identities from mnemonics | 📋 Planned |
| [message-signer/](message-signer/) | Sign and verify SNAP messages | 📋 Planned |
| [card-validator/](card-validator/) | Validate Agent Cards | 📋 Planned |

## Planned Tools

### Key Generator

Generate and manage SNAP identities.

**Features:**
- Generate BIP-39 mnemonics
- Derive P2TR addresses using BIP-86
- Convert P2TR ↔ Nostr hex format
- Export public key for verification

**Usage (planned):**
```bash
# Generate new identity
snap-keygen generate --words 24

# Derive identity from mnemonic
snap-keygen derive --mnemonic "word1 word2 ..." --path "m/86'/0'/0'/0/0"

# Convert P2TR to Nostr hex
snap-keygen convert --p2tr bc1p...
```

### Message Signer

Sign and verify SNAP messages.

**Features:**
- Sign messages with private key
- Verify message signatures
- Generate canonical signature input
- Validate message structure

**Usage (planned):**
```bash
# Sign a message
snap-sign --key <private-key> --message message.json

# Verify a signature
snap-verify --message signed-message.json

# Show canonical input
snap-sign --canonical --message message.json
```

### Card Validator

Validate Agent Cards.

**Features:**
- Validate Agent Card structure
- Check field constraints
- Verify against JSON Schema
- Test Nostr publishability

**Usage (planned):**
```bash
# Validate Agent Card
snap-validate-card agent-card.json

# Publish to Nostr
snap-validate-card --publish --relays wss://relay.damus.io agent-card.json
```

## Installation (Future)

**TypeScript tools:**
```bash
npm install -g @snap-protocol/tools
```

**Python tools:**
```bash
pip install snap-protocol-tools
```

## Development Status

🚧 **v0.1**: No tools available yet
📋 **v0.5**: Tool development begins
✅ **v0.9**: Production-ready tools

## Contributing

Contributions welcome! See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## License

Tools are released under the [MIT License](../LICENSE).
