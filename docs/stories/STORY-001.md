# STORY-001: 项目脚手架 + TypeScript 类型系统 + 配置

**Epic:** EPIC-006 (Plugin Infrastructure) + EPIC-001 (Storage Foundation)
**Priority:** Must Have
**Story Points:** 3
**Status:** Completed
**Assigned To:** Claude
**Created:** 2026-02-27
**Sprint:** 1

---

## User Story

As a developer,
I want the project structure, type definitions, and config system ready,
So that all subsequent modules have a solid foundation to build on.

---

## Description

### Background
claude-ace 是一个 Claude Code 插件，需要标准的 TypeScript 项目结构、严格的类型定义作为所有后续模块的基础，以及可配置的参数系统。此 Story 是整个项目的第一步，建立开发环境和核心类型契约。

### Scope
**In scope:**
- 项目目录结构创建（按架构文档规定）
- package.json 含所有核心依赖声明
- TypeScript strict mode 配置
- ESLint + Prettier 配置
- Plugin 清单文件 (.claude-plugin/plugin.json, hooks/hooks.json)
- 所有核心 TypeScript 接口定义
- 配置加载器（config.json 读写、默认值生成）
- 日志工具 ([ACE] 前缀)
- 平台适配工具（socket path / pipe name）

**Out of scope:**
- 实际的业务逻辑实现
- 数据库操作
- IPC 通信
- Hook 脚本逻辑

---

## Acceptance Criteria

- [x] package.json 包含：name=claude-ace, main/types 字段, scripts (build/test/lint), dependencies (better-sqlite3, onnxruntime-node), devDependencies (typescript, vitest, eslint, prettier, tsup)
- [x] tsconfig.json: strict=true, target=ES2022, module=Node16, outDir=dist
- [x] vitest.config.ts 配置就绪，可运行 `npm test`
- [x] ESLint + Prettier 配置，可运行 `npm run lint`
- [x] 目录结构完整：hooks/, skills/, engine/, daemon/, storage/, types/, shared/, scripts/, tests/
- [x] .claude-plugin/plugin.json 符合 Claude Code Plugin 标准
- [x] hooks/hooks.json 包含 5 个 Hook 注册（SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd）
- [x] types/bullet.ts: Bullet 接口完整（id, scope, section, content, distilled_rule, code_content, code_language, instructivity_score, knowledge_type, source_type, recall_count, last_recall, decay_weight, related_tools, related_files, key_entities, tags, embedding, created_at, updated_at）
- [x] types/ipc.ts: IPCRequest, IPCResponse, 所有 method params/result 类型
- [x] types/config.ts: AceConfig 接口（decay, reflector, search, daemon 四组）
- [x] types/hook.ts: UserPromptSubmitInput, PostToolUseInput, SessionQueueEntry 等 Hook I/O 类型
- [x] shared/config-loader.ts: loadConfig() 从 ~/.ace-claude/config.json 读取，不存在时生成默认值
- [x] shared/logger.ts: aceLog(msg), aceWarn(msg), aceError(msg) → stderr 输出，格式 `[ACE] message`
- [x] shared/platform.ts: getSocketPath(), getPidPath(), getMetaPath(), getDataDir(), getSessionDir() 平台适配
- [x] TypeScript 编译零错误
- [x] 所有类型文件有导出 index

---

## Technical Notes

### 目录结构

```
claude-ace/
├── .claude-plugin/
│   └── plugin.json
├── hooks/
│   └── hooks.json
├── skills/
├── engine/
├── daemon/
├── storage/
├── types/
│   ├── bullet.ts
│   ├── ipc.ts
│   ├── config.ts
│   ├── hook.ts
│   └── index.ts
├── shared/
│   ├── config-loader.ts
│   ├── logger.ts
│   ├── platform.ts
│   └── index.ts
├── scripts/
├── tests/
│   └── shared/
│       ├── config-loader.test.ts
│       └── platform.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── vitest.config.ts
├── .eslintrc.json
├── .prettierrc
├── .gitignore
└── README.md
```

### Plugin Manifest

```json
// .claude-plugin/plugin.json
{
  "name": "claude-ace",
  "version": "0.1.0",
  "description": "ACE - Adaptive Context Engine. Self-adaptive memory for Claude Code.",
  "hooks": "../hooks/hooks.json",
  "skills": [
    "../skills/ace.md",
    "../skills/learn.md"
  ]
}
```

### Hooks Registration

```json
// hooks/hooks.json
{
  "hooks": [
    { "event": "SessionStart", "command": "node dist/hooks/session-start.js", "timeout": 5000 },
    { "event": "UserPromptSubmit", "command": "node dist/hooks/user-prompt-submit.js", "timeout": 200 },
    { "event": "PostToolUse", "command": "node dist/hooks/post-tool-use.js", "matcher": "Edit|Write|Bash", "timeout": 100 },
    { "event": "Stop", "command": "node dist/hooks/stop.js", "timeout": 10000 },
    { "event": "SessionEnd", "command": "node dist/hooks/session-end.js", "timeout": 30000 }
  ]
}
```

### Config Default Values

参考架构文档 Appendix A，完整默认值：

```typescript
const DEFAULT_CONFIG: AceConfig = {
  decay: { half_life_days: 30, grace_period_days: 7, recall_boost_factor: 0.3, permanent_recall_threshold: 15, archive_threshold: 0.02 },
  reflector: { min_interaction_quality: 0.3, max_content_length: 500, max_code_lines: 3, code_density_reject_threshold: 0.6, llm_evaluate: false, llm_model: "haiku" },
  search: { keyword_weight: 0.6, semantic_weight: 0.4, recency_boost_days: 7, recency_boost_factor: 1.2, max_results: 5, max_context_tokens: 2000, min_score_threshold: 0.1 },
  daemon: { idle_timeout_minutes: 5, max_idle_minutes: 10, session_check_interval_seconds: 60 }
};
```

### Platform Adapter

```typescript
// shared/platform.ts
import os from 'os';
import path from 'path';

export function getDataDir(): string {
  return path.join(os.homedir(), '.ace-claude');
}

export function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\ace-claude-daemon';
  }
  return path.join(getDataDir(), 'daemon.sock');
}

export function getPidPath(): string {
  return path.join(getDataDir(), 'daemon.pid');
}

export function getMetaPath(): string {
  return path.join(getDataDir(), 'daemon.meta.json');
}

export function getSessionDir(): string {
  return path.join(getDataDir(), 'sessions');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'playbook.db');
}
```

### Build Configuration

使用 tsup 编译，每个 Hook 和 Daemon 有独立入口：

```typescript
// tsup.config.ts
export default defineConfig({
  entry: {
    'hooks/session-start': 'hooks/session-start.ts',
    'hooks/user-prompt-submit': 'hooks/user-prompt-submit.ts',
    'hooks/post-tool-use': 'hooks/post-tool-use.ts',
    'hooks/stop': 'hooks/stop.ts',
    'hooks/session-end': 'hooks/session-end.ts',
    'daemon/index': 'daemon/index.ts',
    'scripts/ace-cli': 'scripts/ace-cli.ts',
    'scripts/setup': 'scripts/setup.ts',
    'scripts/install': 'scripts/install.ts',
  },
  format: ['cjs'],
  target: 'node18',
  clean: true,
  external: ['better-sqlite3', 'onnxruntime-node'],
});
```

---

## Dependencies

**Prerequisite Stories:** None (第一个 Story)

**Blocked Stories:**
- STORY-002 (SQLite 存储层 — 需要类型定义)
- STORY-003 (IPC 通信框架 — 需要类型定义和平台适配)
- STORY-008 (安装脚本 — 需要项目结构)
- 所有后续 Story

**External Dependencies:**
- npm registry 可达（安装依赖）
- Node.js ≥ 18 LTS

---

## Definition of Done

- [x] `npm install` 成功，零错误
- [x] `npm run build` TypeScript 编译通过
- [x] `npm test` 通过（config-loader, platform 工具测试）
- [x] `npm run lint` 零 warning
- [x] 所有类型文件正确导出，可被其他模块 import
- [x] config-loader 在 ~/.ace-claude/ 不存在时能正确创建并写入默认配置
- [x] platform.ts 在当前 OS 返回正确路径

---

## Story Points Breakdown

- **项目脚手架 + 构建配置:** 1 point
- **TypeScript 类型定义:** 1 point
- **配置/日志/平台工具 + 测试:** 1 point
- **Total:** 3 points

**Rationale:** 虽然文件数量多，但都是模板性质的设置工作，没有复杂业务逻辑。有架构文档作为精确蓝图，执行清晰。
