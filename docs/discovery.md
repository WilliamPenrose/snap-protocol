# Discovery

SNAP uses **Nostr** for decentralized agent discovery. Agents publish their capabilities to Nostr relays, and other agents query relays to find them.

## Nostr Event Types

SNAP uses three Nostr event kinds:

| Kind | Purpose | Range | NIP Reference |
|------|---------|-------|---------------|
| 31337 | Agent Card (replaceable) | 30000-39999 (addressable replaceable) | [NIP-33](https://github.com/nostr-protocol/nips/blob/master/33.md) |
| 21339 | Ephemeral SNAP message (default) | 20000-29999 (ephemeral) | [NIP-16](https://github.com/nostr-protocol/nips/blob/master/16.md) |
| 4339 | Storable SNAP message (persist) | 1000-9999 (regular / storable) | [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) |

### Kind Number Selection

- **31337** — Addressable replaceable event range (30000-39999). Relay keeps only the latest card per `kind + pubkey + d-tag`.
- **21339** — Ephemeral event range (20000-29999). Relay forwards but does not store. Default for real-time `send()`.
- **4339** — Regular event range (1000-9999). Relay stores events, enabling offline message retrieval. Used when `persist: true` is set. Use [NIP-40](https://github.com/nostr-protocol/nips/blob/master/40.md) `expiration` tag to limit storage lifetime.

**Note**: These numbers are not yet registered with the Nostr community. They do not conflict with any known NIP as of v0.1. Future versions may register official kind numbers via a NIP proposal.

## Tag Usage

| Tag | Format | Why | Reference |
|-----|--------|-----|-----------|
| `d` | P2TR address | SNAP-defined identifier for replaceable events | [NIP-33](https://github.com/nostr-protocol/nips/blob/master/33.md) |
| `p` | Hex pubkey | Nostr message routing (protocol requirement) | [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) |

## Key Encoding

The same private key derives both formats, but they use **different keys** due to the BIP-341 taproot tweak:

```
Private Key (32 bytes)
    │
    ├─→ Internal Key (P)  ─→ hex (Nostr) : a3b9e108d8f7c2b1...
    │
    └─→ Internal Key (P)  ─→ Taproot Tweak ─→ Output Key (Q) ─→ P2TR (SNAP) : bc1p...
```

**Important**: The Nostr hex pubkey is the **internal key** (P). The P2TR address encodes the **tweaked output key** (Q). These are different keys. The tweak is irreversible — you cannot derive the internal key from the P2TR address.

Conversion functions:

```javascript
import { bech32m } from 'bech32';
import { schnorr } from '@noble/curves/secp256k1';

// Internal Key (hex) → P2TR address (applies taproot tweak)
function internalKeyToP2tr(internalKeyHex) {
  const pubBytes = Buffer.from(internalKeyHex, 'hex');
  const tweakedKey = taprootTweak(pubBytes);  // BIP-341 tweak
  const words = bech32m.toWords(tweakedKey);
  return bech32m.encode('bc', [1, ...words]); // witness version 1
}

// P2TR → tweaked output key (hex). NOT the internal/Nostr key!
function p2trToTweakedKey(p2tr) {
  const { words } = bech32m.decode(p2tr);
  return Buffer.from(bech32m.fromWords(words.slice(1))).toString('hex');
}
```

**Note**: `p2trToTweakedKey()` returns the tweaked output key Q, not the internal key P. There is no way to reverse the tweak. To map a P2TR address back to a Nostr pubkey, cache the mapping during agent discovery.

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Agent A                 Nostr Relays              Agent B     │
│                                                                 │
│   ┌─────────┐            ┌──────────┐            ┌─────────┐   │
│   │         │  publish   │          │   query    │         │   │
│   │ bc1p... │ ─────────→ │  relay1  │ ←───────── │ bc1p... │   │
│   │         │            │  relay2  │            │         │   │
│   └─────────┘            │  relay3  │            └─────────┘   │
│                          └──────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Publishing an Agent Card

Agents publish their card as a Nostr event with kind `31337`:

```json
{
  "kind": 31337,
  "pubkey": "a3b9e108d8f7c2b1e9f8a7d6c5b4a3e2d1c0b9a8...",
  "created_at": 1770163200,
  "tags": [
    ["d", "bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0z..."],
    ["name", "Code Assistant"],
    ["version", "1.0.0"],
    ["skill", "code-generation", "Code Generation"],
    ["skill", "code-review", "Code Review"],
    ["skill", "bug-fix", "Bug Fix"],
    ["endpoint", "http", "https://agent.example.com/snap"],
    ["endpoint", "wss", "wss://agent.example.com/snap"],
    ["relay", "wss://relay.damus.io"]
  ],
  "content": "{\"name\":\"Code Assistant\",\"description\":\"...\"}",
  "sig": "nostr-event-signature..."
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

The `content` field contains the full Agent Card JSON.

## Querying for Agents

### By Skill

Find agents that can do code generation:

```json
{
  "kinds": [31337],
  "#skill": ["code-generation"]
}
```

### By Multiple Skills

Find agents that have all specified skills:

```json
{
  "kinds": [31337],
  "#skill": ["code-generation", "typescript"]
}
```

### By Identity

Find a specific agent:

```json
{
  "kinds": [31337],
  "#d": ["bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0z..."]
}
```

### By Name (Prefix Search)

Some relays support [NIP-50](https://github.com/nostr-protocol/nips/blob/master/50.md) search:

```json
{
  "kinds": [31337],
  "search": "Code"
}
```

## Key Derivation

The same private key derives both the P2TR address and the Nostr pubkey, but through different paths:

```
Private Key
    │
    ├──→ Internal Key (P) ──→ Taproot Tweak ──→ Output Key (Q) ──→ P2TR Address (bc1p...)
    │
    └──→ Internal Key (P) ──→ Nostr Pubkey (hex)
```

This means:
- `d` tag contains the P2TR address (encodes the tweaked output key Q)
- `pubkey` is the internal key P in hex format (different from Q)
- The agent controls both identities via the same private key
- Clients can compute `P2TR = internalKeyToP2tr(event.pubkey)` to verify the mapping

## Relays

Agents should publish to multiple relays for reliability:

```javascript
const relays = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol'
];

for (const relay of relays) {
  await publishEvent(relay, agentCardEvent);
}
```

Clients should query multiple relays and deduplicate results.

## Updating an Agent Card

To update your card, publish a new event with the same `d` tag. Relays will keep only the latest version (replaceable events per [NIP-33](https://github.com/nostr-protocol/nips/blob/master/33.md)).

```javascript
// Update endpoints
agentCard.endpoints = [
  { protocol: 'http', url: 'https://new-endpoint.example.com/snap' }
];
agentCard.created_at = Math.floor(Date.now() / 1000);

// Re-sign and publish
const event = createNostrEvent(agentCard);
await publishToRelays(event);
```

## Offline Inbox

Only storable SNAP message events (kind `4339`, sent with `persist: true`) are stored by relays. Agents can retrieve these messages when they come back online.

Note: The `p` tag requires **hex pubkey** (Nostr protocol requirement), not P2TR address. Use the conversion functions above.

```json
{
  "kind": 4339,
  "pubkey": "a3b9e108d8f7c2b1...",
  "created_at": 1770163200,
  "tags": [
    ["p", "b4c2d3e5f6a7b8c9..."],
    ["expiration", "1738713600"]
  ],
  "content": "<NIP-44 encrypted SNAP message>",
  "sig": "..."
}
```

The `content` is encrypted using [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md). The `expiration` tag ([NIP-40](https://github.com/nostr-protocol/nips/blob/master/40.md)) tells relays to discard the event after the given timestamp, preventing indefinite storage.

When an agent comes online:

```javascript
// Query for messages received while offline
const filter = {
  kinds: [4339],
  '#p': [myPubkey],
  since: lastOnlineTimestamp
};

relay.subscribe(filter, handleOfflineMessage);
```

## Recommended Relays

For SNAP-specific discovery, we recommend these relays (subject to change):

```javascript
const snapRelays = [
  'wss://relay.damus.io',
  'wss://relay.nostr.band',
  'wss://nos.lol',
  'wss://relay.primal.net'
];
```

## Well-Known URL Discovery

In addition to Nostr-based discovery, SNAP agents with HTTP endpoints can serve their Agent Card at a well-known URL, following [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) conventions.

### Endpoint

```text
GET /.well-known/snap-agent.json
```

### Response Format

The response is a `SignedAgentCard` — the Agent Card wrapped with a Schnorr signature for verifiability:

```json
{
  "card": {
    "name": "Code Assistant",
    "description": "An AI agent that helps with code generation and review",
    "version": "1.0.0",
    "identity": "bc1pmfr3p9j00pfxjh0zmgp99y8zftmd3s5pmedqhyptwy6lm87hf5sspknck9",
    "skills": [
      {
        "id": "code-generation",
        "name": "Code Generation",
        "description": "Generate code from natural language",
        "tags": ["code"]
      },
      {
        "id": "code-review",
        "name": "Code Review",
        "description": "Review code for bugs and improvements",
        "tags": ["code"]
      }
    ],
    "defaultInputModes": ["text/plain"],
    "defaultOutputModes": ["text/plain"]
  },
  "sig": "eec2fc8876050b0258721e77146c760e219c56a0f3688f12b58ceeb4070b6e07fa80e6accb318aa5aa0a940b649afd124dfc299339b2ecef504717b4321dd95f",
  "publicKey": "da4710964f7852695de2da025290e24af6d8c281de5a0b902b7135fd9fd74d21",
  "timestamp": 1770622297
}
```

| Field       | Type   | Description                                          |
|-------------|--------|------------------------------------------------------|
| `card`      | object | The full Agent Card                                  |
| `sig`       | string | Schnorr signature (128 hex chars)                    |
| `publicKey` | string | x-only tweaked public key (64 hex chars)             |
| `timestamp` | number | Unix seconds when signed                             |

### Signature Verification

Clients MUST verify the signature before trusting the card:

1. Canonicalize the card JSON per [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) (JCS)
2. Build signature input: `canonicalize(card) + "|" + timestamp`
3. SHA-256 hash the UTF-8 encoded input
4. Verify the Schnorr signature against the hash and `publicKey`
5. Verify that `publicKey` matches `p2trToPublicKey(card.identity)`

### SDK Usage

```typescript
// Server: automatically served when using HttpTransport with SnapAgent
const agent = new SnapAgent({ privateKey, card })
  .transport(new HttpTransport({ port: 3000 }));
await agent.start(); // serves card at GET /.well-known/snap-agent.json

// Client: discover an agent by URL
const card = await HttpTransport.discoverViaHttp('https://agent.example.com');
```

### When to Use

| Method          | Best for                                               |
|-----------------|--------------------------------------------------------|
| Nostr discovery | Finding agents by skill, decentralized search          |
| Well-Known URL  | Fetching a known agent's card, domain-anchored trust   |

## Privacy Considerations

**Public by default:** Agent Cards on Nostr are public. Anyone can see:
- Your agent's name and description
- Skills and capabilities
- Transport endpoints

**Private messaging:** Use [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md) encryption for direct messages between agents.

**Pseudonymity:** P2TR addresses don't reveal real-world identity, but behavior patterns may be linkable.

## Next Steps

- [Agent Card](agent-card.md) — Full Agent Card specification
- [Transport](transport.md) — Using Nostr for message transport
