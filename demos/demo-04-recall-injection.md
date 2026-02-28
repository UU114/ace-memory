# Demo 4: Context Recall & Injection

## Purpose
Verify the UserPromptSubmit hook: query -> keyword extraction -> hybrid search -> `<ace-memory>` injection.

## Prerequisites
- Demo 2 or 3 completed (Playbook has bullets)
- `ACE_DEBUG=1` set
- Start a **new** Claude Code session

## Steps

### Step 1: Start New Session
Open a fresh Claude Code session. Daemon should be reused:
```
[ACE] DEBUG: SessionStart: reusing existing daemon (version=0.1.0)
[ACE] Reused existing daemon (session: sess-...)
```

### Step 2: Enter a Related Prompt
Type a prompt related to stored bullets. For example, if Demo 2 stored an error-fix bullet:
```
How do I fix this npm error?
```

**What to observe (UserPromptSubmit hook):**
```
[ACE] DEBUG: UserPromptSubmit: query="How do I fix this npm error?", project=...
[ACE] DEBUG: UserPromptSubmit: attempting recall via daemon...
[ACE] DEBUG: IPCHandler: method=recall, params_keys=query,project,limit
[ACE] DEBUG: IPCHandler.recall: query="How do I fix this npm error?", project=..., limit=5
[ACE] DEBUG: IPCHandler.recall: 3 candidate bullets in scope [project:..., global]
[ACE] DEBUG: IPCHandler.recall: returning 2 results
[ACE] DEBUG: UserPromptSubmit: recall returned 2 bullets
[ACE] DEBUG: UserPromptSubmit: injecting 2 bullets as <ace-memory> (350 chars)
```

### Step 3: Check Claude's Response
Claude's response should reference information from the injected `<ace-memory>` block. The memory is invisible to you but guides Claude's answer.

### Step 4: Try an Unrelated Prompt
```
What is the capital of France?
```

**Expected:**
```
[ACE] DEBUG: UserPromptSubmit: query="What is the capital of France?", project=...
[ACE] DEBUG: UserPromptSubmit: recall returned 0 bullets
[ACE] DEBUG: UserPromptSubmit: no relevant bullets found, skipping injection
```

### Step 5: Verify Recall Count
```
/ace search npm
```

**Expected:** The matching bullet's `recall_count` should have incremented by 1.

## Success Criteria
- [ ] Recall via daemon succeeds (or gracefully falls back to SQLite)
- [ ] Related prompts return matching bullets
- [ ] Unrelated prompts return 0 bullets (no injection)
- [ ] `<ace-memory>` block is injected into Claude's context
- [ ] `recall_count` increments for returned bullets
