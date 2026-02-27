# STORY-016: /ace Skill

**Epic:** EPIC-005 (User Interaction)
**Priority:** Must Have
**Story Points:** 3
**Status:** Done
**Assigned To:** Developer
**Created:** 2026-02-27
**Completed:** 2026-02-27
**Sprint:** 3

---

## User Story

As a developer,
I want to view and manage my knowledge base through the /ace command,
So that I have visibility and control over what Claude has learned.

---

## Description

### Background

用户需要一种直观的方式查看 Playbook 状态、搜索已学知识、管理配置和检查系统健康。/ace Skill 通过 Claude Code 的 Skill 机制（SKILL.md）提供这些能力，底层由 `ace-cli.ts` CLI 工具执行。

### Scope

**In scope:**
- `skills/ace.md`：SKILL.md 定义文件，指导 Claude 调用 CLI
- `scripts/ace-cli.ts`：CLI 入口，支持 6 个子命令
- 直接读取 SQLite（不依赖 Daemon）

**Out of scope:**
- GUI 界面
- 实时更新/推送通知

---

## Acceptance Criteria

- [x] `skills/ace.md`：SKILL.md 定义完整
- [x] `scripts/ace-cli.ts`：CLI 入口实现
- [x] `/ace` 或 `/ace status`：Playbook 统计（total, byScope, byType, bySection）
- [x] `/ace search <query>`：关键词检索，返回 top 10 结果（id, content, scope, section, knowledge_type, finalScore）
- [x] `/ace config`：显示完整当前配置
- [x] `/ace config set <key> <value>`：dot-notation 键更新配置
- [x] `/ace health`：检查 daemon（PID 文件）、IPC（ping 2s 超时）、ONNX 模型目录
- [x] `/ace export`：导出全部 Bullet 为 JSON 数组
- [x] `/ace clear`：清空所有 Bullet（逐条删除）
- [x] 所有输出通过 `JSON.stringify` 格式化
- [x] SKILL.md 指导 Claude 通过 `node dist/scripts/ace-cli.js <command>` 执行
- [x] 单元测试 — 15 tests

---

## Technical Notes

### 已实现的子命令

| 子命令 | 函数 | 描述 |
|--------|------|------|
| `status` | `statusCmd()` | `db.getStats()` 统计 |
| `search <query>` | `searchCmd(query)` | `generator.keywordSearch()` top 10 |
| `config [set <key> <value>]` | `configCmd(args)` | 配置读取/更新 |
| `health` | `healthCmd()` | PID + IPC ping + ONNX 检查 |
| `export` | `exportCmd()` | 全量 Bullet JSON 导出 |
| `clear` | `clearCmd()` | 清空 Playbook |

### 架构设计

- **独立运行**：ace-cli 直接打开 SQLite 连接，不依赖 Daemon IPC
- **JSON 输出**：所有结果通过 `output()` → `console.log(JSON.stringify())` 输出
- **入口守卫**：`require.main === module` 确保测试导入时不自动执行 `main()`
- **错误处理**：无效命令和参数返回 `{ error: "..." }` + `process.exit(1)`

---

## Dependencies

**Prerequisite Stories:**
- STORY-002: SQLite 存储层
- STORY-006: 关键词检索引擎

---

## Implementation Files

| File | Role | Tests |
|------|------|-------|
| `scripts/ace-cli.ts` | CLI 实现（6 子命令） | `tests/scripts/ace-cli.test.ts` — 15 tests |
| `skills/ace.md` | Skill 定义文档 | — |

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
