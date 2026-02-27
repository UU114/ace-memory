# Sprint Plan: claude-ace

**Date:** 2026-02-27
**Scrum Master:** TPY
**Project Level:** Level 3 (大型)
**Total Stories:** 23 (18 committed + 5 backlog)
**Total Points:** 86 (69 committed + 17 backlog)
**Planned Sprints:** 3 (2 × 2-week + 1 × 1-week)
**Target Completion:** 2026-04-04 (5 weeks)

---

## Executive Summary

claude-ace 的实现分为 3 个 Sprint：Sprint 1 构建 Daemon + 存储 + IPC 基础设施并实现关键词召回 MVP；Sprint 2 集成 ONNX 语义检索并完成完整的自动学习管道；Sprint 3 补齐用户交互层和端到端验证。Could Have 功能（冲突检测、LLM 评估等）进入 Backlog，视进度追加。

**Key Metrics:**
- Total Stories: 23
- Committed Points: 69
- Backlog Points: 17
- Sprints: 3 (5 weeks)
- Team Capacity: ~30 pts / 2-week sprint
- Target Completion: 2026-04-04

**Team:**
- 1 developer (senior), solo project
- Productive hours: ~6h/day
- Point calibration: 1pt=1-2h, 3pt=half day, 5pt=1 day, 8pt=2 days

---

## Story Inventory

### STORY-001: 项目脚手架 + 类型系统 + 配置

**Epic:** EPIC-006 (Plugin Infrastructure) + EPIC-001 (Storage Foundation)
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer,
I want the project structure, type definitions, and config system ready,
So that all subsequent modules have a solid foundation to build on.

**Acceptance Criteria:**
- [ ] package.json 配置完整（name, scripts, dependencies）
- [ ] tsconfig.json strict mode 开启
- [ ] vitest.config.ts 配置就绪
- [ ] ESLint + Prettier 配置
- [ ] 目录结构创建：hooks/, skills/, engine/, daemon/, storage/, types/, shared/, scripts/, tests/
- [ ] .claude-plugin/plugin.json + hooks/hooks.json 清单文件
- [ ] TypeScript 接口定义完成：Bullet, IPCRequest/Response, Config, HookInput/Output
- [ ] config-loader.ts：读取 ~/.ace-claude/config.json，缺失时生成默认值
- [ ] logger.ts：[ACE] 前缀 stderr 输出
- [ ] platform.ts：getSocketPath(), getPidPath() 平台适配

**Technical Notes:**
- 参考架构文档 "Code Organization" 章节
- Config schema 参考架构文档 Appendix A
- 所有类型定义在 types/ 目录下，其他模块引用

**Dependencies:** None (第一个 Story)

---

### STORY-002: SQLite 存储层

**Epic:** EPIC-001 (Storage Foundation)
**Priority:** Must Have
**Points:** 5

**User Story:**
As a developer,
I want a reliable SQLite database layer for storing Bullets,
So that all knowledge data is persisted and queryable.

**Acceptance Criteria:**
- [ ] better-sqlite3 集成，WAL 模式开启
- [ ] Schema DDL：bullets, archive, conflicts, schema_version 四表
- [ ] 索引：scope, section, knowledge_type, decay_weight, (scope + decay_weight) 复合索引
- [ ] 自动初始化：DB 不存在时创建 + 执行 DDL
- [ ] CRUD 操作：insertBullet, updateBullet, deleteBullet, getBulletById
- [ ] 批量查询：queryBullets(filters) 支持 scope/section/decay_weight 过滤
- [ ] JSON 数组字段序列化：related_tools, related_files, key_entities, tags
- [ ] embedding BLOB 读写：Float32Array ↔ Buffer 转换
- [ ] 参数化查询，防止 SQL 注入
- [ ] schema_version 迁移机制（预留升级路径）
- [ ] 单元测试覆盖核心 CRUD

**Technical Notes:**
- 存储路径：~/.ace-claude/playbook.db（可配置）
- 参考架构文档 "Database Design" 章节的完整 DDL
- better-sqlite3 是同步 API，天然适合 Daemon 单线程模型

**Dependencies:** STORY-001

---

### STORY-003: IPC 通信框架

**Epic:** EPIC-006 (Plugin Infrastructure)
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer,
I want a cross-platform IPC communication layer,
So that Hook scripts can efficiently communicate with the Daemon.

**Acceptance Criteria:**
- [ ] JSON-RPC 2.0 协议实现（request/response/error 格式）
- [ ] IPCClient 类：connect(), call(method, params), disconnect()
- [ ] IPCServer 类：listen(), onRequest(handler), close()
- [ ] 平台适配：Unix domain socket (Linux/macOS) / Named pipe (Windows)
- [ ] 连接超时机制（默认 50ms for hooks, 5s for SessionStart）
- [ ] 自动重连：连接失败时返回 null 而非抛异常（支持降级）
- [ ] Newline-delimited JSON 消息分帧
- [ ] 单元测试：client-server 通信回环测试

**Technical Notes:**
- Unix socket path: ~/.ace-claude/daemon.sock
- Named pipe: \\.\pipe\ace-claude-daemon
- 参考架构文档 "IPC Protocol Architecture" 章节

**Dependencies:** STORY-001

---

### STORY-004: ACE Daemon 核心 + 生命周期管理

**Epic:** EPIC-006 (Plugin Infrastructure)
**Priority:** Must Have
**Points:** 8

**User Story:**
As a developer,
I want a persistent background daemon process,
So that ONNX model and SQLite connection are loaded once and shared across all Hook invocations.

**Acceptance Criteria:**
- [ ] Daemon 主进程入口 (daemon/index.ts)
- [ ] 启动时：加载配置 → 打开 SQLite → 启动 IPC Server → 写 PID 文件 + meta 文件
- [ ] IPC 请求路由：ping, recall, curate, embed, session_register, session_unregister, shutdown, stats, decay_update
- [ ] ping 返回 { status, version, uptime, active_sessions }
- [ ] session_register：记录 { session_id, pid } 到内存 Map
- [ ] session_unregister：移除 session，检查是否触发空闲退出
- [ ] PID 文件 (~/.ace-claude/daemon.pid) 正确维护
- [ ] daemon.meta.json 包含 pid, engine_version, started_at, socket_path, active_sessions
- [ ] 空闲退出：active_sessions == 0 且 5 分钟无请求 → 自动退出
- [ ] 兜底退出：最后请求超过 10 分钟 → 强制退出
- [ ] 存活检测：每 60 秒检查已注册 session 的进程是否存在（kill -0 / tasklist）
- [ ] 死亡 session 自动清理
- [ ] 优雅退出：关闭 IPC Server → 关闭 SQLite → 删除 PID 文件 + socket 文件
- [ ] uncaughtException 处理器：尝试清理 PID/socket 后退出
- [ ] Daemon 作为 detached 子进程启动（stdio: 'ignore', detached: true, unref()）

**Technical Notes:**
- 这是整个系统最复杂的组件，点数 8
- recall/curate/embed 方法暂返回 stub 响应（Sprint 2 填充真实逻辑）
- 参考架构文档 "Component 1: ACE Daemon" 和 "Lifecycle State Machine"
- Windows 进程检测使用 `process.kill(pid, 0)` 或 tasklist

**Dependencies:** STORY-002, STORY-003

---

### STORY-005: SessionStart Hook

**Epic:** EPIC-006 (Plugin Infrastructure)
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer,
I want the SessionStart Hook to manage Daemon startup and session registration,
So that the Daemon is always available when a Claude Code session begins.

**Acceptance Criteria:**
- [ ] hooks/session-start.ts 实现
- [ ] 流程：检查 PID 文件 → 进程存活? → IPC ping → 版本匹配?
- [ ] 全部通过：session_register → 完成
- [ ] PID 不存在或进程死亡：清理残留 → 启动新 Daemon → 等待 ready → register
- [ ] 版本不匹配：shutdown 旧 Daemon → 启动新版本
- [ ] Daemon 启动失败：日志 `[ACE] Daemon failed to start, running in degraded mode`
- [ ] 首次冷启动允许 5s 超时
- [ ] 复用已有 Daemon <500ms
- [ ] stdout 输出空 JSON `{}`（SessionStart 无需注入内容）

**Technical Notes:**
- 使用 child_process.spawn 启动 Daemon（detached: true）
- 等待 ready：轮询 IPC ping，最多 5s，间隔 200ms
- 参考架构文档 "2a: SessionStart Hook"

**Dependencies:** STORY-004

---

### STORY-006: 关键词检索引擎

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer,
I want a multi-layer keyword search engine,
So that relevant knowledge can be retrieved by text matching even without semantic embeddings.

**Acceptance Criteria:**
- [ ] L1 精确匹配：完整关键词命中 +15 分
- [ ] L2 模糊匹配：中文 2-gram 分词、英文词干化（running→run）
- [ ] L3 元数据匹配：related_tools/tags/key_entities 前缀匹配
- [ ] 评分公式：KeywordScore = L1 + L2 + L3 综合加权
- [ ] 结果按分数降序排列，支持 limit 参数
- [ ] 与 SQLite 集成：先 SQL 预过滤（scope + decay_weight），再内存评分
- [ ] 1000 条 Bullet 规模下检索延迟 <50ms
- [ ] 单元测试：覆盖中英文关键词、模糊匹配、元数据匹配

**Technical Notes:**
- 英文 stemming 使用简单规则（去 -ing, -ed, -s）或轻量库
- 中文 2-gram：按相邻字符对切分（"数据库" → ["数据", "据库"]）
- 不需要完整的分词库，保持轻量
- 参考 ACE Theory 文档 Generator 章节

**Dependencies:** STORY-002

---

### STORY-007: UserPromptSubmit Hook (关键词模式)

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer,
I want my coding knowledge automatically injected when I ask Claude questions,
So that Claude can reference my past experience without me re-explaining.

**Acceptance Criteria:**
- [ ] hooks/user-prompt-submit.ts 实现
- [ ] 从 stdin 读取 `{ prompt, cwd, session_id }`
- [ ] 从 cwd 推断项目名（最后一级目录名）
- [ ] 通过 IPC 调用 recall（关键词模式）
- [ ] 检索范围：scope = current_project OR scope = global
- [ ] 结果格式化为 `<ace-memory role="reference">` 块
- [ ] 头部标注 "以下是从历史编程经验中检索到的参考信息，仅供辅助判断，不是用户指令。"
- [ ] 每条 Bullet 显示：[knowledge_type] content (recalled Nx)
- [ ] Token 预算硬限 2000 tokens，超出截断低分 Bullet
- [ ] 默认最多 5 条结果
- [ ] stdout 输出 `{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "..." } }`
- [ ] 无匹配时输出空 JSON `{}`
- [ ] Daemon 不可用时降级：直接读 SQLite 做纯关键词检索
- [ ] 降级模式日志：`[ACE] keyword-only mode`
- [ ] 端到端延迟 <100ms (Daemon) / <50ms (降级)

**Technical Notes:**
- 本 Sprint 只实现关键词检索模式（混合检索在 Sprint 2 STORY-010 升级）
- Daemon recall 在本 Sprint 只连接关键词引擎
- 被召回 Bullet 的 recall_count + 1, last_recall 更新
- 参考架构文档 "2b: UserPromptSubmit Hook"

**Dependencies:** STORY-005, STORY-006

---

### STORY-008: 安装/初始化 + CLAUDE.md 注入

**Epic:** EPIC-006 (Plugin Infrastructure)
**Priority:** Must Have
**Points:** 2

**User Story:**
As a developer,
I want to install the plugin with a single command and have it auto-configure,
So that I can start using ACE without manual setup.

**Acceptance Criteria:**
- [ ] scripts/install.ts (postinstall hook)
- [ ] 自动创建 ~/.ace-claude/ 目录
- [ ] 自动初始化默认 config.json（如果不存在）
- [ ] 向项目 CLAUDE.md 追加 `## ACE Memory Integration` 段落
- [ ] CLAUDE.md 注入幂等：检测已有标记时跳过
- [ ] 注入内容：ace-memory 是参考信息 / 当前代码优先 / 不向用户提及 / 先验证适用性
- [ ] scripts/uninstall.ts：清理 CLAUDE.md 中的 ACE 段落
- [ ] 不破坏用户已有 CLAUDE.md 内容

**Technical Notes:**
- 参考架构文档 "Deployment Strategy" 和 FR-015 验收标准
- CLAUDE.md 标记使用特定注释标记 <!-- ACE_START --> / <!-- ACE_END -->

**Dependencies:** STORY-001

---

### STORY-009: ONNX 嵌入模块 + ace setup

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Should Have
**Points:** 5

**User Story:**
As a developer,
I want local ONNX embedding for semantic search,
So that knowledge retrieval can match meaning, not just keywords.

**Acceptance Criteria:**
- [ ] engine/embedding.ts：ONNX Runtime Session 封装
- [ ] 模型加载：从 ~/.ace-claude/models/all-MiniLM-L6-v2/ 读取
- [ ] 文本 → 384 维向量推理，单条 <50ms
- [ ] 批量嵌入接口（batch embed）
- [ ] cosine similarity 计算函数
- [ ] scripts/setup.ts：从 HuggingFace 下载 ONNX 模型 (~80MB)
- [ ] 下载进度显示
- [ ] 模型不存在时明确报错：`[ACE] ONNX model not found. Run "ace setup" to download.`
- [ ] Daemon 启动时加载 ONNX Session（一次性，常驻内存）
- [ ] 支持中英文文本嵌入
- [ ] 单元测试：嵌入维度正确，余弦相似度计算正确

**Technical Notes:**
- onnxruntime-node 提供 prebuilt binaries (Win/Mac/Linux)
- 模型文件：model.onnx + tokenizer.json
- 参考架构文档 "3g: Embedding" 和 FR-007

**Dependencies:** STORY-001

---

### STORY-010: 内存向量缓存 + 混合检索升级

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Should Have
**Points:** 5

**User Story:**
As a developer,
I want hybrid keyword + semantic search,
So that fuzzy intent-based queries also return relevant knowledge.

**Acceptance Criteria:**
- [ ] daemon/vector-cache.ts：Daemon 启动时加载所有活跃 Bullet 的 embedding 到内存
- [ ] 5000 条 ≈ 7.5MB 内存占用
- [ ] 增量更新：新 Bullet 插入/删除时同步更新缓存
- [ ] brute-force cosine similarity：5000 条 <20ms
- [ ] 混合评分公式实现：`FinalScore = (KeywordScore × 0.6 + SemanticScore × 0.4) × DecayWeight × RecencyBoost`
- [ ] RecencyBoost：7 天内 ×1.2
- [ ] 权重可配置（search.keyword_weight, search.semantic_weight）
- [ ] UserPromptSubmit Hook 自动升级：ONNX 可用时使用混合检索
- [ ] 无 ONNX 模型时回退关键词模式（不报错，只是不用语义分支）
- [ ] 性能测试：5000 条混合检索 <80ms

**Technical Notes:**
- vector-cache 与 Daemon 生命周期绑定
- recall IPC 方法升级为调用 Generator 混合检索
- 参考架构文档 "3a: Generator" 和 FR-008

**Dependencies:** STORY-004, STORY-006, STORY-009

---

### STORY-011: PostToolUse Hook + 规则引擎

**Epic:** EPIC-003 (Knowledge Learning)
**Priority:** Should Have
**Points:** 5

**User Story:**
As a developer,
I want Claude's tool usage patterns to be detected automatically,
So that the system learns from my coding sessions without manual input.

**Acceptance Criteria:**
- [ ] hooks/post-tool-use.ts 实现
- [ ] matcher 配置：`"Edit|Write|Bash"` 仅匹配这三种工具
- [ ] 从 stdin 读取 `{ tool_name, tool_input, tool_response, session_id }`
- [ ] engine/rules-engine.ts：纯规则模式检测（不调用 LLM）
- [ ] 检测模式类型：
  - error_fix：Bash 失败后 Edit 修复
  - code_pattern：import 添加、错误处理模式
  - command_usage：成功的命令模式
  - file_creation：新文件创建模式
- [ ] 候选写入 `~/.ace-claude/sessions/{session_id}.jsonl`
- [ ] 每行一个 JSON 对象（SessionQueueEntry 格式）
- [ ] 无模式检测到时输出空 JSON `{}`
- [ ] 执行时间 <50ms
- [ ] 单元测试：各种工具输出的模式检测

**Technical Notes:**
- session queue 文件是跨进程共享的（PostToolUse 写，Stop/SessionEnd 读）
- 每次 Hook 是新进程，不依赖内存状态
- 参考架构文档 "2c: PostToolUse Hook"

**Dependencies:** STORY-001

---

### STORY-012: 隐私脱敏 + 内容分类器

**Epic:** EPIC-003 (Knowledge Learning)
**Priority:** Must Have (脱敏) + Should Have (分类)
**Points:** 3

**User Story:**
As a developer,
I want sensitive information filtered and knowledge properly classified,
So that no secrets leak into the Playbook and each Bullet has the right metadata.

**Acceptance Criteria:**
- [ ] engine/sanitizer.ts：正则匹配 API Key (sk-xxx, ghp_xxx, AKIA...)
- [ ] 检测疑似密码/Token 字符串
- [ ] 含用户名的绝对路径替换为 ~ 占位符
- [ ] 被过滤内容不写入 Playbook
- [ ] 过滤日志可审计（记录原因，不记录内容）
- [ ] engine/classifier.ts：knowledge_type 分类（Method/Trick/Pitfall/Preference/Knowledge）
- [ ] instructivity_score 评分 (0-100)
- [ ] 内容密度惩罚：`final_score = base_score × (0.6 + 0.4 × content_density / 100)`
- [ ] 蒸馏奖励 +5 分
- [ ] 低分过滤（< min_interaction_quality 拒绝，默认 0.3）
- [ ] 单元测试：各种 API Key 格式检测、分类准确性

**Technical Notes:**
- Sanitizer 在 Reflector 流程中最先调用（入库前过滤）
- Classifier 结果写入 Bullet 的 knowledge_type + instructivity_score
- 参考 FR-010 和 FR-022

**Dependencies:** STORY-001

---

### STORY-013: Reflector 蒸馏器 + Curator 语义去重

**Epic:** EPIC-003 (Knowledge Learning) + EPIC-004 (Knowledge Lifecycle)
**Priority:** Should Have
**Points:** 5

**User Story:**
As a developer,
I want raw patterns distilled into concise knowledge rules and deduplicated,
So that the Playbook stays clean, focused, and free of redundancy.

**Acceptance Criteria:**
- [ ] engine/reflector.ts：SessionQueueEntry → Bullet 转换
- [ ] 内容控制：content ≤ 500 字符（蒸馏规则，非原始代码）
- [ ] 内容控制：code_content ≤ 3 行
- [ ] 内容控制：候选中代码行占比 > 60% 时降分或拒绝
- [ ] 格式化为 "When X, do Y because Z" 蒸馏格式
- [ ] scope 自动判断：引用项目内路径 → project:{name}，通用知识 → global
- [ ] 自动提取 key_entities（函数名、类名等）到 metadata
- [ ] 自动提取 related_files 到 metadata
- [ ] 调用 Sanitizer 过滤隐私信息
- [ ] 调用 Classifier 分类 + 评分
- [ ] engine/curator.ts：入库前语义去重
- [ ] cosine similarity 阈值 0.8（可配置）
- [ ] Merge 策略：合并 content、保留较高 recall_count、更新 updated_at
- [ ] 完全不同的 Bullet 直接插入
- [ ] 更新内存向量缓存
- [ ] 去重检查 <100ms (5000 条规模)

**Technical Notes:**
- Reflector 调用链：Sanitizer → 蒸馏 → Classifier → Embedding → Curator → DB insert
- Curator 依赖 ONNX embedding（无 ONNX 时跳过语义去重，仅做精确匹配去重）
- Daemon IPC curate 方法调用此流程
- 参考架构文档 "3b: Reflector" 和 "3c: Curator"

**Dependencies:** STORY-009, STORY-010, STORY-012

---

### STORY-014: Stop Hook + SessionEnd Hook

**Epic:** EPIC-003 (Knowledge Learning)
**Priority:** Should Have (Stop) + Must Have (SessionEnd)
**Points:** 5

**User Story:**
As a developer,
I want knowledge distilled incrementally during sessions and fully cleaned up at session end,
So that learning happens promptly and no candidates are lost.

**Acceptance Criteria:**
- [ ] hooks/stop.ts：每次 Claude 回复完成后触发
- [ ] 读取 sessions/{session_id}.jsonl 中未处理候选
- [ ] 候选数量 ≥ 3 时触发蒸馏（避免过频）
- [ ] 通过 Daemon IPC curate 执行蒸馏+入库
- [ ] 处理完的候选标记 processed: true
- [ ] Daemon 不可用时跳过，交给 SessionEnd
- [ ] hooks/session-end.ts：会话结束时触发
- [ ] 处理残余未蒸馏候选
- [ ] 清理会话队列文件
- [ ] IPC session_unregister
- [ ] 输出统计：`[ACE] Session complete. +N new, ~N merged, -N skipped`
- [ ] SessionEnd 完成时间 <30s

**Technical Notes:**
- Stop Hook 不阻塞用户输入（无严格延迟限制）
- SessionEnd 是兜底机制，处理 Stop Hook 遗漏的残余
- 参考架构文档 "2d: Stop Hook" 和 "2e: SessionEnd Hook"

**Dependencies:** STORY-011, STORY-013

---

### STORY-015: Decay 衰退管理

**Epic:** EPIC-004 (Knowledge Lifecycle)
**Priority:** Should Have
**Points:** 3

**User Story:**
As a developer,
I want outdated knowledge to naturally fade and frequently-used knowledge to persist,
So that the Playbook stays relevant and Claude gives current advice.

**Acceptance Criteria:**
- [ ] engine/decay.ts：Ebbinghaus 衰退公式
- [ ] `decay_weight = 2^(-age_days / half_life) × (1 + recall_boost × recall_count)`
- [ ] 半衰期 30 天（可配置）
- [ ] 新知识 7 天保护期（decay_weight 锁定 1.0）
- [ ] recall_boost_factor = 0.3（可配置）
- [ ] recall_count ≥ 15 → 永久保留（decay_weight 锁定 1.0）
- [ ] decay_weight < 0.02 → 移入 archive 表
- [ ] 归档而非删除（可恢复）
- [ ] 每次召回时更新：recall_count +1, last_recall, 重算 decay_weight
- [ ] Daemon IPC decay_update 方法：批量重算所有 Bullet 的 decay_weight
- [ ] 单元测试：衰退曲线与理论值对照

**Technical Notes:**
- Decay 更新有两个触发点：recall 时单条更新、decay_update 批量更新（可由定时任务或 SessionStart 触发）
- 参考 ACE Theory 文档 Decay 章节和 FR-011

**Dependencies:** STORY-002

---

### STORY-016: /ace Skill

**Epic:** EPIC-005 (User Interaction)
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer,
I want to view and manage my knowledge base through the /ace command,
So that I have visibility and control over what Claude has learned.

**Acceptance Criteria:**
- [ ] skills/ace.md (SKILL.md 定义)
- [ ] scripts/ace-cli.ts：CLI 入口
- [ ] `/ace` 或 `/ace status`：Playbook 统计（总数、按类型、按 scope、衰退分布）
- [ ] `/ace search [query]`：执行混合检索并格式化展示
- [ ] `/ace review`：最近 7 天添加的 Bullet 列表
- [ ] `/ace config`：显示当前配置
- [ ] `/ace setup`：触发 ONNX 模型下载（调用 scripts/setup.ts）
- [ ] Bullet 展示包含：[type] content | decay: ████░░ 72% | recalled 5x
- [ ] SKILL.md 的 allowed-tools 配置允许 Bash(node *)

**Technical Notes:**
- Skill 通过 SKILL.md 指令 Claude 调用 `node scripts/ace-cli.js <command>`
- ace-cli 直接读取 SQLite（不需要 Daemon，CLI 场景可以独立运行）
- 参考架构文档 "4a: /ace Skill"

**Dependencies:** STORY-002, STORY-006

---

### STORY-017: /learn Skill

**Epic:** EPIC-005 (User Interaction)
**Priority:** Should Have
**Points:** 2

**User Story:**
As a developer,
I want to manually teach Claude knowledge with /learn,
So that I can capture insights the automatic system might miss.

**Acceptance Criteria:**
- [ ] skills/learn.md (SKILL.md 定义)
- [ ] `/learn [文本]` 触发手动知识录入
- [ ] 自动分类 knowledge_type 和 section
- [ ] 通过 Curator 去重检查
- [ ] 确认存储结果（显示存储的 Bullet 摘要）
- [ ] 支持 `/learn` 时指定 scope（默认自动判断）
- [ ] 示例：`/learn 这个项目始终使用 pnpm 而不是 npm` → Preference

**Technical Notes:**
- learn 调用 ace-cli.ts learn 子命令
- 走完整的 Sanitizer → Classifier → Embedding → Curator → Insert 流程
- 参考 FR-013

**Dependencies:** STORY-013, STORY-016

---

### STORY-018: 端到端集成测试 + 验收

**Epic:** (Cross-cutting)
**Priority:** Must Have
**Points:** 3

**User Story:**
As a developer,
I want end-to-end validation of the complete system,
So that I'm confident in releasing the plugin.

**Acceptance Criteria:**
- [ ] E2E 流程验证：全新安装 → SessionStart → 首次对话 → PostToolUse → Stop → SessionEnd → 下次对话召回
- [ ] 性能基准测试：5000 条 Bullet 下 UserPromptSubmit <100ms
- [ ] 降级模式验证：Kill Daemon → UserPromptSubmit 关键词模式工作
- [ ] 跨平台验证：Windows + macOS/Linux
- [ ] Bug 修复：集成测试发现的问题
- [ ] README.md 基础文档

**Technical Notes:**
- 使用 vitest bench 进行性能基准测试
- 手动 E2E 测试（Claude Code 内实际使用）

**Dependencies:** All prior stories

---

### STORY-019: 冲突检测 ConflictDetector (Backlog)

**Epic:** EPIC-004 (Knowledge Lifecycle)
**Priority:** Could Have
**Points:** 5

**User Story:**
As a developer,
I want contradictory knowledge automatically detected,
So that the Playbook doesn't give conflicting advice.

**Acceptance Criteria:**
- [ ] 检测 Semantic、Negation、Version 三类冲突
- [ ] 异步执行，不阻塞正常工作流
- [ ] 冲突结果写入 conflicts 表
- [ ] `/ace conflicts` 查看并处理
- [ ] 冲突解决后自动更新/归档

**Dependencies:** STORY-009, STORY-002

---

### STORY-020: distilled_rule LLM 生成 (Backlog)

**Epic:** EPIC-007 (Advanced Intelligence)
**Priority:** Could Have
**Points:** 3

**User Story:**
As a developer,
I want high-quality Bullets refined by LLM into concise rules,
So that recalled knowledge is more precise and actionable.

**Acceptance Criteria:**
- [ ] 高分 Bullet (instructivity_score > 70) 触发 LLM 精炼
- [ ] 生成 "When X, do Y because Z" 格式
- [ ] 支持 Haiku (低成本) 和 Sonnet (高质量)
- [ ] 默认关闭，配置开启

**Dependencies:** STORY-013

---

### STORY-021: 知识导入/导出 (Backlog)

**Epic:** EPIC-005 (User Interaction)
**Priority:** Could Have
**Points:** 3

**User Story:**
As a developer,
I want to export and import my knowledge base,
So that I can backup, share, or migrate my accumulated knowledge.

**Acceptance Criteria:**
- [ ] `/ace export` 导出 JSON / Markdown
- [ ] `/ace import [file]` 从 JSON 导入
- [ ] 导入时 Curator 去重
- [ ] 格式校验

**Dependencies:** STORY-016

---

### STORY-022: 跨项目 Playbook 管理 (Backlog)

**Epic:** EPIC-007 (Advanced Intelligence)
**Priority:** Could Have
**Points:** 3

**User Story:**
As a developer,
I want to manage knowledge across projects,
So that I can promote project-specific insights to global knowledge.

**Acceptance Criteria:**
- [ ] `/ace projects` 按项目分组统计
- [ ] 支持 project → global 提升
- [ ] `/learn` 可指定 scope

**Dependencies:** STORY-016

---

### STORY-023: LLM 评估增强 (Backlog)

**Epic:** EPIC-007 (Advanced Intelligence)
**Priority:** Could Have
**Points:** 3

**User Story:**
As a developer,
I want optional LLM evaluation of knowledge candidates,
So that only truly valuable insights enter the Playbook.

**Acceptance Criteria:**
- [ ] 配置 `reflector.llm_evaluate: true` 启用
- [ ] Haiku 模型评估 should_record, category, score
- [ ] 默认关闭
- [ ] 超时 >5s 降级到规则评估

**Dependencies:** STORY-013

---

## Sprint Allocation

### Sprint 1 (Week 1-2) — 30/30 points

**Goal:** Daemon 运行稳定，关键词召回注入上下文。安装即可用的 MVP。

**Stories:**

| # | Story | Points | Priority | Epic |
|---|-------|--------|----------|------|
| 1 | STORY-001: 项目脚手架 + 类型 + 配置 | 3 | Must Have | EPIC-006/001 |
| 2 | STORY-002: SQLite 存储层 | 5 | Must Have | EPIC-001 |
| 3 | STORY-003: IPC 通信框架 | 3 | Must Have | EPIC-006 |
| 4 | STORY-004: ACE Daemon 核心 + 生命周期 | 8 | Must Have | EPIC-006 |
| 5 | STORY-005: SessionStart Hook | 3 | Must Have | EPIC-006 |
| 6 | STORY-006: 关键词检索引擎 | 3 | Must Have | EPIC-002 |
| 7 | STORY-007: UserPromptSubmit Hook (关键词) | 3 | Must Have | EPIC-002 |
| 8 | STORY-008: 安装/初始化 + CLAUDE.md 注入 | 2 | Must Have | EPIC-006 |

**Total:** 30 points / 30 capacity (100%)

**Sprint 1 交付物:**
- 可安装的插件 (plugin.json + hooks.json)
- 运行中的 Daemon（IPC 通信、生命周期管理）
- 关键词召回注入到 Claude Code 对话上下文
- CLAUDE.md 自动注入行为指令
- SQLite 存储就绪

**Risks:**
- ACE Daemon (8 pts) 是最大单体，跨平台 IPC 可能有坑
- 缓解：优先验证 Windows Named pipe 行为，必要时降级 TCP localhost

**依赖链:** STORY-001 → (002, 003, 008 并行) → 004 → 005 → (006 并行) → 007

---

### Sprint 2 (Week 3-4) — 28/30 points

**Goal:** ONNX 混合检索上线，自动学习管道完整闭环。

**Stories:**

| # | Story | Points | Priority | Epic |
|---|-------|--------|----------|------|
| 9 | STORY-009: ONNX 嵌入 + ace setup | 5 | Should Have | EPIC-002 |
| 10 | STORY-010: 向量缓存 + 混合检索升级 | 5 | Should Have | EPIC-002 |
| 11 | STORY-011: PostToolUse Hook + 规则引擎 | 5 | Should Have | EPIC-003 |
| 12 | STORY-012: 隐私脱敏 + 内容分类器 | 3 | Must/Should | EPIC-003 |
| 13 | STORY-013: Reflector 蒸馏 + Curator 去重 | 5 | Should Have | EPIC-003/004 |
| 14 | STORY-014: Stop Hook + SessionEnd Hook | 5 | Should/Must | EPIC-003 |

**Total:** 28 points / 30 capacity (93%)

**Sprint 2 交付物:**
- ONNX 语义检索 + 混合评分
- 完整自动学习管道：PostToolUse → Stop → SessionEnd
- 隐私脱敏 + 内容分类 + 蒸馏 + 去重
- 用户可体验完整的"学习→召回"闭环

**Risks:**
- onnxruntime-node 跨平台编译可能有问题
- 缓解：提前测试三平台 prebuilt binaries

**依赖链:** (009, 011, 012 并行) → 010 → 013 → 014

---

### Sprint 3 (Week 5, 1-week sprint) — 11/15 points

**Goal:** 补齐生命周期管理和用户交互，端到端验收通过。

**Stories:**

| # | Story | Points | Priority | Epic |
|---|-------|--------|----------|------|
| 15 | STORY-015: Decay 衰退管理 | 3 | Should Have | EPIC-004 |
| 16 | STORY-016: /ace Skill | 3 | Must Have | EPIC-005 |
| 17 | STORY-017: /learn Skill | 2 | Should Have | EPIC-005 |
| 18 | STORY-018: 端到端测试 + 验收 | 3 | Must Have | Cross-cut |

**Total:** 11 points / 15 capacity (73%)

**Sprint 3 交付物:**
- Ebbinghaus 衰退机制生效
- /ace 和 /learn Skills 可用
- 端到端测试通过
- 可发布版本

**Buffer:** 4 points 余量用于 Sprint 1-2 遗留 Bug 修复

---

### Backlog (Post-Launch)

| # | Story | Points | Priority | Epic |
|---|-------|--------|----------|------|
| 19 | STORY-019: 冲突检测 | 5 | Could Have | EPIC-004 |
| 20 | STORY-020: distilled_rule LLM 生成 | 3 | Could Have | EPIC-007 |
| 21 | STORY-021: 导入/导出 | 3 | Could Have | EPIC-005 |
| 22 | STORY-022: 跨项目管理 | 3 | Could Have | EPIC-007 |
| 23 | STORY-023: LLM 评估增强 | 3 | Could Have | EPIC-007 |

**Backlog Total:** 17 points

---

## Epic Traceability

| Epic ID | Epic Name | Stories | Points | Sprint |
|---------|-----------|---------|--------|--------|
| EPIC-001 | Storage Foundation | STORY-001(部分), 002 | 8 | 1 |
| EPIC-002 | Knowledge Recall | STORY-006, 007, 009, 010 | 16 | 1-2 |
| EPIC-003 | Knowledge Learning | STORY-011, 012, 013, 014 | 18 | 2 |
| EPIC-004 | Knowledge Lifecycle | STORY-013(部分), 015, 019* | 11 | 2-3 (+Backlog) |
| EPIC-005 | User Interaction | STORY-016, 017, 021* | 8 | 3 (+Backlog) |
| EPIC-006 | Plugin Infrastructure | STORY-001(部分), 003, 004, 005, 008 | 19 | 1 |
| EPIC-007 | Advanced Intelligence | STORY-020*, 022*, 023* | 9 | Backlog |

*Backlog items

---

## Functional Requirements Coverage

| FR ID | FR Name | Story | Sprint |
|-------|---------|-------|--------|
| FR-001 | Bullet 数据结构与 SQLite 存储 | STORY-001, 002 | 1 |
| FR-002 | 混合检索引擎 | STORY-010 | 2 |
| FR-003 | 关键词检索 | STORY-006 | 1 |
| FR-004 | UserPromptSubmit Hook | STORY-007, 010 | 1-2 |
| FR-005 | SessionEnd Hook | STORY-014 | 2 |
| FR-006 | PostToolUse Hook | STORY-011 | 2 |
| FR-007 | ONNX 本地嵌入 | STORY-009 | 2 |
| FR-008 | 混合检索评分 | STORY-010 | 2 |
| FR-009 | 语义去重 Curator | STORY-013 | 2 |
| FR-010 | 内容分类与质量过滤 | STORY-012 | 2 |
| FR-011 | 艾宾浩斯衰退 | STORY-015 | 3 |
| FR-012 | /ace Skill | STORY-016 | 3 |
| FR-013 | /learn Skill | STORY-017 | 3 |
| FR-014 | 配置系统 | STORY-001 | 1 |
| FR-015 | CLAUDE.md 注入 | STORY-008 | 1 |
| FR-016 | 冲突检测 | STORY-019* | Backlog |
| FR-017 | distilled_rule 生成 | STORY-020* | Backlog |
| FR-018 | 导入/导出 | STORY-021* | Backlog |
| FR-019 | 跨项目管理 | STORY-022* | Backlog |
| FR-020 | LLM 评估 | STORY-023* | Backlog |
| FR-021 | 插件安装与初始化 | STORY-001, 008, 016 | 1, 3 |
| FR-022 | 隐私自动脱敏 | STORY-012 | 2 |
| FR-023 | ACE Daemon | STORY-003, 004, 005 | 1 |
| FR-024 | Stop Hook | STORY-014 | 2 |
| FR-025 | SessionStart Hook | STORY-005 | 1 |

**Coverage:** 20/25 FRs committed (12 Must + 8 Should), 5 Could Have in Backlog

---

## Risks and Mitigation

**High:**
- **Windows Named pipe 稳定性** — Node.js net 模块对 Named pipe 支持可能有边缘问题
  - Mitigation: Sprint 1 第一天验证 IPC 跨平台；备选方案 TCP localhost:49152
- **onnxruntime-node 跨平台编译** — native binding 在某些 ARM64 环境可能缺 prebuilt
  - Mitigation: Sprint 2 首日验证 Win/Mac/Linux；考虑 fallback 到纯关键词模式

**Medium:**
- **Daemon 孤儿进程** — Claude Code 崩溃可能导致 Daemon 未被正常回收
  - Mitigation: 10 分钟兜底退出 + 60 秒存活检测
- **Playbook 冷启动期** — 前 5-10 次会话 Playbook 为空，用户无感知价值
  - Mitigation: 文档说明、首次 /learn 引导

**Low:**
- **中文嵌入质量** — all-MiniLM-L6-v2 非中文专用
  - Mitigation: 关键词权重 0.6 补偿；后续可换模型
- **Claude Code Plugin API 变更** — API 尚在演进
  - Mitigation: 仅使用稳定事件，保持最小依赖

---

## Dependencies

| 依赖 | 类型 | 影响 |
|------|------|------|
| Claude Code Hook API (5 events) | External | 核心——API 变更需要适配 |
| better-sqlite3 npm package | External | 存储层——需三平台 prebuilt |
| onnxruntime-node npm package | External | 语义层——需三平台 prebuilt |
| all-MiniLM-L6-v2 ONNX model | External | 语义层——需 HuggingFace 可达 |
| Node.js ≥ 18 LTS | External | 运行时——用户机器上需要 |
| ACEST Rust 代码 (参考) | Internal | 算法对照——非运行时依赖 |

---

## Definition of Done

For a story to be considered complete:
- [ ] Code implemented and committed
- [ ] TypeScript strict mode 编译通过，零错误
- [ ] 核心逻辑有单元测试（>70% 覆盖率）
- [ ] ESLint 零 warning
- [ ] 在 Windows 上手动验证（主开发平台）
- [ ] Acceptance criteria 全部满足
- [ ] 无已知 regression

---

## Next Steps

**Immediate:** Begin Sprint 1

Run `/dev-story STORY-001` to start implementing the first story, or `/create-story STORY-001` to create a detailed story document first.

**Recommended implementation order for Sprint 1:**
```
Week 1 (Day 1-5):
  Day 1:   STORY-001 (脚手架 + 类型 + 配置)
  Day 2:   STORY-002 (SQLite 存储层)
  Day 3:   STORY-003 (IPC 通信框架) + STORY-008 (安装/CLAUDE.md)
  Day 4-5: STORY-004 (ACE Daemon 核心)

Week 2 (Day 6-10):
  Day 6:   STORY-004 续 + STORY-005 (SessionStart Hook)
  Day 7:   STORY-006 (关键词检索)
  Day 8:   STORY-007 (UserPromptSubmit Hook)
  Day 9-10: 集成调试 + Bug 修复 + Buffer
```

**Sprint cadence:**
- Sprint 1: Week 1-2 (2026-02-28 → 2026-03-14)
- Sprint 2: Week 3-4 (2026-03-14 → 2026-03-28)
- Sprint 3: Week 5 (2026-03-28 → 2026-04-04)

---

**This plan was created using BMAD Method v6 - Phase 4 (Implementation Planning)**

*To continue: Run `/workflow-status` to see your progress and next recommended workflow.*
