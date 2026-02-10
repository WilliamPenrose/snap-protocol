# SNAP Protocol Skills

Agent Skills for building SNAP-compatible tools and agents.

| Skill | Description |
|-------|-------------|
| [snap-protocol](../.claude/skills/snap-protocol/) | Build agents, send messages, publish Agent Cards |

## Usage

```bash
# 1. Create your project
mkdir my-snap-tool && cd my-snap-tool
npm init -y

# 2. Install the SDK
npm install @snap-protocol/core

# 3. Copy the skill into your project (Claude Code convention)
mkdir -p .claude/skills
cp -r path/to/snap-protocol/.claude/skills/snap-protocol .claude/skills/
```

Your project structure should look like:

```text
my-snap-tool/
├── .claude/
│   └── skills/
│       └── snap-protocol/
│           ├── SKILL.md
│           └── references/
├── package.json
└── src/
```

Claude Code will automatically discover and load skills from `.claude/skills/`.

Compatible with Claude Code, Cursor, Gemini CLI, VS Code, and other [Agent Skills](https://agentskills.io)-compatible tools.
