# STORY-022: 跨项目 Playbook 管理

**Epic:** EPIC-007 (Advanced Intelligence)
**Priority:** Could Have
**Story Points:** 3
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 4

---

## User Story

As a developer,
I want to manage knowledge across projects,
So that I can promote project-specific insights to global knowledge.

---

## Description

### Background

当前 Playbook 使用 `BulletScope` 区分 `global` 和 `project:{name}` 范围的知识。但用户没有工具按项目分组查看统计、在项目间迁移知识、或将项目特定知识提升为全局知识。

`/ace status` 已有 `byScope` 统计，但缺少交互式管理能力。本 Story 新增项目管理子命令，让用户可以按项目查看、提升和清理知识。

### Scope

**In scope:**
- `scripts/ace-cli.ts`：新增 `projects` 子命令（列出项目及统计）
- `scripts/ace-cli.ts`：新增 `promote` 子命令（project → global 提升）
- `storage/sqlite.ts`：新增 `getBulletsByScope()` 和 `updateBulletScope()` 方法
- `/learn` 支持 `--scope` 参数指定知识范围

**Out of scope:**
- 跨设备/跨用户的 Playbook 同步
- 项目间知识合并（可通过 export + import 实现）
- 自动 scope 推断优化（保持现有 Reflector 逻辑）

---

## User Flow

### 查看项目
1. 用户执行 `/ace projects`
2. 系统按 scope 分组显示统计：
   ```
   global          — 25 bullets (avg decay: 0.72)
   project:myapp   — 18 bullets (avg decay: 0.85)
   project:utils   —  7 bullets (avg decay: 0.45)
   ```

### 提升知识
1. 用户执行 `/ace promote project:myapp`
2. 系统列出该项目下所有 Bullet（高分优先）
3. 用户选择提升方式：
   - `--all`：全部提升为 global
   - `--min-score N`：仅提升 instructivity_score ≥ N 的 Bullet
   - `--id <bullet_id>`：提升指定 Bullet
4. 系统更新 scope 为 `global`，输出统计

### 手动指定 scope
1. 用户执行 `/learn --scope global 始终使用 ESM 而非 CommonJS`
2. 系统将知识直接入库为 global scope

---

## Acceptance Criteria

- [ ] `/ace projects`：按 scope 分组显示 bullet 数量和平均 decay_weight
- [ ] `/ace projects <scope>`：显示指定 scope 下的所有 Bullet 列表（摘要模式）
- [ ] `/ace promote <scope>`：列出该 scope 下 Bullet 摘要
- [ ] `/ace promote <scope> --all`：将该 scope 下所有 Bullet 提升为 `global`
- [ ] `/ace promote <scope> --min-score <N>`：仅提升 score ≥ N 的 Bullet
- [ ] `/ace promote <scope> --id <bullet_id>`：提升单条 Bullet
- [ ] 提升后 `scope` 更新为 `global`，`updated_at` 更新
- [ ] 提升后如果与已有 global Bullet 冲突，走 Curator 去重（merge 或跳过）
- [ ] `storage/sqlite.ts`：`getBulletsByScope(scope)` 和 `updateBulletScope(id, newScope)` 方法
- [ ] `/learn --scope <scope>` 参数支持
- [ ] `skills/learn.md` 更新说明 --scope 用法
- [ ] 不允许将 `global` 降级为 `project:X`（单向提升）
- [ ] 单元测试：projects 统计、promote 更新、scope 过滤

---

## Technical Notes

### Components

- **Modify:** `scripts/ace-cli.ts` — 新增 projects、promote 子命令
- **Modify:** `storage/sqlite.ts` — 新增 scope 查询和更新方法
- **Modify:** `skills/learn.md` — 添加 --scope 参数文档

### Database Methods (新增到 AceDatabase)

```typescript
// Get all distinct scopes with counts
getProjectStats(): Array<{
  scope: string;
  count: number;
  avgDecayWeight: number;
}>

// Get bullets filtered by exact scope
getBulletsByScope(scope: string, options?: {
  minScore?: number;
  limit?: number;
}): Bullet[]

// Update a bullet's scope
updateBulletScope(id: string, newScope: BulletScope): void
```

### SQL Queries

```sql
-- getProjectStats
SELECT scope, COUNT(*) as count, AVG(decay_weight) as avgDecayWeight
FROM bullets
GROUP BY scope
ORDER BY count DESC;

-- getBulletsByScope
SELECT * FROM bullets
WHERE scope = ?
AND instructivity_score >= ?
ORDER BY instructivity_score DESC
LIMIT ?;

-- updateBulletScope
UPDATE bullets SET scope = ?, updated_at = ? WHERE id = ?;
```

### Promote 流程

```typescript
async function promoteCmd(args: string[]) {
  const scope = args[0]; // e.g., 'project:myapp'
  const all = hasFlag(args, '--all');
  const minScore = getFlag(args, '--min-score');
  const bulletId = getFlag(args, '--id');

  if (bulletId) {
    // Single bullet promote
    db.updateBulletScope(bulletId, 'global');
    return;
  }

  const bullets = db.getBulletsByScope(scope, {
    minScore: minScore ? parseInt(minScore) : undefined,
  });

  if (!all && !minScore) {
    // List mode: show bullets for user to review
    output({ scope, bullets: bullets.map(summarize) });
    return;
  }

  // Batch promote
  let promoted = 0;
  for (const b of bullets) {
    db.updateBulletScope(b.id, 'global');
    promoted++;
  }
  output({ promoted, scope, newScope: 'global' });
}
```

### Edge Cases

- 提升已经是 global 的 Bullet → 跳过（no-op）
- scope 不存在 → 返回空列表（不报错）
- promote --all 空 scope → 输出 "No bullets to promote"
- 大量 Bullet 提升 → 在事务中批量更新

---

## Dependencies

**Prerequisite Stories:**
- STORY-016: /ace Skill（CLI 基础架构）

**Blocked Stories:**
- None

**External Dependencies:**
- None

---

## Definition of Done

- [ ] `/ace projects` 命令实现并通过测试
- [ ] `/ace promote` 命令实现并通过测试
- [ ] `storage/sqlite.ts` 新增方法实现
- [ ] `/learn --scope` 参数支持
- [ ] `skills/learn.md` 文档更新
- [ ] 单元测试覆盖各子命令和边界情况
- [ ] 所有现有测试仍通过（364 tests regression）

---

## Story Points Breakdown

- **DB methods:** 0.5 points
- **CLI commands (projects + promote):** 1.5 points
- **learn --scope 集成:** 0.5 points
- **Testing:** 0.5 points
- **Total:** 3 points

**Rationale:** 主要是 CLI 命令和简单 DB 查询，逻辑不复杂但交互场景较多。

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
