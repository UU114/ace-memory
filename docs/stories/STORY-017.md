# STORY-017: /learn Skill

**Epic:** EPIC-005 (User Interaction)
**Priority:** Should Have
**Story Points:** 2
**Status:** Done
**Assigned To:** Developer
**Created:** 2026-02-27
**Completed:** 2026-02-27
**Sprint:** 3

---

## User Story

As a developer,
I want to manually teach Claude knowledge with /learn,
So that I can capture insights the automatic system might miss.

---

## Description

### Background

自动学习管道（PostToolUse → Stop → Curate）只能从工具调用交互中提取知识。但很多重要知识——项目偏好、团队约定、经验教训——只存在于开发者脑中。`/learn` Skill 让用户可以直接告诉 ACE "记住这个"。

与 `/ace` 不同，`/learn` 不使用 ace-cli.ts，而是通过 SKILL.md 指导 Claude 构造 `SessionQueueEntry` JSON 并通过 IPC 发送给 Daemon，走完整的 Sanitizer → Classifier → Embedding → Curator → Insert 蒸馏流程。

### Scope

**In scope:**
- `skills/learn.md`：SKILL.md 定义，指导 Claude 完成 6 步知识录入流程
- 通过 Daemon IPC `curate` 方法入库

**Out of scope:**
- 专用 CLI 脚本（`/learn` 完全通过 SKILL.md 指导 Claude 行为实现）
- 批量导入（单条录入）

---

## Acceptance Criteria

- [x] `skills/learn.md`：SKILL.md 定义完整
- [x] `/learn <文本>` 直接模式：Claude 处理提供的文本
- [x] `/learn` 交互模式：Claude 询问用户要记住什么
- [x] Step 1: 理解知识内容
- [x] Step 2: 分类 `pattern_type`（error_fix / code_pattern / command_usage / file_creation）
- [x] Step 3: 确定 `knowledge_type`（Method / Trick / Pitfall / Preference / Knowledge）
- [x] Step 4: 获取项目名（`basename $(pwd)`）
- [x] Step 5: 构造 `SessionQueueEntry` JSON 并通过 IPC 发送 `curate` 请求
- [x] Step 6: 解析结果并报告（added / merged / skipped / daemon 未运行错误）
- [x] IPC 通过临时 JS 脚本执行（避免 shell 转义问题）
- [x] 包含 5 种知识类型的完整示例

---

## Technical Notes

### 实现方式

`/learn` 是纯 SKILL.md 实现——没有专用的 TypeScript 代码。SKILL.md 指导 Claude 执行 6 个步骤：

1. **理解知识** — 解析用户输入
2. **分类** — 确定 pattern_type 和 knowledge_type
3. **获取项目名** — `basename "$(pwd)"`
4. **构造 JSON** — 组装 `SessionQueueEntry`
5. **IPC 发送** — 创建临时 Node.js 脚本，通过 Named pipe/Unix socket 发送 JSON-RPC `curate` 请求
6. **报告结果** — 解析 daemon 响应

### IPC 通信

```javascript
// 临时脚本 /tmp/ace-learn-send.js
// 通过 net.createConnection 连接 Daemon socket
// 发送 JSON-RPC: { method: "curate", params: { insights: [entry], project } }
// 10s 超时
```

### SessionQueueEntry 格式

```json
{
  "timestamp": "ISO 8601",
  "tool_name": "manual",
  "pattern_type": "code_pattern",
  "summary": "[Preference] Always use bun instead of npm in this project.",
  "context": { "command": "bun" },
  "processed": false
}
```

### 知识分类参考

| knowledge_type | 场景 |
|----------------|------|
| Method | 标准方法或技术 |
| Trick | 非显而易见的捷径 |
| Pitfall | 易导致 bug 的陷阱 |
| Preference | 用户/项目偏好 |
| Knowledge | 一般事实性知识 |

---

## Dependencies

**Prerequisite Stories:**
- STORY-013: Reflector 蒸馏器 + Curator 去重（入库管道）
- STORY-016: /ace Skill（Skill 机制前置）

---

## Implementation Files

| File | Role | Tests |
|------|------|-------|
| `skills/learn.md` | Skill 定义（纯 Markdown） | — (无单独测试，通过 E2E 验证) |

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
