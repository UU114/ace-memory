# STORY-002: SQLite 存储层

**Epic:** EPIC-001 (Storage Foundation)
**Priority:** Must Have
**Story Points:** 5
**Status:** Completed
**Assigned To:** Claude
**Created:** 2026-02-27
**Sprint:** 1

---

## User Story

As a developer,
I want a reliable SQLite database layer for storing Bullets,
So that all knowledge data is persisted, queryable, and supports the recall/learning pipeline.

---

## Description

### Background
Bullet 是 claude-ace 的核心数据实体——每条 Bullet 代表一个蒸馏后的知识片段。存储层需要支持高效的元数据过滤查询（scope、section、decay_weight）、embedding BLOB 读写、以及归档操作。使用 better-sqlite3 的同步 API 简化 Daemon 单线程模型中的数据操作。

### Scope
**In scope:**
- SQLite schema 定义（4 张表 + 5 个索引）
- Schema 版本管理和迁移机制
- Bullet CRUD 完整操作
- 批量查询（带过滤条件）
- Embedding BLOB ↔ Float32Array 转换
- JSON 数组字段序列化（tags, related_tools 等）
- WAL 模式开启
- 自动初始化（DB 不存在时创建）
- Archive 操作（Decay 归档）

**Out of scope:**
- 向量相似度计算（由 vector-cache 模块负责）
- 全文检索引擎（由 Generator 模块负责）
- IPC 封装（由 Daemon 负责）

---

## Acceptance Criteria

- [ ] better-sqlite3 集成，WAL 模式默认开启 (`PRAGMA journal_mode=WAL`)
- [ ] bullets 表 DDL 包含所有 Bullet 字段（参考 types/bullet.ts）
- [ ] archive 表 DDL 包含归档字段
- [ ] conflicts 表 DDL 包含冲突检测字段
- [ ] schema_version 表实现版本跟踪
- [ ] 索引：idx_bullets_scope, idx_bullets_section, idx_bullets_knowledge_type, idx_bullets_decay_weight, idx_bullets_scope_decay
- [ ] insertBullet(bullet): 插入完整 Bullet，embedding 作为 Buffer 写入 BLOB
- [ ] updateBullet(id, fields): 部分更新（recall_count, decay_weight 等）
- [ ] deleteBullet(id): 按 ID 删除
- [ ] getBulletById(id): 按 ID 查询，BLOB 转 Float32Array
- [ ] queryBullets(filters): 支持 scope (IN 条件)、section、decay_weight > 阈值、knowledge_type 过滤
- [ ] getAllEmbeddings(): 返回 { id, embedding }[] 用于向量缓存加载
- [ ] archiveBullet(id): 将 Bullet 移入 archive 表并从 bullets 表删除
- [ ] getStats(): 返回总数、按 scope/type/section 分组统计、衰退分布
- [ ] JSON 数组字段正确序列化/反序列化（string[] ↔ JSON string）
- [ ] DB 不存在时自动创建文件 + 执行全量 DDL
- [ ] 所有查询使用参数化（`db.prepare().run(...)`)，防止 SQL 注入
- [ ] 单元测试覆盖：CRUD 操作、过滤查询、BLOB 转换、JSON 数组、自动初始化

---

## Technical Notes

### 模块结构

```
storage/
├── sqlite.ts          # Database class 封装
├── schema.ts          # DDL 定义 + 迁移
└── session-queue.ts   # 会话队列文件读写 (简单 JSONL)
```

### Database Class API

```typescript
// storage/sqlite.ts
export class AceDatabase {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string);

  // Bullet CRUD
  insertBullet(bullet: Bullet): void;
  updateBullet(id: string, fields: Partial<Bullet>): void;
  deleteBullet(id: string): void;
  getBulletById(id: string): Bullet | null;

  // Queries
  queryBullets(filters: BulletFilter): Bullet[];
  getAllEmbeddings(): Array<{ id: string; embedding: Float32Array }>;
  getStats(): PlaybookStats;

  // Lifecycle
  archiveBullet(id: string): void;
  getArchivedBullets(limit?: number): ArchivedBullet[];

  // Conflicts
  insertConflict(conflict: Conflict): void;
  getConflicts(resolved?: boolean): Conflict[];
  resolveConflict(id: string): void;

  // Maintenance
  close(): void;
}

interface BulletFilter {
  scopes?: string[];       // IN (...)
  section?: string;
  knowledgeType?: string;
  minDecayWeight?: number; // decay_weight > threshold
  limit?: number;
  offset?: number;
}
```

### Schema DDL

直接使用架构文档中定义的完整 DDL（bullets, archive, conflicts, schema_version 四表）。

### Embedding BLOB 转换

```typescript
// Float32Array → Buffer (for INSERT)
function embeddingToBuffer(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer);
}

// Buffer → Float32Array (for SELECT)
function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
```

### Session Queue (简单 JSONL)

```typescript
// storage/session-queue.ts
export function appendToQueue(sessionId: string, entry: SessionQueueEntry): void;
export function readQueue(sessionId: string): SessionQueueEntry[];
export function markProcessed(sessionId: string, timestamps: string[]): void;
export function cleanupQueue(sessionId: string): void;
```

Session queue 使用 JSONL 文件（每行一个 JSON），路径 `~/.ace-claude/sessions/{session_id}.jsonl`。

### Edge Cases

- DB 文件被锁（另一进程正在写）→ better-sqlite3 WAL 模式下读写可并发
- DB 文件损坏 → try-catch，日志告警，不崩溃
- embedding 为 null（关键词模式下入库的 Bullet）→ BLOB 列允许 NULL
- JSON 数组字段为空 → 存储为 `"[]"` 而非 NULL

---

## Dependencies

**Prerequisite Stories:**
- STORY-001 (类型定义 + 配置 + 平台适配)

**Blocked Stories:**
- STORY-004 (Daemon — 需要 DB 连接)
- STORY-006 (关键词检索 — 需要查询能力)
- STORY-015 (Decay — 需要 archive 操作)
- STORY-016 (/ace Skill — 需要 stats 查询)

**External Dependencies:**
- better-sqlite3 npm package（含 prebuilt native binding）

---

## Definition of Done

- [ ] AceDatabase 类完整实现
- [ ] 所有 CRUD 方法通过单元测试
- [ ] 过滤查询测试：scope IN、decay_weight 阈值、组合条件
- [ ] BLOB ↔ Float32Array 转换测试（384 维向量）
- [ ] JSON 数组序列化/反序列化测试
- [ ] 自动初始化测试（临时目录创建 DB）
- [ ] session-queue JSONL 读写测试
- [ ] TypeScript 编译通过
- [ ] better-sqlite3 在 Windows 上可正常加载

---

## Story Points Breakdown

- **Schema DDL + 初始化 + 迁移:** 1 point
- **Bullet CRUD + 查询:** 2 points
- **BLOB/JSON 转换 + 边界处理:** 1 point
- **Session queue + 测试:** 1 point
- **Total:** 5 points

**Rationale:** SQLite 操作本身不复杂，但字段数量多（Bullet 20+ 字段），BLOB 处理需要仔细，测试覆盖面广。
