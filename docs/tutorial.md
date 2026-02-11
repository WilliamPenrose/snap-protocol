# Build Your First SNAP Agent

You don't need to be an engineer to build a SNAP agent. If you have an AI coding assistant (Claude Code, Cursor, GitHub Copilot, etc.) and can write a prompt, you can build one.

This tutorial shows you how.

**What you'll build:** An agent that lives on the internet, has its own cryptographic identity, and can receive and respond to messages from other agents. No API keys, no OAuth, no central registry.

## What You Need

- [Node.js 18+](https://nodejs.org/) installed on your computer
- An AI coding assistant (Claude Code, Cursor, or similar)
- About 10 minutes

## Step 1: Set Up

Open your terminal and run:

```bash
mkdir my-agent && cd my-agent
npm init -y
npm install @snap-protocol/core
```

Then install the SNAP skill so your AI assistant knows the protocol:

```bash
npx skills add WilliamPenrose/snap-protocol
```

To enable auto-loading in Claude Code, create a symlink:

```bash
mkdir -p .claude/skills
# Linux / macOS
ln -s ../../.agents/skills/snap-protocol .claude/skills/snap-protocol
# Windows
mklink /D .claude\skills\snap-protocol .agents\skills\snap-protocol
```

Your project should look like this:

```text
my-agent/
├── .claude/skills/snap-protocol/  (symlink)
├── .agents/skills/snap-protocol/
│   ├── SKILL.md
│   └── references/
├── package.json
└── node_modules/
```

Now open this folder in your AI coding assistant.

## Step 2: Build Your Agent

Tell your AI assistant what you want. Here's a prompt you can use:

> Build a SNAP agent that runs on HTTP port 3000. When it receives a message, it should echo back whatever the caller said with a friendly greeting. Use the @snap-protocol/core SDK.

Your AI assistant will read the SNAP skill and generate something like this:

```typescript
// agent.ts
import { randomBytes } from 'crypto';
import { SnapAgent, HttpTransport, KeyManager } from '@snap-protocol/core';

const privateKey = randomBytes(32).toString('hex');
const keyPair = KeyManager.deriveKeyPair(privateKey);

const agent = new SnapAgent({
  keyPair,
  transports: [new HttpTransport({ port: 3000 })],
});

agent.handle('message/send', async (payload) => {
  const text = payload.message?.parts?.[0]?.text ?? '';
  return {
    message: {
      role: 'assistant',
      parts: [{ text: `Hey! You said: "${text}". Welcome to SNAP.` }],
    },
  };
});

await agent.listen();
console.log(`Agent running at http://localhost:3000/snap`);
console.log(`Identity: ${keyPair.address}`);
```

You don't need to write this yourself. The AI assistant generates it based on the skill knowledge.

## Step 3: Run It

```bash
npx tsx agent.ts
```

You'll see output like:

```text
Agent running at http://localhost:3000/snap
Identity: bc1p5d7rjq7g6rdk2yhzqnt9dp8wvscrplqk0zwy63lmgreu9jzyt0mqf3xvn8
```

That `bc1p...` address is your agent's identity. It generated its own cryptographic passport on startup — no registration needed.

## Step 4: Test It

Open a second terminal in the same folder. Tell your AI assistant:

> Create a second agent script that sends a "Hello!" message to my agent at localhost port 3000. The agent's address is [paste the bc1p... address from Step 3].

Run the generated script:

```bash
npx tsx requester.ts
```

You should see your agent's greeting in the response. Two agents just talked to each other with cryptographic authentication. No API keys. No OAuth.

## Step 5: Make It Do Something Useful

Now that you have a working agent, tell your AI assistant to make it smarter. Here are some prompts to try:

**A translation agent:**

> Change my agent so it translates any incoming message to Spanish using the OpenAI API. Return the translation as the response.

**A weather agent:**

> Make my agent respond with current weather data. When someone asks about a city, call a weather API and return the forecast.

**A code review agent:**

> Build an agent that accepts code in the message, reviews it for bugs, and returns suggestions.

Your AI assistant knows the SNAP protocol from the installed skill. Just describe what you want in plain English.

## Step 6: Tell the World What Your Agent Can Do

Other agents need to know your agent exists and what it's good at. Ask your AI assistant:

> Add an Agent Card to my agent that describes it as a [translation/weather/whatever] service. Include the skill name and a public endpoint URL.

The Agent Card is like a business card for your agent — it tells other agents what skills you offer and how to reach you.

## Step 7: Go Live

When you're ready to put your agent on the internet:

> Help me deploy this agent to [Vercel/Railway/a VPS]. Make sure the HTTP endpoint is publicly accessible and update the Agent Card with the real URL.

Once deployed, any SNAP agent anywhere in the world can find and talk to yours.

## Key Concepts (for the Curious)

| Concept | What it means |
| ------- | ------------- |
| **P2TR Address** | Your agent's unique identity (like `bc1p5d7...`), derived from a private key |
| **Schnorr Signature** | Every message is signed to prove who sent it |
| **Agent Card** | A profile describing what your agent can do |
| **Skill** | A capability your agent advertises (e.g., "translation", "code-review") |
| **Transport** | How agents communicate — HTTP (default), WebSocket, or Nostr |

You don't need to understand the cryptography. The SDK handles signing, verification, and identity management for you.

## What's Next

- [Use Cases](use-cases.md) — See what kinds of agents people are building
- [Core Concepts](concepts.md) — Understand the identity and discovery model
- [Implementation Guide](implementation-guide.md) — Full API reference for engineers on your team
