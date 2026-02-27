# Product Brief: claude-ace

**Date:** 2026-02-26
**Author:** TPY
**Version:** 1.0
**Project Type:** Claude Code 插件
**Project Level:** Level 3 (大型, 12-40 Stories)

---

## Executive Summary

**claude-ace** 是一个 Claude Code 插件，将 ACE（Adaptive Context Engine）自适应记忆框架移植为 Claude Code 原生插件形式。它通过 MCP Server + Hooks + Skills 三层架构，让 Claude Code 从"每次从零开始"的无状态工具，进化为"越用越懂你"的编程助手。该插件面向所有 Claude Code 用户，解决了原生 Auto-Memory 在容量、检索精度、知识演进和去重方面的根本性局限。

---

## Problem Statement

### The Problem

Claude Code 原生的 Auto-Memory (`MEMORY.md`) 存在以下结构性缺陷：

1. **容量硬上限** — 仅 200 行，长期使用后被截断，重要知识丢失
2. **全量加载无检索** — 每次对话全文载入上下文，浪费 Token 且信噪比低
3. **无时效管理** — 过时知识永久占位，无衰退机制，导致"记忆毒化"
4. **无去重机制** — 经常重复记录相同信息，加速容量耗尽
5. **无冲突检测** — 库版本升级等场景下，新旧建议自相矛盾
6. **被动存储** — 依赖 Claude 自行判断是否记录，常遗漏关键经验

**具体示例**：开发者在第一个月解决了一个复杂的 Rust borrow checker 问题并发现了巧妙的解法。三个月后遇到类似问题时，MEMORY.md 早已截断了那条记录，Claude 只能再次从零探索。

### Why Now?

- Claude Code 已成为主流 AI 编程工具，用户基数快速增长
- Claude Code 插件生态处于早期阶段，是切入的最佳时机
- ACEST 项目已在桌面端完成 ACE 框架的完整 Rust 实现，理论和工程已验证
- 2025-2026 年 AI Agent 记忆管理领域出现了 Consolidator-Agent、AgeMem、MemGPT 等突破性学术成果，ACE 框架已对标融合

### Impact if Unsolved

- Claude Code 用户持续面临"健忘助手"问题，每个会话从零开始
- 宝贵的避坑经验、解决方案散落在历史对话中无法复用
- Token 被低价值历史记录浪费，成本上升、推理准确度下降
- 开发者只能手动维护 CLAUDE.md，效率低且难以规模化

---

## Target Audience

### Primary Users

- **Claude Code 重度用户** — 每天使用 Claude Code 进行编码的开发者
  - 技术水平：中高级开发者
  - 痛点：频繁在不同项目间切换，需要 Claude 记住跨会话的解决方案和偏好
  - 行为：已习惯在 CLAUDE.md 中手动记录规范，但觉得自动化程度不够
  - 规模：Claude Code 活跃用户群体

### Secondary Users

- **团队技术负责人** — 希望将团队编码经验沉淀为可共享的知识库
- **开源项目维护者** — 在项目中积累的上下文和决策历史需要长期保持
- **Claude Code 插件开发者** — 可参考本项目的 MCP + Hooks 架构模式

### User Needs

1. **自动经验沉淀** — 无需手动操作，在正常编码过程中自动提炼和积累解决方案
2. **精准知识召回** — 每次对话只注入当前任务相关的经验知识，而非全量历史
3. **知识生命周期管理** — 过时知识自然衰退、高频知识永久保留、矛盾知识自动检测

---

## Solution Overview

### Proposed Solution

将 ACEST 桌面应用中已验证的 ACE 学习框架，以 Claude Code 原生插件形式重新实现。采用 **Hooks (自动化) + Skills (交互) + 共享 Engine 库** 的轻量级架构：

- **Hooks** — 三个自动化触发点：`UserPromptSubmit`（Generator 召回）、`PostToolUse`（模式检测）、`SessionEnd`（Reflector 蒸馏 + Curator 入库）
- **Skills** — `/ace`（管理主入口）和 `/learn`（手动记录）两个用户交互命令
- **Engine** — 共享 TypeScript 库，包含检索、衰退、去重、冲突检测等核心算法，供 Hooks 和 Skills 共同调用

不使用 MCP Server，避免额外进程开销，保持插件轻量。

### Key Features

- **自动知识蒸馏** — 通过 Reflector 机制，自动将对话中的经验提炼为结构化的 Bullet 规则（"When [条件], [动作], [原因]"）
- **混合检索引擎** — 60% 关键词 + 40% 语义 + 衰退加权的三层匹配算法，<100ms 延迟
- **艾宾浩斯衰退** — 指数衰退算法，低频知识自然淘汰，高频知识永久保留（15 次召回以上）
- **语义去重** — Curator 自动检测重复知识并合并，避免 Playbook 膨胀
- **冲突检测** — 自动识别 Semantic/Negation/Version 三类矛盾知识
- **JSONL 存储** — 人类可读、可编辑、Git 友好、零依赖的知识库格式
- **三级评估策略** — 纯规则（0 成本）→ Haiku 快评 → Sonnet 深度蒸馏，渐进式成本控制
- **隐私优先 (Local-First)** — 所有数据本地存储，自动脱敏，无云端依赖

### Value Proposition

**从"无状态工具"到"越用越懂你的编程助手"** — claude-ace 是 Claude Code 原生记忆能力的**量级跃升**。它用经过学术验证的认知心理学模型（艾宾浩斯遗忘曲线、间隔重复、模式提取），将 AI 从"问答机器"提升为"具有经验积累能力的数字协作者"。相比全量载入 MEMORY.md (200 行 ≈ 4000 tokens)，精准检索 5 条 Bullet ≈ 500-1000 tokens，**节省 60-75% Token**。

---

## Business Objectives

### Goals

- **G1**: 1 个月内完成全功能版本，自用验证核心闭环（自动学习→存储→召回→强化→衰退）
- **G2**: 连续 2 周日常使用后，Playbook 无明显重复条目，衰退权重分布合理
- **G3**: 发布为开源项目，获得 Claude Code 社区的关注和反馈
- **G4**: 通过该项目建立在 Claude Code 插件生态中的技术影响力

### Success Metrics

- **自用验证**: 连续 10+ 次会话后，知识召回准确率体感 >70%
- **知识质量**: Playbook 中有效 Bullet 占比 >80%（无重复、无低质量条目）
- **性能达标**: UserPromptSubmit Hook 延迟 <100ms，不影响交互体验
- **Token 节省**: 相比全量 MEMORY.md 注入，上下文 Token 消耗减少 >50%
- **社区指标**: 开源后 3 个月内获得 100+ GitHub Stars、10+ 有效 Issue/PR

### Business Value

作为个人开源项目，核心商业价值体现在：
- **技术品牌**: 在 AI Agent 记忆管理领域建立个人技术影响力
- **社区贡献**: 为 Claude Code 生态提供首个高质量记忆增强插件
- **经验复用**: 将 ACEST 项目的 Rust 实现经验转化为更广泛可用的 TypeScript 生态资产
- **后续可能性**: 为潜在的商业化（如企业版团队知识库、付费高级功能）奠定基础

---

## Scope

### In Scope

**Phase 1 — MVP (核心闭环)**
- MCP Server 骨架 (TypeScript + MCP SDK, stdio 传输)
- JSONL Storage Engine (读写 + 内存索引)
- 关键词检索 (Generator L1+L2)
- `ace_recall` + `ace_curate` MCP Tools
- `UserPromptSubmit` Hook (自动召回)
- `SessionEnd` Hook (规则提取，纯规则，无 LLM)
- Plugin manifest + 基础 `/ace status`

**Phase 2 — 智能化**
- 简单哈希嵌入 (SimpleHashEmbedding 移植)
- 混合检索 (关键词 + 语义)
- 语义去重 (Curator)
- 指数衰退算法 (Decay)
- LLM 评估 (Haiku, SessionEnd)
- `PostToolUse` Hook (模式检测)
- `/ace search` + `/ace review` Skills

**Phase 3 — 高级功能**
- 冲突检测 (Semantic/Negation/Version)
- `distilled_rule` 生成 (Sonnet)
- 知识导入/导出
- 跨项目 Playbook 支持
- `/learn` 手动记录 Skill
- 可视化统计面板

**Phase 4 — 优化与分发**
- 大规模 Playbook 性能调优
- 配置 UI (通过 `/ace config`)
- 文档和使用指南
- 开源发布

### Out of Scope

- **桌面 GUI** — 不构建独立桌面应用（ACEST Desktop 已有此功能）
- **多用户/团队协作** — 初版仅支持单用户本地 Playbook
- **云端同步** — 不提供 Playbook 云同步功能
- **LanceDB 向量数据库** — 简化为纯 JSONL + 哈希嵌入，不依赖重型向量数据库
- **BGE 嵌入模型** — 不移植 ACEST 的 Candle ML 纯 Rust 嵌入，使用轻量级哈希嵌入
- **完整的论文库/学术功能** — 这是 ACEST Desktop 的专属能力
- **Office 文档处理** — 不属于记忆插件的职责

### Future Considerations

- 团队共享 Playbook（远程同步 + 权限控制）
- 与 ACEST Desktop Playbook 的双向同步
- 插件市场分发（Claude Code Plugin Marketplace）
- 可选的外部 Embedding API 集成（OpenAI Ada、Cohere 等）提升语义检索质量
- Playbook 的 Web UI 可视化管理面板
- 多语言文档和国际化

---

## Key Stakeholders

- **TPY (Owner/Developer)** — Influence: High. 唯一开发者与决策者，负责设计、开发、测试、发布全流程
- **Claude Code 用户社区** — Influence: Medium. 开源后的目标用户群，提供需求反馈和 Bug 报告
- **Anthropic (Claude Code 团队)** — Influence: Medium. 插件 API 的提供者，其 Hook/MCP 能力边界决定了插件的实现上限

---

## Constraints and Assumptions

### Constraints

- **Claude Code 插件 API 限制** — Hook 类型有限（UserPromptSubmit / PostToolUse / SessionEnd），能力边界可能不足以支撑所有设计
- **Hook 延迟预算** — UserPromptSubmit Hook 必须在 100ms 内完成，否则阻塞用户输入
- **无 Claude Code 官方插件 SDK** — 插件系统处于早期阶段，文档和工具链不完善
- **单人开发** — 所有工作由一人完成，需要严格的优先级管理
- **TypeScript 生态** — MCP Server 必须使用 Node.js/TypeScript（Claude Code 生态最成熟）
- **存储格式** — JSONL 在万级 Bullet 规模下可能出现性能瓶颈

### Assumptions

- Claude Code 的 Hook 机制（UserPromptSubmit、PostToolUse、SessionEnd）在插件中可用且稳定
- MCP Server 可通过 stdio 与 Claude Code 通信，延迟可接受
- Claude Code 用户有意愿安装第三方插件来增强记忆能力
- JSONL + 内存索引在千级 Bullet 规模下性能足够（<100ms 检索）
- SimpleHashEmbedding 从 Rust 移植到 TypeScript 的精度损失在可接受范围
- Haiku 模型在 SessionEnd 评估场景下的成本和质量平衡可接受

---

## Success Criteria

- **闭环验证**: 在真实编码工作中完成"学习→存储→召回→强化→衰退"完整生命周期
- **零感知体验**: 用户无需任何手动操作即可享受知识积累和召回，ACE 在后台默默工作
- **知识库健康度**: 连续使用 2 周后，Playbook 无大量重复条目，衰退分布合理（长尾衰退，高频永久保留）
- **性能无感**: Hook 执行不影响 Claude Code 响应速度（用户无法感知额外延迟）
- **可维护性**: 代码结构清晰，TypeScript 类型安全，便于后续迭代和社区贡献
- **开源就绪**: 文档完整、安装简单（`npm install` 一步到位）、示例充分

---

## Timeline and Milestones

### Target Launch

**1 个月**（2026-02-26 ~ 2026-03-26）完成全功能版本并开源发布

### Key Milestones

- **Week 1** — Phase 1 MVP: MCP Server 骨架 + JSONL Storage + 关键词检索 + UserPromptSubmit Hook + SessionEnd Hook
  - 里程碑: 能在一次会话中自动记住一个修复方法，下次会话自动召回
- **Week 2** — Phase 2 智能化: 混合检索 + 语义去重 + 衰退算法 + LLM 评估 + PostToolUse Hook
  - 里程碑: 连续 10 次会话后，知识库无明显重复，衰退权重合理
- **Week 3** — Phase 3 高级功能: 冲突检测 + distilled_rule + 导入导出 + `/learn` Skill
  - 里程碑: 完成全部核心功能，进入自用验证阶段
- **Week 4** — Phase 4 优化与发布: 性能调优 + 文档 + 开源发布
  - 里程碑: GitHub 仓库公开，README 完整，安装流程顺畅

---

## Risks and Mitigation

- **Risk:** Claude Code Hook API 能力不足以实现设计中的自动化流程
  - **Likelihood:** Medium
  - **Mitigation:** 提前调研 Hook 实际能力边界；核心功能通过 MCP Tools 兜底，Hook 作为体验增强而非硬依赖

- **Risk:** Rust 核心算法（混合检索、哈希嵌入、衰退计算）移植到 TypeScript 时精度或性能劣化
  - **Likelihood:** Medium
  - **Mitigation:** 对 ACEST 的 Rust 实现编写对照测试集；关键算法先做基准测试再移植；保留降级到纯关键词检索的选项

- **Risk:** UserPromptSubmit Hook 延迟超过 100ms，阻塞用户输入体验
  - **Likelihood:** Medium-High
  - **Mitigation:** Playbook 启动时一次性加载到内存；检索使用预计算索引；超时自动降级跳过

- **Risk:** Playbook 膨胀导致检索质量下降和存储性能问题
  - **Likelihood:** Low-Medium
  - **Mitigation:** 衰退机制 + 归档策略自动控制规模；每月自动清理低权重条目；JSONL 分页读取

- **Risk:** 与 Claude Code 原生 Auto-Memory 产生冲突（重复记录、指令矛盾）
  - **Likelihood:** Low
  - **Mitigation:** 通过 CLAUDE.md 注入明确分工指令；ACE 专注经验蒸馏，Auto-Memory 保留临时备忘角色

- **Risk:** 单人开发精力有限，1 个月内难以完成全部 4 个 Phase
  - **Likelihood:** Medium
  - **Mitigation:** 严格按 Phase 优先级排序；Phase 1 完成即可自用；Phase 3-4 可延后不影响核心价值

---

## Next Steps

1. 创建技术规格文档 (Tech Spec) — `/tech-spec`
2. 进行架构设计 — `/architecture`
3. 开始 Sprint 规划 — `/sprint-planning`

---

**This document was created using BMAD Method v6 - Phase 1 (Analysis)**

*To continue: Run `/workflow-status` to see your progress and next recommended workflow.*
