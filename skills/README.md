# SNAP Protocol Skills

Agent Skills for building SNAP-compatible tools and agents.

| Skill | Description |
|-------|-------------|
| [snap-protocol](snap-protocol/) | Build agents, send messages, publish Agent Cards |

## Usage

```bash
# 1. Create your project
mkdir my-snap-tool && cd my-snap-tool
npm init -y

# 2. Install the SDK
npm install @snap-protocol/core

# 3. Copy the skill into your project
mkdir -p skills
cp -r path/to/snap-protocol/skills/snap-protocol skills/
```

Your project structure should look like:

```text
my-snap-tool/
├── skills/
│   └── snap-protocol/
│       ├── SKILL.md
│       └── references/
├── package.json
└── src/
```

AI coding agents will automatically discover the skill and use SNAP protocol knowledge to help you build.

Compatible with Claude Code, Cursor, Gemini CLI, VS Code, and other [Agent Skills](https://agentskills.io)-compatible tools.
