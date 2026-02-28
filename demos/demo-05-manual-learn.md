# Demo 5: Manual Learning (`/ace-memory:learn`)

## Purpose
Verify the `/ace-memory:learn` command for manual knowledge injection, including classification and deduplication.

## Prerequisites
- Demo 1 completed (daemon running)
- `ACE_DEBUG=1` set

## Steps

### Step 1: Learn a Preference
```
/ace-memory:learn Always use bun instead of npm
```

**What to observe:**
```
[ACE] DEBUG: IPCHandler: method=curate, params_keys=insights,project
[ACE] DEBUG: IPCHandler.curate: 1 insights for project=...
[ACE] DEBUG: Reflector.distill: processing 1 entries for project=...
[ACE] DEBUG: Reflector: [command_usage] raw content="Always use bun instead of npm"
[ACE] DEBUG: Reflector: sanitized ok, length=29
[ACE] DEBUG: Reflector: classified as Preference, score=70, rejected=false
[ACE] DEBUG: Curator.curate: content="Always use bun instead of npm", type=Preference, scope=global
[ACE] DEBUG: Curator: inserting new bullet
[ACE] Curator: inserted new bullet ...
```

### Step 2: Learn a Pitfall
```
/ace-memory:learn When you see ECONNRESET, retry with exponential backoff
```

**Expected classification:** `Pitfall` with `error_fix` tag.

### Step 3: Test Deduplication
Run the exact same learn command again:
```
/ace-memory:learn Always use bun instead of npm
```

**What to observe:**
```
[ACE] DEBUG: Curator.curate: content="Always use bun...", type=Preference, scope=global
[ACE] DEBUG: Curator: semantic match found id=..., score=0.95 (threshold=0.8)
[ACE] Curator: merged bullet into ...
```

**Expected:** Merged (not duplicated).

### Step 4: Verify Count
```
/ace-memory:ace status
```

**Expected:** Only 2 new bullets (not 3), because the duplicate was merged.

### Step 5: Search
```
/ace-memory:ace search bun
```

**Expected:** Returns the "Always use bun instead of npm" bullet.

## Success Criteria
- [ ] `/ace-memory:learn` command injects knowledge into the pipeline
- [ ] Preference is classified correctly
- [ ] Pitfall is classified correctly
- [ ] Duplicate `/ace-memory:learn` triggers merge (not new insert)
- [ ] `/ace-memory:ace status` reflects correct count
- [ ] `/ace-memory:ace search` finds manually learned bullets
