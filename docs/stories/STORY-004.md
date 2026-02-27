# STORY-004: ACE Daemon 核心 + 生命周期管理

**Epic:** EPIC-006 (Plugin Infrastructure)
**Priority:** Must Have
**Story Points:** 8
**Status:** Completed
**Assigned To:** Claude
**Created:** 2026-02-27
**Sprint:** 1

---

## User Story

As a developer,
I want a persistent background daemon that holds heavy resources,
So that Hook scripts can access ONNX model and SQLite without cold-start penalty.

---

## Description

### Background
Claude Code Hook 每次触发都是新的 Node.js 进程。ONNX 模型加载需要 ~3 秒冷启动。如果每次 UserPromptSubmit 都冷启动，用户体验不可接受。ACE Daemon 作为常驻后台进程一次性加载 ONNX + SQLite，通过 IPC 对外服务，将冷启动成本从"每次 Hook"降低到"每次 Session"。

这是整个系统最复杂的组件（8 points），包含进程管理、IPC 路由、会话追踪和自管理机制。

### Scope
**In scope:**
- Daemon 主进程入口和启动流程
- IPC Server 启动和请求路由
- PID 文件和 meta 文件管理
- 会话注册/注销（多 Claude 会话共享同一 Daemon）
- 自管理：空闲退出、兜底退出、存活检测
- 优雅退出和异常处理
- recall/curate 方法 stub（Sprint 2 填充）

**Out of scope:**
- ONNX 模型加载（Sprint 2 STORY-009）
- 向量缓存（Sprint 2 STORY-010）
- Reflector/Curator 业务逻辑（Sprint 2）

### User Flow (Internal)
```
SessionStart Hook spawn → Daemon 进程启动
  → 加载配置
  → 打开 SQLite 连接
  → 启动 IPC Server 监听
  → 写 PID 文件 + meta 文件
  → 进入服务循环
  → 接收 IPC 请求 → 分发到处理函数 → 返回响应
  → 空闲检测 → 无活跃 session 且 5 分钟无请求 → 退出
```

---

## Acceptance Criteria

### 启动与初始化
- [ ] daemon/index.ts 作为独立 Node.js 脚本可运行
- [ ] 启动时加载配置（config-loader）
- [ ] 启动时打开 SQLite 连接（AceDatabase）
- [ ] 启动时启动 IPCServer 监听
- [ ] 写入 PID 文件 (~/.ace-claude/daemon.pid)，内容为 process.pid
- [ ] 写入 meta 文件 (~/.ace-claude/daemon.meta.json)：{ pid, engine_version, started_at, socket_path, active_sessions: [] }

### IPC 请求路由
- [ ] `ping` → 返回 { status: "ok", version: string, uptime: number, active_sessions: number }
- [ ] `recall` → 暂返回 { bullets: [] }（Sprint 2 填充）
- [ ] `curate` → 暂返回 { added: 0, merged: 0, skipped: 0 }（Sprint 2 填充）
- [ ] `embed` → 暂返回 { vector: [] }（Sprint 2 填充）
- [ ] `session_register` → 记录 { session_id, pid } 到内存 Map，更新 meta 文件
- [ ] `session_unregister` → 移除 session，更新 meta 文件，检查是否触发空闲计时
- [ ] `shutdown` → 触发优雅退出
- [ ] `stats` → 调用 AceDatabase.getStats() 返回统计
- [ ] `decay_update` → 暂返回 { updated: 0, archived: 0 }（Sprint 3 填充）
- [ ] 未知方法 → 返回 JSON-RPC error -32601 (Method not found)

### 会话管理
- [ ] activeSessions: Map<string, { pid: number, registeredAt: Date }> 内存管理
- [ ] session_register 时记录 session_id + pid
- [ ] session_unregister 时移除 session
- [ ] 多 Claude Code 会话可同时连接同一 Daemon

### 自管理
- [ ] 空闲退出：activeSessions 为空 且 lastRequestAt + idleTimeout(5min) < now → 自动退出
- [ ] 兜底退出：lastRequestAt + maxIdle(10min) < now → 强制退出（防孤儿）
- [ ] 存活检测：setInterval 每 60 秒扫描 activeSessions，对每个 session 执行 `process.kill(pid, 0)`
- [ ] 检测到死亡 session → 从 activeSessions 移除，日志提示
- [ ] Windows 进程检测：`process.kill(pid, 0)` 在 Windows 上也有效（Node.js 跨平台支持）

### 退出与清理
- [ ] 优雅退出：关闭 IPC Server → 关闭 SQLite → 删除 PID 文件 → 删除 socket 文件（Unix）
- [ ] SIGTERM/SIGINT 信号处理 → 触发优雅退出
- [ ] uncaughtException 处理器：日志记录 → 尝试清理 PID/socket → process.exit(1)
- [ ] unhandledRejection 处理器：日志记录（不退出）

### 进程行为
- [ ] 可作为 detached 子进程运行（SessionStart Hook spawn 时 stdio: 'ignore', detached: true）
- [ ] stdout/stderr 重定向到日志文件 (~/.ace-claude/daemon.log)（可选，用于调试）

---

## Technical Notes

### 模块结构

```
daemon/
├── index.ts          # 主入口：init → listen → serve
├── ipc-handler.ts    # IPC 请求路由和处理函数
├── lifecycle.ts      # 生命周期管理（idle check, session check, shutdown）
└── vector-cache.ts   # Sprint 2 添加
```

### Daemon 主流程

```typescript
// daemon/index.ts
async function main() {
  const config = loadConfig();
  const db = new AceDatabase(getDbPath());
  const server = new IPCServer();
  const lifecycle = new LifecycleManager(config.daemon);
  const handler = new IPCHandler(db, lifecycle);

  // Register request handler
  server.onRequest(async (method, params) => {
    lifecycle.recordRequest();
    return handler.handle(method, params);
  });

  // Start server
  await server.listen(getSocketPath());

  // Write PID + meta
  writePidFile(process.pid);
  writeMetaFile({ pid: process.pid, engine_version: VERSION, ... });

  // Start lifecycle timers
  lifecycle.start();

  // Signal handlers
  process.on('SIGTERM', () => shutdown(server, db));
  process.on('SIGINT', () => shutdown(server, db));
  process.on('uncaughtException', (err) => { ... });
}
```

### LifecycleManager

```typescript
class LifecycleManager {
  private activeSessions: Map<string, SessionInfo>;
  private lastRequestAt: Date;
  private idleTimer: NodeJS.Timeout;
  private sessionCheckTimer: NodeJS.Timeout;

  start(): void;           // 启动 idle 和 session check 定时器
  stop(): void;            // 停止所有定时器
  recordRequest(): void;   // 更新 lastRequestAt
  registerSession(sessionId: string, pid: number): void;
  unregisterSession(sessionId: string): void;
  shouldShutdown(): boolean; // 检查是否应该退出
}
```

### Meta 文件格式

```json
{
  "pid": 12345,
  "engine_version": "0.1.0",
  "started_at": "2026-02-28T10:00:00.000Z",
  "socket_path": "/home/user/.ace-claude/daemon.sock",
  "active_sessions": ["sess-abc123", "sess-def456"]
}
```

### 关键设计决策

1. **单线程模型**：Daemon 是单线程 Node.js 进程，所有请求串行处理。better-sqlite3 是同步 API，天然无并发问题。
2. **Stub 方法**：recall/curate/embed 在 Sprint 1 返回空结果。Sprint 2 插入真实逻辑时只需替换 handler 内部实现，接口不变。
3. **定时器管理**：idle check 和 session check 使用 setInterval，退出时 clearInterval。

---

## Dependencies

**Prerequisite Stories:**
- STORY-002 (SQLite 存储层 — AceDatabase)
- STORY-003 (IPC 通信框架 — IPCServer)

**Blocked Stories:**
- STORY-005 (SessionStart Hook — 启动/连接 Daemon)
- STORY-007 (UserPromptSubmit Hook — IPC recall)
- STORY-010 (向量缓存 — Daemon 内嵌)
- STORY-014 (Stop/SessionEnd Hook — IPC curate)

**External Dependencies:** None

---

## Definition of Done

- [ ] Daemon 可独立启动（`node dist/daemon/index.js`）
- [ ] PID 文件和 meta 文件正确写入
- [ ] IPC 客户端可连接并调用所有方法（ping, session_register, etc.）
- [ ] session_register/unregister 正确维护 activeSessions
- [ ] 空闲退出集成测试：注册 session → 注销 → 等待 → 确认进程退出
- [ ] 兜底退出测试：不发任何请求 → 10 分钟后确认退出
- [ ] 存活检测测试：注册一个虚假 PID → 60 秒后确认被清理
- [ ] 优雅退出测试：发送 shutdown → 确认 PID 和 socket 文件被清理
- [ ] Windows 上 Named pipe 通信验证通过
- [ ] TypeScript 编译通过

---

## Story Points Breakdown

- **主进程入口 + 初始化流程:** 2 points
- **IPC 请求路由 + handler:** 2 points
- **生命周期管理 (idle/session/shutdown):** 2.5 points
- **PID/meta/信号处理 + 测试:** 1.5 points
- **Total:** 8 points

**Rationale:** 这是系统核心组件，涉及进程管理、定时器、信号处理、文件管理等多种机制。虽然每个部分不算复杂，但组合在一起需要仔细的集成和测试。
