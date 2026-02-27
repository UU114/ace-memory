# STORY-005: SessionStart Hook

**Epic:** EPIC-006 (Plugin Infrastructure)
**Priority:** Must Have
**Story Points:** 3
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 1

---

## User Story

As a developer,
I want the Daemon automatically started when I open a Claude Code session,
So that ACE services are always available without manual intervention.

---

## Description

### Background
ACE Daemon 需要在 Claude Code 会话期间保持运行。SessionStart Hook 负责确保 Daemon 可用：如果已运行则复用，如果未运行则启动。这是 Daemon 生命周期管理的"入口"。

### Scope
**In scope:**
- 检测 Daemon 是否已运行（PID 文件 + 进程存活 + IPC ping）
- 版本兼容检测
- 启动新 Daemon（spawn detached）
- 等待 Daemon 就绪（轮询 ping）
- 注册当前 session
- 降级模式处理

**Out of scope:**
- Daemon 内部逻辑（STORY-004）
- 其他 Hook 逻辑

### User Flow
```
Claude Code 会话启动
  → SessionStart Hook 触发
  → 检查 daemon.pid 文件存在?
    → Yes: 进程存活? (kill -0)
      → Yes: IPC ping 成功? 版本匹配?
        → Yes: session_register → 完成 ✓
        → No (版本不匹配): shutdown → 启动新版本
      → No (进程死亡): 清理残留文件
    → No: 直接启动新 Daemon
  → spawn Daemon (detached, unref)
  → 轮询 IPC ping (200ms interval, max 5s)
  → 成功: session_register → 完成 ✓
  → 失败: 日志警告，降级模式 → 完成 (degraded)
```

---

## Acceptance Criteria

- [ ] hooks/session-start.ts 实现完整
- [ ] 从 stdin 读取 session_id（如果 SessionStart 事件提供）
- [ ] PID 文件检查：fs.existsSync(pidPath) → readFileSync → parseInt
- [ ] 进程存活检测：try { process.kill(pid, 0); alive = true } catch { alive = false }
- [ ] IPC ping：IPCClient.connect(500ms) → call('ping') → 检查 version
- [ ] 版本匹配：比较 ping.version 与当前 engine_version
- [ ] 版本不匹配时：call('shutdown') → 等待旧进程退出 → 启动新 Daemon
- [ ] 残留 PID 文件清理：进程不存在时删除 daemon.pid + daemon.sock（如果存在）
- [ ] 启动 Daemon：child_process.spawn('node', ['dist/daemon/index.js'], { detached: true, stdio: 'ignore' }).unref()
- [ ] 就绪轮询：每 200ms 尝试 IPC connect + ping，最多 25 次（5 秒）
- [ ] 就绪成功：call('session_register', { session_id, pid: process.ppid })
- [ ] 就绪失败（5s 超时）：日志 `[ACE] Daemon failed to start, running in degraded mode`
- [ ] stdout 输出 `{}`（SessionStart Hook 无需注入内容）
- [ ] 全过程异常 try-catch → 输出 `{}` + stderr 日志
- [ ] 复用已有 Daemon 的延迟 <500ms
- [ ] 首次冷启动允许 <5s

---

## Technical Notes

### 流程伪代码

```typescript
async function main() {
  const input = readStdinSync(); // { session_id, ... }
  const sessionId = input.session_id || generateSessionId();

  try {
    // Step 1: Check existing daemon
    const existingPid = readPidFile();
    if (existingPid && isProcessAlive(existingPid)) {
      const client = await IPCClient.connect(500);
      if (client) {
        const pong = await client.call('ping');
        if (pong.version === ENGINE_VERSION) {
          await client.call('session_register', { session_id: sessionId, pid: process.ppid });
          client.disconnect();
          process.stdout.write('{}');
          return;
        }
        // Version mismatch - shutdown old daemon
        await client.call('shutdown');
        client.disconnect();
        await waitForProcessExit(existingPid, 3000);
      }
    }

    // Step 2: Cleanup stale files
    cleanupStaleFiles();

    // Step 3: Spawn new daemon
    spawnDaemon();

    // Step 4: Wait for ready
    const ready = await pollDaemonReady(5000, 200);
    if (ready) {
      const client = await IPCClient.connect(500);
      await client.call('session_register', { session_id: sessionId, pid: process.ppid });
      client.disconnect();
    } else {
      aceWarn('Daemon failed to start, running in degraded mode');
    }
  } catch (err) {
    aceError(`SessionStart error: ${err}`);
  }

  process.stdout.write('{}');
}
```

### Session ID

如果 Claude Code SessionStart 事件提供 session_id，使用它。否则生成一个基于时间的 ID（`sess-${Date.now()}-${randomHex(4)}`）。SessionStart 需要将 session_id 传递给后续 Hook 使用——目前各 Hook 从 stdin 获取 session_id。

### spawn Daemon

```typescript
function spawnDaemon() {
  const child = spawn('node', [path.join(__dirname, '../daemon/index.js')], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ACE_DAEMON: '1' }
  });
  child.unref();
}
```

---

## Dependencies

**Prerequisite Stories:**
- STORY-004 (ACE Daemon — 需要 Daemon 可启动)

**Blocked Stories:**
- STORY-007 (UserPromptSubmit Hook — 需要 Daemon 已启动)

**External Dependencies:** None

---

## Definition of Done

- [ ] SessionStart Hook 可被 Claude Code 触发
- [ ] 首次启动 Daemon 成功（spawn + ready）
- [ ] 复用已有 Daemon 成功（ping + register）
- [ ] 版本不匹配重启成功
- [ ] 残留 PID 文件清理成功
- [ ] 降级模式（Daemon 启动失败）不阻塞 Claude Code
- [ ] 输出始终为有效 JSON
- [ ] Windows 上 Named pipe 通信验证

---

## Story Points Breakdown

- **Daemon 检测 + 复用逻辑:** 1 point
- **Daemon 启动 + 就绪轮询:** 1 point
- **版本检测 + 清理 + 测试:** 1 point
- **Total:** 3 points
