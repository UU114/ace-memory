# System Architecture: claude-ace

**Date:** 2026-02-27
**Architect:** TPY
**Version:** 1.0
**Project Type:** Claude Code 插件
**Project Level:** Level 3 (大型, 12-40 Stories)
**Status:** Draft

---

## Document Overview

本文档定义 claude-ace 的系统架构。它为实现阶段提供技术蓝图，解决 PRD 中所有功能需求和非功能需求。

**Related Documents:**
- Product Requirements Document: `docs/prd-claude-ace-2026-02-27.md`
- Product Brief: `docs/product-brief-claude-ace-2026-02-26.md`

---

## Executive Summary

claude-ace 采用 **Hooks + Skills + ACE Daemon + 共享 Engine 库** 四层架构。ACE Daemon 常驻后台持有 ONNX 模型和 SQLite 连接池，通过 IPC（Unix domain socket / Windows Named pipe）对外提供低延迟的嵌入计算、混合检索和知识入库服务。5 个 Hook 脚本（SessionStart、UserPromptSubmit、PostToolUse、Stop、SessionEnd）作为独立 Node.js 进程按事件触发，通过 IPC 与 Daemon 通信。Skills（/ace、/learn）通过 SKILL.md 注册，用户交互层直接调用 Engine CLI。所有数据存储在本地 SQLite 数据库中（`~/.ace-claude/playbook.db`），嵌入向量作为 BLOB 列内联存储。

---

## Architectural Drivers

以下需求对架构设计有重大影响：

1. **NFR-001: Hook 延迟 <100ms** → 需要 Daemon 常驻架构避免 ONNX 冷启动；需要内存向量缓存加速检索
2. **NFR-003: Local-First 零网络** → 所有计算本地完成；ONNX 本地推理替代 API 调用
3. **NFR-004: 容错降级** → Daemon 不可用时降级为关键词检索；Hook 异常不阻塞 Claude Code
4. **NFR-006: 跨平台兼容** → IPC 需同时支持 Unix socket 和 Windows Named pipe；native binding 需三平台编译
5. **FR-023: Daemon 多会话共享** → 单进程架构避免 SQLite 并发写冲突；会话注册/注销生命周期管理
6. **FR-004: additionalContext 注入** → Claude Code 不支持 modifiedQuery，只能通过 additionalContext 追加上下文

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Claude Code Host                     │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │                  Hook Layer                       │   │
│  │  ┌────────────┐ ┌──────────────┐ ┌────────────┐ │   │
│  │  │SessionStart│ │UserPromptSub │ │PostToolUse │ │   │
│  │  │   Hook     │ │   Hook       │ │   Hook     │ │   │
│  │  └─────┬──────┘ └──────┬───────┘ └─────┬──────┘ │   │
│  │  ┌─────┴──────┐ ┌──────┴───────┐               │   │
│  │  │  Stop Hook │ │SessionEnd    │               │   │
│  │  │            │ │   Hook       │               │   │
│  │  └─────┬──────┘ └──────┬───────┘               │   │
│  └────────┼───────────────┼──────────────────────────┘   │
│           │               │                              │
│  ┌────────┼───────────────┼──────────────────────────┐   │
│  │        │  Skill Layer  │                          │   │
│  │  ┌─────┴──────┐ ┌─────┴──────┐                   │   │
│  │  │ /ace Skill │ │/learn Skill│                   │   │
│  │  └────────────┘ └────────────┘                   │   │
│  └───────────────────────────────────────────────────┘   │
└──────────────────────┬───────────────────────────────────┘
                       │ IPC (Unix socket / Named pipe)
                       ▼
┌──────────────────────────────────────────────────────────┐
│                    ACE Daemon (常驻进程)                   │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │                  Engine Library                   │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │    │
│  │  │Generator │ │Reflector │ │ Curator  │        │    │
│  │  │(检索)    │ │(蒸馏)    │ │(去重)    │        │    │
│  │  └──────────┘ └──────────┘ └──────────┘        │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐        │    │
│  │  │  Decay   │ │Classifier│ │Sanitizer │        │    │
│  │  │(衰退)    │ │(分类)    │ │(脱敏)    │        │    │
│  │  └──────────┘ └──────────┘ └──────────┘        │    │
│  │  ┌──────────┐                                   │    │
│  │  │Embedding │                                   │    │
│  │  │(ONNX)    │                                   │    │
│  │  └──────────┘                                   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────┐  ┌────────────────────────┐        │
│  │  SQLite (DB)    │  │ In-Memory Vector Cache │        │
│  │  playbook.db    │  │ (embeddings × 5000)    │        │
│  └─────────────────┘  └────────────────────────┘        │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                  Local File System                        │
│  ~/.ace-claude/                                          │
│  ├── playbook.db          (SQLite 数据库)                 │
│  ├── config.json          (用户配置)                      │
│  ├── daemon.pid           (Daemon PID)                   │
│  ├── daemon.meta.json     (Daemon 元信息)                 │
│  ├── daemon.sock          (Unix socket, Linux/macOS)     │
│  ├── models/              (ONNX 模型文件)                 │
│  │   └── all-MiniLM-L6-v2/                               │
│  └── sessions/            (会话临时队列)                   │
│      └── {session_id}.jsonl                              │
└──────────────────────────────────────────────────────────┘
```

### Architectural Pattern

**Pattern:** Event-Driven Daemon + Hook Pipeline

**Rationale:**

Claude Code 的 Hook 机制决定了每次事件触发都会启动一个新的 Node.js 进程。ONNX 模型加载（冷启动 ~2-3s）和 SQLite 连接建立无法在 Hook 进程的生命周期内高效完成。因此采用 Daemon 常驻架构：

1. **Daemon 常驻** — 一次性支付 ONNX/SQLite 初始化成本，多次 Hook 调用复用
2. **Hook 轻量化** — Hook 脚本仅做 stdin 解析 → IPC 调用 → stdout 输出，极短生命周期
3. **IPC 低延迟** — Unix socket / Named pipe 本地通信延迟 <1ms
4. **单写者模式** — Daemon 独占 SQLite 写权限，消除并发冲突

这不是传统的 Client-Server 架构，而是 **事件驱动管道**：Hook 是管道入口，Daemon 是处理核心，文件系统是共享总线。

---

## Technology Stack

### Runtime

**Choice:** Node.js ≥ 18 LTS + TypeScript 5.x (strict mode)

**Rationale:** Claude Code 本身运行在 Node.js 上，Hook 脚本要求 Node.js 环境。TypeScript strict mode 确保类型安全，便于社区贡献。

**Trade-offs:**
- ✓ Gain: 与 Claude Code 运行时一致，零额外依赖
- ✗ Lose: 相比 Rust ACEST 版本，性能略低；但 Daemon 常驻 + 内存缓存弥补了差距

---

### Database

**Choice:** SQLite (better-sqlite3)

**Rationale:** 单文件数据库，零配置，与 Daemon 单进程架构完美匹配。better-sqlite3 是同步 API，避免异步回调复杂度。native binding 三平台编译稳定。

**Trade-offs:**
- ✓ Gain: 安装体积小（~10MB native binding），无需额外数据库进程，SQL 查询灵活
- ✗ Lose: 向量检索需内存 brute-force（无原生 ANN），但 5000 条规模 <20ms 可接受

**替代方案评估:**
| 方案 | 安装体积 | 向量检索 | 元数据查询 | 适合 Daemon |
|------|----------|----------|------------|-------------|
| better-sqlite3 | ~10MB | 内存 brute-force | SQL WHERE | ✓ 完美 |
| LanceDB | ~50MB+ | 原生 ANN | Arrow 过滤 | ✗ 过重 |
| JSONL | 0 | 需全量扫描 | 需全量扫描 | ✗ 无索引 |

---

### Embedding

**Choice:** onnxruntime-node + all-MiniLM-L6-v2 ONNX

**Rationale:** 384 维嵌入，模型文件 ~80MB，推理延迟 <50ms/条。支持中英文。ONNX Runtime 三平台可用。

**Trade-offs:**
- ✓ Gain: 完全本地推理，零 API 成本，零网络依赖
- ✗ Lose: 需要手动 `ace setup` 下载模型；中文嵌入质量不如专用中文模型，但对关键词 + 语义混合检索足够

---

### IPC

**Choice:** Unix domain socket (Linux/macOS) + Named pipe (Windows)

**Rationale:** 本地 IPC 延迟 <1ms，远优于 HTTP/TCP localhost。原生支持，无需额外依赖。

**Format:** JSON-RPC 2.0 over line-delimited JSON

---

### Development & Build

| 工具 | 选择 | 用途 |
|------|------|------|
| Build | tsup / esbuild | 快速 TypeScript 编译 |
| Test | vitest | 单元测试 + 覆盖率 |
| Lint | ESLint + Prettier | 代码质量 |
| Package | npm | Claude Code Plugin 标准分发 |
| VCS | Git + GitHub | 源码管理 + 开源托管 |

---

## System Components

### Component 1: ACE Daemon

**Purpose:** 常驻后台进程，持有重量级资源（ONNX 模型 + SQLite 连接 + 向量缓存），通过 IPC 对外暴露服务。

**Responsibilities:**
- ONNX 模型加载与推理（embedding 计算）
- SQLite 连接管理（读写 playbook.db）
- 内存向量缓存维护（启动时加载，增量更新）
- IPC 请求分发（recall、curate、session 管理）
- 会话生命周期管理（注册/注销/存活检测）
- 自管理（空闲退出、版本检测、异常清理）

**Interfaces:**
- IPC: Unix domain socket `~/.ace-claude/daemon.sock` 或 Named pipe `\\.\pipe\ace-claude-daemon`
- Protocol: JSON-RPC 2.0 over newline-delimited JSON

**IPC Protocol Detail:**

```typescript
// Request format
interface IPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

// Response format
interface IPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// Methods:
// "ping"               → { status, version, uptime, active_sessions }
// "recall"             → params: { query, project, limit } → { bullets: Bullet[] }
// "curate"             → params: { insights: CandidateInsight[] } → { added, merged, skipped }
// "embed"              → params: { text } → { vector: number[] }
// "session_register"   → params: { session_id, pid }
// "session_unregister" → params: { session_id }
// "shutdown"           → graceful exit
// "decay_update"       → trigger batch decay recalculation
```

**Lifecycle State Machine:**

```
                    ┌───────────────┐
        ┌──────────│   NOT_RUNNING  │◄─────────────┐
        │          └───────┬───────┘               │
        │    SessionStart  │                       │
        │    Hook 触发     │                       │
        │                  ▼                       │
        │          ┌───────────────┐               │
        │          │   STARTING    │               │
        │          │ (ONNX加载)   │               │
        │          └───────┬───────┘               │
        │                  │ ready                  │
        │                  ▼                       │
        │          ┌───────────────┐   idle 5min   │
  PID文件 ─────────│    RUNNING    │───────────────┘
  检测失败         │ (serving IPC) │
                   └───────┬───────┘
                           │ shutdown / 10min兜底
                           ▼
                   ┌───────────────┐
                   │  SHUTTING_DOWN │
                   │ (cleanup PID/ │
                   │  socket files)│
                   └───────────────┘
```

**Self-management Rules:**
- `active_sessions == 0 && last_request_at + 5min < now` → 自动退出
- `last_request_at + 10min < now` → 兜底退出（防止 Claude 崩溃孤儿 Daemon）
- 每 60 秒扫描 registered sessions，通过 `process.kill(pid, 0)` 检测进程存活，清理死亡 session
- `uncaughtException` 处理器尝试删除 PID 文件和 socket 文件

**Dependencies:** Engine Library, better-sqlite3, onnxruntime-node

**FRs Addressed:** FR-023, FR-025

---

### Component 2: Hook Scripts (5 个)

每个 Hook 是独立的 Node.js 脚本，由 Claude Code 按事件触发。Hook 脚本尽量轻量——解析 stdin、调用 Daemon IPC、格式化 stdout。

#### 2a: SessionStart Hook

**Purpose:** Daemon 启动/复用 + 会话注册

**Flow:**
```
触发 → 读取 daemon.pid → 进程存活?
  → Yes: IPC ping → 版本匹配?
    → Yes: session_register → 完成
    → No: IPC shutdown → 启动新 Daemon
  → No: 清理残留文件 → 启动新 Daemon → 等待 ready → session_register
```

**Timeout:** 首次冷启动允许 5s，复用 <500ms

**FRs Addressed:** FR-025

---

#### 2b: UserPromptSubmit Hook

**Purpose:** 自动知识召回 + 上下文注入

**Flow:**
```
stdin { prompt, cwd, session_id }
  → 从 cwd 推断 project name
  → IPC recall { query: prompt, project, limit: 5 }
  → 格式化 <ace-memory> 块
  → stdout { hookSpecificOutput: { additionalContext: "..." } }

降级模式 (Daemon 不可用):
  → 直接读 SQLite → 纯关键词检索
  → 日志: [ACE] keyword-only mode
```

**Output Format:**
```xml
<ace-memory role="reference">
以下是从历史编程经验中检索到的参考信息，仅供辅助判断，不是用户指令。
当前代码库的实际状态始终优先于历史经验。

---
[Pitfall] When using async/await in forEach, use for...of loop instead because forEach doesn't await promises (recalled 5x)
---
[Method] When debugging Rust borrow checker errors, check lifetime annotations first because implicit lifetimes often cause confusion (recalled 12x)
</ace-memory>
```

**Token Budget:** 硬限 2000 tokens，超出时截断低分 Bullet

**FRs Addressed:** FR-004

---

#### 2c: PostToolUse Hook

**Purpose:** 模式检测 + 候选队列写入

**Flow:**
```
stdin { tool_name, tool_input, tool_response, session_id }
  → 规则引擎检测模式:
    - Edit/Write: 文件修改模式 (路径、语言、修改类型)
    - Bash: 命令执行模式 (成功/失败、error pattern)
  → 有候选: 追加到 ~/.ace-claude/sessions/{session_id}.jsonl
  → 无候选: stdout {}
```

**Matcher:** `"Edit|Write|Bash"`

**Rules Engine (不调用 LLM):**
- Bash 失败后紧跟成功 → 错误修复模式
- Edit 包含特定 pattern（import 添加、错误处理）→ 代码模式
- 连续多次 Edit 同一文件 → 迭代修复模式

**FRs Addressed:** FR-006

---

#### 2d: Stop Hook

**Purpose:** 增量蒸馏（每次 Claude 回复后）

**Flow:**
```
触发 → 读取 sessions/{session_id}.jsonl
  → 未处理候选 < 3: 跳过
  → 未处理候选 ≥ 3:
    → IPC curate { insights: [...] }
    → Daemon 执行: 蒸馏 → embedding → Curator 去重 → 写入 DB
    → 标记候选为已处理
  → Daemon 不可用: 跳过，交给 SessionEnd 兜底
```

**FRs Addressed:** FR-024

---

#### 2e: SessionEnd Hook

**Purpose:** 兜底清理 + 会话注销

**Flow:**
```
触发 → 读取 sessions/{session_id}.jsonl 残余候选
  → 有残余: 蒸馏+入库 (通过 Daemon 或直接操作)
  → 清理会话队列文件
  → IPC session_unregister { session_id }
  → 输出统计: [ACE] Session complete. +N new, ~N merged, -N skipped
```

**FRs Addressed:** FR-005

---

### Component 3: Engine Library

**Purpose:** 核心算法库，被 Daemon 和 Hook (降级模式) 共同引用。

**Modules:**

#### 3a: Generator (检索引擎)

**Responsibilities:**
- 多层关键词评分 (L1 精确 +15, L2 模糊 2-gram/stemming, L3 元数据前缀)
- 混合评分公式: `FinalScore = (KeywordScore × 0.6 + SemanticScore × 0.4) × DecayWeight × RecencyBoost`
- RecencyBoost: 7 天内 ×1.2
- Token 预算控制

**FRs Addressed:** FR-003, FR-008

---

#### 3b: Reflector (蒸馏器)

**Responsibilities:**
- 候选模式蒸馏为结构化 Bullet
- 内容控制: content ≤ 500 chars, code_content ≤ 3 lines, 代码占比 >60% 拒绝
- 格式化为 "When X, do Y because Z" 规则
- 自动提取 key_entities、related_files 到 metadata
- 自动判断 scope（项目路径引用 → project:{name}，通用知识 → global）
- 隐私脱敏 (委托 Sanitizer)

**FRs Addressed:** FR-005, FR-024

---

#### 3c: Curator (去重器)

**Responsibilities:**
- 新 Bullet 入库前语义去重检查
- Cosine similarity 阈值 0.8（可配置）
- Merge 策略: 合并内容、保留较高 recall_count、更新 updated_at
- 更新内存向量缓存

**FRs Addressed:** FR-009

---

#### 3d: Decay (衰退管理器)

**Responsibilities:**
- 指数衰退: `decay_weight = 2^(-age_days / half_life) × (1 + recall_boost × recall_count)`
- 半衰期 30 天，新知识 7 天保护期
- recall_count ≥ 15 永久保留
- decay_weight < 0.02 自动归档
- 每次召回更新 recall_count / last_recall / decay_weight

**FRs Addressed:** FR-011

---

#### 3e: Classifier (内容分类器)

**Responsibilities:**
- knowledge_type 分类: Method / Trick / Pitfall / Preference / Knowledge
- instructivity_score 评分 (0-100)
- 内容密度惩罚: `final_score = base_score × (0.6 + 0.4 × content_density / 100)`
- 蒸馏奖励 +5 分
- 低分过滤 (< min_interaction_quality 拒绝)

**FRs Addressed:** FR-010

---

#### 3f: Sanitizer (脱敏器)

**Responsibilities:**
- 正则检测 API Key (sk-xxx, ghp_xxx, AKIA..., etc.)
- 检测密码/Token 字符串
- 替换含用户名的绝对路径为通用占位符 `~`
- 审计日志 (记录过滤原因，不记录内容)

**FRs Addressed:** FR-022

---

#### 3g: Embedding (嵌入模块)

**Responsibilities:**
- ONNX Runtime Session 管理
- 文本 tokenize + 推理 → 384 维向量
- 批量嵌入接口
- Cosine similarity 计算

**FRs Addressed:** FR-007

---

### Component 4: Skill Definitions

#### 4a: /ace Skill (SKILL.md)

**Purpose:** Playbook 管理主入口

**Commands:**
- `status` — Bullet 数量、分类分布、衰退分布统计
- `search [query]` — 交互式混合检索
- `review` — 最近添加的 Bullet
- `conflicts` — 冲突扫描结果
- `export` — 导出 JSON/Markdown
- `config` — 查看/编辑配置
- `setup` — 下载 ONNX 模型

**Implementation:** SKILL.md 指令 Claude 调用 Engine CLI 脚本 (`node scripts/ace-cli.js`)

**FRs Addressed:** FR-012, FR-021

---

#### 4b: /learn Skill (SKILL.md)

**Purpose:** 手动知识录入

**Implementation:** SKILL.md 指令 Claude 解析用户输入，调用 Engine CLI 写入 Bullet

**FRs Addressed:** FR-013

---

### Component 5: Storage Layer

**Purpose:** SQLite 数据库 + 会话临时文件

**Details:** 见 Data Architecture 章节

**FRs Addressed:** FR-001, FR-002, FR-014

---

## Data Architecture

### Data Model

**Core Entity: Bullet**

```typescript
interface Bullet {
  // Primary
  id: string;                    // UUID v4
  scope: string;                 // "global" | "project:{name}"
  section: string;               // "techniques" | "pitfalls" | "preferences" | "knowledge" | "methods"
  content: string;               // ≤500 chars, distilled rule text
  distilled_rule: string | null; // "When X, do Y because Z" format (optional LLM-generated)

  // Code (optional, very short)
  code_content: string | null;   // ≤3 lines, minimal code snippet
  code_language: string | null;  // "rust", "typescript", etc.

  // Metadata
  instructivity_score: number;   // 0-100
  knowledge_type: string;        // "Method" | "Trick" | "Pitfall" | "Preference" | "Knowledge"
  source_type: string;           // "auto" | "manual" | "imported"
  recall_count: number;          // times recalled
  last_recall: string | null;    // ISO 8601 datetime
  decay_weight: number;          // 0.0 - 1.0
  related_tools: string[];       // ["cargo", "git", ...]
  related_files: string[];       // ["src/main.rs", ...]
  key_entities: string[];        // ["BorrowChecker", "async_trait", ...]

  // Tags
  tags: string[];                // user-defined and auto-generated

  // Embedding
  embedding: Float32Array;       // 384-dim vector, stored as BLOB

  // Timestamps
  created_at: string;            // ISO 8601
  updated_at: string;            // ISO 8601
}
```

**Secondary Entity: Session Queue Entry (file-based)**

```typescript
interface SessionQueueEntry {
  timestamp: string;             // ISO 8601
  tool_name: string;             // "Edit" | "Write" | "Bash"
  pattern_type: string;          // "error_fix" | "code_pattern" | "command_usage"
  summary: string;               // brief description of what happened
  context: {
    file?: string;
    language?: string;
    error_message?: string;
    command?: string;
  };
  processed: boolean;            // marked true after distillation
}
```

---

### Database Design

**SQLite Schema:**

```sql
-- Bullets table (core knowledge store)
CREATE TABLE IF NOT EXISTS bullets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  distilled_rule TEXT,
  code_content TEXT,
  code_language TEXT,
  instructivity_score REAL NOT NULL DEFAULT 0,
  knowledge_type TEXT NOT NULL DEFAULT 'Knowledge',
  source_type TEXT NOT NULL DEFAULT 'auto',
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recall TEXT,
  decay_weight REAL NOT NULL DEFAULT 1.0,
  related_tools TEXT NOT NULL DEFAULT '[]',    -- JSON array
  related_files TEXT NOT NULL DEFAULT '[]',    -- JSON array
  key_entities TEXT NOT NULL DEFAULT '[]',     -- JSON array
  tags TEXT NOT NULL DEFAULT '[]',             -- JSON array
  embedding BLOB,                              -- 384 × float32 = 1536 bytes
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_bullets_scope ON bullets(scope);
CREATE INDEX IF NOT EXISTS idx_bullets_section ON bullets(section);
CREATE INDEX IF NOT EXISTS idx_bullets_knowledge_type ON bullets(knowledge_type);
CREATE INDEX IF NOT EXISTS idx_bullets_decay_weight ON bullets(decay_weight);
CREATE INDEX IF NOT EXISTS idx_bullets_scope_decay ON bullets(scope, decay_weight);

-- Archive table (decayed bullets)
CREATE TABLE IF NOT EXISTS archive (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  knowledge_type TEXT NOT NULL,
  recall_count INTEGER NOT NULL,
  decay_weight REAL NOT NULL,
  created_at TEXT NOT NULL,
  archived_at TEXT NOT NULL
);

-- Conflicts table (detected conflicts)
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  bullet_a_id TEXT NOT NULL,
  bullet_b_id TEXT NOT NULL,
  conflict_type TEXT NOT NULL,    -- "Semantic" | "Negation" | "Version"
  description TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (bullet_a_id) REFERENCES bullets(id),
  FOREIGN KEY (bullet_b_id) REFERENCES bullets(id)
);

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

**Storage Estimates:**

| 规模 | Bullet 数 | DB 文件大小 | 内存向量缓存 |
|------|-----------|-------------|-------------|
| 轻度 (1 月) | 100-300 | ~1 MB | ~0.5 MB |
| 中度 (6 月) | 1000-2000 | ~5 MB | ~3 MB |
| 重度 (1 年) | 3000-5000 | ~12 MB | ~7.5 MB |

**JSON Array 字段存储约定:**

`related_tools`、`related_files`、`key_entities`、`tags` 存储为 JSON 字符串（SQLite 不原生支持数组）。读取时 `JSON.parse()`，写入时 `JSON.stringify()`。关键词检索时使用 `LIKE '%keyword%'` 或 `json_each()` 函数。

---

### Data Flow

#### Flow 1: Knowledge Recall (召回)

```
User types prompt
  → Claude Code triggers UserPromptSubmit Hook
  → Hook reads stdin { prompt, cwd, session_id }
  → Hook connects to Daemon via IPC
  → Daemon.Generator:
    1. Extract keywords from prompt
    2. SQL query: SELECT * FROM bullets WHERE scope IN (project, global) AND decay_weight > 0.02
    3. L1/L2/L3 keyword scoring on results
    4. Cosine similarity against in-memory vectors
    5. Hybrid score = keyword × 0.6 + semantic × 0.4 × decay × recency
    6. Top-K results (default 5)
    7. Update recall_count, last_recall, decay_weight
  → Daemon returns { bullets: [...] }
  → Hook formats <ace-memory> block
  → Hook outputs { hookSpecificOutput: { additionalContext: "..." } }
  → Claude Code injects context into conversation
```

#### Flow 2: Knowledge Learning (学习)

```
Claude uses Edit/Write/Bash tool
  → Claude Code triggers PostToolUse Hook
  → Hook runs rules engine on tool data
  → Candidate appended to sessions/{session_id}.jsonl

Claude finishes response
  → Claude Code triggers Stop Hook
  → Stop Hook checks queue length ≥ 3
  → Stop Hook sends candidates to Daemon via IPC
  → Daemon.Reflector:
    1. Sanitizer filters PII
    2. Distill candidate → content ≤ 500 chars
    3. Auto-detect scope (project/global)
    4. Extract metadata (entities, files, tools)
    5. Classifier assigns knowledge_type + score
  → Daemon.Embedding: compute 384-dim vector
  → Daemon.Curator: cosine similarity check against existing bullets
    → similarity > 0.8: Merge
    → similarity ≤ 0.8: Insert
  → Daemon.Decay: set initial decay_weight = 1.0
  → Update in-memory vector cache
  → Mark candidates as processed in queue file
```

#### Flow 3: Daemon Lifecycle

```
Claude Code session starts
  → SessionStart Hook:
    1. Check daemon.pid exists?
    2. Process alive? (kill -0)
    3. IPC ping → version match?
    4. All yes → session_register → done
    5. Otherwise → start new Daemon → wait ready → session_register

Daemon running:
  → Every 60s: check registered sessions alive
  → Dead session detected → remove from active list
  → active_sessions == 0 && idle > 5min → self-terminate
  → last_request > 10min → forced self-terminate

Claude Code session ends
  → SessionEnd Hook:
    1. Process residual queue
    2. IPC session_unregister
    3. Daemon checks if active_sessions == 0
    4. If empty → start idle timer (5min)
```

---

## API Design

### IPC Protocol Architecture

**Transport:** Unix domain socket / Windows Named pipe
**Format:** JSON-RPC 2.0, newline-delimited
**Encoding:** UTF-8

### Endpoints (IPC Methods)

```
┌─────────────────────┬─────────────────────────────┬──────────────────────────┐
│ Method              │ Params                       │ Result                   │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ ping                │ {}                           │ { status, version,       │
│                     │                              │   uptime, sessions }     │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ recall              │ { query: string,             │ { bullets: Bullet[],     │
│                     │   project: string,           │   total_matched: number }│
│                     │   limit?: number }           │                          │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ curate              │ { insights:                  │ { added: number,         │
│                     │   CandidateInsight[] }       │   merged: number,        │
│                     │                              │   skipped: number }      │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ embed               │ { text: string }             │ { vector: number[] }     │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ session_register    │ { session_id: string,        │ { ok: true }             │
│                     │   pid: number }              │                          │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ session_unregister  │ { session_id: string }       │ { ok: true,              │
│                     │                              │   remaining: number }    │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ shutdown            │ {}                           │ { ok: true }             │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ decay_update        │ {}                           │ { updated: number,       │
│                     │                              │   archived: number }     │
├─────────────────────┼─────────────────────────────┼──────────────────────────┤
│ stats               │ {}                           │ { total_bullets,         │
│                     │                              │   by_scope, by_type,     │
│                     │                              │   decay_distribution }   │
└─────────────────────┴─────────────────────────────┴──────────────────────────┘
```

### Authentication & Authorization

**N/A** — 纯本地 IPC，无需认证。Socket 文件权限 0600（仅当前用户可访问）。Named pipe 权限限制为当前用户 SID。

---

## Non-Functional Requirements Coverage

### NFR-001: Performance — Hook 延迟

**Requirement:** UserPromptSubmit <100ms (Daemon) / <50ms (降级)。PostToolUse <50ms。SessionStart 冷启动 <5s。

**Architecture Solution:**
- **Daemon 常驻**: ONNX 模型和 SQLite 连接一次性初始化，避免 Hook 冷启动
- **IPC 延迟**: Unix socket / Named pipe 本地通信 <1ms
- **内存向量缓存**: 启动时加载所有活跃 embedding 到内存，brute-force cosine similarity 5000 条 <20ms
- **SQL 预过滤**: scope + decay_weight 索引将搜索范围缩小到相关子集
- **超时降级**: UserPromptSubmit 100ms 超时后自动降级到纯关键词

**Validation:**
- Benchmark: 5000 条 Bullet，模拟 UserPromptSubmit 端到端延迟
- p95 < 100ms (Daemon mode), p95 < 50ms (keyword-only)

---

### NFR-002: Performance — 存储效率

**Requirement:** SQLite 在千级 Bullet 规模下保持高效。

**Architecture Solution:**
- **SQLite WAL 模式**: 启用 Write-Ahead Logging，读写并发不阻塞
- **索引覆盖**: scope, section, knowledge_type, decay_weight 建索引
- **BLOB 存储**: embedding 作为 1536 bytes BLOB 内联存储，无需额外向量索引文件
- **单文件数据库**: playbook.db 单文件，便于备份和迁移

**Validation:**
- 5000 条 Bullet 时 DB 文件 <15MB
- SQL 查询（带索引）< 10ms
- 单条插入 < 5ms

---

### NFR-003: Security — Local-First 数据安全

**Requirement:** 零网络请求（LLM 评估关闭时）。

**Architecture Solution:**
- **ONNX 本地推理**: 嵌入计算完全在本地完成
- **SQLite 本地存储**: 所有数据在 `~/.ace-claude/` 目录
- **Socket 权限**: Unix socket 文件权限 0600；Named pipe 限当前用户
- **Sanitizer**: 入库前自动过滤 API Key、Token、密码、含用户名路径
- **无 telemetry**: 插件不收集任何使用数据

**Validation:**
- 网络抓包验证零出站连接
- strace/Process Monitor 确认无网络 syscall

---

### NFR-004: Reliability — 容错与降级

**Requirement:** Hook 失败不影响 Claude Code。

**Architecture Solution:**
- **三层降级**:
  1. Daemon + ONNX + SQLite → 完整混合检索
  2. 直接 SQLite 访问 → 纯关键词检索
  3. 全部失败 → 空 JSON `{}`，Claude Code 正常工作
- **超时机制**: 每个 IPC 调用 50ms 超时
- **异常捕获**: 顶层 try-catch，任何异常输出 `{}`
- **文件损坏恢复**: 会话队列 JSONL 逐行解析，错误行跳过

**Validation:**
- 模拟 Daemon 崩溃，验证 Hook 降级行为
- 模拟 DB 损坏，验证自动恢复
- 模拟 IPC 超时，验证降级到关键词模式

---

### NFR-005: Maintainability — 代码质量

**Requirement:** TypeScript strict, >70% 测试覆盖。

**Architecture Solution:**
- **TypeScript strict mode**: noImplicitAny, strictNullChecks, strictFunctionTypes
- **模块化设计**: Engine 各模块独立，可单独测试
- **清晰目录结构**: hooks/ skills/ engine/ types/ scripts/
- **Vitest 测试**: 单元测试 + 集成测试
- **算法对照**: 关键算法（Decay, Generator 评分）与 Rust ACEST 结果对比

**Validation:**
- vitest coverage report > 70%
- TypeScript 零编译错误
- ESLint 零 warning

---

### NFR-006: Compatibility — Claude Code 兼容性

**Requirement:** 三平台可用，稳定 API。

**Architecture Solution:**
- **IPC 适配器模式**: 统一 IPC 接口，底层根据 `process.platform` 切换 Unix socket / Named pipe
- **Native binding**: better-sqlite3 和 onnxruntime-node 都提供 prebuilt binaries（Win/Mac/Linux）
- **Plugin 标准**: 遵循 Claude Code Plugin 结构 (`.claude-plugin/plugin.json`)
- **Hook API**: 仅使用稳定事件 (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd)

**Validation:**
- Windows 11, macOS 14+, Ubuntu 22.04 三平台测试
- Claude Code 最新稳定版验证

---

### NFR-007: Usability — 零配置启动

**Requirement:** 安装后无需配置。

**Architecture Solution:**
- **默认配置**: `config.json` 所有参数有合理默认值
- **自动初始化**: 首次 SessionStart 自动创建目录、初始化 DB schema、生成默认配置
- **自动 CLAUDE.md 注入**: 安装时自动追加行为指令
- **渐进增强**: 无 ONNX 模型时纯关键词工作，有模型后自动升级为混合检索

**Validation:**
- 全新安装 → 第一次对话 → 自动初始化 → 正常工作（纯关键词模式）
- `ace setup` 后 → 自动升级为混合检索

---

## Security Architecture

### Authentication

**N/A** — 纯本地应用，无用户认证需求。

### Authorization

- Socket 文件权限 0600（仅 owner 可读写）
- Named pipe ACL 限制为当前用户 SID
- 无远程访问能力

### Data Encryption

- **At Rest**: 依赖文件系统加密（BitLocker / FileVault / LUKS）
- **In Transit**: 本地 IPC，无网络传输，无需 TLS
- **Key Management**: 无密钥管理需求

### Security Best Practices

- **Input Sanitization**: Sanitizer 模块自动过滤 PII (FR-022)
- **Path Traversal Prevention**: 所有文件路径归一化，限制在 `~/.ace-claude/` 下
- **Injection Prevention**: better-sqlite3 使用参数化查询，禁止字符串拼接 SQL
- **Process Isolation**: Hook 脚本作为独立进程运行，崩溃不影响 Claude Code
- **No eval()**: 禁止使用 eval() 或 new Function()
- **Dependency Audit**: npm audit 检查依赖漏洞

---

## Scalability & Performance

### Scaling Strategy

**单用户本地应用，不需要水平扩展。** 垂直扩展维度：

- **Bullet 增长**: 5000 条为设计上限。超过后 Decay 自动归档低权重条目维持活跃数量
- **向量缓存**: 5000 × 384 × 4 bytes = 7.5MB 内存占用，在可接受范围
- **SQLite**: 单文件可支撑数十万行，远超需求

### Performance Optimization

- **SQL 索引**: 覆盖高频查询的 WHERE 条件
- **内存向量**: 启动时一次性加载，避免每次检索 IO
- **增量缓存**: 新 Bullet 插入时同步更新内存向量，无需全量重载
- **ONNX Session 复用**: Daemon 启动时创建 InferenceSession，所有请求复用
- **WAL 模式**: SQLite Write-Ahead Logging 减少读写互斥

### Caching Strategy

| 缓存层 | 内容 | 更新策略 | 大小 |
|--------|------|----------|------|
| 内存向量缓存 | 所有活跃 Bullet 的 embedding | 增量 (insert/delete 同步) | ~7.5MB |
| ONNX Session | 模型权重 | 进程生命周期 | ~300MB RAM |
| SQLite Page Cache | 热数据页 | SQLite 自管理 | 默认 2MB |
| 配置缓存 | config.json 内容 | 每次 Hook 触发重读 | ~1KB |

### Load Balancing

**N/A** — 单进程 Daemon 架构，无需负载均衡。

---

## Reliability & Availability

### High Availability Design

**不适用** — 本地单用户应用，无 HA 需求。可用性保证通过降级策略实现：

- Daemon 不可用 → 关键词检索降级
- SQLite 不可用 → 空响应，不阻塞用户
- ONNX 不可用 → 关键词检索（无语义匹配）

### Disaster Recovery

- **RPO**: 实时（SQLite WAL 日志）
- **RTO**: 下次 SessionStart 自动恢复（重启 Daemon）
- **Backup**: 用户可手动复制 `~/.ace-claude/playbook.db`

### Backup Strategy

- 自动：Decay 归档到 archive 表（不删除）
- 手动：`/ace export` 导出完整 JSON 备份
- 建议：将 `~/.ace-claude/` 加入用户自己的备份计划

### Monitoring & Alerting

- **日志**: stderr 输出到 Claude Code 日志系统，格式 `[ACE] message`
- **统计**: `/ace status` 展示 Playbook 健康度指标
- **异常**: Hook 异常记录到 stderr，不中断用户

---

## Integration Architecture

### External Integrations

| 集成对象 | 接口方式 | 方向 | 用途 |
|----------|----------|------|------|
| Claude Code (Hooks) | stdin/stdout JSON | 双向 | 事件触发 + 上下文注入 |
| Claude Code (Skills) | SKILL.md | 单向 | 用户命令注册 |
| Claude Code (CLAUDE.md) | 文件追加 | 单向 | 行为指令注入 |
| HuggingFace (setup only) | HTTPS Download | 下载 | ONNX 模型下载 |
| Claude API (optional) | Claude SDK | 调用 | LLM 评估 (FR-020, 默认关闭) |

### Internal Integrations

```
Hook Scripts ──IPC──→ ACE Daemon ──→ Engine Library ──→ SQLite
     │                    │
     │                    ├──→ ONNX Runtime
     │                    │
     └──File I/O──→ Session Queue Files (.jsonl)
```

### Message/Event Architecture

**Event Pipeline:**

```
SessionStart ────→ Daemon 启动/复用
                   │
UserPromptSubmit → recall → additionalContext 注入
                   │
PostToolUse ─────→ 候选写入 session queue
                   │
Stop ────────────→ 增量蒸馏 (≥3 candidates)
                   │
SessionEnd ──────→ 兜底清理 + session 注销
```

---

## Development Architecture

### Code Organization

```
claude-ace/
├── .claude-plugin/
│   └── plugin.json              # Claude Code Plugin 清单
├── hooks/
│   ├── hooks.json               # Hook 注册配置
│   ├── session-start.ts         # SessionStart Hook
│   ├── user-prompt-submit.ts    # UserPromptSubmit Hook
│   ├── post-tool-use.ts         # PostToolUse Hook
│   ├── stop.ts                  # Stop Hook
│   └── session-end.ts           # SessionEnd Hook
├── skills/
│   ├── ace.md                   # /ace Skill 定义
│   └── learn.md                 # /learn Skill 定义
├── engine/
│   ├── generator.ts             # 检索引擎 (keyword + semantic + scoring)
│   ├── reflector.ts             # 蒸馏器 (candidate → bullet)
│   ├── curator.ts               # 去重器 (cosine dedup + merge)
│   ├── decay.ts                 # 衰退管理 (Ebbinghaus formula)
│   ├── classifier.ts            # 内容分类 + 质量评分
│   ├── sanitizer.ts             # 隐私脱敏
│   ├── embedding.ts             # ONNX 嵌入模块
│   └── rules-engine.ts          # PostToolUse 规则引擎
├── daemon/
│   ├── index.ts                 # Daemon 主进程入口
│   ├── ipc-server.ts            # IPC 服务器 (socket/pipe)
│   ├── lifecycle.ts             # 生命周期管理 (idle exit, session tracking)
│   └── vector-cache.ts          # 内存向量缓存
├── storage/
│   ├── sqlite.ts                # SQLite 封装 (better-sqlite3)
│   ├── schema.ts                # DDL + migrations
│   └── session-queue.ts         # 会话队列文件读写
├── types/
│   ├── bullet.ts                # Bullet 类型定义
│   ├── ipc.ts                   # IPC 协议类型
│   ├── config.ts                # 配置类型
│   └── hook.ts                  # Hook stdin/stdout 类型
├── shared/
│   ├── ipc-client.ts            # IPC 客户端 (Hook 端使用)
│   ├── config-loader.ts         # 配置加载器
│   ├── logger.ts                # 日志工具 ([ACE] prefix)
│   └── platform.ts              # 平台适配 (socket path / pipe name)
├── scripts/
│   ├── ace-cli.ts               # CLI 入口 (Skill 调用)
│   ├── setup.ts                 # ONNX 模型下载
│   └── install.ts               # 安装后初始化 (CLAUDE.md 注入)
├── tests/
│   ├── engine/                  # Engine 模块单元测试
│   ├── daemon/                  # Daemon 集成测试
│   ├── hooks/                   # Hook 端到端测试
│   └── fixtures/                # 测试数据
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

### Module Boundaries

```
┌─────────────────────────────────────────────────┐
│                  hooks/ (Entry Layer)             │
│  Each hook: stdin parse → IPC call → stdout      │
│  Dependencies: shared/ipc-client, types/         │
│  NO direct import of engine/ or storage/         │
└──────────────────────┬──────────────────────────┘
                       │ IPC (JSON-RPC)
┌──────────────────────▼──────────────────────────┐
│                daemon/ (Service Layer)            │
│  Imports: engine/*, storage/*, shared/*           │
│  Owns: ONNX session, SQLite connection, vectors  │
└──────────────────────┬──────────────────────────┘
                       │ function calls
┌──────────────────────▼──────────────────────────┐
│                engine/ (Business Logic)           │
│  Pure functions + classes, no I/O side effects   │
│  Dependencies: types/ only                       │
│  Testable in isolation                           │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│                storage/ (Data Layer)              │
│  SQLite operations + file queue I/O              │
│  Dependencies: better-sqlite3, types/            │
└─────────────────────────────────────────────────┘
```

**Key Rule:** Hook 脚本禁止直接 import engine/ 或 storage/（降级模式除外）。所有重逻辑通过 IPC 委托 Daemon。

---

### Testing Strategy

| 层级 | 工具 | 覆盖目标 | 关键测试 |
|------|------|----------|----------|
| 单元测试 | vitest | >70% | Generator 评分算法、Decay 公式、Classifier 规则、Sanitizer 正则 |
| 集成测试 | vitest | Daemon + Engine | IPC 请求/响应、recall 端到端、curate 端到端 |
| 算法对照 | vitest | ACEST Rust 比对 | Decay 值、Generator 排序、Curator 合并行为 |
| E2E 测试 | 手动 | 关键用户流 | 安装→首次对话→学习→召回 |
| 性能测试 | vitest bench | NFR-001 | 5000 条 recall <100ms、PostToolUse <50ms |

### CI/CD Pipeline

```
Push → GitHub Actions:
  1. npm install
  2. TypeScript 编译检查
  3. ESLint + Prettier 检查
  4. vitest --coverage (>70%)
  5. 三平台 matrix build (Win/Mac/Linux)
  6. npm pack (验证打包完整性)
```

---

## Deployment Architecture

### Environments

| 环境 | 用途 | 特殊配置 |
|------|------|----------|
| Development | 本地开发调试 | `ACE_DEBUG=1` 开启详细日志 |
| CI | GitHub Actions 自动测试 | 三平台 matrix |
| Production (用户机器) | 最终用户使用 | 默认配置 |

### Deployment Strategy

```
npm publish → npm registry
  → 用户: claude plugin install claude-ace
    → npm install → postinstall: node scripts/install.js
      → 创建 ~/.ace-claude/ 目录
      → 初始化默认 config.json
      → 注入 CLAUDE.md 行为指令
    → 用户可选: /ace setup (下载 ONNX 模型)
```

### Plugin Directory Structure

```json
// .claude-plugin/plugin.json
{
  "name": "claude-ace",
  "version": "1.0.0",
  "description": "ACE - Adaptive Context Engine for Claude Code",
  "hooks": "./hooks/hooks.json",
  "skills": [
    "./skills/ace.md",
    "./skills/learn.md"
  ],
  "scripts": {
    "postinstall": "node scripts/install.js",
    "preuninstall": "node scripts/uninstall.js"
  }
}
```

```json
// hooks/hooks.json
{
  "hooks": [
    {
      "event": "SessionStart",
      "command": "node hooks/session-start.js",
      "timeout": 5000
    },
    {
      "event": "UserPromptSubmit",
      "command": "node hooks/user-prompt-submit.js",
      "timeout": 200
    },
    {
      "event": "PostToolUse",
      "command": "node hooks/post-tool-use.js",
      "matcher": "Edit|Write|Bash",
      "timeout": 100
    },
    {
      "event": "Stop",
      "command": "node hooks/stop.js",
      "timeout": 10000
    },
    {
      "event": "SessionEnd",
      "command": "node hooks/session-end.js",
      "timeout": 30000
    }
  ]
}
```

---

## Requirements Traceability

### Functional Requirements Coverage

| FR ID | FR Name | Components | Notes |
|-------|---------|------------|-------|
| FR-001 | Bullet 数据结构与 SQLite 存储 | Storage (sqlite.ts, schema.ts), Types (bullet.ts) | 核心数据模型 |
| FR-002 | 混合检索引擎 | Daemon (vector-cache.ts), Engine (generator.ts), Storage (sqlite.ts) | SQL 预过滤 + 内存向量 |
| FR-003 | 关键词检索 | Engine (generator.ts) | L1/L2/L3 三层 |
| FR-004 | UserPromptSubmit Hook | Hooks (user-prompt-submit.ts), Shared (ipc-client.ts) | additionalContext 注入 |
| FR-005 | SessionEnd Hook | Hooks (session-end.ts), Storage (session-queue.ts) | 兜底清理 |
| FR-006 | PostToolUse Hook | Hooks (post-tool-use.ts), Engine (rules-engine.ts) | 纯规则，不调 LLM |
| FR-007 | ONNX 本地嵌入 | Engine (embedding.ts), Scripts (setup.ts) | Daemon 持有 Session |
| FR-008 | 混合检索评分 | Engine (generator.ts) | 0.6 keyword + 0.4 semantic |
| FR-009 | 语义去重 Curator | Engine (curator.ts) | 阈值 0.8 cosine |
| FR-010 | 内容分类与质量过滤 | Engine (classifier.ts) | 5 种类型 + 密度惩罚 |
| FR-011 | 艾宾浩斯衰退 | Engine (decay.ts) | 30 天半衰期 |
| FR-012 | /ace Skill | Skills (ace.md), Scripts (ace-cli.ts) | 6 个子命令 |
| FR-013 | /learn Skill | Skills (learn.md), Scripts (ace-cli.ts) | 手动录入 |
| FR-014 | 配置系统 | Shared (config-loader.ts), Types (config.ts) | JSON 配置 |
| FR-015 | CLAUDE.md 注入 | Scripts (install.ts) | 行为指令 |
| FR-016 | 冲突检测 | Engine (conflict-detector.ts)*, Storage (conflicts 表) | *Could Have |
| FR-017 | distilled_rule 生成 | Engine (reflector.ts 扩展)* | *Could Have, LLM |
| FR-018 | 导入/导出 | Scripts (ace-cli.ts)* | *Could Have |
| FR-019 | 跨项目管理 | Scripts (ace-cli.ts), Storage (scope 查询)* | *Could Have |
| FR-020 | LLM 评估 | Engine (reflector.ts 扩展)* | *Could Have, 默认关闭 |
| FR-021 | 插件安装 | .claude-plugin/, Scripts (install.ts), hooks.json | Plugin 标准结构 |
| FR-022 | 隐私脱敏 | Engine (sanitizer.ts) | 正则过滤 |
| FR-023 | ACE Daemon | Daemon (index.ts, ipc-server.ts, lifecycle.ts) | 核心架构组件 |
| FR-024 | Stop Hook | Hooks (stop.ts) | 增量蒸馏 |
| FR-025 | SessionStart Hook | Hooks (session-start.ts) | Daemon 启动/复用 |

### Non-Functional Requirements Coverage

| NFR ID | NFR Name | Solution | Validation |
|--------|----------|----------|------------|
| NFR-001 | Hook 延迟 | Daemon 常驻 + 内存向量 + IPC <1ms | p95 benchmark |
| NFR-002 | 存储效率 | SQLite WAL + 索引覆盖 + BLOB embedding | DB size + query time |
| NFR-003 | Local-First | ONNX 本地 + SQLite 本地 + 零网络 | 网络抓包 |
| NFR-004 | 容错降级 | 三层降级 + 超时 + try-catch | 故障注入测试 |
| NFR-005 | 代码质量 | TS strict + vitest >70% + ESLint | CI 报告 |
| NFR-006 | 兼容性 | IPC 适配器 + prebuilt binaries + Plugin 标准 | 三平台 CI |
| NFR-007 | 零配置 | 默认值 + 自动初始化 + 渐进增强 | 全新安装测试 |

---

## Trade-offs & Decision Log

### Decision 1: Daemon 架构 vs 每次 Hook 冷启动

**Trade-off:**
- ✓ Gain: ONNX 推理延迟从 ~3000ms 降至 <50ms (warm)；SQLite 连接复用
- ✗ Lose: 增加系统复杂度（进程管理、IPC 协议、生命周期）
- **Rationale:** 延迟是用户体验的核心。没有 Daemon，每次 UserPromptSubmit 需要 3+ 秒加载 ONNX 模型，完全不可接受。

### Decision 2: SQLite vs LanceDB

**Trade-off:**
- ✓ Gain: 安装体积小 (~10MB vs ~50MB+)，API 简单，社区成熟
- ✗ Lose: 无原生向量索引，需要内存 brute-force
- **Rationale:** 5000 条规模下 brute-force <20ms，不是瓶颈。轻量优先。

### Decision 3: 内存向量缓存 vs SQLite 向量扩展

**Trade-off:**
- ✓ Gain: 极低延迟 (纯内存计算)，实现简单
- ✗ Lose: 内存占用 ~7.5MB (5000 条)，需要手动维护增量同步
- **Rationale:** 7.5MB 在现代机器上微不足道。简单胜于复杂。

### Decision 4: additionalContext vs stdout 文本注入

**Trade-off:**
- ✓ Gain: 结构化注入，Claude Code 正式支持的方式
- ✗ Lose: 无法修改原始 prompt（Claude Code 不支持 modifiedQuery）
- **Rationale:** 这不是选择题——modifiedQuery 不存在。additionalContext 是唯一正确的方式。

### Decision 5: 会话队列文件 vs Daemon 内存队列

**Trade-off:**
- ✓ Gain: 跨进程共享（PostToolUse → Stop → SessionEnd 不同进程可读）、持久化（进程崩溃不丢数据）
- ✗ Lose: 文件 I/O 延迟 (~1-2ms)
- **Rationale:** Hook 是独立进程，内存不共享。文件是最可靠的跨进程通信方式。

### Decision 6: JSON Array 存储 vs 关联表

**Trade-off:**
- ✓ Gain: 单表查询，无 JOIN 开销，schema 简单
- ✗ Lose: 无法对 tags/entities 建高效索引，需要 LIKE 或 json_each
- **Rationale:** Bullet 表结构已有 section/scope/knowledge_type 等列做主要过滤。tags/entities 是辅助评分，全文匹配足够。

---

## Open Issues & Risks

| # | Issue | Impact | Mitigation | Status |
|---|-------|--------|------------|--------|
| 1 | Windows Named pipe 在 Node.js 中的稳定性 | 高 | 原型验证；降级到 TCP localhost 备选 | 待验证 |
| 2 | better-sqlite3 在 Windows ARM64 的编译 | 中 | prebuilt binaries 通常覆盖；需测试 | 待验证 |
| 3 | onnxruntime-node 在 Apple Silicon 的兼容性 | 中 | v1.16+ 已支持 ARM64；需实测 | 待验证 |
| 4 | Claude Code Plugin 标准尚在演进 | 高 | 保持最小依赖，跟踪 API 变化 | 持续关注 |
| 5 | Playbook 冷启动期 (前 5-10 会话) 用户无感知价值 | 低 | 文档说明，提供 seed knowledge 选项 | 设计阶段 |
| 6 | 中文嵌入质量 (all-MiniLM-L6-v2 非中文专用) | 中 | 关键词权重 0.6 弥补语义不足；可换模型 | 可接受 |

---

## Assumptions & Constraints

### Assumptions

1. Claude Code Hook API (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd) 在 2026 Q1 版本稳定可用
2. PostToolUse Hook 的 stdin 包含 `tool_name, tool_input, tool_response, session_id`
3. better-sqlite3 + 内存向量在 5000 条 Bullet 规模下检索延迟 <50ms
4. all-MiniLM-L6-v2 在中英文混合场景下嵌入质量可接受
5. 用户的 Node.js ≥ 18 LTS 环境已就绪（Claude Code 本身依赖）
6. Unix domain socket 在 Windows 10 build 17063+ / WSL 下可用，或可降级到 Named pipe

### Constraints

- 仅使用 Claude Code 稳定 API，不使用实验性功能
- 安装体积 (不含 ONNX 模型) 控制在 ~20MB 以内
- 运行时内存占用 (Daemon) 控制在 ~400MB 以内 (ONNX ~300MB + 向量 ~8MB + 其他)
- 零网络依赖 (LLM 评估关闭时)

---

## Future Considerations

- **ANN 索引**: 当 Bullet 超过 10000 条时，可引入 HNSW 算法替代 brute-force
- **多模型支持**: 支持用户选择不同 ONNX 模型（如中文专用模型）
- **Team Playbook**: 多人共享知识库（需要服务端 + 同步协议）
- **VS Code 扩展**: 将 ACE 集成到 VS Code 侧边栏
- **自动 Decay 调优**: 根据用户使用模式动态调整半衰期
- **Plugin Marketplace**: Claude Code 官方市场上架

---

## Approval & Sign-off

**Review Status:**
- [ ] Technical Lead (TPY)
- [ ] Product Owner (TPY)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-27 | TPY | Initial architecture |

---

## Next Steps

### Phase 4: Sprint Planning & Implementation

Run `/sprint-planning` to:
- Break epics into detailed user stories
- Estimate story complexity
- Plan sprint iterations
- Begin implementation following this architectural blueprint

**Key Implementation Principles:**
1. Follow component boundaries defined in this document
2. Implement NFR solutions as specified
3. Use technology stack as defined
4. Follow IPC protocol contracts exactly
5. Adhere to security and performance guidelines

**Recommended Implementation Order:**
1. EPIC-006 (Plugin Infrastructure) — Daemon + SessionStart + 安装
2. EPIC-001 (Storage Foundation) — SQLite schema + Config
3. EPIC-002 (Knowledge Recall) — Generator + UserPromptSubmit Hook
4. EPIC-003 (Knowledge Learning) — PostToolUse + Stop + SessionEnd Hooks
5. EPIC-004 (Knowledge Lifecycle) — Curator + Decay
6. EPIC-005 (User Interaction) — /ace + /learn Skills
7. EPIC-007 (Advanced Intelligence) — LLM 评估等增强

---

**This document was created using BMAD Method v6 - Phase 3 (Solutioning)**

*To continue: Run `/workflow-status` to see your progress and next recommended workflow.*

---

## Appendix A: Configuration Schema

```json
// ~/.ace-claude/config.json (default values)
{
  "decay": {
    "half_life_days": 30,
    "grace_period_days": 7,
    "recall_boost_factor": 0.3,
    "permanent_recall_threshold": 15,
    "archive_threshold": 0.02
  },
  "reflector": {
    "min_interaction_quality": 0.3,
    "max_content_length": 500,
    "max_code_lines": 3,
    "code_density_reject_threshold": 0.6,
    "llm_evaluate": false,
    "llm_model": "haiku"
  },
  "search": {
    "keyword_weight": 0.6,
    "semantic_weight": 0.4,
    "recency_boost_days": 7,
    "recency_boost_factor": 1.2,
    "max_results": 5,
    "max_context_tokens": 2000,
    "min_score_threshold": 0.1
  },
  "daemon": {
    "idle_timeout_minutes": 5,
    "max_idle_minutes": 10,
    "session_check_interval_seconds": 60
  }
}
```

---

## Appendix B: Capacity Planning

| Metric | 轻度 (1 月) | 中度 (6 月) | 重度 (1 年) | 设计上限 |
|--------|-------------|-------------|-------------|----------|
| Active Bullets | 100-300 | 1000-2000 | 3000-5000 | 10000 |
| DB File Size | ~1 MB | ~5 MB | ~12 MB | ~30 MB |
| Memory (vectors) | ~0.5 MB | ~3 MB | ~7.5 MB | ~15 MB |
| Memory (Daemon total) | ~310 MB | ~315 MB | ~320 MB | ~350 MB |
| Recall Latency (Daemon) | <30 ms | <50 ms | <80 ms | <100 ms |
| Recall Latency (keyword) | <5 ms | <15 ms | <30 ms | <50 ms |
| Session Queue (per session) | 5-10 entries | 10-20 entries | 20-50 entries | 100 entries |

---

## Appendix C: Platform-Specific Details

### IPC Adapter

```typescript
// shared/platform.ts
export function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\ace-claude-daemon';
  }
  const home = os.homedir();
  return path.join(home, '.ace-claude', 'daemon.sock');
}

export function getPidPath(): string {
  return path.join(os.homedir(), '.ace-claude', 'daemon.pid');
}

export function getMetaPath(): string {
  return path.join(os.homedir(), '.ace-claude', 'daemon.meta.json');
}
```

### Daemon Meta File

```json
// ~/.ace-claude/daemon.meta.json
{
  "pid": 12345,
  "engine_version": "1.0.0",
  "started_at": "2026-02-27T10:00:00Z",
  "socket_path": "/home/user/.ace-claude/daemon.sock",
  "active_sessions": ["session-abc", "session-def"]
}
```
