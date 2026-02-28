# Demo 1: Startup & Health Check

## Purpose
Verify daemon startup, IPC connection, and ONNX embedding status.

## Prerequisites
- Plugin built (`npx tsup`)
- `ACE_DEBUG=1` environment variable set

## Steps

### Step 1: Start a New Claude Code Session
Open a new Claude Code session in any project directory. The `SessionStart` hook fires automatically.

**What to observe in stderr:**
```
[ACE] DEBUG: SessionStart: checking existing daemon...
[ACE] DEBUG: SessionStart: no running daemon found (pid=null)
[ACE] DEBUG: SessionStart: cleaning up stale files
[ACE] DEBUG: SessionStart: spawning new daemon process
[ACE] Spawned daemon process
[ACE] DEBUG: SessionStart: polling daemon readiness (timeout=5000ms)
[ACE] DEBUG: SessionStart: daemon is ready, registering session
[ACE] Daemon started and session registered (session: sess-...)
```

If a daemon already exists:
```
[ACE] DEBUG: SessionStart: found alive daemon pid=12345, attempting IPC ping
[ACE] DEBUG: SessionStart: reusing existing daemon (version=0.1.0)
[ACE] Reused existing daemon (session: sess-...)
```

### Step 2: Run `/ace health`
```
/ace health
```

**Expected output:**
- Daemon: running (PID, uptime)
- IPC: connected
- ONNX: loaded / not loaded
- Active sessions count

### Step 3: Run `/ace status`
```
/ace status
```

**Expected output:**
- Total bullets count
- Breakdown by section (pitfalls, methods, techniques, preferences, knowledge)
- Breakdown by scope (global, project:xxx)

### Step 4: Run `/ace config`
```
/ace config
```

**Expected output:**
- Current search config (max_results, keyword_weight, semantic_weight)
- Decay settings
- Reflector settings

## Success Criteria
- [ ] Daemon starts (or reuses) without errors
- [ ] Session registered successfully
- [ ] `/ace health` shows all green
- [ ] `/ace status` returns valid statistics
- [ ] `/ace config` shows default configuration
