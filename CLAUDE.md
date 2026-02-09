# SNAP Protocol - Development Guide

Read `skills/snap-protocol/SKILL.md` for SNAP protocol reference.

## Project-Specific Resources

| What you need | Where to find it |
|---------------|------------------|
| TypeScript types | `implementations/typescript/src/types/` |
| SDK source code | `implementations/typescript/src/` |
| SDK architecture | `implementations/typescript/ARCHITECTURE.md` |
| Tests | `implementations/typescript/tests/` |
| Protocol docs | `docs/` |

## Development Commands

```bash
cd implementations/typescript
npm run build    # Build SDK
npm run test     # Run tests
npm publish --access public  # Publish to npm
```

## After Modifying `docs/`

Follow these three steps in order:

### Step 1: Update skills summary

Sync changes to the corresponding file in `skills/snap-protocol/`:

| Changed doc | Update |
|-------------|--------|
| `docs/errors.md` | `skills/snap-protocol/references/error-codes.md` |
| `docs/messages.md` | `skills/snap-protocol/SKILL.md` (methods, states) |
| `docs/agent-card.md` | `skills/snap-protocol/SKILL.md` (Agent Card section) |
| `docs/constraints.md` | `skills/snap-protocol/references/constraints.md` |
| `docs/authentication.md` | `skills/snap-protocol/SKILL.md` (signing section) |
| `docs/transport.md` | `skills/snap-protocol/references/nostr-transport.md` |

### Step 2: Check code consistency

Compare `skills/snap-protocol/` against TypeScript implementation:

| Skills reference | Code to check |
|------------------|---------------|
| `references/error-codes.md` | `src/types/errors.ts`, `src/errors/SnapError.ts` |
| `SKILL.md` method names | `src/types/messages.ts` |
| `SKILL.md` state transitions | `src/types/task.ts` |
| `SKILL.md` Agent Card fields | `src/types/agent-card.ts` |
| `references/constraints.md` | `src/messaging/MessageValidator.ts` |

### Step 3: Build and test

```bash
cd implementations/typescript
npm run build && npm run test
```

## Default Infrastructure

- **Nostr relay**: `wss://snap.onspace.ai`
- **npm package**: `@snap-protocol/core`
- **Network**: mainnet (`bc1p...`), testnet (`tb1p...`)
