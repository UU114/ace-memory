# ACE for Claude Code — 插件方案设计 (v1.0)

**将 ACEST 的自适应记忆引擎移植为 Claude Code 插件**

---

## 1. 动机与价值分析

### 1.1 Claude Code 现有记忆的局限性

| 维度 | Claude Code 原生 Auto-Memory | ACE 方案 |
|------|------------------------------|----------|
| **存储格式** | 平坦 Markdown (`MEMORY.md`) | 结构化 Bullet (JSONL + 向量索引) |
| **容量** | ~200 行硬截断 | 无上限，靠衰退自然淘汰 |
| **写入触发** | Claude 自行判断（常遗漏） | 自动蒸馏 + 质量过滤 |
| **检索方式** | 全文载入上下文（无搜索） | 混合检索（关键词 60% + 语义 40%） |
| **时效管理** | 无衰退，永久占位 | 艾宾浩斯指数衰退 + 召回强化 |
| **去重** | 无（经常重复记录） | 语义去重 + distilled_rule 匹配 |
| **冲突检测** | 无 | 自动 Semantic/Negation/Version 检测 |
| **跨项目** | 按项目隔离 | 可配置全局/项目级 Playbook |

### 1.2 核心价值

> **让 Claude Code 从"每次从零开始"进化为"越用越懂你的编程助手"**

- 自动积累：解决方案、避坑经验、代码模式、用户偏好
- 精准召回：只注入与当前任务相关的知识，不浪费 Token
- 知识演进：过时知识自然衰退，高频知识永久保留

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│              Claude Code Plugin: ace-memory                  │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐ │
│  │   Hooks      │  │   Skills     │  │  CLAUDE.md Patch   │ │
│  │             │  │              │  │                    │ │
│  │ • PrePrompt │  │ • /ace       │  │ 行为指令注入       │ │
│  │ • PostTool  │  │ • /playbook  │  │                    │ │
│  │ • SessionEnd│  │              │  │                    │ │
│  └──────┬──────┘  └──────┬───────┘  └────────────────────┘ │
│         │                │                                  │
│  ───────┼────────────────┼────────────────────────────────  │
│         │          MCP Protocol                             │
│  ───────┼────────────────┼────────────────────────────────  │
│         │                │                                  │
│  ┌──────▼────────────────▼──────────────────────────────┐  │
│  │          ace-mcp-server (Node.js / TypeScript)        │  │
│  │                                                       │  │
│  │  ┌───────────┐ ┌──────────┐ ┌─────────┐ ┌─────────┐ │  │
│  │  │ Generator │ │Reflector │ │ Curator │ │  Decay  │ │  │
│  │  │ (Recall)  │ │(Extract) │ │ (Dedup) │ │ Manager │ │  │
│  │  └─────┬─────┘ └────┬─────┘ └────┬────┘ └────┬────┘ │  │
│  │        │             │            │           │      │  │
│  │  ┌─────▼─────────────▼────────────▼───────────▼────┐ │  │
│  │  │              Storage Engine                      │ │  │
│  │  │  • JSONL (主存储, 可读可编辑)                     │ │  │
│  │  │  • 轻量级向量索引 (可选, 语义搜索)                │ │  │
│  │  │  • Archive (已遗忘条目备份)                       │ │  │
│  │  └─────────────────────────────────────────────────┘ │  │
│  │                                                       │  │
│  │  存储位置: ~/.ace-claude/playbook.jsonl               │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  plugin.json + hooks.json + .mcp.json + skills/            │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. 组件详细设计

### 3.1 MCP Server — ace-mcp-server (核心引擎)

**技术栈**: Node.js + TypeScript (选择原因：Claude Code 生态最成熟，MCP SDK 官方支持)

**传输方式**: stdio (本地进程，零网络开销)

#### 3.1.1 MCP Tools 定义

```typescript
// ═══════════════════════════════════════════
// Tool 1: ace_recall — 知识召回 (Pre-execute)
// ═══════════════════════════════════════════
{
  name: "ace_recall",
  description: "Search ACE Playbook for relevant knowledge based on current query context",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Current user query or task description" },
      context: {
        type: "object",
        properties: {
          files: { type: "array", items: { type: "string" }, description: "Files being worked on" },
          tools: { type: "array", items: { type: "string" }, description: "Tools being used" },
          language: { type: "string", description: "Programming language context" }
        }
      },
      limit: { type: "number", default: 5, description: "Max bullets to return" }
    },
    required: ["query"]
  }
}
// 返回: 格式化的 Bullet 列表，按相关性排序，附带衰退权重

// ═══════════════════════════════════════════
// Tool 2: ace_reflect — 知识蒸馏 (Post-execute)
// ═══════════════════════════════════════════
{
  name: "ace_reflect",
  description: "Extract reusable knowledge from a completed interaction",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Original user query" },
      response_summary: { type: "string", description: "Summary of what was done and the outcome" },
      success: { type: "boolean", description: "Whether the task succeeded" },
      files_changed: { type: "array", items: { type: "string" } },
      tools_used: { type: "array", items: { type: "string" } },
      errors_encountered: { type: "array", items: { type: "string" } }
    },
    required: ["query", "response_summary", "success"]
  }
}
// 返回: 提取的 RawInsight 列表 + 是否值得存储的判断

// ═══════════════════════════════════════════
// Tool 3: ace_curate — 知识入库 (Dedup + Store)
// ═══════════════════════════════════════════
{
  name: "ace_curate",
  description: "Validate, deduplicate, and store extracted knowledge into Playbook",
  inputSchema: {
    type: "object",
    properties: {
      insights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            content: { type: "string" },
            category: { type: "string", enum: ["Method", "Trick", "Pitfall", "Preference", "Knowledge"] },
            importance: { type: "number", minimum: 0, maximum: 100 },
            related_tools: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } }
          }
        }
      }
    },
    required: ["insights"]
  }
}
// 返回: 新增/合并/跳过的 Bullet 统计

// ═══════════════════════════════════════════
// Tool 4: ace_search — 交互式搜索
// ═══════════════════════════════════════════
{
  name: "ace_search",
  description: "Search Playbook with advanced filters",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      section: { type: "string", enum: ["strategies", "snippets", "troubleshooting", "tools", "preferences", "all"] },
      tags: { type: "array", items: { type: "string" } },
      min_score: { type: "number" },
      limit: { type: "number", default: 10 }
    },
    required: ["query"]
  }
}

// ═══════════════════════════════════════════
// Tool 5: ace_manage — Playbook 管理
// ═══════════════════════════════════════════
{
  name: "ace_manage",
  description: "Manage Playbook: view stats, edit bullets, run maintenance",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["status", "get", "edit", "delete", "export", "import", "conflicts", "decay_report"]
      },
      params: { type: "object" }
    },
    required: ["action"]
  }
}
```

#### 3.1.2 Bullet 数据结构 (JSONL)

```jsonc
// ~/.ace-claude/playbook.jsonl 每行一条 Bullet
{
  "id": "b_1a2b3c4d",
  "created_at": "2026-02-26T10:00:00Z",
  "updated_at": "2026-02-26T15:30:00Z",
  "section": "troubleshooting",  // strategies | snippets | troubleshooting | tools | preferences | custom
  "content": "When encountering 'borrow of moved value' in Rust, check if the variable is used after a move. Use `.clone()` for owned copies or `&` references for borrowing.",
  "distilled_rule": "When Rust borrow-after-move error, use clone() or references because ownership transferred",
  "metadata": {
    "instructivity_score": 78,
    "knowledge_type": "Pitfall",       // Method | Trick | Pitfall | Preference | Knowledge
    "source_type": "ErrorResolution",  // SuccessExecution | ErrorResolution | UserPreference | PatternDetected
    "recall_count": 5,
    "last_recall": "2026-02-25T14:00:00Z",
    "decay_weight": 0.92,
    "related_tools": ["lang:rust", "cmd:cargo"],
    "related_files": ["*.rs"],
    "key_entities": ["borrow checker", "ownership", "move semantics"]
  },
  "tags": ["rust", "compiler-errors", "ownership"],
  "code_content": null  // 可选的代码片段
}
```

#### 3.1.3 检索算法 (Generator)

```
混合检索评分公式:

FinalScore = (KeywordScore × 0.6 + SemanticScore × 0.4) × DecayWeight × RecencyBoost

其中:
├── KeywordScore:
│   ├── L1 精确匹配: 全词命中 +15
│   ├── L2 模糊匹配: 2-gram (CJK) / 词干化 (EN)
│   └── L3 元数据匹配: tools/tags/entities 前缀匹配
│
├── SemanticScore:
│   └── Cosine similarity (简单哈希嵌入 或 外部 embedding API)
│
├── DecayWeight:
│   └── weight = 2^(-age_days / half_life) × (1 + recall_boost × recall_count)
│
└── RecencyBoost:
    └── 最近 7 天内创建/召回的 Bullet 额外 ×1.2
```

#### 3.1.4 衰退配置

```jsonc
// ~/.ace-claude/config.json
{
  "decay": {
    "enabled": true,
    "strategy": "exponential",      // exponential | linear | none
    "half_life_days": 30,           // 30天权重减半
    "grace_period_days": 7,         // 新知识7天保护期
    "recall_boost_factor": 0.3,     // 每次召回延长30%半衰期
    "permanent_recall_threshold": 15, // 15次以上召回=永久保留
    "forget_threshold": 0.02,       // 低于2%权重→归档
    "archive_forgotten": true       // 归档而非删除
  },
  "reflector": {
    "auto_reflect": true,           // 自动反思
    "min_interaction_quality": 0.3, // 最低交互质量阈值
    "filter_noise": true,           // 过滤琐碎内容
    "max_bullets_per_session": 5    // 每会话最多提取5条
  },
  "search": {
    "keyword_weight": 0.6,
    "semantic_weight": 0.4,
    "default_limit": 5,
    "max_context_tokens": 2000     // 注入上下文的Token预算
  }
}
```

---

### 3.2 Hooks — 自动化触发器

#### 3.2.1 UserPromptSubmit Hook (知识自动召回)

**触发时机**: 用户每次发送消息前
**作用**: 自动检索相关知识并附加到用户消息中

```jsonc
// hooks.json
{
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node scripts/recall_hook.js",
          "timeout": 3000,
          "statusMessage": "Recalling relevant knowledge..."
        }
      ]
    }
  ]
}
```

```typescript
// scripts/recall_hook.js
// 接收 stdin: { query: string, ... }
// 输出: { modifiedQuery: string } 或 {}

import { readPlaybook, hybridSearch, formatContext } from '../lib/engine.js';

const input = JSON.parse(await readStdin());
const query = input.query;

// 快速检索 (< 100ms 目标)
const bullets = await hybridSearch(query, { limit: 5, minScore: 0.3 });

if (bullets.length === 0) {
  // 无相关知识，不修改消息
  process.stdout.write(JSON.stringify({}));
  process.exit(0);
}

// 格式化上下文并附加
const context = formatContext(bullets);
const modifiedQuery = `${query}\n\n<ace-context>\n${context}\n</ace-context>`;

process.stdout.write(JSON.stringify({ modifiedQuery }));

// 异步更新召回计数（不阻塞）
updateRecallCounts(bullets.map(b => b.id));
```

**注入格式示例**:
```markdown
<ace-context>
## ACE Playbook (5 relevant entries)

### Troubleshooting
- **[Pitfall]** When encountering 'borrow of moved value' in Rust, use `.clone()` or references
  - Tools: `lang:rust`, `cmd:cargo` | Recalled: 5 times | Score: 0.87

### Strategies
- **[Method]** For Tauri IPC, always use `#[tauri::command]` with async fn and proper error types
  - Tools: `framework:tauri` | Recalled: 12 times | Score: 0.82

### Preferences
- **[Preference]** User prefers quiet builds: always use `-q` flag with cargo
  - Recalled: 20 times (permanent) | Score: 0.79
</ace-context>
```

#### 3.2.2 PostToolUse Hook (增量反思)

**触发时机**: Claude 每次使用 Edit/Write/Bash 工具后
**作用**: 检测是否有值得记录的模式

```jsonc
{
  "PostToolUse": [
    {
      "matcher": "Edit|Write|Bash",
      "hooks": [
        {
          "type": "command",
          "command": "node scripts/post_tool_hook.js",
          "timeout": 2000,
          "statusMessage": "Checking for learnable patterns..."
        }
      ]
    }
  ]
}
```

```typescript
// scripts/post_tool_hook.js
// 轻量级模式检测，不调用 LLM
// 仅记录工具使用模式、错误修复模式等

const input = JSON.parse(await readStdin());
const { tool_name, tool_input, tool_output, tool_error } = input;

// 规则引擎快速检测
const patterns = detectPatterns(tool_name, tool_input, tool_output, tool_error);

if (patterns.length > 0) {
  // 写入待处理队列，SessionEnd 时批量处理
  appendToQueue(patterns);
}

// 不阻塞，不修改行为
process.stdout.write(JSON.stringify({}));
```

#### 3.2.3 SessionEnd Hook (批量蒸馏)

**触发时机**: Claude Code 会话结束时
**作用**: 对整个会话进行反思，提取高质量知识

```jsonc
{
  "SessionEnd": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "node scripts/session_end_hook.js",
          "timeout": 30000,
          "statusMessage": "Reflecting on session knowledge..."
        }
      ]
    }
  ]
}
```

```typescript
// scripts/session_end_hook.js
// 1. 读取 PostToolUse 积累的模式队列
// 2. 合并为候选 insights
// 3. 调用 LLM (可选，用小模型如 Haiku) 进行质量评估
// 4. 通过 Curator 去重入库

const queue = await readPatternQueue();
if (queue.length === 0) process.exit(0);

// 规则过滤: 去除低价值模式
const candidates = filterByRules(queue);

// 可选: LLM 评估 (用 Haiku 模型，低成本)
const evaluated = await llmEvaluate(candidates);  // 或跳过，纯规则

// Curator: 去重 + 入库
const result = await curate(evaluated);

console.error(`[ACE] Session reflection: +${result.added} new, ~${result.merged} merged, -${result.skipped} skipped`);
```

---

### 3.3 Skills — 用户交互界面

#### 3.3.1 /ace Skill (主入口)

```markdown
<!-- skills/ace/SKILL.md -->
---
name: ace
description: ACE Playbook memory management - search, review, and manage your learned knowledge base
user-invocable: true
---

# ACE Playbook Manager

You have access to the ACE (Adaptive Context Engine) Playbook - a persistent knowledge base that learns from your coding sessions.

## Available Actions

When the user invokes /ace, ask what they want to do:

1. **status** — Show Playbook statistics (bullet count, sections, decay report)
2. **search [query]** — Search for specific knowledge
3. **review** — Review recently added bullets for quality
4. **conflicts** — Run conflict detection scan
5. **export** — Export Playbook (JSON/Markdown)
6. **config** — View/edit ACE configuration

Use the `ace_manage` and `ace_search` MCP tools to execute these actions.

## Formatting Rules

- Show bullets in a readable table format
- Include decay_weight as a visual bar: ████░░ 67%
- Highlight conflicts in red
- Show recall_count as a heat indicator
```

#### 3.3.2 /learn Skill (手动记录)

```markdown
<!-- skills/learn/SKILL.md -->
---
name: learn
description: Manually teach ACE a new piece of knowledge
user-invocable: true
---

# Manual Knowledge Entry

When the user says "/learn [something]", extract the knowledge and store it:

1. Parse the user's input into a structured insight
2. Call `ace_curate` with the insight
3. Confirm what was stored and its metadata

Example: "/learn Always use pnpm instead of npm in this project"
→ Category: Preference, Tags: [package-manager, pnpm], Section: preferences
```

---

### 3.4 CLAUDE.md 注入 (行为指令)

插件安装时自动追加到项目 CLAUDE.md:

```markdown
## ACE Memory Integration

You have access to the ACE Playbook knowledge base through MCP tools. Follow these rules:

### Automatic Behavior
- The `<ace-context>` block in user messages contains recalled knowledge from past sessions. USE this information to inform your responses.
- Do NOT mention the ace-context block to the user unless asked. Treat it as your own knowledge.
- When you solve a tricky problem, encounter a pitfall, or learn a user preference, call `ace_reflect` to capture the insight.

### When to Reflect
- After fixing a non-obvious bug → Pitfall
- After discovering a working approach through trial → Method
- After the user corrects your approach → Preference
- After finding a useful tool/flag/config → Trick

### When NOT to Reflect
- Trivial file reads or simple edits
- Information already in CLAUDE.md or project docs
- Temporary debugging steps
- User's private data (tokens, passwords, paths with usernames)
```

---

## 4. 插件文件结构

```
ace-memory/
├── .claude-plugin/
│   └── plugin.json              # 插件清单
├── .mcp.json                    # MCP server 配置
├── hooks/
│   └── hooks.json               # Hook 定义
├── skills/
│   ├── ace/
│   │   └── SKILL.md             # /ace 主命令
│   └── learn/
│       └── SKILL.md             # /learn 手动记录
├── agents/
│   └── ace-reflector.md         # 反思专用 agent (可选)
├── scripts/
│   ├── recall_hook.js           # UserPromptSubmit hook
│   ├── post_tool_hook.js        # PostToolUse hook
│   └── session_end_hook.js      # SessionEnd hook
├── src/                         # MCP Server 源码
│   ├── index.ts                 # 入口
│   ├── server.ts                # MCP server 定义
│   ├── tools/
│   │   ├── recall.ts            # ace_recall 实现
│   │   ├── reflect.ts           # ace_reflect 实现
│   │   ├── curate.ts            # ace_curate 实现
│   │   ├── search.ts            # ace_search 实现
│   │   └── manage.ts            # ace_manage 实现
│   ├── engine/
│   │   ├── storage.ts           # JSONL 读写
│   │   ├── search.ts            # 混合检索算法
│   │   ├── decay.ts             # 衰退计算
│   │   ├── dedup.ts             # 语义去重
│   │   ├── conflict.ts          # 冲突检测
│   │   ├── classifier.ts        # 内容分类与质量过滤
│   │   └── embedding.ts         # 简单哈希嵌入
│   └── types.ts                 # Bullet, Playbook 类型定义
├── settings.json                # 默认设置
├── package.json
├── tsconfig.json
└── README.md
```

---

## 5. 数据流全景

```
═══════════════════════════════════════════════════════════════
                    完整交互周期
═══════════════════════════════════════════════════════════════

[用户输入] "帮我修复这个 Rust borrow checker 错误"
     │
     ▼
┌─────────────────────────────────────────────┐
│ Hook: UserPromptSubmit                       │
│                                             │
│ 1. 提取 query 关键词: "Rust borrow checker"  │
│ 2. 混合检索 Playbook (< 100ms)              │
│ 3. 找到 3 条相关 Bullet                      │
│ 4. 格式化为 <ace-context> 附加到消息         │
│ 5. 更新 recall_count (+1)                   │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
[Claude 收到] 用户原始问题 + <ace-context> 历史知识
     │
     ▼
[Claude 工作] 读取代码 → 分析错误 → 编辑修复
     │
     ▼
┌─────────────────────────────────────────────┐
│ Hook: PostToolUse (每次 Edit/Bash 后)        │
│                                             │
│ 检测模式:                                    │
│ - 错误修复? → 记录 error pattern             │
│ - 新文件? → 记录 project structure           │
│ - 命令成功? → 记录 tool usage                │
│                                             │
│ → 追加到 session_queue.jsonl (待处理队列)    │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
[Claude 完成任务] "已修复，问题是..."
     │
     ▼
[用户结束会话] /exit 或关闭终端
     │
     ▼
┌─────────────────────────────────────────────┐
│ Hook: SessionEnd                             │
│                                             │
│ 1. 读取 session_queue.jsonl                  │
│ 2. 规则过滤低质量条目                        │
│ 3. (可选) LLM 评估 → 质量打分                │
│ 4. Curator 语义去重                          │
│ 5. 写入 playbook.jsonl                      │
│ 6. 清理 session_queue                       │
│                                             │
│ 输出: "[ACE] +2 new, ~1 merged, -3 skipped" │
└─────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════
                    下次会话
═══════════════════════════════════════════════════════════════

[用户输入] "Rust 里怎么处理生命周期？"
     │
     ▼
[Hook: UserPromptSubmit]
→ 检索到上次学到的 Bullet: "borrow checker 修复方法"
→ 自动注入 → Claude 直接给出更精准的建议
→ recall_count: 5→6, 衰退计时器重置
```

---

## 6. 与 ACEST Rust 实现的映射关系

| ACEST Rust 组件 | Claude Code 插件对应 | 移植策略 |
|----------------|---------------------|----------|
| `ACEPlugin` (ExecutorHook) | Hooks + MCP Tools | Hook 替代 pre/post_execute |
| `Reflector` (reflector.rs) | `reflect.ts` + `post_tool_hook.js` | 保留规则引擎，LLM 评估改用 Haiku |
| `Curator` (curator.rs) | `curate.ts` + `dedup.ts` | 保留 LAPS 验证 + 语义去重 |
| `Storage` (storage.rs) | `storage.ts` (JSONL) | 简化为纯 JSONL，去掉 LanceDB |
| `DecayCalculator` (decay.rs) | `decay.ts` | 完整移植指数衰退算法 |
| `ConflictDetector` (conflict.rs) | `conflict.ts` | 保留 Semantic/Negation 检测 |
| `SimpleHashEmbedding` (embedding.rs) | `embedding.ts` | 移植哈希嵌入（纯 JS，零依赖） |
| `ContentClassifier` (content_classifier.rs) | `classifier.ts` | 保留 LAPS 内容质量过滤 |
| `Similarity` (similarity.rs) | `dedup.ts` | Levenshtein + N-gram |
| Playbook CLI | `/ace` Skill + `ace_manage` tool | CLI → 交互式 Skill |

---

## 7. 关键技术决策

### 7.1 为什么选 MCP Server + Hooks 而非纯 Hooks？

| 方案 | 优势 | 劣势 |
|------|------|------|
| **纯 Hooks** | 简单，无额外进程 | Hook 能力有限，无法提供交互式搜索 |
| **纯 MCP** | 功能强大，Claude 可主动调用 | 无法自动触发（需要 Claude 主动调用） |
| **MCP + Hooks** (本方案) | 自动化 + 交互式兼备 | 略复杂，需维护两套接口 |

**结论**: Hook 负责自动化（recall/reflect），MCP 负责交互式操作（search/manage）。两者共享同一个引擎代码。

### 7.2 为什么用 JSONL 而非数据库？

- **可读性**: 用户可以直接用编辑器查看/修改知识库
- **可移植**: 复制一个文件即可迁移
- **Git 友好**: 可以版本控制知识库的演进
- **性能足够**: 千级 Bullet 规模下，内存索引 + JSONL 足以在 <100ms 内完成检索
- **无依赖**: 不需要 SQLite/LanceDB/Redis

### 7.3 LLM 评估策略

```
三级评估策略 (渐进式):

Level 0 — 纯规则 (零成本, <10ms)
├── 正则匹配: 错误修复、代码模式、命令用法
├── 长度过滤: 太短(<20字)或太长(>2000字)拒绝
└── 适用: PostToolUse hook 实时检测

Level 1 — Haiku 快评 (低成本, <500ms)
├── 单次调用，判断 should_record + category + score
├── Prompt: "Is this interaction worth remembering? ..."
└── 适用: SessionEnd 批量评估

Level 2 — Sonnet 深度蒸馏 (中成本, <2s)
├── 生成 distilled_rule: "When X, do Y because Z"
├── 提取 key_entities, related_tools
└── 适用: 高分 Bullet 的二次精炼 (可选)
```

---

## 8. 性能预算

| 环节 | 延迟目标 | Token 消耗 |
|------|----------|-----------|
| **Recall (UserPromptSubmit)** | < 100ms | 0 (纯本地计算) |
| **Pattern Detection (PostToolUse)** | < 50ms | 0 (纯规则) |
| **Session Reflection (SessionEnd)** | < 10s | ~2000 (Haiku) |
| **Context Injection** | — | ~500-2000 per query (注入的 Bullet) |
| **Playbook 加载** | < 200ms | 0 (启动时一次) |

**Token 节省估算**: 相比全文载入 MEMORY.md (200行 ≈ 4000 tokens)，精准检索 5 条 Bullet ≈ 500-1000 tokens，节省 **60-75%**。

---

## 9. 实施路线图

### Phase 1: MVP (核心闭环) — 预计 3-5 天

- [ ] MCP Server 骨架 (TypeScript + MCP SDK)
- [ ] JSONL Storage Engine (读写 + 内存索引)
- [ ] 关键词检索 (Generator L1+L2)
- [ ] `ace_recall` + `ace_curate` MCP tools
- [ ] `UserPromptSubmit` hook (自动召回)
- [ ] `SessionEnd` hook (规则提取，无 LLM)
- [ ] Plugin manifest + 基础 `/ace status`

**验证标准**: 能在一次会话中自动记住一个修复方法，下次会话自动召回。

### Phase 2: 智能化 — 预计 3-4 天

- [ ] 简单哈希嵌入 (SimpleHashEmbedding 移植)
- [ ] 混合检索 (关键词 + 语义)
- [ ] 语义去重 (Curator)
- [ ] 指数衰退算法
- [ ] LLM 评估 (Haiku, SessionEnd)
- [ ] `PostToolUse` hook (模式检测)
- [ ] `/ace search` + `/ace review` Skills

**验证标准**: 连续 10 次会话后，知识库无明显重复，衰退权重合理。

### Phase 3: 高级功能 — 预计 2-3 天

- [ ] 冲突检测
- [ ] distilled_rule 生成
- [ ] 知识导入/导出
- [ ] 跨项目 Playbook 支持
- [ ] `/learn` 手动记录 Skill
- [ ] 可视化统计面板

### Phase 4: 优化与分发 — 预计 1-2 天

- [ ] 性能调优 (大规模 Playbook 测试)
- [ ] 配置 UI (通过 /ace config)
- [ ] 发布到 Claude Code Plugin Marketplace

---

## 10. 与 Claude Code 原生 Memory 的共存策略

```
                 ┌─────────────────────┐
                 │   Claude Code 用户   │
                 └──────────┬──────────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
     ┌──────────────┐ ┌──────────┐ ┌──────────────┐
     │ CLAUDE.md    │ │ Auto     │ │ ACE Playbook │
     │ (项目规范)   │ │ Memory   │ │ (经验知识)   │
     │              │ │ (备忘)   │ │              │
     │ • 构建命令   │ │ • 临时   │ │ • 蒸馏规则   │
     │ • 代码规范   │ │   笔记   │ │ • 解决方案   │
     │ • 架构说明   │ │ • 快速   │ │ • 避坑指南   │
     │              │ │   参考   │ │ • 用户偏好   │
     │ 静态/手动    │ │ 200行限  │ │ 动态/自动    │
     └──────────────┘ └──────────┘ └──────────────┘
         不变            保留           新增
```

**分工原则**:
- **CLAUDE.md**: 项目级静态规范（人工维护）
- **Auto Memory**: 简短临时备忘（Claude 自动，保持现状）
- **ACE Playbook**: 经验级动态知识（自动蒸馏，长期演进）

三者互不冲突，ACE 填补的是"自动学习 + 精准检索 + 知识演进"的空白。

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Hook 延迟影响体验 | UserPromptSubmit 阻塞用户输入 | 严格 100ms 预算，超时降级跳过 |
| Playbook 膨胀 | 检索变慢，噪声增加 | 衰退 + 归档 + 每月自动清理 |
| LLM 评估成本 | SessionEnd 消耗 Token | 默认关闭，仅规则提取；可选开启 Haiku |
| 知识质量低 | 注入错误信息误导 Claude | LAPS 过滤 + distilled_rule 验证 |
| 与 Auto Memory 冲突 | 重复记录相同信息 | CLAUDE.md 指令约束 + 去重检查 |
| 隐私泄露 | 记录了 token/密码 | 正则脱敏 + 内容分类过滤 |

---

## 12. 总结

本方案将 ACEST 的 ACE 学习框架**完整移植**为 Claude Code 插件，通过 **MCP Server (引擎) + Hooks (自动化) + Skills (交互)** 三层架构，实现：

1. **零感知学习** — 每次编码会话自动积累经验
2. **精准召回** — 只注入当前任务相关的知识
3. **知识演进** — 衰退淘汰过时知识，强化高频知识
4. **质量保证** — 多层过滤 + 去重 + 冲突检测

最终目标：**让每个 Claude Code 用户拥有一个"越用越聪明"的编程助手**。
