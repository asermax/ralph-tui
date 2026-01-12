# Ralph TUI

[![npm version](https://img.shields.io/npm/v/ralph-tui.svg)](https://www.npmjs.com/package/ralph-tui)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1.svg)](https://bun.sh)

**AI Agent Loop Orchestrator** - A terminal UI for orchestrating AI coding agents to work through task lists autonomously.

Ralph TUI connects your AI coding assistant (Claude Code, OpenCode) to your task tracker (Beads, prd.json) and runs them in an autonomous loop, completing tasks one-by-one with intelligent selection, error handling, and full visibility into what's happening.

---

## Table of Contents

- [Quick Start](#quick-start)
- [What is Ralph TUI?](#what-is-ralph-tui)
- [Installation](#installation)
- [Getting Started](#getting-started)
- [CLI Commands Reference](#cli-commands-reference)
- [TUI Keyboard Shortcuts](#tui-keyboard-shortcuts)
- [Configuration](#configuration)
- [Agent & Tracker Plugins](#agent--tracker-plugins)
- [Best Practices](#best-practices)
- [How It Works](#how-it-works)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)
- [Credits](#credits)

---

## Quick Start

Choose your path based on your task tracker:

### With Beads (bd CLI)

```bash
# Install
bun install -g ralph-tui

# Run with an epic
ralph-tui run --epic my-project-epic
```

### With prd.json

```bash
# Install
bun install -g ralph-tui

# Run with a PRD file
ralph-tui run --prd ./scripts/ralph/prd.json
```

### Interactive Setup

```bash
# Run the setup wizard
ralph-tui setup

# Then launch the TUI
ralph-tui
```

---

## What is Ralph TUI?

Ralph TUI is an **AI Agent Loop Orchestrator** that automates the cycle of selecting tasks, building prompts, running AI agents, and detecting completion. Instead of manually copying task details into Claude Code or OpenCode, Ralph does it for you in a continuous loop.

**The Autonomous Loop:**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │  1. SELECT   │────▶│  2. BUILD    │────▶│  3. EXECUTE  │   │
│   │    TASK      │     │    PROMPT    │     │    AGENT     │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│          ▲                                         │            │
│          │                                         ▼            │
│   ┌──────────────┐                         ┌──────────────┐    │
│   │  5. NEXT     │◀────────────────────────│  4. DETECT   │    │
│   │    TASK      │                         │  COMPLETION  │    │
│   └──────────────┘                         └──────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Concepts:**

- **Task Tracker**: Where your tasks live (Beads issues, prd.json user stories)
- **Agent Plugin**: The AI CLI that does the work (Claude Code, OpenCode)
- **Prompt Template**: Handlebars template that turns task data into agent prompts
- **Completion Detection**: The `<promise>COMPLETE</promise>` token signals task completion
- **Session Persistence**: Pause anytime, resume later, survive crashes

---

## Installation

### Prerequisites

- **Bun** >= 1.0.0 (required - Ralph TUI uses OpenTUI which requires Bun)
- One of these AI coding agents:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (`claude` CLI)
  - [OpenCode](https://github.com/opencode-ai/opencode) (`opencode` CLI)
- One of these task trackers:
  - [Beads](https://github.com/anthropics/beads) (`.beads/` directory with `bd` CLI)
  - `prd.json` file (simple JSON-based task list)

### Install

```bash
# Install globally with Bun
bun install -g ralph-tui

# Or run directly without installing
bunx ralph-tui
```

---

## Getting Started

### Step 1: Initialize Your Project

```bash
cd your-project
ralph-tui setup
```

The interactive wizard will:
1. Detect available trackers (Beads `.beads/` directory, prd.json files)
2. Detect installed agents (Claude Code, OpenCode)
3. Create a `.ralph-tui/config.toml` configuration file
4. Optionally install the Ralph claude-code skill for better integration

### Step 2: Start Ralph

```bash
# With Beads tracker
ralph-tui run --epic your-epic-id

# With prd.json tracker
ralph-tui run --prd ./prd.json

# Or launch the interactive TUI first
ralph-tui
```

### Step 3: Watch the Progress

The TUI shows:
- **Left Panel**: Task list with status indicators
- **Right Panel**: Live agent output (stdout/stderr)
- **Header**: Current iteration, task being worked on
- **Footer**: Available keyboard shortcuts

Ralph will:
1. Select the highest-priority task with no blockers
2. Build a prompt from the task details using Handlebars templates
3. Execute your AI agent with the prompt
4. Stream output in real-time
5. Detect `<promise>COMPLETE</promise>` in the output
6. Mark the task complete and move to the next one

### Step 4: Control Execution

Press `p` to pause, `q` to quit, `d` for the dashboard, `i` for iteration history.

---

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| `ralph-tui` | Launch the interactive TUI |
| `ralph-tui run [options]` | Start Ralph execution |
| `ralph-tui resume [options]` | Resume an interrupted session |
| `ralph-tui status [options]` | Check session status (headless, for CI/scripts) |
| `ralph-tui logs [options]` | View/manage iteration output logs |
| `ralph-tui setup` | Run interactive project setup (alias: `init`) |
| `ralph-tui create-prd [options]` | Create a new PRD interactively (alias: `prd`) |
| `ralph-tui convert [options]` | Convert PRD markdown to JSON format |
| `ralph-tui config show` | Display merged configuration |
| `ralph-tui template show` | Display current prompt template |
| `ralph-tui template init` | Copy default template for customization |
| `ralph-tui plugins agents` | List available agent plugins |
| `ralph-tui plugins trackers` | List available tracker plugins |
| `ralph-tui docs [section]` | Open documentation in browser |
| `ralph-tui help` | Show help message |

### Run Options

| Option | Description |
|--------|-------------|
| `--epic <id>` | Epic ID for beads tracker |
| `--prd <path>` | PRD file path (auto-switches to json tracker) |
| `--agent <name>` | Override agent plugin (e.g., `claude`, `opencode`) |
| `--model <name>` | Override model (e.g., `opus`, `sonnet`) |
| `--tracker <name>` | Override tracker plugin (e.g., `beads`, `beads-bv`, `json`) |
| `--iterations <n>` | Maximum iterations (0 = unlimited) |
| `--delay <ms>` | Delay between iterations in milliseconds |
| `--prompt <path>` | Custom prompt template file path |
| `--output-dir <path>` | Directory for iteration logs (default: .ralph-tui/iterations) |
| `--headless` | Run without TUI (alias: `--no-tui`) |
| `--no-setup` | Skip interactive setup even if no config exists |

### Resume Options

| Option | Description |
|--------|-------------|
| `--cwd <path>` | Working directory |
| `--headless` | Run without TUI |
| `--force` | Override stale lock |

### Status Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format for CI/scripts |
| `--cwd <path>` | Working directory |

### Convert Options

| Option | Description |
|--------|-------------|
| `--to <format>` | Target format: `json` |
| `--output, -o <path>` | Output file path (default: `./prd.json`) |
| `--branch, -b <name>` | Git branch name (prompts if not provided) |
| `--force, -f` | Overwrite existing files |

### Logs Options

| Option | Description |
|--------|-------------|
| `--iteration <n>` | View specific iteration |
| `--task <id>` | View logs for a specific task |
| `--clean` | Clean up old logs |
| `--keep <n>` | Number of recent logs to keep (with `--clean`) |
| `--dry-run` | Preview cleanup without deleting |
| `--verbose` | Show full output (not truncated) |

---

## TUI Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `s` | Start execution |
| `p` | Pause/Resume execution |
| `d` | Toggle progress dashboard |
| `i` | Toggle iteration history view |
| `v` | Toggle tasks/iterations view |
| `o` | Toggle details/output in panel |
| `h` | Toggle showing closed tasks |
| `l` | Load/switch epic |
| `u` | Toggle subagent tracing panel |
| `t` | Cycle subagent tracing detail level |
| `T` (Shift+T) | Toggle subagent tree panel |
| `,` | Open settings |
| `r` | Refresh task list |
| `j` / `Down` | Move selection down |
| `k` / `Up` | Move selection up |
| `Enter` | Drill into task/iteration details |
| `Escape` | Back (from detail views) / Quit (from task list) |
| `q` | Quit |
| `?` | Show help overlay |
| `Ctrl+C` | Interrupt current agent (with confirmation) |
| `Ctrl+C` x2 | Force quit immediately |

---

## Configuration

Ralph TUI uses TOML configuration files with layered overrides:

1. **Global config**: `~/.config/ralph-tui/config.toml`
2. **Project config**: `.ralph-tui/config.toml` (in project root)
3. **CLI flags**: Override everything

### Example Configuration

```toml
# .ralph-tui/config.toml

# Default tracker and agent
tracker = "beads-bv"
agent = "claude"

# Execution limits
maxIterations = 10

# Tracker-specific options
[trackerOptions]
beadsDir = ".beads"
labels = "ralph"

# Agent-specific options
[agentOptions]
model = "opus"

# Error handling
[errorHandling]
strategy = "skip"        # retry | skip | abort
maxRetries = 3
retryDelayMs = 5000
continueOnNonZeroExit = false

# Subagent tracing detail level
# off | minimal | moderate | full
subagentTracingDetail = "full"

# Custom prompt template path (relative to project root)
# prompt_template = "./my-prompt.hbs"
```

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `tracker` | string | Default tracker plugin (`beads`, `beads-bv`, `json`) |
| `agent` | string | Default agent plugin (`claude`, `opencode`) |
| `maxIterations` | number | Maximum iterations (0 = unlimited) |
| `iterationDelay` | number | Delay in ms between iterations |
| `prompt_template` | string | Path to custom Handlebars template |
| `outputDir` | string | Output directory for iteration logs |
| `autoCommit` | boolean | Auto-commit after task completion |
| `fallbackAgents` | string[] | Fallback agents for rate limit handling |
| `rateLimitHandling` | object | Rate limit retry/fallback configuration |
| `subagentTracingDetail` | string | Subagent visibility: `off`, `minimal`, `moderate`, `full` |

---

## Agent & Tracker Plugins

### Built-in Agents

| Plugin | CLI Command | Description |
|--------|-------------|-------------|
| `claude` | `claude --print` | Claude Code CLI with streaming output |
| `opencode` | `opencode run` | OpenCode CLI |

### Built-in Trackers

| Plugin | Description | Features |
|--------|-------------|----------|
| `beads` | Beads issue tracker via `bd` CLI | Hierarchy, dependencies, labels |
| `beads-bv` | Beads + `bv` graph analysis | Intelligent selection via PageRank, critical path |
| `json` | prd.json file-based tracker | Simple JSON format, no external tools |

### Plugin Comparison Matrix

| Feature | beads | beads-bv | json |
|---------|-------|----------|------|
| External CLI | `bd` | `bd` + `bv` | None |
| Hierarchy (epics) | Yes | Yes | No |
| Dependencies | Yes | Yes | Yes |
| Priority ordering | Yes | Yes | Yes |
| Graph analysis | No | Yes | No |
| Sync with git | Yes | Yes | No |

---

## Best Practices

### 1. Use Meaningful Task Descriptions

Include clear acceptance criteria in your tasks. The more context in the prompt, the better the agent performs.

### 2. Start with Small Iterations

Set `maxIterations = 5` initially to monitor behavior before running longer sessions.

### 3. Use beads-bv for Complex Projects

If your project has many interdependent tasks, `beads-bv` uses graph analysis to prioritize tasks that unblock the most downstream work.

### 4. Customize Your Prompt Template

```bash
ralph-tui template init
# Edit .ralph-tui-prompt.hbs to match your workflow
```

### 5. Review Iteration Logs

```bash
ralph-tui logs --iteration 3
ralph-tui logs --task US-005
```

### 6. Handle Errors Gracefully

Configure error handling based on your needs:
- `retry`: For flaky operations (network issues)
- `skip`: For non-critical tasks
- `abort`: For critical workflows where any failure is unacceptable

---

## How It Works

### Execution Engine

The engine runs an iteration loop:

```
1. Get next task from tracker (respecting priority + dependencies)
2. Set task status to "in_progress"
3. Build prompt from Handlebars template + task data
4. Spawn agent process with prompt
5. Stream stdout/stderr to TUI
6. Parse output for <promise>COMPLETE</promise>
7. If complete: mark task done, move to next
8. If failed: apply error handling strategy (retry/skip/abort)
9. Repeat until no tasks remain or max iterations reached
```

### Session Persistence

Ralph saves state to `.ralph-tui-session.json`:
- Current iteration number
- Task statuses
- Iteration history
- Active task IDs (for crash recovery)

On resume, Ralph:
1. Loads the session file
2. Resets any stale "in_progress" tasks to "open"
3. Continues from where it left off

### Subagent Tracing

When using Claude Code, Ralph can trace subagent activity:
- See when Claude spawns Task, Bash, Read, Write, etc.
- Track nested agent calls
- View timing and status of each subagent

Enable with `subagentTracingDetail = "full"` and press `u` to toggle the panel.

**Keyboard shortcuts for subagent tracing:**
- Press `t` to cycle detail levels (off -> minimal -> moderate -> full)
- Press `T` (Shift+T) to toggle the subagent tree panel

### Completion Detection

The agent signals task completion by outputting:
```
<promise>COMPLETE</promise>
```

Ralph watches for this token in stdout. When detected:
1. Task is marked as completed in the tracker
2. Session state is updated
3. Next iteration begins

---

## Troubleshooting

### "No tasks available"

- Check that your epic has open tasks: `bd list --epic your-epic`
- Verify label filters in config match your tasks
- Ensure tasks aren't blocked by incomplete dependencies

### "Agent not found"

- Verify the agent CLI is installed: `which claude` or `which opencode`
- Check the agent is in your PATH
- Run `ralph-tui plugins agents` to see detected agents

### "Session lock exists"

Another Ralph instance may be running. Options:
- Wait for it to complete
- Use `ralph-tui resume --force` to override
- Manually delete `.ralph-tui-session.json`

### "Task stuck in_progress"

If Ralph crashed, tasks may be stuck:
```bash
# Resume will auto-reset stale tasks
ralph-tui resume

# Or manually reset via beads
bd update TASK-ID --status open
```

### "Agent output not streaming"

- Ensure the agent supports streaming (Claude Code does with `--print`)
- Check `subagentTracingDetail` isn't filtering output

### Logs and Debugging

```bash
# View iteration output
ralph-tui logs --iteration 5 --verbose

# Clean up old logs
ralph-tui logs --clean --keep 10

# Check session status
ralph-tui status --json
```

---

## Development

### Setup

```bash
# Clone the repo
git clone https://github.com/your-org/ralph-tui.git
cd ralph-tui

# Install dependencies
pnpm install

# Run in development mode
bun run ./src/cli.tsx

# Type check
pnpm typecheck

# Lint
pnpm lint
```

### Project Structure

```
ralph-tui/
├── src/
│   ├── cli.tsx           # CLI entry point
│   ├── commands/         # CLI commands (run, resume, status, logs, etc.)
│   ├── config/           # Configuration loading and validation (Zod schemas)
│   ├── engine/           # Execution engine (iteration loop, events)
│   ├── interruption/     # Signal handling and graceful shutdown
│   ├── logs/             # Iteration log persistence
│   ├── plugins/
│   │   ├── agents/       # Agent plugins (claude, opencode)
│   │   │   └── tracing/  # Subagent tracing parser
│   │   └── trackers/     # Tracker plugins (beads, beads-bv, json)
│   ├── session/          # Session persistence and lock management
│   ├── setup/            # Interactive setup wizard
│   ├── templates/        # Handlebars prompt templates
│   ├── chat/             # AI chat mode for PRD creation
│   ├── prd/              # PRD generation and parsing
│   └── tui/              # Terminal UI components (OpenTUI/React)
│       └── components/   # React components
```

### Key Technologies

- [Bun](https://bun.sh) - JavaScript runtime
- [OpenTUI](https://github.com/AshMartian/opentui) - Terminal UI framework
- [React](https://react.dev) - Component model for TUI
- [Handlebars](https://handlebarsjs.com) - Prompt templating
- [Zod](https://zod.dev) - Configuration validation
- [smol-toml](https://github.com/squirrelchat/smol-toml) - TOML parsing

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Credits

Ralph TUI is built with:
- [OpenTUI](https://github.com/AshMartian/opentui) - Terminal UI framework for Bun
- [Handlebars](https://handlebarsjs.com/) - Template engine
- [Zod](https://zod.dev/) - Schema validation
