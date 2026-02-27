# STORY-015: Decay 衰退管理

**Epic:** EPIC-004 (Knowledge Lifecycle)
**Priority:** Should Have
**Story Points:** 3
**Status:** Done
**Assigned To:** Developer
**Created:** 2026-02-27
**Completed:** 2026-02-27
**Sprint:** 3

---

## User Story

As a developer,
I want outdated knowledge to naturally fade and frequently-used knowledge to persist,
So that the Playbook stays relevant and Claude gives current advice.

---

## Description

### Background

Playbook 中的知识会随时间失去相关性——一个已过时的 API 建议可能误导未来的开发。Decay 机制模拟人类记忆的艾宾浩斯遗忘曲线，让不再被召回的知识自然衰退，频繁使用的知识则得到强化。

### Scope

**In scope:**
- `engine/decay.ts`：DecayManager 类，Ebbinghaus 衰退公式
- `daemon/ipc-handler.ts`：`decay_update` IPC 方法集成
- 单元测试覆盖衰退曲线计算

**Out of scope:**
- 定时触发的自动衰退更新（由 SessionStart 或手动触发）
- 衰退策略可视化

---

## Acceptance Criteria

- [x] `engine/decay.ts`：DecayManager 类实现
- [x] Ebbinghaus 衰退公式：`decay_weight = 2^(-age_days / half_life) × (1 + recall_boost × recall_count)`
- [x] 半衰期 30 天（可通过 `config.decay.half_life_days` 配置）
- [x] 新知识 7 天保护期（`grace_period_days`，decay_weight 锁定 1.0）
- [x] `recall_boost_factor = 0.3`（可配置）
- [x] `recall_count >= permanent_recall_threshold (15)` → 永久保留（decay_weight 锁定 1.0）
- [x] `decay_weight < archive_threshold (0.02)` → 标记为归档候选
- [x] 归档而非删除（移入 archive 表，可恢复）
- [x] `processAll()` 批量重算所有 Bullet，仅在变化 > 0.001 时更新
- [x] Daemon IPC `decay_update` 方法：批量重算 + 归档低权重 Bullet
- [x] 单元测试：衰退曲线理论值对照 — 20 tests

---

## Technical Notes

### 已实现的组件

- **`engine/decay.ts`** — DecayManager class
  - `computeDecayWeight(bullet)`: 计算单条 Bullet 当前衰退权重
  - `processAll(bullets)`: 批量处理，返回 `{ updates, toArchive }`
- **`daemon/ipc-handler.ts`** — `decay_update` IPC 方法
  - 加载所有 Bullet → `DecayManager.processAll()` → 批量更新 + 归档

### 衰退公式详解

```
weight = 2^(-age_days / half_life_days) × (1 + recall_boost_factor × recall_count)
```

- `age_days`: 从 `created_at` 到当前时间的天数
- `half_life_days`: 默认 30（半衰期）
- `recall_boost_factor`: 默认 0.3（每次召回的衰退减缓因子）
- 结果 clamp 到 `[0.0, 1.0]`

### 配置项

```typescript
interface DecayConfig {
  half_life_days: number;             // default: 30
  grace_period_days: number;          // default: 7
  recall_boost_factor: number;        // default: 0.3
  archive_threshold: number;          // default: 0.02
  permanent_recall_threshold: number; // default: 15
}
```

---

## Dependencies

**Prerequisite Stories:**
- STORY-002: SQLite 存储层（archive 表、bullets 表 decay_weight 字段）

---

## Implementation Files

| File | Role | Tests |
|------|------|-------|
| `engine/decay.ts` | DecayManager class | `tests/engine/decay.test.ts` — 20 tests |
| `daemon/ipc-handler.ts` | `decay_update` IPC method | (covered in ipc-handler tests) |

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
