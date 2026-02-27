# STORY-011: PostToolUse Hook + Rules Engine

**Epic:** EPIC-003 (Knowledge Learning)
**Priority:** Should Have
**Story Points:** 5
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 2

---

## User Story

As a developer,
I want Claude's tool usage patterns to be detected automatically,
So that the system learns from my coding sessions without manual input.

---

## Description

### Background
The learning pipeline starts with the PostToolUse Hook. Every time Claude uses Edit, Write, or Bash, this hook fires and examines the tool input/output for learnable patterns. Detected patterns are written as candidates to a per-session JSONL queue file, which is later consumed by Stop Hook and SessionEnd Hook for distillation.

Currently `hooks/post-tool-use.ts` exists as a basic scaffold. This story implements the full rules engine that extracts structured pattern candidates without calling any LLM.

### Scope
**In scope:**
- `engine/rules-engine.ts`: Pure rule-based pattern detection
- `hooks/post-tool-use.ts`: Full implementation reading stdin, calling rules engine, writing JSONL
- Pattern types: error_fix, code_pattern, command_usage, file_creation
- Session queue JSONL file writing
- Matcher configuration for Edit|Write|Bash only

**Out of scope:**
- LLM-based evaluation (STORY-023 backlog)
- Distillation into Bullets (that's STORY-013 Reflector)
- Stop/SessionEnd consumption (that's STORY-014)

### User Flow
1. Claude uses Edit/Write/Bash tool during conversation
2. Claude Code fires PostToolUse event
3. Hook reads `{ tool_name, tool_input, tool_response, session_id }` from stdin
4. Rules engine analyzes the tool interaction
5. If pattern detected → append SessionQueueEntry to `~/.ace-claude/sessions/{session_id}.jsonl`
6. If no pattern → output empty JSON `{}`
7. User is unaware of this background learning

---

## Acceptance Criteria

- [ ] `hooks/post-tool-use.ts` fully implemented
- [ ] Hook matcher: `"Edit|Write|Bash"` — only triggers for these three tools
- [ ] Reads stdin: `{ tool_name, tool_input, tool_response, session_id }`
- [ ] `engine/rules-engine.ts` created: pure rule-based pattern detection (no LLM)
- [ ] Detects **error_fix** pattern: Bash failure (exit code != 0) context suggesting a fix was applied
- [ ] Detects **code_pattern** pattern: Edit/Write with import additions, error handling, config changes
- [ ] Detects **command_usage** pattern: Bash success with notable commands (build, test, deploy patterns)
- [ ] Detects **file_creation** pattern: Write creating new files with meaningful content
- [ ] Candidate written to `~/.ace-claude/sessions/{session_id}.jsonl` (one JSON per line)
- [ ] Each line follows `SessionQueueEntry` format: `{ timestamp, tool_name, pattern_type, summary, context, processed }`
- [ ] `context` includes relevant fields: `file`, `language`, `error_message`, `command`
- [ ] No pattern detected → stdout `{}`
- [ ] Execution time < 50ms per invocation
- [ ] Sessions directory auto-created if missing
- [ ] Unit tests: pattern detection for each pattern type, edge cases

---

## Technical Notes

### Components
- **engine/rules-engine.ts** — New module: `RulesEngine` class
- **hooks/post-tool-use.ts** — Upgrade from scaffold to full implementation
- **types/hook.ts** — Already has PostToolUse types (verify)

### Rules Engine Design
```typescript
interface PatternCandidate {
  pattern_type: 'error_fix' | 'code_pattern' | 'command_usage' | 'file_creation';
  summary: string;
  context: {
    file?: string;
    language?: string;
    error_message?: string;
    command?: string;
  };
}

class RulesEngine {
  detect(toolName: string, toolInput: unknown, toolResponse: unknown): PatternCandidate | null;

  private detectErrorFix(input: unknown, response: unknown): PatternCandidate | null;
  private detectCodePattern(toolName: string, input: unknown): PatternCandidate | null;
  private detectCommandUsage(input: unknown, response: unknown): PatternCandidate | null;
  private detectFileCreation(input: unknown): PatternCandidate | null;
}
```

### Pattern Detection Rules

**error_fix:**
- Bash tool with non-zero exit code or stderr containing error keywords
- Summary captures the error message and the tool context
- Look for: compile errors, test failures, permission errors, command not found

**code_pattern:**
- Edit/Write containing recognizable patterns:
  - `import` / `require` additions
  - try-catch / error handling blocks
  - Configuration file changes (.json, .yaml, .toml)
  - Type definition changes
- Extract file path and language from tool_input

**command_usage:**
- Bash with exit code 0
- Command matches notable patterns: build, test, deploy, install, migrate
- Exclude trivial commands: ls, cd, cat, echo, pwd

**file_creation:**
- Write tool creating new file (not overwriting)
- File has meaningful content (> 5 lines or > 100 chars)
- Extract file path and inferred language

### Session Queue File Format
```jsonl
{"timestamp":"2026-02-27T10:30:00Z","tool_name":"Bash","pattern_type":"error_fix","summary":"TypeScript compilation error: Property 'foo' does not exist on type 'Bar'","context":{"error_message":"TS2339","language":"typescript"},"processed":false}
{"timestamp":"2026-02-27T10:31:00Z","tool_name":"Edit","pattern_type":"code_pattern","summary":"Added import for 'path' module in daemon/index.ts","context":{"file":"daemon/index.ts","language":"typescript"},"processed":false}
```

### Edge Cases
- Very large tool_response (>100KB) → truncate before analysis
- tool_input/tool_response is null or malformed → skip silently
- Session directory doesn't exist → create `~/.ace-claude/sessions/`
- JSONL file append race condition → each Hook invocation is a separate process, append-only is safe
- Multiple patterns in one tool use → pick the strongest/first match

---

## Dependencies

**Prerequisite Stories:**
- STORY-001: Project scaffolding + types (completed) — provides types and config

**Blocked Stories:**
- STORY-014: Stop Hook + SessionEnd Hook (reads the JSONL queue this story writes)

**External Dependencies:**
- None (pure rule-based, no external libraries)

---

## Definition of Done

- [ ] Code implemented and committed to feature branch
- [ ] TypeScript strict mode compiles with zero errors
- [ ] Unit tests written and passing
  - [ ] error_fix detection (Bash failure scenarios)
  - [ ] code_pattern detection (Edit with imports, error handling)
  - [ ] command_usage detection (Bash success with notable commands)
  - [ ] file_creation detection (Write with new files)
  - [ ] No false positives on trivial operations
  - [ ] JSONL file writing correctness
- [ ] ESLint zero warnings
- [ ] Performance: < 50ms per hook invocation
- [ ] Manual verification on Windows
- [ ] Acceptance criteria all satisfied

---

## Story Points Breakdown

- **Rules Engine (4 pattern types):** 3 points
- **Hook implementation + JSONL writing:** 1 point
- **Testing:** 1 point
- **Total:** 5 points

**Rationale:** The rules engine is the core complexity — designing heuristics that catch real patterns without excessive false positives requires careful tuning. The hook itself is simple stdin/stdout plumbing.

---

## Progress Tracking

**Status History:**
- 2026-02-27: Created by Scrum Master

**Actual Effort:** TBD

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
