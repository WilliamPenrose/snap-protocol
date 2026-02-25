# Use Cases & Design Thinking

As AI agents become our digital proxies — booking flights, managing subscriptions, negotiating prices on our behalf — one question keeps coming up: *how does an agent prove who it is?*

Today's answer is API keys. Your agent collects a secret credential from every service it talks to. This works, until it doesn't. If you've ever had to rotate an OpenAI key after a GitHub leak, imagine multiplying that by every service your agent touches.

SNAP takes a different approach: agents generate their own identity, and services choose whether to trust them. No shared secrets. No registration flows. This document explores why that matters.

## Part 1: Design Thinking

### The Shared Secret Problem

Imagine William has a personal assistant agent — let's call it Biscuit. William wants Biscuit to do things on his behalf: check prices, book restaurants, manage subscriptions. To interact with each service, Biscuit needs credentials.

In the traditional API key model, every service gives Biscuit a private key:

```text
William's agent "Biscuit" carries:
  - Shopping API key:     sk-a8f3...  (shared secret with Shop A)
  - Restaurant API key:   sk-72b1...  (shared secret with Restaurant B)
  - Calendar API key:     sk-e4d9...  (shared secret with Calendar C)
  - Social media API key: sk-1fc7...  (shared secret with Platform D)
  - ... and more for every service Biscuit interacts with
```

This works — until Biscuit is compromised.

Maybe William's server is hacked. Maybe the device running Biscuit is lost. Now William faces a cascade:

1. Every API key Biscuit carried is potentially leaked
2. William must go to **every platform**, one by one, to revoke and regenerate keys
3. He must then configure a new agent with all the fresh keys
4. Any service he forgets to rotate is still exposed

The problem isn't that Biscuit was compromised — things get compromised. The problem is that **every service relationship was a shared secret**. Losing one agent means losing them all.

### Identity Without Shared Secrets

SNAP takes a different approach. Instead of collecting a secret from each service, Biscuit has **one identity** — a Bitcoin P2TR address:

```text
William's agent "Biscuit":
  - Identity: bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8
  - Private key: (stays with Biscuit, never shared with anyone)
```

When Biscuit talks to a service, it doesn't present a shared secret. It **signs** its messages with its private key, and the service verifies the signature against Biscuit's public address. The service never receives or stores a secret that could be used to impersonate Biscuit.

Now if Biscuit is compromised:

1. William generates a new agent with a new address
2. Services that trusted the old address simply stop trusting it
3. No secret rotation needed — there were no shared secrets to rotate
4. The compromised key can sign as the old identity, but cannot access any service that updates its trust list

The shift is subtle but fundamental:

|   | API Key Model | SNAP Model |
| - | ------------- | ---------- |
| Who creates the credential? | The service | The agent itself |
| What is shared? | A secret both sides know | A public address anyone can know |
| Compromise impact | Must rotate at every service | Revoke one identity, issue a new one |
| Relationship model | "You have an account here" | "I know who you are, I choose to trust you" |

### Zero-Registration Interaction

Because identity is self-generated, there's no signup step. An agent generates a key pair, derives its P2TR address, and starts communicating. The first message **is** the introduction.

A service agent decides whether to respond based on its own policy — open access, allowlist, payment verification, or referral from a trusted party. The point is: the decision to interact doesn't require a registration flow.

This matters for agents more than it does for humans. A human can click "Sign in with Google" once and forget about it. But an agent that needs to interact with 50 services can't navigate 50 different OAuth flows. With SNAP, an agent generates one address and talks to all of them.

### Trust by Referral

When services don't use shared secrets, a new pattern becomes possible: **third-party referral**.

```text
William subscribes to a Platform Agent (P).
P offers premium features through specialist agents (S1, S2, S3).

Traditional: William registers with P, then separately with S1, S2, S3.
             Each gives him an API key. Four shared secrets to manage.

SNAP:        William's agent has one identity (bc1p...).
             P tells S1: "Trust bc1p..., this is a paying user of mine."
             S1 serves William's agent without any registration.
```

William never directly registers with S1. P vouches for William's agent. If William stops paying P, P revokes the referral. S1 doesn't need to manage William's credentials at all.

This works because identity is **verifiable without being secret**. S1 can confirm that the agent claiming to be `bc1p...` really is `bc1p...` by checking the signature. No API key exchange needed between William and S1.

### Key Protection in Practice

The previous sections show that SNAP eliminates shared secrets between parties. But the agent's own private key is still a single point of failure. If an attacker obtains the private key, they can impersonate that identity — and because the cryptographic derivation is one-way deterministic, possessing the key is enough to identify and act as the agent.

This is an honest trade-off: SNAP reduces the blast radius from N shared secrets to 1 private key. Protecting that one key is critical.

| Method | How it works | Best for |
| ------ | ------------ | -------- |
| Runtime injection | Key entered at startup, lives only in memory, never written to disk | Personal servers, dev setups |
| Encrypted storage | Key encrypted with password at rest; decrypted into memory on startup | Personal use baseline |
| [Remote signing](https://nips.nostr.com/46) | Key stays on dedicated signer device; app sends unsigned messages, signer returns signatures | High-security setups |
| [Threshold signing (FROST)](https://eprint.iacr.org/2020/852) | Key split into N shares; M-of-N must collaborate to sign; key never assembled | Enterprise, multi-party |
| HSM / Secure Enclave | Key generated inside tamper-resistant hardware; never leaves the chip | Maximum security |

**If all else fails:** the agent cannot recover on its own. The owner (William) must step in — re-authenticate with each service through out-of-band means and update the trusted address to a new agent. This is the fallback, not the plan.

The protocol is agnostic to which approach you use. All of them produce valid SNAP identities and signed messages.

### The Key Management Challenge

Self-sovereign identity has a well-known UX problem: users must manage private keys. Most people don't want to think about cryptographic keys.

SNAP is transparent to different solutions:

**Custodial approach.** A service (mobile app, web platform) generates and stores the key on the user's behalf. The user logs in with email/password or biometrics. This is the "Google login" equivalent — convenient, but the custodian holds the key.

**Device-bound keys.** Passkeys or secure enclaves hold the private key on the user's device. Biometric authentication unlocks signing. The user never sees a hex string.

**Progressive disclosure.** The app shows "Your Agent ID: Biscuit" on day one. Weeks later, in settings: "Export your identity backup." The underlying key pair exists from the start, but the user encounters it only when ready.

The protocol doesn't prescribe which approach to use. All three produce valid SNAP identities and signed messages. The difference is who holds the private key and how it's protected — a product decision, not a protocol decision.

---

## Part 2: Integrating with OpenClaw

[OpenClaw](https://openclaw.ai/) is one of the most popular personal AI agents today. It connects to your apps — calendar, email, GitHub — and acts on your behalf. By integrating SNAP, OpenClaw gains two capabilities: interoperating with other agents, and accepting connections from any app you build.

### The Big Picture

```text
                         ┌─────────────────────┐
  Your wife's app ──────→│                     │
  Your kid's app ───────→│   Public Relay      │←─── Your OpenClaw
  Your menubar app ─────→│                     │     (Mac Mini at home)
  Your dashboard app ───→│                     │
                         └─────────────────────┘
                                  ↑
                          All use SNAP protocol
```

One OpenClaw, multiple entry points. No public IP required. No per-app configuration.

### Scenario 1: Family Sharing

You have OpenClaw running at home. Your wife wants to ask it "What's on the calendar today?" Your kid wants to ask "What was that restaurant Dad mentioned?"

**The problem today:**

- OpenClaw is single-user by default
- Sharing means sharing your account — full access to everything
- Or you deploy separate instances — but then memories aren't shared

**With SNAP:**

- Your wife has her own identity (think of it like her own Passkey)
- Your kid has their own identity
- You configure OpenClaw: "These identities are authorized family members"
- Each person uses their own app, signs with their own key
- OpenClaw can enforce different permissions: kid can ask questions but can't modify the calendar

```text
Your OpenClaw config:
  owner: bc1p_you...      → full access
  family:
    - bc1p_wife...        → read calendar, send messages
    - bc1p_kid...         → read-only, no sensitive data
```

No shared passwords. No account handoff. Permissions are cryptographically enforced.

### Scenario 2: Multiple Apps, One Agent

You're a vibe coder. You use [Onspace.ai](https://onspace.ai/) to build apps without writing backend code. You've made:
- A macOS menubar quick-launcher
- An iPad family dashboard
- A workout logging app

All of these want to talk to your OpenClaw.

**The problem today:**

- Each app needs to connect to OpenClaw somehow
- OpenClaw runs on your home Mac Mini — no public IP
- You'd need ngrok, or a relay server, or Telegram as middleware
- Each app needs its own auth configuration

**With SNAP:**

- All your apps use your same identity
- They send signed messages to a public relay
- OpenClaw subscribes to that relay (outbound connection, no public IP needed)
- Add a new app? It just works. No OpenClaw-side changes.

In Onspace.ai, connecting to OpenClaw becomes:

1. Add a "send HTTP request" action pointing to the relay
2. Sign the message (Passkey prompt)
3. Done

No backend. No ngrok. No waiting for Onspace to ship an OpenClaw plugin.

### Why This Works Without Public IP

Traditional approach:

```text
Your App → needs to reach → OpenClaw
                              ↑
                      But OpenClaw has no public address
```

SNAP approach:

```text
Your App → pushes to → Relay ← subscribes ← OpenClaw
                                              ↑
                                    Outbound connection only
```

OpenClaw connects *out* to the relay and listens. Your apps push *to* the relay. The relay is the rendezvous point. Your home network never needs to accept inbound connections — no exposed ports, no attack surface.

### Compared to Telegram

You could use Telegram as the communication channel. Many OpenClaw users do. Here's the trade-off:

|   | Telegram | SNAP + Relay |
| - | -------- | ------------ |
| Setup | Easy — everyone has Telegram | Need relay URL and identity setup |
| Multi-user | Each person needs Telegram account | Each person has their own SNAP identity |
| Multi-app | All apps go through Telegram | Any app can connect directly |
| Permissions | Coarse-grained | Fine-grained per identity |
| Dependency | Telegram's servers | Relay (can self-host) |
| Works offline | Telegram stores messages | Relay stores messages |
| Command auth | Session-based | Cryptographic signature |

Telegram is simpler to start. SNAP is more flexible as your setup grows.

### OpenClaw Calling Other Agents

The scenarios above are about *reaching* your OpenClaw. But SNAP also enables OpenClaw to *call out* to other agents.

```text
You: "Find me a restaurant nearby and book a table for tonight"

OpenClaw (bc1p_claw...) → Restaurant Discovery Agent: "What's available?"
Restaurant Agent → OpenClaw: [list of options]
OpenClaw → You: "I found three options. Which one?"
You: "The second one, 7pm"
OpenClaw → Restaurant Booking Agent: "Book table for bc1p_you..., 7pm"
Booking Agent → OpenClaw: "Confirmed"
```

OpenClaw uses its own SNAP identity to talk to other agents. No API keys collected. No per-service registration. If the restaurant agent requires user confirmation, you sign that specific request — OpenClaw facilitates, but the booking is cryptographically tied to *your* identity.

---

## Part 3: Agent-to-Service Authentication

Not every interaction is between two agents. Sometimes an agent needs to **authenticate to a plain HTTP service** — an API server, an MCP endpoint, a database gateway. The service doesn't have its own P2TR identity; it just needs to know *who* is calling.

### The Problem

Traditional API authentication requires shared secrets:

```text
Agent → HTTP Service
  Authorization: Bearer sk-abc123...
```

The service issued `sk-abc123` to the agent. If the agent is compromised, that key must be rotated at the service. If the agent talks to 50 services, 50 keys must be rotated.

### SNAP's Solution: Signed Requests Without `to`

With SNAP, the agent sends a self-authenticating message. The `to` field is omitted — the service doesn't have a P2TR address:

```json
{
  "id": "svc-001",
  "version": "0.1",
  "from": "bc1p...agent",
  "type": "request",
  "method": "service/call",
  "payload": {
    "name": "query_database",
    "arguments": { "sql": "SELECT * FROM users LIMIT 10" }
  },
  "timestamp": 1770163200,
  "sig": "a1b2c3d4..."
}
```

The service validates the signature (proving the sender controls the private key behind `bc1p...agent`) and checks an allowlist:

```python
# Server-side — no private key, no SnapAgent needed
message = parse_json(request.body)
validate_signature(message)            # Schnorr verification
if message["from"] not in allowlist:
    return 403, "Unauthorized"
# Process the request...
```

### Why This Matters

| Aspect | API Key | SNAP Agent-to-Service |
| ------ | ------- | --------------------- |
| Credential type | Shared secret | Self-sovereign signature |
| Issued by | The service | The agent itself |
| Compromise impact | Rotate at each service | Revoke one identity |
| Service-side storage | Must store/hash each key | Just an allowlist of addresses |
| Registration required | Yes | No |

This is the same identity the agent uses for agent-to-agent communication. One key pair, every interaction.

---

## Next Steps

- **Technical details:** [Transport](transport.md), [Authentication](authentication.md), [Discovery](discovery.md)
- **Reference implementation:** [`implementations/typescript/`](../implementations/typescript/)
- **Project overview:** [README](../README.md)
