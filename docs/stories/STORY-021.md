# STORY-021: 知识导入/导出

**Epic:** EPIC-005 (User Interaction)
**Priority:** Could Have
**Story Points:** 3
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 4

---

## User Story

As a developer,
I want to export and import my knowledge base,
So that I can backup, share, or migrate my accumulated knowledge.

---

## Description

### Background

当前 `ace-cli.ts` 的 `export` 子命令仅将所有 Bullet 以原始 JSON 数组输出到 stdout，没有格式选项、scope 过滤、文件路径支持。`SourceType = 'imported'` 类型已定义但从未使用。完全没有 `import` 命令。

本 Story 完善导出功能并实现导入功能，支持 JSON 和 Markdown 两种格式，导入时走 Curator 去重流程，使用 `source_type: 'imported'` 标记来源。

### Scope

**In scope:**
- `scripts/ace-cli.ts`：升级 `export` 子命令（支持 --format, --scope, --output）
- `scripts/ace-cli.ts`：新增 `import` 子命令（从 JSON 文件导入）
- `engine/exporter.ts`：导出格式化逻辑（JSON + Markdown）
- `engine/importer.ts`：导入解析 + 校验 + Curator 入库
- 格式版本化（export_version 字段，便于未来兼容）

**Out of scope:**
- 导入 Markdown 格式（仅导出 Markdown，导入仅支持 JSON）
- 增量导出（仅全量或按 scope 过滤）
- 远程同步（仅本地文件操作）

---

## User Flow

### 导出
1. 用户执行 `/ace export` → 输出全量 JSON 到 stdout（向后兼容）
2. 用户执行 `/ace export --format json --scope project:myapp --output ./backup.json` → 按 scope 过滤，写入文件
3. 用户执行 `/ace export --format markdown` → 输出人类可读的 Markdown 格式

### 导入
1. 用户执行 `/ace import ./backup.json`
2. 系统校验 JSON 格式和 export_version
3. 逐条通过 Curator 去重检查
4. 导入结果统计：`+N added, ~N merged, -N skipped`
5. 导入的 Bullet 标记 `source_type: 'imported'`

---

## Acceptance Criteria

- [ ] `/ace export`（无参数）：向后兼容，输出原始 JSON 到 stdout
- [ ] `/ace export --format json`：带版本信息的结构化 JSON
- [ ] `/ace export --format markdown`：人类可读的 Markdown 格式（按 section 分组）
- [ ] `/ace export --scope <scope>`：按 scope 过滤（支持 `global`、`project:name`）
- [ ] `/ace export --output <path>`：输出到文件而非 stdout
- [ ] 导出 JSON 包含 `export_version`、`exported_at`、`bullet_count`、`bullets` 字段
- [ ] 导出 JSON 不包含 `embedding` 字段（节省体积，导入时重新计算）
- [ ] `/ace import <file>`：从 JSON 文件导入
- [ ] 导入时格式校验：检查 `export_version`、`bullets` 数组存在
- [ ] 导入时每条 Bullet 通过 Curator 去重
- [ ] 导入的 Bullet 设置 `source_type: 'imported'`
- [ ] 导入时重新计算 embedding（如果 ONNX 可用）
- [ ] 导入结果统计输出：`{ added: N, merged: N, skipped: N, errors: N }`
- [ ] 导入文件不存在或格式错误时给出明确错误信息
- [ ] 单元测试：导出 JSON/Markdown 格式验证
- [ ] 单元测试：导入正常路径 + 去重 + 错误处理

---

## Technical Notes

### Components

- **New:** `engine/exporter.ts` — 导出格式化
- **New:** `engine/importer.ts` — 导入解析 + 入库
- **Modify:** `scripts/ace-cli.ts` — 升级 export，新增 import 子命令

### 导出 JSON 格式

```json
{
  "export_version": 1,
  "exported_at": "2026-03-01T12:00:00Z",
  "source_project": "claude-ace",
  "bullet_count": 42,
  "bullets": [
    {
      "id": "uuid",
      "scope": "global",
      "section": "techniques",
      "content": "...",
      "distilled_rule": "...",
      "code_content": null,
      "code_language": null,
      "knowledge_type": "Method",
      "instructivity_score": 75,
      "source_type": "auto",
      "recall_count": 3,
      "decay_weight": 0.85,
      "related_tools": [],
      "related_files": [],
      "key_entities": [],
      "tags": [],
      "created_at": "2026-02-28T10:00:00Z",
      "updated_at": "2026-02-28T10:00:00Z"
    }
  ]
}
```

### 导出 Markdown 格式

```markdown
# ACE Playbook Export
> Exported: 2026-03-01 | Bullets: 42

## Techniques
- **[Method]** When using async iterators... (score: 75, recalled 3x)
  > `code snippet here`

## Pitfalls
- **[Pitfall]** Avoid nested callbacks... (score: 60, recalled 1x)

## Preferences
...
```

### Importer 设计

```typescript
class Importer {
  constructor(
    db: AceDatabase,
    curator: Curator,
    embedding: OnnxEmbedding | null,
  ) {}

  async importFromFile(filePath: string): Promise<{
    added: number;
    merged: number;
    skipped: number;
    errors: number;
  }>

  private validateExport(data: unknown): ExportData  // throws on invalid
  private toBullet(raw: ExportedBullet): DistilledBullet
}
```

### CLI 参数解析

```typescript
// ace-cli.ts
case 'export': {
  const format = getFlag(args, '--format') || 'json'; // 'json' | 'markdown'
  const scope = getFlag(args, '--scope');              // optional scope filter
  const output = getFlag(args, '--output');             // optional file path
  // ...
}
case 'import': {
  const filePath = args[0]; // required file path
  // ...
}
```

### Edge Cases

- 导出空 Playbook → 返回空 bullets 数组（不报错）
- 导入含已存在 ID 的 Bullet → Curator 按内容去重（忽略原始 ID，生成新 ID）
- 导入大文件（>1000 条）→ 批量处理，每 100 条输出进度
- 导出 Markdown 中特殊字符转义（`|`、`#` 等）

---

## Dependencies

**Prerequisite Stories:**
- STORY-016: /ace Skill（CLI 基础架构）

**Blocked Stories:**
- None

**External Dependencies:**
- None（纯本地文件操作）

---

## Definition of Done

- [ ] `engine/exporter.ts` 实现并通过测试
- [ ] `engine/importer.ts` 实现并通过测试
- [ ] `scripts/ace-cli.ts` export 升级 + import 新增
- [ ] 导出 JSON 格式版本化
- [ ] 导入走 Curator 去重
- [ ] 单元测试覆盖两种导出格式 + 导入正常和错误路径
- [ ] 所有现有测试仍通过（364 tests regression）

---

## Story Points Breakdown

- **Exporter:** 1 point
- **Importer + Curator 集成:** 1 point
- **CLI + Testing:** 1 point
- **Total:** 3 points

**Rationale:** 导出是格式化输出，较为直接；导入需要校验+Curator 集成，略复杂但模式已有。

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
