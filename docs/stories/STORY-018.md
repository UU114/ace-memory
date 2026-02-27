# STORY-018: 端到端集成测试 + 验收

**Epic:** Cross-cutting
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
I want end-to-end validation of the complete system,
So that I'm confident in releasing the plugin.

---

## Description

### Background

18 个 Story 的单元测试各自验证了模块正确性，但模块间的集成——从 RulesEngine 捕获模式到 Reflector 蒸馏、Curator 入库、Generator 召回、Decay 衰退——需要端到端测试覆盖完整数据流。

本 Story 创建综合 E2E 测试套件，验证：
1. 完整的学习管道（capture → distill → curate → store）
2. 完整的召回管道（query → search → rank → return）
3. 衰退和归档流程
4. 降级模式（无 ONNX 时的关键词回退）
5. SessionQueue 文件 I/O 链路

### Scope

**In scope:**
- `tests/e2e/pipeline.test.ts`：12 个端到端集成测试
- 覆盖所有核心组件的交互
- 使用真实 SQLite（临时目录）但 mock ONNX

**Out of scope:**
- 手动 E2E 测试（Claude Code 内实际使用）
- 跨平台 CI 验证（本地开发验证）
- 性能基准测试（vitest bench）

---

## Acceptance Criteria

- [x] `tests/e2e/pipeline.test.ts` 创建并通过
- [x] **学习管道 E2E**：RulesEngine 检测 → SessionQueue 写入 → Reflector 蒸馏 → Curator 入库
- [x] **召回管道 E2E**：入库 Bullet → Generator 关键词检索 → 验证召回结果
- [x] **Decay E2E**：入库 → 模拟时间推移 → DecayManager.processAll → 验证权重变化
- [x] **归档 E2E**：decay_weight 低于阈值 → archiveBullet → 验证 Bullet 从 bullets 表移除
- [x] **Curator 去重 E2E**：相同内容入库两次 → 验证 merge 而非 duplicate
- [x] **降级模式 E2E**：无 ONNX embedding → 关键词检索仍工作
- [x] **SessionQueue E2E**：append → read → markProcessed → cleanup 完整链路
- [x] **IPCHandler E2E**：通过 handler.handle() 直接调用 curate/recall/stats/decay_update
- [x] 所有测试使用临时目录（`os.tmpdir()`），测试后清理
- [x] 所有 12 个 E2E 测试通过

---

## Technical Notes

### 测试架构

```typescript
// tests/e2e/pipeline.test.ts
// 使用真实组件（非 mock），但在临时目录中运行
// - AceDatabase: 真实 SQLite in tmpdir
// - VectorCache: 真实内存缓存
// - OnnxEmbedding: null（跳过 ONNX，测试降级路径）
// - RulesEngine, Sanitizer, Classifier, Reflector, Curator, Generator, DecayManager: 全部真实
// - IPCHandler: 真实，但不启动 TCP/socket（直接调用 handle()）
// - LifecycleManager: 真实
```

### 测试用例概览

| # | 测试名 | 验证内容 |
|---|--------|----------|
| 1 | RulesEngine → SessionQueue | 模式检测 → 文件写入 |
| 2 | Reflector distill | SessionQueueEntry → DistilledBullet 转换 |
| 3 | Curator insert | 新 Bullet 入库成功 |
| 4 | Curator merge | 重复内容走 merge 路径 |
| 5 | Generator keyword search | 入库 Bullet 可被关键词检索到 |
| 6 | Decay compute | 衰退权重与公式对照 |
| 7 | Decay archive | 低权重 Bullet 被归档 |
| 8 | IPCHandler curate | IPC 层面完整蒸馏链路 |
| 9 | IPCHandler recall | IPC 层面召回 |
| 10 | IPCHandler stats | IPC 层面统计 |
| 11 | IPCHandler decay_update | IPC 层面批量衰退更新 |
| 12 | Full pipeline | 端到端：capture → distill → store → recall |

### Helper 函数

```typescript
// makeBullet(overrides): 创建完整 Bullet 对象，支持部分覆盖
// candidateToEntry(toolName, candidate): PatternCandidate → SessionQueueEntry 转换
```

---

## Dependencies

**Prerequisite Stories:**
- All prior stories (STORY-001 ~ STORY-017)

---

## Implementation Files

| File | Role | Tests |
|------|------|-------|
| `tests/e2e/pipeline.test.ts` | E2E 集成测试 | 12 tests |

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
