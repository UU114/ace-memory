# Demo 3: Auto-learn — Code Pattern & Command Usage

## Purpose
Verify `code_pattern` and `command_usage` detection in the PostToolUse pipeline.

## Prerequisites
- Demo 1 completed (daemon running)
- `ACE_DEBUG=1` set

## Steps

### Step 1: Trigger code_pattern via Edit
Ask Claude to add an import statement to a file:
```
Add "import path from 'path';" at the top of some-file.ts
```

**What to observe:**
```
[ACE] DEBUG: PostToolUse: tool=Edit, session=sess-...
[ACE] DEBUG: RulesEngine.detect: tool=Edit, input_keys=file_path,old_string,new_string, response_len=0
[ACE] DEBUG: RulesEngine.detect: Edit → code_pattern
[ACE] DEBUG: PostToolUse: detected pattern_type=code_pattern, summary=Added import: import path from 'path'...
[ACE] DEBUG: PostToolUse: appended to session queue
```

### Step 2: Trigger code_pattern via Error Handling
Ask Claude to add a try-catch block:
```
Wrap that function call in a try-catch block
```

**Expected pattern:** `code_pattern` with summary "Added error handling in ..."

### Step 3: Trigger command_usage via Build
Ask Claude to build the project:
```
Run: npm run build
```

**What to observe:**
```
[ACE] DEBUG: RulesEngine.detect: tool=Bash, input_keys=command, response_len=...
[ACE] DEBUG: RulesEngine.detect: Bash → command_usage
[ACE] DEBUG: PostToolUse: detected pattern_type=command_usage, summary=Executed: npm run build
```

### Step 4: Trigger command_usage via Test
```
Run: npx vitest run
```

**Expected:** `command_usage` detected for vitest.

### Step 5: End Session & Check Curate
End the session (close Claude Code or wait for SessionEnd hook).

**What to observe (SessionEnd):**
```
[ACE] DEBUG: SessionEnd: session=sess-..., total_entries=4, unprocessed=4
[ACE] DEBUG: SessionEnd: curating 4 entries for project=...
[ACE] DEBUG: SessionEnd: batch result — added=3, merged=0, skipped=1
[ACE] Session complete. +3 new, ~0 merged, -1 skipped
```

### Step 6: Verify
```
/ace search import
/ace search build
```

**Expected:** Bullets for each detected pattern type.

## Success Criteria
- [ ] Edit tool triggers `code_pattern` for import additions
- [ ] Edit tool triggers `code_pattern` for error handling additions
- [ ] Bash tool triggers `command_usage` for npm/vitest commands
- [ ] Trivial commands (ls, cd, cat) are NOT captured
- [ ] SessionEnd curate processes all remaining entries
- [ ] `/ace search` finds stored bullets
