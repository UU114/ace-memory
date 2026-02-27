# STORY-014: Stop Hook + SessionEnd Hook

**Epic:** EPIC-003 (Knowledge Learning)
**Priority:** Should Have (Stop) + Must Have (SessionEnd)
**Story Points:** 5
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 2

---

## User Story

As a developer,
I want knowledge distilled incrementally during sessions and fully cleaned up at session end,
So that learning happens promptly and no candidates are lost.

---

## Description

### Background
The learning pipeline has two consumption points for the session queue:

1. **Stop Hook** — fires after every Claude response. If enough candidates have accumulated (≥ 3), it triggers incremental distillation via the Daemon. This keeps the queue short and learning responsive.

2. **SessionEnd Hook** — fires when the Claude Code session terminates. It processes any remaining undistilled candidates, cleans up the session queue file, and unregisters the session from the Daemon.

Both hooks currently exist as basic scaffolds. This story implements their full logic, connecting them to the Reflector/Curator pipeline (STORY-013) via the Daemon's `curate` IPC method.

### Scope
**In scope:**
- `hooks/stop.ts`: Full implementation — read queue, batch curate, mark processed
- `hooks/session-end.ts`: Full implementation — process remaining, cleanup, unregister, stats
- Integration with Daemon IPC `curate` method
- Fallback behavior when Daemon is unavailable

**Out of scope:**
- The Reflector/Curator pipeline itself (STORY-013)
- PostToolUse pattern detection (STORY-011)
- Direct SQLite access from hooks (only through Daemon IPC or degraded mode)

### User Flow

**Stop Hook (incremental, after each Claude response):**
1. Claude finishes responding → Stop Hook fires
2. Read `~/.ace-claude/sessions/{session_id}.jsonl`
3. Count unprocessed entries (`processed: false`)
4. If < 3 unprocessed → skip (too few to justify IPC overhead)
5. If ≥ 3 unprocessed → send batch to Daemon via IPC `curate`
6. Mark processed entries in JSONL file
7. Output empty JSON `{}`

**SessionEnd Hook (cleanup, session termination):**
1. Claude Code session ends → SessionEnd Hook fires
2. Read remaining unprocessed entries from JSONL
3. If any remain → send to Daemon via IPC `curate`
4. Delete session queue file
5. IPC `session_unregister { session_id }`
6. Log stats: `[ACE] Session complete. +N new, ~N merged, -N skipped`
7. Output empty JSON `{}`

---

## Acceptance Criteria

### Stop Hook
- [ ] `hooks/stop.ts` fully implemented
- [ ] Reads `~/.ace-claude/sessions/{session_id}.jsonl`
- [ ] Counts unprocessed candidates (`processed: false`)
- [ ] Threshold: ≥ 3 unprocessed candidates triggers distillation
- [ ] Sends unprocessed candidates to Daemon via IPC `curate`
- [ ] Marks processed candidates: rewrites JSONL with `processed: true`
- [ ] Daemon unavailable → skip silently, defer to SessionEnd
- [ ] Session queue file doesn't exist → skip silently
- [ ] stdout outputs `{}`
- [ ] Does not block user input (no strict latency requirement)

### SessionEnd Hook
- [ ] `hooks/session-end.ts` fully implemented
- [ ] Reads remaining unprocessed candidates from session JSONL
- [ ] Sends remaining to Daemon via IPC `curate` (if any)
- [ ] Deletes session queue file after processing
- [ ] Calls IPC `session_unregister { session_id }`
- [ ] Logs summary to stderr: `[ACE] Session complete. +N new, ~N merged, -N skipped`
- [ ] Daemon unavailable for curate → log warning, still cleanup file and attempt unregister
- [ ] Daemon unavailable for unregister → log warning, proceed
- [ ] Total SessionEnd processing time < 30s
- [ ] stdout outputs `{}`

### Integration
- [ ] Both hooks correctly parse `session_id` from stdin or environment
- [ ] Both hooks use shared IPC client from `shared/ipc-client.ts`
- [ ] Session queue JSONL format matches `SessionQueueEntry` from STORY-011

---

## Technical Notes

### Components
- **hooks/stop.ts** — Upgrade from scaffold to full implementation
- **hooks/session-end.ts** — Upgrade from scaffold to full implementation
- **shared/ipc-client.ts** — Already implemented, used for Daemon communication
- **storage/session-queue.ts** — May need read/write utilities for JSONL

### Stop Hook Flow
```typescript
// Pseudocode
const entries = readJsonl(sessionQueuePath);
const unprocessed = entries.filter(e => !e.processed);

if (unprocessed.length < 3) {
  process.stdout.write('{}');
  return;
}

const client = new IPCClient();
const connected = await client.connect();
if (!connected) {
  // Daemon unavailable, defer to SessionEnd
  logger.info('[ACE] Daemon unavailable, deferring distillation');
  process.stdout.write('{}');
  return;
}

const result = await client.call('curate', { insights: unprocessed });
// Mark as processed
markProcessed(sessionQueuePath, unprocessed);
process.stdout.write('{}');
```

### SessionEnd Hook Flow
```typescript
// Pseudocode
const entries = readJsonl(sessionQueuePath);
const unprocessed = entries.filter(e => !e.processed);

const client = new IPCClient();
const connected = await client.connect();

let stats = { added: 0, merged: 0, skipped: 0 };

if (connected && unprocessed.length > 0) {
  stats = await client.call('curate', { insights: unprocessed });
}

// Cleanup queue file
deleteFile(sessionQueuePath);

// Unregister session
if (connected) {
  await client.call('session_unregister', { session_id });
}

logger.info(`[ACE] Session complete. +${stats.added} new, ~${stats.merged} merged, -${stats.skipped} skipped`);
process.stdout.write('{}');
```

### JSONL Processing
```typescript
// Read: each line is one JSON object
function readJsonl(path: string): SessionQueueEntry[] {
  const lines = fs.readFileSync(path, 'utf-8').split('\n').filter(Boolean);
  return lines.map(line => JSON.parse(line));
}

// Mark processed: rewrite file with updated entries
function markProcessed(path: string, processed: SessionQueueEntry[]): void {
  const all = readJsonl(path);
  const processedTimestamps = new Set(processed.map(e => e.timestamp));
  const updated = all.map(e =>
    processedTimestamps.has(e.timestamp) ? { ...e, processed: true } : e
  );
  fs.writeFileSync(path, updated.map(e => JSON.stringify(e)).join('\n') + '\n');
}
```

### Edge Cases
- Session queue file is empty or doesn't exist → no-op for both hooks
- JSONL file is corrupted (invalid JSON on a line) → skip that line, process rest
- Daemon crashes mid-curate → partial processing; SessionEnd will retry remaining
- Very large queue (>100 entries from long session) → batch in groups of 20
- Stop Hook and SessionEnd fire in quick succession → SessionEnd reads updated file
- session_id not available → log error, skip

### Stdin Format
Stop Hook receives: `{ session_id }` (from Claude Code Stop event)
SessionEnd Hook receives: `{ session_id }` (from Claude Code SessionEnd event)

---

## Dependencies

**Prerequisite Stories:**
- STORY-011: PostToolUse Hook (writes the JSONL queue that these hooks consume)
- STORY-013: Reflector + Curator (provides the `curate` IPC pipeline)

**Blocked Stories:**
- None (this completes the learning pipeline)

**External Dependencies:**
- None

---

## Definition of Done

- [ ] Code implemented and committed to feature branch
- [ ] TypeScript strict mode compiles with zero errors
- [ ] Unit tests written and passing
  - [ ] Stop Hook: skip when < 3 candidates
  - [ ] Stop Hook: trigger curate when ≥ 3 candidates
  - [ ] Stop Hook: mark processed correctly
  - [ ] Stop Hook: handle Daemon unavailable
  - [ ] SessionEnd: process remaining candidates
  - [ ] SessionEnd: cleanup queue file
  - [ ] SessionEnd: session unregister
  - [ ] SessionEnd: stats logging
  - [ ] SessionEnd: handle Daemon unavailable gracefully
  - [ ] JSONL read/write correctness
- [ ] ESLint zero warnings
- [ ] SessionEnd total processing < 30s (tested with 50 candidates)
- [ ] Manual verification on Windows
- [ ] Acceptance criteria all satisfied

---

## Story Points Breakdown

- **Stop Hook implementation:** 1.5 points
- **SessionEnd Hook implementation:** 2 points
- **JSONL utilities + integration:** 0.5 points
- **Testing:** 1 point
- **Total:** 5 points

**Rationale:** SessionEnd is more complex than Stop — it handles cleanup, unregistration, stats, and all failure modes. The Stop Hook is simpler but still needs careful JSONL state management. Both require thorough testing of edge cases and failure scenarios.

---

## Progress Tracking

**Status History:**
- 2026-02-27: Created by Scrum Master

**Actual Effort:** TBD

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
