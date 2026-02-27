# Product Requirements Document: claude-ace

**Date:** 2026-02-27
**Author:** TPY
**Version:** 1.0
**Project Type:** Claude Code 插件
**Project Level:** Level 3 (大型, 12-40 Stories)
**Status:** Draft

---

## Document Overview

本文档定义 claude-ace 插件的功能需求（FRs）、非功能需求（NFRs）和 Epics。它是开发阶段的需求真相源（Source of Truth），提供从需求到实现的完整可追溯性。

**Related Documents:**
- Product Brief: `docs/product-brief-claude-ace-2026-02-26.md`
- ACE Framework Theory: `E:\acest\acest\doc\ACE_Framework_Theory.md`
- Plugin Proposal: `docs/ACE_ClaudeCode_Plugin_Proposal.md`

---

## Executive Summary

claude-ace 是一个 Claude Code 插件，将 ACE 自适应记忆框架以 **Hooks + Skills + ACE Daemon + 共享 Engine 库** 的架构实现。Hooks 驱动自动化记忆流程（召回→检测→蒸馏→入库），ACE Daemon 常驻后台提供 ONNX 推理和 SQLite 连接池，Skills 提供用户交互界面。核心目标是让 Claude Code 在持续交互中自动积累、检索、去重和衰退知识，从"无状态工具"进化为"越用越懂你的编程助手"。

---

## Product Goals

### Business Objectives

- **G1**: 1 个月内完成全功能版本，自用验证核心闭环
- **G2**: 连续 2 周日常使用后，Playbook 质量稳定（无重复、衰退合理）
- **G3**: 开源发布，获得 Claude Code 社区关注
- **G4**: 建立在 Claude Code 插件生态中的技术影响力

### Success Metrics

- 知识召回准确率体感 >70%（连续 10+ 次会话后）
- Playbook 有效 Bullet 占比 >80%
- UserPromptSubmit Hook 延迟 <100ms
- 上下文 Token 消耗比全量 MEMORY.md 减少 >50%
- 开源后 3 个月内 100+ Stars、10+ 有效 Issue/PR

---

## Functional Requirements

Functional Requirements (FRs) define **what** the system does - specific features and behaviors.

Each requirement includes:
- **ID**: Unique identifier (FR-001, FR-002, etc.)
- **Priority**: Must Have / Should Have / Could Have / Won't Have (MoSCoW)
- **Description**: What the system should do
- **Acceptance Criteria**: How to verify it's complete

---

### FR-001: Bullet 数据结构与 SQLite 存储

**Priority:** Must Have

**Description:**
定义并实现 Bullet 结构化知识条目，使用 SQLite（better-sqlite3）持久化存储。每条 Bullet 包含：id、scope（global/project:{name}）、section、content、distilled_rule、metadata（instructivity_score、knowledge_type、source_type、recall_count、last_recall、decay_weight、related_tools、related_files、key_entities）、tags、code_content、embedding（BLOB，384维 float32 向量）。项目记忆与通用记忆通过 scope 字段区分，检索时按当前项目 + global 过滤。

**Acceptance Criteria:**
- [ ] Bullet TypeScript 类型定义完整，包含所有必要字段
- [ ] SQLite 数据库 schema 定义正确，关键字段建索引（scope、section、knowledge_type、decay_weight）
- [ ] embedding 列存储为 BLOB（384 × float32 = 1536 bytes/条）
- [ ] 支持插入、按 ID 更新/删除、批量查询
- [ ] scope 字段自动分类："global"（通用知识）/ "project:{name}"（项目级知识）
- [ ] Reflector 根据内容信号自动判断 scope（引用项目内路径→项目级，语言通用知识→global）
- [ ] 存储路径默认 `~/.ace-claude/playbook.db`，可配置
- [ ] 数据库不存在时自动创建并初始化 schema

---

### FR-002: 混合检索引擎（SQL + 内存向量）

**Priority:** Must Have

**Description:**
结合 SQLite 元数据查询和内存向量搜索实现混合检索。元数据过滤（scope、section、decay_weight 等）通过 SQL WHERE 完成；向量相似度通过启动时加载 embedding 到内存进行 brute-force cosine similarity 计算。两者评分加权合并。

**Acceptance Criteria:**
- [ ] 元数据过滤通过 SQL 查询：按 scope（当前项目 + global）、section、decay_weight > 阈值等条件预过滤
- [ ] 启动时加载所有活跃 Bullet 的 embedding 到内存（5000 条 ≈ 7.5MB）
- [ ] 内存中 brute-force cosine similarity 计算，5000 条规模 <20ms
- [ ] 支持增量更新：新增/删除 Bullet 时同步更新内存向量缓存
- [ ] 5000 条 Bullet 规模下，完整检索延迟 <50ms

---

### FR-003: 关键词检索 (Generator L1+L2)

**Priority:** Must Have

**Description:**
实现多层关键词检索算法：L1 精确匹配（全词命中 +15 分）、L2 模糊匹配（中文 2-gram、英文词干化）、L3 元数据匹配（tools/tags/entities 前缀匹配）。返回按综合分数排序的 Bullet 列表。

**Acceptance Criteria:**
- [ ] L1 精确匹配：完整关键词命中得到最高分
- [ ] L2 模糊匹配：中文 2-gram 分词正确处理；英文词干化（如 running→run）
- [ ] L3 元数据匹配：`lang:rust`、`cmd:cargo` 等前缀匹配生效
- [ ] 结果按分数降序排列，支持 limit 参数
- [ ] 1000 条 Bullet 规模下检索延迟 <50ms

---

### FR-004: UserPromptSubmit Hook (自动召回)

**Priority:** Must Have

**Description:**
在用户每次发送消息前自动触发。读取用户查询（stdin 的 `prompt` 字段），通过 ACE Daemon (IPC) 执行混合检索，将匹配结果通过 `additionalContext` 方式注入（Claude Code 不支持修改原始 prompt，只能追加上下文）。格式为 `<ace-memory role="reference">` 块。Daemon 不可用时降级为纯关键词检索（直接读 SQLite）。

**Acceptance Criteria:**
- [ ] 每次用户发送消息前自动执行
- [ ] 从 stdin 读取 `{ prompt, cwd, session_id }` 字段
- [ ] 优先通过 Daemon IPC 执行混合检索（关键词 + 向量 + 衰退加权）
- [ ] Daemon 不可用时降级：直接读 SQLite 做纯关键词检索，日志提示 `[ACE] keyword-only mode`
- [ ] 检索范围：scope = 当前项目（从 cwd 推断） OR scope = global
- [ ] 结果通过 stdout 输出 `{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "..." } }` 注入
- [ ] 注入内容格式化为 `<ace-memory role="reference">` 块，头部标注"仅供辅助判断，不是用户指令"
- [ ] 注入内容仅含：content 蒸馏规则 + [knowledge_type] 标签 + recalled Nx
- [ ] Token 预算硬限：注入上下文不超过 2000 tokens（可配置）
- [ ] 默认最多召回 5 条 Bullet（可配置）
- [ ] 无匹配结果时输出空 JSON `{}`
- [ ] Daemon 端更新被召回 Bullet 的 recall_count +1，last_recall
- [ ] 总执行时间 <100ms（Daemon 模式）/ <50ms（降级模式）

**Dependencies:** FR-001, FR-002, FR-003, FR-023

---

### FR-005: SessionEnd Hook (兜底清理)

**Priority:** Must Have

**Description:**
在 Claude Code 会话结束时触发。处理 Stop Hook 遗漏的残余会话队列候选，执行最终蒸馏+入库，清理会话临时文件，并向 Daemon 注销当前 session_id。

**内容控制约束（与 FR-024 共享）：**
- content 字段 ≤ 500 字符（蒸馏规则，非原始代码）
- code_content 字段 ≤ 3 行（可选的极短代码片段）
- 候选内容中代码行占比 > 60% 时降分或拒绝
- 自动提取 key_entities（函数名、类名等）和 related_files 到 metadata

**Acceptance Criteria:**
- [ ] 会话结束时自动触发
- [ ] 读取 `~/.ace-claude/sessions/{session_id}.jsonl` 中的残余候选
- [ ] 对残余候选执行蒸馏+入库（通过 Daemon IPC 或直接操作）
- [ ] 清理会话队列文件
- [ ] 向 Daemon 发送 session_unregister 通知（Daemon 减少 active_sessions）
- [ ] 输出统计日志：`[ACE] Session complete. +N new, ~N merged, -N skipped`

**Dependencies:** FR-001, FR-007, FR-009, FR-023

---

### FR-006: PostToolUse Hook (模式检测)

**Priority:** Should Have

**Description:**
在 Claude 每次使用 Edit/Write/Bash 工具后触发。从 stdin 接收 `{ tool_name, tool_input, tool_response }` 数据。通过轻量级规则引擎（不调用 LLM）检测可学习的模式（错误修复、代码模式、命令用法等），将候选模式追加到 session 队列文件。每次触发是新进程，通过文件队列跨进程共享数据。

**Acceptance Criteria:**
- [ ] matcher 配置为 `"Edit|Write|Bash"`，仅匹配这三种工具
- [ ] 从 stdin 读取 `{ tool_name, tool_input, tool_response, session_id }`
- [ ] 规则引擎检测：错误修复模式、新文件创建、命令成功/失败模式
- [ ] 候选模式追加到 `~/.ace-claude/sessions/{session_id}.jsonl`（按 session 隔离）
- [ ] 不调用 LLM，纯规则处理
- [ ] 执行时间 <50ms，不阻塞 Claude 工作流
- [ ] 无模式检测到时输出空 JSON `{}`

**Dependencies:** FR-001

---

### FR-007: ONNX 本地嵌入模型

**Priority:** Should Have

**Description:**
使用 `onnxruntime-node` 加载本地 ONNX 嵌入模型（`all-MiniLM-L6-v2`，384 维，~80MB）进行语义向量计算。模型通过 `ace setup` 命令手动触发下载到 `~/.ace-claude/models/`。模型未安装时不提供语义检索能力，明确报错提示用户运行 `ace setup`。

**Acceptance Criteria:**
- [ ] `ace setup` 命令从 HuggingFace 下载 ONNX 模型到 `~/.ace-claude/models/`
- [ ] 使用 `onnxruntime-node` 加载模型并计算 384 维嵌入向量
- [ ] 支持中英文文本嵌入
- [ ] 余弦相似度计算正确
- [ ] 单条文本嵌入计算延迟可接受（<50ms）
- [ ] 模型未安装时，混合检索和语义去重相关功能明确报错，提示运行 `ace setup`
- [ ] Bullet 入库时预计算嵌入向量并存储，避免检索时重复计算

---

### FR-008: 混合检索 (关键词 + 语义)

**Priority:** Should Have

**Description:**
实现完整的混合检索评分公式：`FinalScore = (KeywordScore × 0.6 + SemanticScore × 0.4) × DecayWeight × RecencyBoost`。其中关键词分数来自 FR-003，语义分数来自 FR-007 的余弦相似度，衰退权重来自 FR-011。

**Acceptance Criteria:**
- [ ] 混合评分公式正确实现
- [ ] 关键词权重 0.6、语义权重 0.4（可配置）
- [ ] DecayWeight 和 RecencyBoost 正确参与计算
- [ ] RecencyBoost：7 天内创建/召回的 Bullet ×1.2
- [ ] 相比纯关键词检索，在模糊查询场景下召回率提升

**Dependencies:** FR-003, FR-007, FR-011

---

### FR-009: 语义去重 (Curator)

**Priority:** Should Have

**Description:**
实现 Curator 语义去重机制。新 Bullet 入库前，通过 embedding 向量余弦相似度与现有 Playbook 比较（阈值 0.8）。重复时执行 Merge 策略：合并内容，保留较高的 recall_count，更新 updated_at。

**Acceptance Criteria:**
- [ ] 新 Bullet 入库前自动执行去重检查
- [ ] 相似度阈值 0.8（可配置），使用 embedding 向量余弦相似度
- [ ] Merge 策略：合并内容、保留元数据最优值
- [ ] 完全不同的 Bullet 直接插入
- [ ] 去重检查时间 <100ms（5000 条规模）

**Dependencies:** FR-001, FR-002, FR-007

---

### FR-010: 内容分类与质量过滤

**Priority:** Should Have

**Description:**
实现规则式内容分类器，对候选知识进行 knowledge_type 分类（Method/Trick/Pitfall/Preference/Knowledge）和 instructivity_score 评分。包含内容密度惩罚：`final_score = base_score × (0.6 + 0.4 × content_density / 100)` 和知识蒸馏奖励（+5 分）。

**Acceptance Criteria:**
- [ ] 自动分类 knowledge_type（5 种类型）
- [ ] instructivity_score 评分范围 0-100
- [ ] 内容密度惩罚公式正确实现
- [ ] 知识蒸馏奖励（成功提炼为 distilled_rule 时 +5 分）
- [ ] 低于阈值的候选自动拒绝（min_interaction_quality 可配置，默认 0.3）

---

### FR-011: 艾宾浩斯指数衰退 (Decay)

**Priority:** Should Have

**Description:**
实现指数衰退算法：`decay_weight = 2^(-age_days / half_life) × (1 + recall_boost × recall_count)`。包含：30 天半衰期、7 天新知识保护期、召回增强因子 0.3、15 次以上永久保留、低于 2% 权重自动归档。

**Acceptance Criteria:**
- [ ] 衰退公式正确实现
- [ ] 半衰期 30 天（可配置）
- [ ] 新知识 7 天保护期内 decay_weight 保持 1.0
- [ ] 每次召回增强：recall_boost_factor = 0.3
- [ ] recall_count ≥ 15 的 Bullet 永久保留（decay_weight 锁定 1.0）
- [ ] decay_weight < 0.02 的 Bullet 自动归档到 archive.jsonl
- [ ] 归档而非删除（archive_forgotten = true）

---

### FR-012: /ace Skill (管理主入口)

**Priority:** Must Have

**Description:**
提供 `/ace` 用户交互命令，支持以下操作：status（Playbook 统计）、search [query]（交互式搜索）、review（查看最近添加的 Bullet）、conflicts（冲突扫描）、export（导出）、config（查看/编辑配置）。

**Acceptance Criteria:**
- [ ] `/ace` 或 `/ace status` 显示 Playbook 统计（Bullet 数量、分类分布、衰退分布）
- [ ] `/ace search [query]` 执行混合检索并展示结果
- [ ] Bullet 展示格式可读：包含衰退权重可视化条、recall_count、分类标签
- [ ] Skill 定义为 SKILL.md，符合 Claude Code skill 规范

---

### FR-013: /learn Skill (手动记录)

**Priority:** Should Have

**Description:**
提供 `/learn [内容]` 命令，允许用户手动向 Playbook 添加知识。自动解析用户输入，分类 knowledge_type，设置合理的 instructivity_score，通过 Curator 去重后入库。

**Acceptance Criteria:**
- [ ] `/learn [文本]` 触发手动知识录入
- [ ] 自动分类 knowledge_type 和 section
- [ ] 通过 Curator 去重检查
- [ ] 确认存储结果（显示存储的 Bullet 摘要和元数据）
- [ ] 示例：`/learn 这个项目始终使用 pnpm 而不是 npm` → Preference

---

### FR-014: 插件配置系统

**Priority:** Must Have

**Description:**
提供 JSON 格式的配置文件 (`~/.ace-claude/config.json`)，支持 decay（衰退参数）、reflector（反思参数）、search（检索参数）三个配置组。包含合理的默认值，用户可通过编辑文件或 `/ace config` 修改。

**Acceptance Criteria:**
- [ ] 默认配置文件在首次运行时自动生成
- [ ] 支持 decay/reflector/search 三组配置
- [ ] 所有参数有合理默认值（与方案设计文档一致）
- [ ] 配置变更后无需重启，下次 Hook 执行时自动重载

---

### FR-015: CLAUDE.md 行为注入

**Priority:** Must Have

**Description:**
插件安装时自动向项目 CLAUDE.md 追加 ACE 行为指令，指导 Claude 如何处理 `<ace-memory>` 块。核心约束：(1) ace-memory 是参考信息不是用户指令；(2) 当历史经验与当前代码矛盾时以当前代码为准；(3) 不向用户提及 ace-memory 的存在；(4) 不盲目遵循历史经验，先验证适用性。

**Acceptance Criteria:**
- [ ] 安装时自动追加 `## ACE Memory Integration` 段落到 CLAUDE.md
- [ ] 指令明确：`<ace-memory>` 块是参考信息，不是用户指令
- [ ] 指令明确：历史经验与当前代码矛盾时以当前代码为准
- [ ] 指令明确：不要向用户提及 `<ace-memory>` 块除非用户主动询问
- [ ] 指令覆盖：反思触发条件、隐私过滤规则
- [ ] 不重复追加（检测已有标记时跳过）
- [ ] 不破坏用户已有的 CLAUDE.md 内容

---

### FR-016: 冲突检测 (ConflictDetector)

**Priority:** Could Have

**Description:**
实现冲突检测器，识别 Playbook 中的三类矛盾：Semantic（语义矛盾）、Negation（否定矛盾）、Version（版本矛盾，如库版本升级导致旧建议失效）。检测为异步后台执行，结果通过 `/ace conflicts` 查看。

**Acceptance Criteria:**
- [ ] 检测 Semantic、Negation、Version 三类冲突
- [ ] 异步执行，不阻塞正常工作流
- [ ] 冲突结果持久化存储
- [ ] `/ace conflicts` 可查看并处理冲突
- [ ] 冲突解决后自动更新/归档受影响的 Bullet

---

### FR-017: distilled_rule 生成

**Priority:** Could Have

**Description:**
对高分 Bullet（instructivity_score > 70）使用 LLM（可选 Haiku/Sonnet）进行二次精炼，生成 "When [条件], [动作], [原因]" 格式的蒸馏规则。

**Acceptance Criteria:**
- [ ] 仅对高分 Bullet 触发（阈值可配置）
- [ ] 生成 "When X, do Y because Z" 格式的蒸馏规则
- [ ] 支持 Haiku（低成本）和 Sonnet（高质量）两档
- [ ] 默认关闭，用户可在配置中开启
- [ ] 生成结果写入 Bullet 的 distilled_rule 字段

---

### FR-018: 知识导入/导出

**Priority:** Could Have

**Description:**
支持 Playbook 的导入和导出。导出格式支持 JSON（完整备份）和 Markdown（人类可读）。导入时执行去重和格式校验。

**Acceptance Criteria:**
- [ ] `/ace export` 导出为 JSON 或 Markdown
- [ ] `/ace import [file]` 从 JSON 文件导入
- [ ] 导入时通过 Curator 去重
- [ ] 导入时校验数据格式完整性
- [ ] 支持跨项目导入（不同项目的 Playbook 合并）

---

### FR-019: 跨项目 Playbook 智能管理

**Priority:** Could Have

**Description:**
基于 FR-001 的 scope 字段（global / project:{name}），提供跨项目知识管理能力：项目间知识迁移、项目级知识导出/导入、scope 手动调整等。

**Acceptance Criteria:**
- [ ] `/ace projects` 查看按项目分组的 Bullet 统计
- [ ] 支持将 project:{name} 的 Bullet 提升为 global
- [ ] 支持在 `/learn` 时指定 scope（默认自动判断）
- [ ] 项目删除后其 project-scope Bullet 不自动删除（需手动清理）

---

### FR-020: LLM 评估 (SessionEnd 增强)

**Priority:** Could Have

**Description:**
在 SessionEnd Hook 中可选启用 LLM 评估。使用 Haiku 模型对候选知识进行 should_record 判断、category 分类和 score 评分。默认关闭，启用后增加约 2000 token/会话成本。

**Acceptance Criteria:**
- [ ] 配置 `reflector.llm_evaluate: true` 时启用
- [ ] 调用 Haiku 模型评估候选知识
- [ ] 评估结果包含：should_record、category、score
- [ ] 默认关闭（纯规则评估）
- [ ] LLM 评估超时（>5s）自动降级到规则评估

---

### FR-021: 插件安装与初始化

**Priority:** Must Have

**Description:**
提供完整的插件安装流程：npm 包安装、hooks.json 注册、配置文件初始化、CLAUDE.md 注入。安装分两步：`npm install` 安装代码和注册 Hooks，`ace setup` 下载 ONNX 嵌入模型。

**Acceptance Criteria:**
- [ ] 遵循 Claude Code Plugin 标准结构：`.claude-plugin/plugin.json` + `hooks/hooks.json` + `skills/` + `scripts/`
- [ ] 通过 Claude Code marketplace 分发（Git 仓库 + `marketplace.json`）
- [ ] `/plugin install claude-ace` 或 `claude plugin install claude-ace` 安装
- [ ] 首次启动时自动创建 `~/.ace-claude/` 目录、初始化 playbook.db schema 和默认配置
- [ ] 自动注入 CLAUDE.md 行为指令
- [ ] `/ace setup` Skill 触发 ONNX 嵌入模型下载（~80MB）到 `~/.ace-claude/models/`
- [ ] 模型未下载时插件可运行（纯关键词检索），但语义功能明确报错提示
- [ ] 提供卸载清理能力

---

### FR-022: 隐私自动脱敏

**Priority:** Must Have

**Description:**
在 Reflector 阶段自动检测并过滤隐私敏感信息。通过正则匹配检测 API Key、Token、密码、含用户名的文件路径等，阻止其进入 Playbook。

**Acceptance Criteria:**
- [ ] 正则匹配 API Key 格式（sk-xxx、ghp_xxx 等常见模式）
- [ ] 检测疑似密码/Token 字符串
- [ ] 过滤含用户名的绝对路径（替换为通用占位符）
- [ ] 被过滤内容不写入 Playbook
- [ ] 过滤日志可审计（记录被过滤的原因，不记录内容）

### FR-023: ACE Daemon (常驻后台进程)

**Priority:** Must Have

**Description:**
常驻后台进程，持有 ONNX 模型和 SQLite 连接，通过 Unix domain socket (Linux/macOS) 或 Named pipe (Windows) 提供 IPC 服务。避免每次 Hook 触发都冷启动 ONNX 模型。支持多会话共享、自动空闲退出、版本兼容检测、残留清理。

**生命周期：**
- **SessionStart Hook** 负责启动/复用 Daemon：检查 PID 文件 → 进程存活检测 → 健康检查 → 启动或复用
- **Daemon 自管理**：active_sessions 为空且空闲 >5 分钟自动退出；最后请求超过 10 分钟兜底退出；每 60 秒检测已注册 session 的进程是否存活
- **SessionEnd Hook** 注销 session，Daemon 自行判断是否退出
- **版本检测**：SessionStart 检查 engine_version，不匹配时重启 Daemon

**IPC 协议：**
- `ping` → `{ status: "ok", version, uptime, active_sessions }`
- `recall` → `{ query, project, limit }` → `{ bullets: [...] }`
- `curate` → `{ insights: [...] }` → `{ added, merged, skipped }`
- `session_register` → `{ session_id }`
- `session_unregister` → `{ session_id }`
- `shutdown` → 优雅退出

**Acceptance Criteria:**
- [ ] Daemon 作为 detached 子进程启动，脱离父 Hook 进程
- [ ] PID 文件 (`~/.ace-claude/daemon.pid`) 和 meta 文件 (`daemon.meta.json`) 正确维护
- [ ] Unix domain socket (`~/.ace-claude/daemon.sock`) 或 Named pipe (`\\.\pipe\ace-claude-daemon`) 监听
- [ ] ONNX 模型启动时加载一次，常驻内存
- [ ] SQLite 连接常驻，embedding 向量缓存常驻内存
- [ ] 多 Claude 会话可同时连接同一个 Daemon
- [ ] active_sessions 为空 + 空闲 5 分钟 → 自动退出并清理 PID/socket 文件
- [ ] 最后请求超过 10 分钟 → 兜底退出（防止 Claude 崩溃导致 Daemon 孤儿）
- [ ] 每 60 秒存活检测：验证已注册 session 的进程是否存在，清理死亡 session
- [ ] 版本不匹配时 SessionStart Hook 发送 shutdown 后重启新版本
- [ ] 进程异常退出时 (uncaughtException) 尝试清理 PID/socket 文件
- [ ] Daemon 不可用时所有功能降级到直接文件访问模式

---

### FR-024: Stop Hook (增量蒸馏)

**Priority:** Should Have

**Description:**
在 Claude 每次回复完成时触发（Stop 事件）。检查当前会话队列是否有足够的候选模式，如有则通过 Daemon 执行增量蒸馏+入库，实现更及时的知识积累而非等到会话结束。

**内容控制约束（与 FR-005 共享）：**
- content ≤ 500 字符，code_content ≤ 3 行，代码占比 >60% 拒绝
- 强制蒸馏为 "When X, do Y because Z" 格式

**Acceptance Criteria:**
- [ ] Claude 每次回复完成后触发
- [ ] 读取 `~/.ace-claude/sessions/{session_id}.jsonl` 中的候选
- [ ] 候选数量 ≥ 3 时触发一次蒸馏（避免过于频繁）
- [ ] 通过 Daemon IPC 执行：蒸馏 → ONNX embedding → Curator 去重 → 写入 DB
- [ ] 处理完的候选从队列文件中标记为已处理
- [ ] Daemon 不可用时跳过，交给 SessionEnd 兜底
- [ ] 执行时间不受严格限制（Stop Hook 不阻塞用户输入）

**Dependencies:** FR-006, FR-023

---

### FR-025: SessionStart Hook (Daemon 管理)

**Priority:** Must Have

**Description:**
在 Claude Code 会话启动时触发。负责 ACE Daemon 的启动/复用逻辑和 session 注册。

**Acceptance Criteria:**
- [ ] 会话启动时自动触发
- [ ] 执行 Daemon 启动/复用逻辑（见 FR-023 生命周期）
- [ ] 成功连接后向 Daemon 注册当前 session_id
- [ ] Daemon 启动失败时不阻塞 Claude Code，日志提示 `[ACE] Daemon failed to start, running in degraded mode`
- [ ] 首次启动的延迟可适当放宽（ONNX 模型加载 + SQLite 初始化）

**Dependencies:** FR-023

---

## Non-Functional Requirements

Non-Functional Requirements (NFRs) define **how** the system performs - quality attributes and constraints.

---

### NFR-001: Performance — Hook 延迟

**Priority:** Must Have

**Description:**
UserPromptSubmit Hook 端到端延迟必须 <100ms（Daemon 模式）/ <50ms（降级模式）。PostToolUse Hook <50ms。Stop Hook 无严格限制。SessionEnd Hook <30s。SessionStart 首次启动可适当放宽（Daemon 冷启动）。

**Acceptance Criteria:**
- [ ] UserPromptSubmit Hook p95 延迟 <100ms（Daemon 模式，5000 条 Playbook）
- [ ] UserPromptSubmit Hook p95 延迟 <50ms（降级模式，纯关键词）
- [ ] PostToolUse Hook p95 延迟 <50ms
- [ ] Stop Hook 无严格延迟限制（不阻塞用户输入）
- [ ] SessionEnd Hook 完成时间 <30s
- [ ] SessionStart 首次冷启动 <5s（ONNX 加载），后续复用 <500ms
- [ ] 超时自动降级（跳过检索，不阻塞用户）

**Rationale:**
Hook 延迟直接影响 Claude Code 用户体验。Daemon 架构将 ONNX 冷启动成本从每次 Hook 触发转移到 Session 开始时一次性支付。

---

### NFR-002: Performance — 存储效率

**Priority:** Should Have

**Description:**
JSONL 存储在千级 Bullet 规模下保持高效。启动加载时间 <200ms，单次写入 <10ms。

**Acceptance Criteria:**
- [ ] 1000 条 Bullet 的 JSONL 文件加载到内存 <200ms
- [ ] 单条 Bullet 追加写入 <10ms
- [ ] Playbook 文件大小合理（1000 条 ≈ 1-2MB）

**Rationale:**
Playbook 是持续增长的文件，需确保长期使用不会导致性能退化。

---

### NFR-003: Security — Local-First 数据安全

**Priority:** Must Have

**Description:**
所有数据（Playbook、配置、会话队列）仅存储在用户本地文件系统。不进行任何网络传输（除可选的 LLM 评估通过 Claude Code 自身 API）。自动脱敏机制防止隐私泄露。

**Acceptance Criteria:**
- [ ] 零网络请求（LLM 评估关闭时）
- [ ] 所有文件存储在 `~/.ace-claude/` 目录下
- [ ] 不写入系统临时目录或共享目录
- [ ] 隐私自动脱敏（FR-022）生效

**Rationale:**
Local-First 是核心设计原则，确保通过金融、军工等行业的合规审查。

---

### NFR-004: Reliability — 容错与降级

**Priority:** Must Have

**Description:**
任何 Hook 执行失败不应影响 Claude Code 正常工作。所有 Hook 必须有超时机制和异常捕获，失败时静默降级而非报错中断。

**Acceptance Criteria:**
- [ ] Hook 执行异常时输出空 JSON `{}`，不修改用户消息
- [ ] JSONL 文件损坏时自动跳过错误行，不崩溃
- [ ] 配置文件不存在或格式错误时使用默认值
- [ ] Playbook 文件锁冲突时自动重试 1 次后跳过

**Rationale:**
插件是增强功能，绝不能成为阻碍用户正常编码的障碍。

---

### NFR-005: Maintainability — 代码质量

**Priority:** Should Have

**Description:**
TypeScript 代码必须类型安全、结构清晰、便于社区贡献。

**Acceptance Criteria:**
- [ ] TypeScript strict 模式开启
- [ ] 核心模块有单元测试覆盖（>70%）
- [ ] 目录结构清晰：hooks/、skills/、engine/、types/
- [ ] 关键算法有对照测试（与 Rust 版本结果对比）

**Rationale:**
作为开源项目，代码质量决定社区参与意愿。

---

### NFR-006: Compatibility — Claude Code 兼容性

**Priority:** Must Have

**Description:**
插件必须兼容 Claude Code 当前稳定版的 Hook 和 Skill 机制。不依赖未发布或实验性 API。

**Acceptance Criteria:**
- [ ] 基于 Claude Code 稳定版 Hook API（UserPromptSubmit / PostToolUse / SessionEnd）
- [ ] Skill 定义符合 SKILL.md 规范
- [ ] Node.js ≥ 18 LTS 运行环境
- [ ] Windows / macOS / Linux 三平台可用

**Rationale:**
确保目标用户群能正常安装和使用。

---

### NFR-007: Usability — 零配置启动

**Priority:** Should Have

**Description:**
安装后无需任何配置即可开始使用。所有参数有合理默认值。ACE 在后台自动工作，用户无感。

**Acceptance Criteria:**
- [ ] `npm install` 后即可使用，无需手动编辑配置文件
- [ ] 默认配置覆盖 90% 使用场景
- [ ] 首次召回体验在 3-5 个会话后自然出现（Playbook 积累期）

**Rationale:**
降低使用门槛，让用户快速体验到价值。

---

## Epics

Epics are logical groupings of related functionality that will be broken down into user stories during sprint planning (Phase 4).

Each epic maps to multiple functional requirements and will generate 2-10 stories.

---

### EPIC-001: Storage Foundation (存储基础)

**Description:**
构建 Bullet 数据结构、JSONL 持久化、内存索引引擎和配置系统——整个插件的数据基础设施。

**Functional Requirements:**
- FR-001 (Bullet 数据结构与 JSONL 存储)
- FR-002 (内存索引引擎)
- FR-014 (插件配置系统)

**Story Count Estimate:** 4-5

**Priority:** Must Have

**Business Value:**
所有其他功能的基石。无存储层则无记忆能力。

---

### EPIC-002: Knowledge Recall (知识召回)

**Description:**
实现 Generator 检索引擎和 UserPromptSubmit Hook，完成"自动召回"闭环——用户提问时自动注入相关历史知识。通过 Daemon IPC 实现低延迟向量检索。

**Functional Requirements:**
- FR-003 (关键词检索)
- FR-004 (UserPromptSubmit Hook)
- FR-007 (ONNX 嵌入模型)
- FR-008 (混合检索)

**Story Count Estimate:** 5-7

**Priority:** Must Have

**Business Value:**
用户可感知的核心价值——"Claude 居然记得上次的解决方案"。

---

### EPIC-003: Knowledge Learning (知识学习)

**Description:**
实现 Reflector 蒸馏、PostToolUse 模式检测、Stop 增量蒸馏和 SessionEnd 兜底清理，完成"自动学习"闭环。

**Functional Requirements:**
- FR-005 (SessionEnd Hook — 兜底清理)
- FR-006 (PostToolUse Hook — 模式检测)
- FR-010 (内容分类与质量过滤)
- FR-022 (隐私自动脱敏)
- FR-024 (Stop Hook — 增量蒸馏)

**Story Count Estimate:** 6-8

**Priority:** Must Have

**Business Value:**
"越用越聪明"的核心——无需用户操作即可自动积累经验。

---

### EPIC-004: Knowledge Lifecycle (知识生命周期)

**Description:**
实现 Curator 去重、Decay 衰退和 ConflictDetector 冲突检测，确保 Playbook 长期健康。

**Functional Requirements:**
- FR-009 (语义去重)
- FR-011 (艾宾浩斯指数衰退)
- FR-016 (冲突检测)

**Story Count Estimate:** 4-5

**Priority:** Should Have (FR-009, FR-011 为 Must for Phase 2; FR-016 为 Could)

**Business Value:**
知识库质量保证——防止膨胀、过时和矛盾。

---

### EPIC-005: User Interaction (用户交互)

**Description:**
实现 /ace 和 /learn Skills，提供 Playbook 查看、搜索、手动记录等交互能力。

**Functional Requirements:**
- FR-012 (/ace Skill)
- FR-013 (/learn Skill)
- FR-018 (知识导入/导出)

**Story Count Estimate:** 4-5

**Priority:** Must Have (FR-012) / Should Have (FR-013) / Could Have (FR-018)

**Business Value:**
用户对知识库的可见性和控制力——信任来自透明。

---

### EPIC-006: Plugin Infrastructure (插件基础设施)

**Description:**
插件安装、初始化、CLAUDE.md 注入、ACE Daemon 生命周期管理、卸载——完整的插件基础设施。

**Functional Requirements:**
- FR-015 (CLAUDE.md 行为注入)
- FR-021 (插件安装与初始化)
- FR-023 (ACE Daemon)
- FR-025 (SessionStart Hook — Daemon 管理)

**Story Count Estimate:** 6-8

**Priority:** Must Have

**Business Value:**
整个系统的运行基础——Daemon 是性能保障，安装体验是用户第一印象。

---

### EPIC-007: Advanced Intelligence (高级智能)

**Description:**
LLM 评估、distilled_rule 生成、跨项目 Playbook 等增强功能。

**Functional Requirements:**
- FR-017 (distilled_rule 生成)
- FR-019 (跨项目 Playbook)
- FR-020 (LLM 评估)

**Story Count Estimate:** 4-5

**Priority:** Could Have

**Business Value:**
差异化竞争力——从"好用"到"智能"的跃升。

---

## User Stories (High-Level)

Preliminary stories per epic. Detailed stories will be created in Phase 4 (Sprint Planning).

### EPIC-001 Stories:
- As a developer, I want my coding knowledge to be stored in a readable local file so that I can audit and edit it manually.
- As a developer, I want the knowledge base to load quickly at startup so that it doesn't slow down my workflow.

### EPIC-002 Stories:
- As a developer, I want Claude to automatically recall relevant solutions when I ask about a similar problem so that I don't have to re-explain past context.
- As a developer, I want only the most relevant knowledge injected (not everything) so that Claude's responses stay focused and Token-efficient.

### EPIC-003 Stories:
- As a developer, I want Claude to automatically learn from our problem-solving sessions so that it gets smarter without any effort from me.
- As a developer, I want sensitive information (API keys, passwords) to never be stored in the knowledge base so that my security isn't compromised.

### EPIC-004 Stories:
- As a developer, I want outdated knowledge to naturally fade away so that Claude doesn't give me stale advice.
- As a developer, I want frequently-used knowledge to be permanently retained so that my most valuable insights are never lost.

### EPIC-005 Stories:
- As a developer, I want to search my knowledge base with `/ace search` so that I can find specific learned insights.
- As a developer, I want to manually teach Claude something with `/learn` so that I can capture knowledge Claude might miss.

### EPIC-006 Stories:
- As a developer, I want to install the plugin with a single command so that setup is effortless.
- As a developer, I want Claude to automatically understand how to use the knowledge base so that I don't have to configure any behavior rules.

---

## User Personas

### Persona 1: 资深全栈开发者 "Alex"
- **背景**: 每天使用 Claude Code 8+ 小时，同时维护 3-4 个项目
- **痛点**: 每个项目切换后 Claude "失忆"，同样的 Rust borrow checker 问题要解释多次
- **需求**: 自动积累跨项目通用知识，减少重复解释
- **技术水平**: Expert

### Persona 2: 中级开发者 "小明"
- **背景**: 使用 Claude Code 辅助学习新技术栈，每天 2-3 小时
- **痛点**: Claude 总是给出过时的库版本建议，不记得之前已经确认过的技术选型
- **需求**: 偏好和决策自动记录，避免重复讨论
- **技术水平**: Intermediate

---

## User Flows

### Flow 1: 自动学习→召回闭环
```
Session 1: 用户遇到 Bug → Claude 修复 → SessionEnd Hook 自动蒸馏解法
    ↓
Session 2: 用户遇到类似 Bug → UserPromptSubmit Hook 召回解法 → Claude 直接引用
```

### Flow 2: 手动知识录入
```
用户输入 /learn "这个项目用 pnpm 不用 npm"
    ↓
Curator 去重检查 → 写入 Playbook (section: preferences, type: Preference)
    ↓
下次相关场景 → 自动召回该偏好
```

### Flow 3: 知识库管理
```
用户输入 /ace → 查看 Playbook 统计
用户输入 /ace search "rust borrow" → 搜索相关知识
用户输入 /ace conflicts → 查看矛盾知识 → 手动解决
```

---

## Dependencies

### Internal Dependencies

- ACEST 项目的 Rust 算法实现（作为 TypeScript 移植参考，非运行时依赖）
- ACE Framework Theory 文档（理论指导）

### External Dependencies

- **Claude Code Hook API** — UserPromptSubmit / PostToolUse / SessionEnd 钩子稳定可用
- **Claude Code Skill 规范** — SKILL.md 格式规范稳定
- **Node.js ≥ 18 LTS** — 运行时环境
- **better-sqlite3** — SQLite native binding（~10MB）
- **onnxruntime-node** — ONNX 推理运行时（native binding）
- **all-MiniLM-L6-v2 ONNX 模型** — 嵌入模型文件（~80MB，通过 `ace setup` 手动下载）
- **Claude API (可选)** — 仅 LLM 评估功能（FR-020）需要，默认关闭

---

## Assumptions

- Claude Code Hook 机制在 2026 Q1 版本中稳定可用
- UserPromptSubmit Hook 支持 modifiedQuery 返回以注入上下文
- PostToolUse Hook 可获取 tool_name、tool_input、tool_output 信息
- better-sqlite3 + 内存向量在 5000 条 Bullet 规模下检索延迟 <50ms
- all-MiniLM-L6-v2 ONNX 模型在中英文混合场景下嵌入质量可接受
- better-sqlite3 和 onnxruntime-node 在 Windows/macOS/Linux 三平台编译可靠
- 用户的 Node.js 环境已就绪（Claude Code 本身依赖 Node.js）

---

## Out of Scope

- 桌面 GUI 应用（ACEST Desktop 已有）
- 多用户/团队协作
- 云端同步
- LanceDB 向量数据库（使用 better-sqlite3 替代，更轻量）
- BGE 嵌入模型（使用 all-MiniLM-L6-v2 ONNX 替代，更通用）
- 论文库/学术功能
- Office 文档处理
- MCP Server（不使用 MCP 架构，纯 Hooks + Skills）
- 原始代码存储（Playbook 只存蒸馏规则，不存大段代码）

---

## Open Questions

1. ~~Hook stdin/stdout 协议~~ → **已解决**：API 文档已确认，UserPromptSubmit 接收 `{ prompt, cwd, session_id }`，输出 `additionalContext`
2. **Skill 与 Engine 交互**: Skill 可通过 `allowed-tools: Bash(node *)` 让 Claude 执行 Engine CLI 脚本，也可直接指令 Claude 读取 SQLite。需实际测试哪种体验更好
3. ~~并发安全~~ → **已解决**：Daemon 单进程持有 SQLite 连接，所有写操作通过 Daemon IPC 串行化
4. **Playbook 冷启动**: 首次安装后 Playbook 为空，需要多少会话才能积累到用户能感知召回价值的 Bullet 数量？是否需要"种子知识"?
5. **Daemon 跨平台 IPC**: Unix domain socket 在 Windows 10 build 17063+ 支持，但需测试 Node.js 在 Windows 上的实际表现。是否需要 Named pipe 作为备选？

---

## Approval & Sign-off

### Stakeholders

- **TPY (Owner/Developer)** — Influence: High. 唯一决策者
- **Claude Code 社区** — Influence: Medium. 目标用户群

### Approval Status

- [ ] Product Owner (TPY)

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-27 | TPY | Initial PRD |

---

## Next Steps

### Phase 3: Architecture

Run `/architecture` to create system architecture based on these requirements.

The architecture will address:
- All functional requirements (FRs)
- All non-functional requirements (NFRs)
- Technical stack decisions
- Data models and APIs
- System components

### Phase 4: Sprint Planning

After architecture is complete, run `/sprint-planning` to:
- Break epics into detailed user stories
- Estimate story complexity
- Plan sprint iterations
- Begin implementation

---

**This document was created using BMAD Method v6 - Phase 2 (Planning)**

*To continue: Run `/workflow-status` to see your progress and next recommended workflow.*

---

## Appendix A: Requirements Traceability Matrix

| Epic ID | Epic Name | Functional Requirements | Story Count (Est.) |
|---------|-----------|-------------------------|-------------------|
| EPIC-001 | Storage Foundation | FR-001, FR-002, FR-014 | 4-5 |
| EPIC-002 | Knowledge Recall | FR-003, FR-004, FR-007, FR-008 | 5-7 |
| EPIC-003 | Knowledge Learning | FR-005, FR-006, FR-010, FR-022, FR-024 | 6-8 |
| EPIC-004 | Knowledge Lifecycle | FR-009, FR-011, FR-016 | 4-5 |
| EPIC-005 | User Interaction | FR-012, FR-013, FR-018 | 4-5 |
| EPIC-006 | Plugin Infrastructure | FR-015, FR-021, FR-023, FR-025 | 6-8 |
| EPIC-007 | Advanced Intelligence | FR-017, FR-019, FR-020 | 4-5 |
| **Total** | | **25 FRs** | **33-43 Stories** |

---

## Appendix B: Prioritization Details

### Functional Requirements by Priority

| Priority | Count | FRs |
|----------|-------|-----|
| **Must Have** | 12 | FR-001, FR-002, FR-003, FR-004, FR-005, FR-012, FR-014, FR-015, FR-021, FR-022, FR-023, FR-025 |
| **Should Have** | 8 | FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-013, FR-024 |
| **Could Have** | 5 | FR-016, FR-017, FR-018, FR-019, FR-020 |

### Non-Functional Requirements by Priority

| Priority | Count | NFRs |
|----------|-------|------|
| **Must Have** | 4 | NFR-001, NFR-003, NFR-004, NFR-006 |
| **Should Have** | 3 | NFR-002, NFR-005, NFR-007 |

### Phase Mapping

| Phase | FRs | Priority |
|-------|-----|----------|
| Phase 1 (MVP) | FR-001, FR-002, FR-003, FR-004, FR-005, FR-014, FR-015, FR-021, FR-022, FR-023, FR-025 | Must Have |
| Phase 2 (智能化) | FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-013, FR-024 | Should Have |
| Phase 3 (高级) | FR-016, FR-017, FR-018, FR-019, FR-020 | Could Have |
