# Demo 6: Advanced — Export/Import & Decay

## Purpose
Verify export, import, clear, and decay update functionality.

## Prerequisites
- At least Demo 2 or 5 completed (Playbook has bullets)
- `ACE_DEBUG=1` set

## Steps

### Step 1: Export
```
/ace-memory:ace export
```

**Expected:**
- JSON file saved to disk (path shown in output)
- Count of exported bullets displayed
- File contains full bullet data with embeddings

### Step 2: Clear Playbook
```
/ace-memory:ace clear
```

**Expected:**
- Confirmation prompt before clearing
- All bullets removed from database
- Vector cache cleared

### Step 3: Verify Empty
```
/ace-memory:ace status
```

**Expected:** 0 bullets in all sections.

### Step 4: Import
Import the JSON file from Step 1:
```
/ace-memory:ace import <path-from-step-1>
```

**What to observe:**
```
[ACE] DEBUG: IPCHandler: method=curate, params_keys=insights,project
[ACE] DEBUG: Curator.curate: content="...", type=..., scope=...
[ACE] DEBUG: Curator: inserting new bullet
...
```

**Expected:** Each bullet is re-inserted (since DB was cleared, no dedup).

### Step 5: Verify Recovery
```
/ace-memory:ace status
```

**Expected:** Bullet count matches the exported count from Step 1.

### Step 6: (Optional) Trigger Decay Update
If you have access to the daemon IPC or a test command:
```
/ace-memory:ace decay
```

**What to observe:**
```
[ACE] Decay update complete: X updated, Y archived
```

Bullets with low `recall_count` and old `created_at` will have reduced `decay_weight`.

## Success Criteria
- [ ] Export produces valid JSON with all bullets
- [ ] Clear removes all data (with confirmation)
- [ ] Status shows 0 after clear
- [ ] Import restores all bullets from JSON
- [ ] Status matches pre-clear count after import
- [ ] (Optional) Decay update runs and adjusts weights
