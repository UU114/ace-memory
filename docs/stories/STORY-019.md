# STORY-019: 冲突检测 ConflictDetector

**Epic:** EPIC-004 (Knowledge Lifecycle)
**Priority:** Could Have
**Story Points:** 5
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 4

---

## User Story

As a developer,
I want contradictory knowledge automatically detected,
So that the Playbook doesn't give conflicting advice.

---

## Description

### Background

随着 Playbook 中知识条目增长，不可避免会出现相互矛盾的建议。例如一条建议"始终使用 pnpm"，另一条却写"推荐使用 yarn"。当前 Curator 的合并逻辑（longer wins）会静默覆盖矛盾内容，无法让用户感知冲突的存在。

ConflictDetector 在 Curator 入库流程中异步检测三类冲突（Semantic、Negation、Version），将冲突写入已存在的 `conflicts` 表，并通过 `/ace conflicts` 命令让用户查看和处理。

### Scope

**In scope:**
- `engine/conflict-detector.ts`：ConflictDetector 类，三类冲突检测算法
- `storage/sqlite.ts`：新增 conflicts 表的 CRUD 方法
- `daemon/ipc-handler.ts`：新增 `conflicts_check` IPC 方法
- `scripts/ace-cli.ts`：新增 `/ace conflicts` 子命令
- `engine/curator.ts`：入库后异步触发冲突检测
- 单元测试 + 集成测试

**Out of scope:**
- 自动冲突解决（本 Story 仅检测和展示，解决由用户手动操作）
- LLM 辅助冲突判定（未来增强）
- 实时冲突通知（仅 CLI 查询）

---

## User Flow

1. 用户正常使用 Claude Code，PostToolUse → Stop → Curate 管道照常运行
2. Curator 入库新 Bullet 后，异步调用 ConflictDetector 对新 Bullet 进行冲突扫描
3. 检测到冲突时写入 `conflicts` 表（不阻塞正常流程）
4. 用户通过 `/ace conflicts` 查看未解决的冲突列表
5. 用户选择保留某一方或同时保留，系统更新冲突状态

---

## Acceptance Criteria

- [ ] `engine/conflict-detector.ts`：ConflictDetector 类实现
- [ ] **Semantic 冲突**：同一 scope + section 中，cosine similarity ≥ 0.75 但 content 包含对立关键词（always/never, use/avoid, enable/disable 等）
- [ ] **Negation 冲突**：检测 "不要/never/avoid" 与 "始终/always/must" 的直接矛盾
- [ ] **Version 冲突**：检测同一实体的版本号不一致（如 "Node 18" vs "Node 20"）
- [ ] 冲突检测异步执行，不阻塞 Curator 入库返回
- [ ] `storage/sqlite.ts`：新增 `insertConflict()`、`getConflicts()`、`resolveConflict()`、`deleteConflict()` 方法
- [ ] `daemon/ipc-handler.ts`：新增 `conflicts_check` 和 `conflicts_list` IPC 方法
- [ ] `scripts/ace-cli.ts`：`/ace conflicts` 显示冲突列表（bullet_a content vs bullet_b content, conflict_type）
- [ ] `scripts/ace-cli.ts`：`/ace conflicts resolve <id> <keep_a|keep_b|keep_both>` 解决冲突
- [ ] 冲突解决后 `resolved = 1`，`resolved_at` 记录时间戳
- [ ] 选择 `keep_a` 时归档 bullet_b，选择 `keep_b` 时归档 bullet_a
- [ ] 新 Bullet 入库后 5 秒内完成冲突扫描（5000 条规模）
- [ ] 单元测试：三种冲突类型各至少 3 个测试用例
- [ ] 集成测试：Curator → ConflictDetector 完整链路

---

## Technical Notes

### Components

- **New:** `engine/conflict-detector.ts` — ConflictDetector class
- **Modify:** `storage/sqlite.ts` — 新增 conflicts CRUD 方法
- **Modify:** `daemon/ipc-handler.ts` — 新增 IPC methods
- **Modify:** `scripts/ace-cli.ts` — 新增 conflicts 子命令
- **Modify:** `engine/curator.ts` — 入库后 hook conflict detection

### ConflictDetector 设计

```typescript
class ConflictDetector {
  constructor(
    db: AceDatabase,
    vectorCache: VectorCache | null,
  ) {}

  // Scan new bullet against existing bullets for conflicts
  async detect(newBullet: Bullet): Promise<Conflict[]>

  // Internal: semantic contradiction check
  private checkSemantic(a: Bullet, b: Bullet): Conflict | null

  // Internal: negation pattern check
  private checkNegation(a: Bullet, b: Bullet): Conflict | null

  // Internal: version mismatch check
  private checkVersion(a: Bullet, b: Bullet): Conflict | null
}
```

### Database Methods (新增到 AceDatabase)

```typescript
insertConflict(conflict: {
  id: string;
  bullet_id_a: string;
  bullet_id_b: string;
  conflict_type: 'semantic' | 'negation' | 'version';
  description: string;
  created_at: string;
}): void

getConflicts(resolved?: boolean): Conflict[]

resolveConflict(id: string): void

deleteConflict(id: string): void
```

### Curator 集成点

```typescript
// curator.ts curate() 方法末尾
if (result === 'added' && this.conflictDetector) {
  // 异步检测，不阻塞返回
  this.conflictDetector.detect(insertedBullet).then(conflicts => {
    conflicts.forEach(c => this.db.insertConflict(c));
  }).catch(() => {}); // swallow errors - conflict detection is non-critical
}
```

### 对立关键词对照表

```typescript
const ANTONYM_PAIRS = [
  ['always', 'never'],
  ['use', 'avoid'],
  ['enable', 'disable'],
  ['must', 'must not'],
  ['recommend', 'discourage'],
  ['始终', '不要'],
  ['使用', '避免'],
  ['开启', '关闭'],
];
```

### Edge Cases

- 同一 Bullet 不与自身冲突（检查 id !== id）
- 不同 scope 的 Bullet 不检测冲突（project:A vs project:B 无矛盾）
- 已归档 Bullet 不参与冲突检测
- 重复冲突检测幂等（相同 bullet pair 不重复插入）

---

## Dependencies

**Prerequisite Stories:**
- STORY-009: ONNX 嵌入（语义冲突需要 embedding 比较）
- STORY-002: SQLite 存储层（conflicts 表已在 schema 中定义）

**Blocked Stories:**
- None

**External Dependencies:**
- None

---

## Definition of Done

- [ ] `engine/conflict-detector.ts` 实现并通过测试
- [ ] `storage/sqlite.ts` conflicts CRUD 方法实现并通过测试
- [ ] `daemon/ipc-handler.ts` 新 IPC 方法实现
- [ ] `scripts/ace-cli.ts` conflicts 子命令实现
- [ ] `engine/curator.ts` 集成异步冲突检测
- [ ] 单元测试覆盖三种冲突类型 + edge cases
- [ ] 集成测试覆盖完整检测链路
- [ ] 所有现有测试仍通过（364 tests regression）

---

## Story Points Breakdown

- **ConflictDetector engine:** 2 points
- **DB methods + IPC:** 1 point
- **CLI command:** 1 point
- **Testing:** 1 point
- **Total:** 5 points

**Rationale:** 核心难点在三种冲突检测算法设计和对立词匹配，DB/CLI/IPC 层面是标准 CRUD 扩展。

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
