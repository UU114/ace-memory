# ace-memory

**ACE (Adaptive Context Engine)** — Claude Code self-adaptive memory plugin.

Turn Claude Code from a stateless tool into a programming assistant that learns from experience. ACE automatically captures, distills, and retrieves knowledge across sessions, injecting relevant context into every conversation.

## How It Works

```
Session Start         User Prompt          Tool Use (Edit/Write/Bash)        Session End
     |                    |                         |                            |
     v                    v                         v                            v
 Start Daemon      Keyword/Semantic          Rules Engine detects          Batch curate
 Register session  search Playbook           patterns (error fixes,        Decay update
 Recall context    Inject <ace-memory>       code patterns, etc.)          Cleanup
                   into context              Queue for distillation
```

**Playbook** is your persistent knowledge base — a SQLite database of distilled "bullets" (short, actionable knowledge snippets). Each bullet has metadata (scope, type, section, embedding vector, decay weight) enabling precise retrieval.

## Architecture

```
ace-memory/
  daemon/        # Background daemon process (IPC server, lifecycle, vector cache)
  engine/        # Core logic (search, distillation, dedup, decay, classification, sanitization)
  hooks/         # Claude Code hook handlers (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd)
  scripts/       # CLI tools (ace-cli, install, setup, uninstall)
  shared/        # Shared utilities (IPC client, config loader, logger, platform paths)
  skills/        # Skill definitions for /ace-memory:ace and /ace-memory:learn commands
  storage/       # SQLite storage layer (schema, CRUD, session queue)
  types/         # TypeScript type definitions (Bullet, Config, IPC protocol, Hook)
  tests/         # 480 tests across 29 test files
```

## Requirements

- **Node.js** >= 18
- **Claude Code** CLI
- **Windows / macOS / Linux**

## Installation

```bash
# 1. Clone
git clone https://github.com/UU114/ace-memory.git
cd ace-memory

# 2. Install dependencies
npm install

# 3. Build
npx tsup

# 4. Download ONNX model (IMPORTANT)
node dist/scripts/setup.js
# Or use the slash command after plugin is registered:
#   /ace-memory:ace setup
```

> **Important**: Please run `setup` to download the ONNX embedding model. Without it, ACE can only use keyword search. After downloading the model, semantic (hybrid) search will be enabled, significantly improving knowledge retrieval accuracy.



### Register as Claude Code Plugin

Copy or symlink the plugin to your Claude Code plugins directory:

```bash
# The plugin entry point is .claude-plugin/plugin.json
# Register it according to Claude Code's plugin system
```

When a new Claude Code session starts, the plugin will:
1. Auto-start the ACE daemon (background process)
2. Load and inject relevant knowledge into context
3. Begin monitoring for learnable patterns

## Usage

### Slash Commands

ACE provides two slash commands in Claude Code (namespaced under the plugin name `ace-memory`):

#### `/ace-memory:ace` — Playbook Manager

| Command | Description |
|---------|-------------|
| `/ace-memory:ace status` | Show Playbook statistics (bullet counts by scope, type, section) |
| `/ace-memory:ace search <query>` | Search knowledge base with keyword matching |
| `/ace-memory:ace config` | Display current configuration |
| `/ace-memory:ace config set <key> <value>` | Update config (dot notation, e.g. `decay.half_life_days 60`) |
| `/ace-memory:ace health` | Check daemon, IPC, and ONNX model status |
| `/ace-memory:ace setup` | Download ONNX embedding model for semantic search (run once) |
| `/ace-memory:ace export` | Export entire Playbook as JSON |
| `/ace-memory:ace clear` | Delete all bullets (requires confirmation) |

Examples:
```
/ace-memory:ace status
/ace-memory:ace search vitest setup
/ace-memory:ace config set search.max_results 10
/ace-memory:ace health
/ace-memory:ace setup
```

#### `/ace-memory:learn` — Manual Knowledge Ingestion

Teach ACE something explicitly:

```
/ace-memory:learn Always use bun instead of npm in this project
/ace-memory:learn When you see ECONNRESET, retry with exponential backoff
/ace-memory:learn Use vitest --watch for TDD workflow
/ace-memory:learn --scope global Always use ESM instead of CommonJS
```

Options:
- `--scope global` — Universal knowledge, applies to all projects
- `--scope project:<name>` — Project-specific knowledge

Without arguments, `/ace-memory:learn` enters interactive mode and asks what you want ACE to remember.

### Automatic Learning

No commands needed. During normal Claude Code sessions, ACE automatically:

1. **Detects patterns** — The Rules Engine watches `Edit`, `Write`, and `Bash` tool usage to identify error fixes, code patterns, command usage, and file creation events.
2. **Distills knowledge** — The Reflector extracts concise, actionable bullets from raw observations.
3. **Deduplicates** — The Curator merges similar bullets and prevents redundancy using keyword + semantic similarity.
4. **Decays** — Unused knowledge gradually loses weight (Ebbinghaus forgetting curve). Frequently recalled knowledge becomes permanent.

### Context Injection

On every user prompt, ACE:
1. Extracts keywords from your message
2. Searches the Playbook (keyword + optional semantic hybrid search)
3. Injects matching bullets as `<ace-memory>` blocks into Claude's context
4. Claude uses this historical experience as reference (not as commands)

## Configuration

Config file location: `~/.ace-claude/config.json`

| Section | Key | Default | Description |
|---------|-----|---------|-------------|
| `decay` | `half_life_days` | 30 | Knowledge half-life in days |
| `decay` | `grace_period_days` | 7 | New bullets are protected from decay |
| `decay` | `archive_threshold` | 0.02 | Weight below this triggers archival |
| `search` | `keyword_weight` | 0.6 | Weight for keyword matching |
| `search` | `semantic_weight` | 0.4 | Weight for semantic matching |
| `search` | `max_results` | 5 | Maximum bullets returned per search |
| `search` | `max_context_tokens` | 2000 | Token budget for injected context |
| `reflector` | `min_interaction_quality` | 0.3 | Minimum quality to accept a bullet |
| `daemon` | `idle_timeout_minutes` | 5 | Daemon auto-shutdown after idle |

Use `/ace-memory:ace config set <key> <value>` to modify, e.g.:
```
/ace-memory:ace config set decay.half_life_days 60
/ace-memory:ace config set search.max_results 10
```

## Data Storage

All data is stored locally at `~/.ace-claude/`:

```
~/.ace-claude/
  config.json       # Configuration
  playbook.db       # SQLite knowledge base
  daemon.pid        # Daemon process ID
  daemon.sock       # Unix socket (macOS/Linux)
  sessions/         # Session queue files
  models/           # ONNX model files (after setup)
```

On Windows, the daemon uses a named pipe (`\\.\pipe\ace-claude-daemon`) instead of a Unix socket.

## Development

```bash
# Run tests
npx vitest run

# Watch mode
npx vitest

# Build
npx tsup

# Type check
npx tsc --noEmit
```

## License

MIT
