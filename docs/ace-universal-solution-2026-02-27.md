# ACE Universal Solution: Adaptive Context Engine for AI Products

**Date:** 2026-02-27
**Version:** 1.0
**Status:** Draft
**Origin:** Abstracted from `prd-claude-ace-2026-02-27.md` (Claude Code Plugin) + `ACE_Framework_Theory.md`

---

## 1. Executive Summary

本文档将 ACE（Adaptive Context Engine）从 Claude Code 插件的具体实现中抽象出来，形成一套**平台无关的 AI 产品自适应记忆解决方案**。

任何具备"用户与 AI 多轮交互"场景的产品——无论是 CLI 编程助手（Claude Code、OpenClaw）、IDE 插件（Cursor、Windsurf）、桌面 AI 应用（ACEST Desktop）、还是 Web AI 平台——都可以基于本方案实现"越用越懂你"的记忆能力。

### 核心命题

> 将 AI 从"无状态工具"进化为"越用越懂你的数字助手"。

### 适用产品类型

| 类型 | 代表产品 | 集成模式 |
|------|----------|----------|
| CLI AI 助手 | Claude Code, OpenClaw, Aider | Hook/Event 驱动 |
| IDE AI 插件 | Cursor, Windsurf, GitHub Copilot | Extension API 驱动 |
| 桌面 AI 应用 | ACEST Desktop, ChatBox | 内嵌引擎 |
| Web AI 平台 | ChatGPT, Claude.ai, 自建 Agent | API Middleware 驱动 |
| Agent 框架 | LangChain, CrewAI, AutoGen | Pipeline Interceptor 驱动 |

---

## 2. Problem Statement（平台无关）

### 2.1 五大痛点悖论

所有 AI 产品共享的记忆困境：

1. **噪声干扰悖论** — 全量记录 → 信噪比极低 → 上下文毒化
2. **成本与性能悖论** — Token 堆叠 → 费用/延迟指数增长
3. **冲突演进悖论** — 知识更新后旧建议仍存 → 自相矛盾
4. **隐私与智能悖论** — 云端记忆 → 无法通过合规审查
5. **经验沉淀悖论** — 隐性经验散落日志 → 无法复用

### 2.2 现有方案不足

| 方案 | 缺陷 |
|------|------|
| 无限上下文窗口 | "大海捞针"效应，推理精度断崖式下降 |
| 传统 RAG | 仅处理静态文档，无法捕获动态交互经验 |
| 原生 Memory（如 ChatGPT） | 永久存储无衰退、无冲突检测、云端隐私风险 |
| 手动 MEMORY.md | 人工维护成本高、无结构化、无自动化 |

---

## 3. ACE Universal Architecture（平台无关架构）

### 3.1 概念模型

```
┌─────────────────────────────────────────────────────┐
│                 任意 AI 产品 (Host)                   │
│                                                     │
│  用户输入 ──→ [集成点A: Pre-Inference]               │
│                    │                                │
│                    ▼                                │
│              ┌──────────┐                           │
│              │ ACE Core │ ←── 平台无关的记忆引擎      │
│              │ (Engine) │                           │
│              └──┬───┬───┘                           │
│                 │   │                               │
│    ┌────────────┘   └────────────┐                  │
│    ▼                             ▼                  │
│  [集成点B: Post-Action]    [集成点C: Session-End]    │
│  (工具调用/代码执行后)      (会话结束时)              │
│                                                     │
└─────────────────────────────────────────────────────┘
         │                │               │
         ▼                ▼               ▼
    ┌─────────────────────────────────────────┐
    │          ACE Memory Service             │
    │  ┌──────────┐ ┌────────┐ ┌──────────┐  │
    │  │Retrieval │ │Storage │ │Lifecycle │  │
    │  │ Engine   │ │ Layer  │ │ Manager  │  │
    │  └──────────┘ └────────┘ └──────────┘  │
    │         Local-First Data Store          │
    └─────────────────────────────────────────┘
```

### 3.2 三个核心集成点（Integration Points）

ACE 与宿主 AI 产品的交互归纳为 **三个通用集成点**，不同平台用不同机制实现：

| 集成点 | 时机 | 职责 | Claude Code | OpenClaw/CLI | IDE Plugin | Web/Agent |
|--------|------|------|-------------|--------------|------------|-----------|
| **A: Pre-Inference** | 用户输入后、LLM 推理前 | 召回相关记忆，注入上下文 | UserPromptSubmit Hook | CLI Middleware / Pre-prompt Hook | Extension `onWillSendRequest` | API Proxy Interceptor |
| **B: Post-Action** | AI 执行工具/生成代码后 | 检测可学习模式 | PostToolUse Hook + Stop Hook | Tool callback / Post-exec Hook | Extension `onDidExecuteCommand` | Agent `on_tool_result` callback |
| **C: Session-End** | 会话结束时 | 兜底蒸馏 + 清理 | SessionEnd Hook | Process exit handler / SIGTERM | Extension `onDeactivate` | WebSocket close / Session timeout |

### 3.3 四大引擎模块（Platform-Agnostic）

```
ACE Engine
├── 1. Generator（检索引擎）     — 负责"想起来"
├── 2. Reflector（蒸馏引擎）     — 负责"学到了"
├── 3. Curator（去重引擎）       — 负责"不重复"
└── 4. Decay（衰退引擎）         — 负责"该忘了"
```

---

## 4. Knowledge Unit: Bullet（知识弹）

### 4.1 通用数据结构

Bullet 是 ACE 的最小知识单元，平台无关：

```typescript
interface Bullet {
  // === Identity ===
  id: string;                          // UUID
  scope: string;                       // "global" | "project:{name}" | "workspace:{id}"

  // === Content ===
  section: BulletSection;              // 知识分区
  content: string;                     // 蒸馏规则（≤500 字符）
  distilled_rule?: string;             // "When X, do Y because Z" 格式
  code_content?: string;               // 极短代码片段（≤3 行，可选）

  // === Metadata ===
  metadata: {
    instructivity_score: number;       // 价值评分 0-100
    knowledge_type: KnowledgeType;     // Method | Trick | Pitfall | Preference | Knowledge
    source_type: SourceType;           // auto_detected | user_manual | llm_evaluated
    recall_count: number;              // 累计被召回次数（强化信号）
    last_recall: Date;                 // 最后召回时间（衰退计算起点）
    decay_weight: number;              // 当前衰退权重 0.0-1.0
    related_tools: string[];           // 关联工具/命令
    related_files: string[];           // 关联文件路径
    key_entities: string[];            // 关键实体（函数名、类名等）
  };

  // === Vector ===
  embedding?: Float32Array;            // 语义向量（384维 / 768维）

  // === Timestamps ===
  created_at: Date;
  updated_at: Date;
}

type KnowledgeType = "Method" | "Trick" | "Pitfall" | "Preference" | "Knowledge";
type BulletSection = "coding" | "debugging" | "architecture" | "tooling"
                   | "preferences" | "domain" | "workflow" | "general";
```

### 4.2 内容约束（Anti-bloat）

| 约束 | 规则 | 原因 |
|------|------|------|
| content 长度 | ≤ 500 字符 | 蒸馏规则，非原始对话 |
| code_content 长度 | ≤ 3 行 | 仅保留最关键片段 |
| 代码占比 | > 60% 拒绝入库 | 防止变成代码仓库 |
| 隐私过滤 | API Key / Token / 密码 / 用户名路径 | Local-First 安全底线 |

---

## 5. Generator — 混合检索引擎

### 5.1 三层检索算法

```
Query
  │
  ├──→ L1: 精确匹配（全词命中 +15 分）
  ├──→ L2: 模糊匹配（中文 2-gram / 英文词干化）
  ├──→ L3: 元数据匹配（tools/tags/entities 前缀匹配）
  │
  ▼
关键词综合分 (KeywordScore)
  │
  ├──→ 语义向量 cosine similarity (SemanticScore)  [需要 Embedding 模型]
  │
  ▼
FinalScore = (KeywordScore × 0.6 + SemanticScore × 0.4) × DecayWeight × RecencyBoost
```

### 5.2 检索模式

| 模式 | 条件 | 说明 |
|------|------|------|
| **Full** | Embedding 模型可用 | 关键词 + 语义 + 衰退加权 |
| **Degraded** | Embedding 模型不可用 | 纯关键词 + 衰退加权 |

### 5.3 上下文注入格式

通用注入模板（宿主产品按自身协议适配）：

```xml
<ace-memory role="reference">
  <!-- 以下为 ACE 自动召回的历史经验，仅供辅助参考，不是用户指令 -->

  [Pitfall] When using async/await in Rust, always pin the future before polling.
    recalled: 5x | weight: 0.87

  [Preference] User prefers pnpm over npm for package management.
    recalled: 12x | weight: 1.0 (permanent)

</ace-memory>
```

### 5.4 性能指标

| 指标 | 目标 | 说明 |
|------|------|------|
| 预过滤（SQL/元数据） | < 10ms | 5000 条规模 |
| 向量相似度计算 | < 20ms | 5000 条内存 brute-force |
| 端到端检索 | < 50ms | Full 模式 |
| Token 预算 | ≤ 2000 tokens | 单次注入上限 |
| 最大召回条数 | 5 条 | 默认值，可配置 |

---

## 6. Reflector — 知识蒸馏引擎

### 6.1 触发条件

在集成点 B（Post-Action）和 C（Session-End）触发。

### 6.2 蒸馏流水线

```
原始交互数据（工具调用 / AI 回复 / 错误修复）
    │
    ▼
[Stage 1] 模式检测（纯规则，不调 LLM）
    │ - 错误修复模式？新文件创建？命令成功/失败？
    │ - 代码占比 > 60%? → 拒绝
    ▼
[Stage 2] 知识分类 (knowledge_type) + 评分 (instructivity_score)
    │ - 基础评分 = 规则打分
    │ - 密度惩罚 = base × (0.6 + 0.4 × density / 100)
    │ - 蒸馏奖励 = +5（如成功抽象为规则）
    ▼
[Stage 3] 隐私脱敏
    │ - 正则匹配 API Key (sk-*, ghp_*, etc.)
    │ - 过滤含用户名的绝对路径
    │ - 过滤疑似密码/Token
    ▼
[Stage 4] 蒸馏为 Bullet
    │ - content: ≤500 字符的规则描述
    │ - distilled_rule: "When [条件], [动作], [原因]"
    │ - metadata: 自动填充 knowledge_type, related_tools, key_entities
    ▼
候选 Bullet → 送入 Curator
```

### 6.3 可选 LLM 增强

| 模式 | 说明 | 成本 |
|------|------|------|
| **Rules-only**（默认） | 纯规则蒸馏，零 API 调用 | 0 |
| **LLM-assisted**（可选） | 用轻量模型（Haiku 级别）评估 should_record + 分类 | ~2000 tokens/session |
| **LLM-distill**（可选） | 用 LLM 生成高质量 distilled_rule | ~500 tokens/bullet |

---

## 7. Curator — 语义去重引擎

### 7.1 去重流程

```
新候选 Bullet
    │
    ▼
与现有 Playbook 计算 cosine similarity
    │
    ├── similarity ≥ 0.8 → Merge（合并内容，保留较高 recall_count）
    ├── similarity < 0.8 → Insert（直接插入）
    │
    ▼
更新内存向量缓存
```

### 7.2 Merge 策略

- 合并 content（取更完整的版本）
- 保留较高的 recall_count
- 合并 related_tools / key_entities（取并集）
- 更新 updated_at

---

## 8. Decay — 艾宾浩斯衰退引擎

### 8.1 衰退公式

```
decay_weight = 2^(-age_days / half_life) × (1 + recall_boost × recall_count)
```

### 8.2 参数体系

| 参数 | 默认值 | 说明 |
|------|--------|------|
| half_life | 30 天 | 半衰期 |
| protection_period | 7 天 | 新知识保护期（weight 锁定 1.0） |
| recall_boost_factor | 0.3 | 每次召回的增强因子 |
| permanent_threshold | 15 次 | 超过此召回次数 → 永久保留 |
| archive_threshold | 0.02 | 低于此权重 → 自动归档 |

### 8.3 生命周期

```
新建 → [7天保护期 weight=1.0] → [指数衰退] → [被召回时重置+增强]
                                     │
                                     ├── recall_count ≥ 15 → 永久保留 (weight=1.0)
                                     └── weight < 0.02 → 归档（不删除）
```

---

## 9. Memory Service Architecture（运行时架构）

### 9.1 两种部署模式

根据宿主平台特性选择：

#### 模式 A: Daemon 常驻进程（推荐用于 CLI / 桌面应用）

```
┌────────────────────────────────────────┐
│           ACE Memory Daemon            │
│                                        │
│  ┌──────────┐  ┌──────────────────┐   │
│  │ Embedding│  │ SQLite + 内存    │   │
│  │ Model    │  │ 向量缓存        │   │
│  │ (ONNX)   │  │                  │   │
│  └──────────┘  └──────────────────┘   │
│                                        │
│  IPC: Unix Socket / Named Pipe / TCP   │
└────────────────┬───────────────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
 Session 1   Session 2   Session 3
 (Hook/CLI)  (Hook/CLI)  (Hook/CLI)
```

**适用场景**: Claude Code, OpenClaw, Aider 等 CLI 工具
**优势**: 避免每次 Hook 冷启动 ONNX 模型，多会话共享
**IPC 协议**: `ping`, `recall`, `curate`, `session_register`, `session_unregister`, `shutdown`

#### 模式 B: 内嵌引擎（推荐用于 IDE 插件 / Web 应用 / Agent 框架）

```
┌──────────────────────────────────┐
│        宿主应用进程               │
│                                  │
│  ┌────────────────────────────┐  │
│  │      ACE Engine (Library)  │  │
│  │  Embedding + SQLite + 缓存 │  │
│  └────────────────────────────┘  │
│                                  │
│  直接函数调用（无 IPC 开销）      │
└──────────────────────────────────┘
```

**适用场景**: Cursor/Windsurf 插件, Web 后端, LangChain Agent
**优势**: 部署简单，无进程管理

### 9.2 Daemon 生命周期管理

```
Session Start
    │
    ▼
检查 PID 文件 → 进程存活？ → 健康检查通过？
    │                │              │
    │ 不存在          │ 存活         │ 通过
    ▼                ▼              ▼
 启动新 Daemon    复用现有        注册 Session
    │                │              │
    └────────────────┴──────────────┘
                     │
              [正常运行中]
                     │
    ┌────────────────┼────────────────┐
    │                │                │
Session End     空闲 5 分钟      最后请求 >10 分钟
    │                │                │
 注销 Session   active=0?         兜底退出
    │            ┌──┴──┐
    │           Yes    No
    │            │      │
    │        自动退出  继续
    └────────────┘
```

---

## 10. Storage Layer（存储层）

### 10.1 推荐方案

| 规模 | 推荐存储 | 向量检索 | 说明 |
|------|----------|----------|------|
| < 5,000 条 | SQLite (better-sqlite3) | 内存 brute-force | 最简单，性能足够 |
| 5,000 - 50,000 条 | SQLite + sqlite-vec | 内置向量索引 | 无需额外依赖 |
| > 50,000 条 | SQLite + LanceDB | 专用向量库 | 高性能检索 |

### 10.2 核心 Schema

```sql
CREATE TABLE bullets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,                -- "global" | "project:{name}"
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  distilled_rule TEXT,
  code_content TEXT,
  knowledge_type TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'auto_detected',
  instructivity_score INTEGER NOT NULL DEFAULT 50,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recall TEXT,
  decay_weight REAL NOT NULL DEFAULT 1.0,
  related_tools TEXT,                 -- JSON array
  related_files TEXT,                 -- JSON array
  key_entities TEXT,                  -- JSON array
  tags TEXT,                          -- JSON array
  embedding BLOB,                    -- 384 × float32 = 1536 bytes
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_scope ON bullets(scope);
CREATE INDEX idx_section ON bullets(section);
CREATE INDEX idx_decay ON bullets(decay_weight);
CREATE INDEX idx_knowledge_type ON bullets(knowledge_type);
```

---

## 11. Platform Integration Guide（平台集成指南）

### 11.1 Claude Code

```
集成机制: Hooks + Skills + Daemon
├── Pre-Inference  → UserPromptSubmit Hook (stdin → recall → additionalContext)
├── Post-Action    → PostToolUse Hook (Edit|Write|Bash) + Stop Hook
├── Session-End    → SessionEnd Hook
├── Daemon         → SessionStart Hook 管理启停
└── User Interface → /ace, /learn Skills (SKILL.md)
```

### 11.2 OpenClaw / 通用 CLI AI 助手

```
集成机制: CLI Middleware + Daemon
├── Pre-Inference  → Pre-prompt middleware（拦截用户输入，注入上下文）
├── Post-Action    → Tool execution callback（监听工具调用结果）
├── Session-End    → Process exit handler / SIGTERM / SIGINT
├── Daemon         → 独立进程，CLI 启动时拉起
└── User Interface → CLI subcommands: `openclaw ace status`, `openclaw ace search`
```

**OpenClaw 具体集成方式**（假设 OpenClaw 支持插件/中间件）：

```
方案 A（如有 Hook/Plugin 机制）:
  注册 pre_prompt / post_tool / session_end 事件回调

方案 B（如无原生 Hook，仅有 CLI）:
  包装为 shell wrapper:
    openclaw-ace() {
      ace recall "$@" | openclaw --context-file /dev/stdin "$@"
      ace reflect --session $SESSION_ID
    }

方案 C（如支持 MCP）:
  ACE 作为 MCP Server 提供 tools:
    - ace_recall(query) → 返回相关记忆
    - ace_learn(content) → 手动记录
    - ace_status() → Playbook 统计
```

### 11.3 IDE 插件（Cursor / Windsurf / VS Code + Copilot）

```
集成机制: Extension API + 内嵌引擎
├── Pre-Inference  → onWillSendRequest / chat participant API
├── Post-Action    → onDidExecuteCommand / onDidSaveTextDocument
├── Session-End    → onDeactivate / window close
├── Engine         → 内嵌于插件进程（模式 B）
└── User Interface → Sidebar Panel / Command Palette
```

### 11.4 Web AI 平台 / Agent 框架

```
集成机制: API Middleware + 内嵌引擎
├── Pre-Inference  → Express/FastAPI middleware: req → inject memory → forward to LLM
├── Post-Action    → Agent framework callback: on_tool_result / on_step_end
├── Session-End    → WebSocket close / HTTP session timeout / explicit /end
├── Engine         → 内嵌于后端服务
└── User Interface → Web dashboard / API endpoints
```

---

## 12. Configuration（通用配置结构）

```json
{
  "ace": {
    "storage": {
      "path": "~/.ace/{product_name}/playbook.db",
      "engine": "sqlite"
    },
    "embedding": {
      "model": "all-MiniLM-L6-v2",
      "dimensions": 384,
      "runtime": "onnx",
      "model_path": "~/.ace/models/"
    },
    "retrieval": {
      "keyword_weight": 0.6,
      "semantic_weight": 0.4,
      "max_results": 5,
      "token_budget": 2000,
      "recency_boost_days": 7,
      "recency_boost_factor": 1.2
    },
    "reflector": {
      "min_interaction_quality": 0.3,
      "max_content_length": 500,
      "max_code_lines": 3,
      "code_ratio_reject_threshold": 0.6,
      "llm_evaluate": false,
      "llm_distill": false
    },
    "curator": {
      "dedup_similarity_threshold": 0.8,
      "merge_strategy": "keep_best"
    },
    "decay": {
      "half_life_days": 30,
      "protection_days": 7,
      "recall_boost_factor": 0.3,
      "permanent_recall_threshold": 15,
      "archive_weight_threshold": 0.02
    },
    "privacy": {
      "filter_api_keys": true,
      "filter_passwords": true,
      "filter_user_paths": true,
      "custom_patterns": []
    },
    "daemon": {
      "enabled": true,
      "idle_timeout_minutes": 5,
      "max_idle_minutes": 10,
      "health_check_interval_seconds": 60,
      "ipc": "auto"
    }
  }
}
```

---

## 13. Implementation Roadmap（通用实施路线）

### Phase 1: MVP — 关键词记忆闭环

| 步骤 | 产出 | 说明 |
|------|------|------|
| 1. Bullet 定义 + SQLite 存储 | Storage Layer | 数据基础 |
| 2. 关键词检索 (L1+L2+L3) | Generator (Degraded) | 无需 Embedding 模型 |
| 3. 规则式蒸馏 + 隐私脱敏 | Reflector (Rules-only) | 无需 LLM 调用 |
| 4. 集成点 A + C | Pre-Inference + Session-End | 最小闭环：学+召回 |
| 5. 配置系统 + 安装流程 | Infrastructure | 可用性保障 |

**验证标准**: 3-5 个会话后，用户能感知到历史经验被自动召回。

### Phase 2: 智能化 — 语义检索 + 衰退

| 步骤 | 产出 | 说明 |
|------|------|------|
| 6. ONNX Embedding 模型集成 | Embedding Engine | 语义能力基础 |
| 7. 混合检索 (关键词 + 语义) | Generator (Full) | 检索质量跃升 |
| 8. 语义去重 | Curator | 防止 Playbook 膨胀 |
| 9. 艾宾浩斯衰退 | Decay Engine | 知识自然新陈代谢 |
| 10. Post-Action 集成点 | 集成点 B | 更及时的知识捕获 |
| 11. Daemon / 常驻服务 | Memory Service | 性能优化 |
| 12. 用户交互界面 | Skill / CLI / Panel | 知识库可见性 |

### Phase 3: 高级 — LLM 增强 + 跨项目

| 步骤 | 产出 | 说明 |
|------|------|------|
| 13. LLM 评估 + distilled_rule | Reflector (LLM-assisted) | 蒸馏质量提升 |
| 14. 冲突检测 | ConflictDetector | 知识一致性保障 |
| 15. 跨项目/跨工作区管理 | Scope Management | 知识复用最大化 |
| 16. 导入/导出 | Portability | 数据可迁移 |

---

## 14. ACE Engine API（语言无关接口定义）

无论用 TypeScript、Rust、Python 还是 Go 实现，ACE Engine 对外暴露以下接口：

```
// === Retrieval ===
recall(query: string, project?: string, limit?: number) → Bullet[]
search(query: string, filters?: SearchFilters) → ScoredBullet[]

// === Learning ===
detect_patterns(tool_event: ToolEvent) → Candidate[]
distill(candidates: Candidate[]) → Bullet[]
ingest(bullets: Bullet[]) → { added: number, merged: number, skipped: number }

// === Lifecycle ===
compute_decay(bullet_id: string) → number
run_decay_sweep() → { archived: number, updated: number }
detect_conflicts() → Conflict[]

// === Management ===
get_stats() → PlaybookStats
export(format: "json" | "markdown") → string
import(data: string, format: "json") → ImportResult

// === Privacy ===
sanitize(content: string) → { clean: string, filtered: FilteredItem[] }
```

---

## 15. Key Design Principles（核心设计原则）

1. **Local-First** — 所有数据存储在用户本地，零云端依赖（LLM 评估可选例外）
2. **Zero-Config Start** — 安装即用，合理默认值覆盖 90% 场景
3. **Graceful Degradation** — Embedding 不可用 → 纯关键词；Daemon 不可用 → 直接读 SQLite；任何组件故障 → 不影响宿主 AI 产品
4. **Distill, Don't Dump** — 存蒸馏规则，不存原始对话/代码
5. **Forget is a Feature** — 有益遗忘防止知识毒化
6. **Non-Intrusive** — 用户无感运行，不改变原有工作流
7. **Transparent on Demand** — 用户主动查询时才暴露记忆内容

---

## 16. Comparison with Existing Solutions

| 维度 | 传统 RAG | ChatGPT Memory | Mem0 | Cursor Rules | **ACE** |
|------|----------|----------------|------|--------------|---------|
| 知识来源 | 静态文档 | 用户明确告知 | API 式存取 | 手动编写 | **自动蒸馏** |
| 时效维护 | 手动清理 | 永久存储 | 手动管理 | 手动更新 | **指数衰退 + 强化** |
| 冲突检测 | 无 | 无 | 无 | 无 | **语义冲突检测** |
| 检索质量 | 语义漂移 | 关键词 | 语义 | 无检索 | **混合三层检索** |
| 隐私安全 | 可能云端 | 云端 | 云端 | 本地 | **完全本地 + 自动脱敏** |
| 去重机制 | 无 | 无 | 有 | 无 | **语义去重 + 合并** |
| 部署方式 | 需要向量库 | SaaS | SaaS/Self-host | 文件 | **SQLite 单文件 + ONNX** |

---

## 17. Open Questions（待定事项）

1. **OpenClaw 集成点确认** — 需确认 OpenClaw 是否提供 Hook/Plugin/Middleware 机制，以确定最优集成方案
2. **跨平台 Embedding 模型** — all-MiniLM-L6-v2 是否满足所有语言（尤其中文）的需求？是否需要支持多模型切换？
3. **多用户/团队场景** — 当前设计为单用户 Local-First，团队知识共享需要额外设计
4. **ACE Engine 发布形态** — 是否独立发布为 npm 包 / PyPI 包 / Rust crate，让不同平台复用？

---

*本文档从 claude-ace PRD 中抽象而来，旨在为任何 AI 产品提供可复用的自适应记忆解决方案框架。*
