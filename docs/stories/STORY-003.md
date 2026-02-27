# STORY-003: IPC 通信框架

**Epic:** EPIC-006 (Plugin Infrastructure)
**Priority:** Must Have
**Story Points:** 3
**Status:** Completed
**Assigned To:** Claude
**Created:** 2026-02-27
**Sprint:** 1

---

## User Story

As a developer,
I want a cross-platform IPC communication layer,
So that Hook scripts can efficiently communicate with the Daemon via local socket.

---

## Description

### Background
Claude Code 的 Hook 每次触发都是新的 Node.js 进程。ACE Daemon 作为常驻后台进程通过 IPC 提供服务。需要一个可靠的通信框架实现 Hook → Daemon 的请求/响应模式。使用 JSON-RPC 2.0 协议标准化消息格式。

### Scope
**In scope:**
- JSON-RPC 2.0 协议编解码
- IPCClient 类（Hook 端使用）
- IPCServer 类（Daemon 端使用）
- Unix domain socket (Linux/macOS) + Named pipe (Windows) 适配
- 连接超时、请求超时
- 错误处理（连接失败返回 null）

**Out of scope:**
- Daemon 的业务逻辑处理（由 Daemon 模块负责）
- 重连/重试策略（Hook 是短生命周期进程）

---

## Acceptance Criteria

- [ ] JSON-RPC 2.0 协议实现：{ jsonrpc: "2.0", id, method, params } → { jsonrpc: "2.0", id, result/error }
- [ ] IPCClient.connect(socketPath, timeout): 连接到 Daemon，超时返回 null
- [ ] IPCClient.call(method, params, timeout): 发送请求并等待响应，超时返回 error
- [ ] IPCClient.disconnect(): 关闭连接
- [ ] IPCServer.listen(socketPath): 监听连接
- [ ] IPCServer.onRequest(handler): 注册请求处理函数
- [ ] IPCServer.close(): 关闭服务器，清理 socket 文件
- [ ] 消息分帧：Newline-delimited JSON（每条消息以 \n 结尾）
- [ ] 平台适配：process.platform === 'win32' 使用 Named pipe，否则 Unix socket
- [ ] Unix socket 创建前清理残留文件
- [ ] Named pipe 路径：\\.\pipe\ace-claude-daemon
- [ ] 多客户端支持：IPCServer 可同时处理多个 Hook 连接
- [ ] 错误码定义：-32600 (Invalid Request), -32601 (Method not found), -32603 (Internal error)
- [ ] 单元测试：client-server 通信回环测试（同进程内创建 server + client）

---

## Technical Notes

### 模块结构

```
shared/
├── ipc-client.ts    # Hook 端 IPC 客户端
├── ipc-server.ts    # Daemon 端 IPC 服务器 (也可放 daemon/)
└── ipc-protocol.ts  # JSON-RPC 编解码 + 消息分帧
```

### IPCClient API

```typescript
export class IPCClient {
  static async connect(timeout?: number): Promise<IPCClient | null>;
  async call<T>(method: string, params?: Record<string, unknown>, timeout?: number): Promise<T>;
  disconnect(): void;
}
```

Hook 使用模式：
```typescript
const client = await IPCClient.connect(50); // 50ms timeout
if (!client) {
  // Daemon 不可用，降级处理
  return fallbackResult;
}
try {
  const result = await client.call('recall', { query, project, limit: 5 }, 80);
  return result;
} finally {
  client.disconnect();
}
```

### IPCServer API

```typescript
export class IPCServer {
  constructor();
  listen(socketPath: string): Promise<void>;
  onRequest(handler: (method: string, params: any) => Promise<any>): void;
  close(): Promise<void>;
  getConnectionCount(): number;
}
```

### 消息分帧

```typescript
// ipc-protocol.ts
export function encode(msg: IPCRequest | IPCResponse): string {
  return JSON.stringify(msg) + '\n';
}

export function createFrameDecoder(onMessage: (msg: any) => void): (chunk: Buffer) => void {
  let buffer = '';
  return (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // last incomplete line
    for (const line of lines) {
      if (line.trim()) {
        onMessage(JSON.parse(line));
      }
    }
  };
}
```

### Node.js net 模块

- 使用 `net.createConnection()` 和 `net.createServer()`
- Unix socket 和 Named pipe 都通过 `path` 参数传入
- Named pipe 格式：`\\.\pipe\ace-claude-daemon`（Node.js net 模块原生支持）

### Edge Cases

- Daemon 未启动 → connect() 返回 null
- Daemon 在请求中崩溃 → call() 超时返回 error
- 消息被截断（大 JSON）→ 分帧解码器缓冲处理
- 并发请求（同一 client 多次 call）→ 用 id 匹配 request/response

---

## Dependencies

**Prerequisite Stories:**
- STORY-001 (类型定义 + 平台适配)

**Blocked Stories:**
- STORY-004 (Daemon — 使用 IPCServer)
- STORY-005 (SessionStart Hook — 使用 IPCClient)

**External Dependencies:** None (纯 Node.js net 模块)

---

## Definition of Done

- [ ] IPCClient 和 IPCServer 实现完整
- [ ] 回环测试通过（server listen → client connect → call → response）
- [ ] 超时测试通过（server 不响应时 client 超时返回）
- [ ] 连接失败测试通过（无 server 时 client 返回 null）
- [ ] 多客户端并发测试通过
- [ ] Windows Named pipe 在当前开发环境验证通过
- [ ] TypeScript 编译通过

---

## Story Points Breakdown

- **JSON-RPC 协议 + 分帧:** 1 point
- **IPCClient + IPCServer:** 1.5 points
- **平台适配 + 测试:** 0.5 point
- **Total:** 3 points

**Rationale:** 使用 Node.js 原生 net 模块，协议简单（JSON-RPC）。主要工作量在边界处理和跨平台验证。
