# Demo 2: Auto-learn — Error Fix Detection

## Purpose
Verify the full pipeline: error_fix pattern detection -> distillation -> storage.

## Prerequisites
- Demo 1 completed (daemon running)
- `ACE_DEBUG=1` set

## Steps

### Step 1: Trigger an Error
Ask Claude to run a command that will fail:
```
Run this command: npm test -- --nonexistent-flag
```

**What to observe in stderr (PostToolUse hook):**
```
[ACE] DEBUG: PostToolUse: tool=Bash, session=sess-...
[ACE] DEBUG: RulesEngine.detect: tool=Bash, input_keys=command, response_len=...
[ACE] DEBUG: RulesEngine.detect: Bash → error_fix
[ACE] DEBUG: PostToolUse: detected pattern_type=error_fix, summary=Command failed: npm test -- --non...
[ACE] DEBUG: PostToolUse: appended to session queue (session=sess-...)
```

### Step 2: Fix the Error
Ask Claude to run the correct command:
```
Actually, just run: npm test
```

This may or may not trigger `command_usage` depending on results.

### Step 3: Accumulate More Entries
Repeat a few more tool calls to reach the Stop hook threshold (3 entries).

### Step 4: Observe Mid-Session Curate (Stop Hook)
When Claude pauses between responses, the Stop hook fires:

**What to observe:**
```
[ACE] DEBUG: Stop: session=sess-..., total_entries=3, unprocessed=3, threshold=3
[ACE] DEBUG: Stop: sending 3 entries to curate for project=...
[ACE] DEBUG: IPCHandler: method=curate, params_keys=insights,project
[ACE] DEBUG: IPCHandler.curate: 3 insights for project=...
[ACE] DEBUG: Reflector.distill: processing 3 entries for project=...
[ACE] DEBUG: Reflector: [error_fix] raw content="When encountering..."
[ACE] DEBUG: Reflector: sanitized ok, length=...
[ACE] DEBUG: Reflector: classified as Pitfall, score=65, rejected=false
[ACE] DEBUG: Curator.curate: content="When encountering...", type=Pitfall, scope=global
[ACE] DEBUG: Curator: inserting new bullet
[ACE] Curator: inserted new bullet abc-123-...
```

### Step 5: Verify Storage
```
/ace-memory:ace search error
```

**Expected:** At least one bullet containing the error message from Step 1.

## Success Criteria
- [ ] PostToolUse detects `error_fix` pattern on failed command
- [ ] Entry appended to session queue
- [ ] Stop hook triggers curate when threshold reached
- [ ] Reflector distills entry into a Pitfall bullet
- [ ] Curator inserts new bullet (no dedup on first occurrence)
- [ ] `/ace-memory:ace search error` returns the stored bullet
