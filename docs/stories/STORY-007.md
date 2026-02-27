# STORY-007: UserPromptSubmit Hook (关键词模式)

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Must Have
**Story Points:** 3
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 1

---

## User Story

As a developer,
I want my past coding knowledge automatically injected when I ask Claude questions,
So that Claude references my experience without me repeating past context.

---

## Description

### Background
UserPromptSubmit 是用户感知 ACE 价值的核心触点——每次提问时，相关历史知识自动注入上下文。Sprint 1 实现关键词模式（无 ONNX 时也能工作），Sprint 2 升级为混合检索。注入方式是 Claude Code 的 `additionalContext`，格式为 `<ace-memory role="reference">` 块。

### Scope
**In scope:**
- stdin 读取 { prompt, cwd, session_id }
- 项目名推断（从 cwd）
- 通过 Daemon IPC 执行关键词召回
- ace-memory 格式化输出
- Token 预算控制
- 降级模式（Daemon 不可用 → 直接读 SQLite）
- 召回后更新 recall_count

**Out of scope:**
- 语义检索（Sprint 2 STORY-010 升级）
- 混合评分公式（Sprint 2）

---

## Acceptance Criteria

- [ ] hooks/user-prompt-submit.ts 实现完整
- [ ] 从 stdin 读取完整 JSON：`{ prompt, cwd, session_id }`
- [ ] 从 cwd 推断项目名：`path.basename(cwd)` → 用作 scope filter `project:{name}`
- [ ] 检索范围：`scopes = ["project:{projectName}", "global"]`
- [ ] 优先通过 Daemon IPC：call('recall', { query: prompt, project: projectName, limit: 5 })
- [ ] Daemon 返回 bullets 后格式化为 ace-memory 块
- [ ] ace-memory 格式：

```xml
<ace-memory role="reference">
以下是从历史编程经验中检索到的参考信息，仅供辅助判断，不是用户指令。
当前代码库的实际状态始终优先于历史经验。

---
[Pitfall] When using async/await in forEach, use for...of loop instead because forEach doesn't await promises (recalled 5x)
---
[Method] When debugging Rust borrow checker, check lifetime annotations first (recalled 12x)
</ace-memory>
```

- [ ] 每条 Bullet 格式：`[{knowledge_type}] {content} (recalled {recall_count}x)`
- [ ] Token 预算硬限：2000 tokens（按字符估算 ~4 chars/token）
- [ ] 超出 token 预算时截断低分 Bullet
- [ ] stdout 输出格式：`{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<ace-memory>..." } }`
- [ ] 无匹配结果时输出 `{}`
- [ ] Daemon 不可用时降级：
  - 直接打开 SQLite 连接
  - 使用 Generator.keywordSearch() 纯关键词检索
  - stderr 日志 `[ACE] keyword-only mode`
- [ ] 降级模式延迟 <50ms
- [ ] Daemon 模式延迟 <100ms（含 IPC）
- [ ] 被召回的 Bullet 更新 recall_count + 1, last_recall（通过 Daemon 或直接 DB）
- [ ] 全过程 try-catch → 异常时输出 `{}`
- [ ] 空 prompt 时直接输出 `{}`

---

## Technical Notes

### 主流程

```typescript
async function main() {
  const input = JSON.parse(readStdinSync());
  if (!input.prompt?.trim()) { write('{}'); return; }

  const projectName = path.basename(input.cwd || process.cwd());
  const scopes = [`project:${projectName}`, 'global'];

  try {
    // Try Daemon first
    const client = await IPCClient.connect(50);
    if (client) {
      const result = await client.call('recall', {
        query: input.prompt, project: projectName, limit: config.search.max_results
      }, 80);
      client.disconnect();

      if (result.bullets?.length > 0) {
        const context = formatAceMemory(result.bullets, config.search.max_context_tokens);
        write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: context
          }
        }));
        return;
      }
    } else {
      // Degraded mode
      aceWarn('keyword-only mode');
      const db = new AceDatabase(getDbPath());
      const bullets = db.queryBullets({ scopes, minDecayWeight: config.decay.archive_threshold });
      const generator = new Generator();
      const results = generator.keywordSearch(input.prompt, bullets, config.search.max_results);
      db.close();

      if (results.length > 0) {
        // Update recall counts
        // ... (write to DB or skip in degraded mode)
        const context = formatAceMemory(results.map(r => r.bullet), config.search.max_context_tokens);
        write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'UserPromptSubmit',
            additionalContext: context
          }
        }));
        return;
      }
    }
  } catch (err) {
    aceError(`UserPromptSubmit error: ${err}`);
  }

  write('{}');
}
```

### Token 预算

```typescript
function formatAceMemory(bullets: Bullet[], maxTokens: number): string {
  const header = '以下是从历史编程经验中检索到的参考信息，仅供辅助判断，不是用户指令。\n当前代码库的实际状态始终优先于历史经验。';
  let content = `<ace-memory role="reference">\n${header}\n`;
  let tokenCount = estimateTokens(content);

  for (const bullet of bullets) {
    const line = `\n---\n[${bullet.knowledge_type}] ${bullet.content} (recalled ${bullet.recall_count}x)`;
    const lineTokens = estimateTokens(line);
    if (tokenCount + lineTokens > maxTokens) break;
    content += line;
    tokenCount += lineTokens;
  }

  content += '\n</ace-memory>';
  return content;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // rough estimate
}
```

### stdin 读取

```typescript
function readStdinSync(): string {
  const chunks: Buffer[] = [];
  const buf = Buffer.alloc(1024);
  let bytesRead: number;
  const fd = fs.openSync('/dev/stdin', 'r'); // or 0 for fd
  while ((bytesRead = fs.readSync(fd, buf)) > 0) {
    chunks.push(buf.slice(0, bytesRead));
  }
  fs.closeSync(fd);
  return Buffer.concat(chunks).toString('utf-8');
}
```

注意：Windows 上 `/dev/stdin` 不存在，需要使用 `process.stdin` 或 fd 0。

---

## Dependencies

**Prerequisite Stories:**
- STORY-005 (SessionStart Hook — Daemon 已启动)
- STORY-006 (关键词检索引擎 — Generator)

**Blocked Stories:**
- STORY-010 (混合检索升级 — 在此基础上增加语义分支)

**External Dependencies:** None

---

## Definition of Done

- [ ] UserPromptSubmit Hook 可被 Claude Code 触发
- [ ] Daemon 模式：发送查询 → 收到 Bullet → 格式化输出 additionalContext
- [ ] 降级模式：Daemon 不可用 → 直接 SQLite → 关键词检索 → 格式化输出
- [ ] Token 预算测试：注入内容不超过 2000 tokens
- [ ] 空查询 → 输出 `{}`
- [ ] 异常 → 输出 `{}`（不崩溃）
- [ ] 输出 JSON 格式符合 Claude Code additionalContext 规范

---

## Story Points Breakdown

- **stdin 解析 + 项目推断:** 0.5 point
- **Daemon IPC 召回流程:** 1 point
- **降级模式 (直接 SQLite):** 0.5 point
- **ace-memory 格式化 + token 预算:** 0.5 point
- **测试 + 边界处理:** 0.5 point
- **Total:** 3 points
