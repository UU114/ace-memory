# ACE Memory Plugin — Demo Scenarios

End-to-end demo scenarios for validating all core features of the ACE Memory plugin.

## Prerequisites

1. Plugin is built: `npx tsup`
2. Enable debug logging: `set ACE_DEBUG=1` (Windows) or `export ACE_DEBUG=1` (Unix)
3. Claude Code is installed and configured with this plugin

## Demo Index

| # | File | Topic | Duration |
|---|------|-------|----------|
| 1 | [demo-01-startup.md](demo-01-startup.md) | Startup & Health Check | ~2 min |
| 2 | [demo-02-error-learning.md](demo-02-error-learning.md) | Auto-learn: Error Fix | ~5 min |
| 3 | [demo-03-pattern-learning.md](demo-03-pattern-learning.md) | Auto-learn: Code Pattern & Command Usage | ~5 min |
| 4 | [demo-04-recall-injection.md](demo-04-recall-injection.md) | Context Recall & Injection | ~3 min |
| 5 | [demo-05-manual-learn.md](demo-05-manual-learn.md) | Manual Learning (`/ace-memory:learn`) | ~3 min |
| 6 | [demo-06-advanced.md](demo-06-advanced.md) | Export/Import, Decay | ~5 min |

## Recommended Order

Run demos sequentially (1 → 6). Demo 4 requires bullets from Demo 2 or 3.

## How to Read Debug Output

With `ACE_DEBUG=1`, all `[ACE] DEBUG:` lines appear on stderr. Key prefixes:

- `SessionStart:` — daemon lifecycle
- `PostToolUse:` — pattern detection pipeline
- `RulesEngine.detect:` — rule matching details
- `UserPromptSubmit:` — recall & injection flow
- `Reflector:` — distillation steps
- `Curator:` — dedup decisions
- `IPCHandler:` — daemon request/response
- `SessionEnd:` / `Stop:` — curate triggers
