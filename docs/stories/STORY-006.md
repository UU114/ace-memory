# STORY-006: 关键词检索引擎

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Must Have
**Story Points:** 3
**Status:** Completed
**Assigned To:** Claude
**Created:** 2026-02-27
**Sprint:** 1

---

## User Story

As a developer,
I want relevant knowledge found by keyword matching,
So that recall works immediately even without ONNX semantic model.

---

## Description

### Background
关键词检索是 Generator 的基础层。即使没有 ONNX 模型（降级模式），关键词检索也能提供有用的召回结果。检索分三层：L1 精确匹配（最高分）、L2 模糊匹配（中文 2-gram、英文词干化）、L3 元数据匹配（工具/标签/实体前缀匹配）。

### Scope
**In scope:**
- 查询文本的关键词提取和标准化
- L1 精确匹配评分
- L2 模糊匹配（中文 2-gram、英文 stemming）
- L3 元数据字段匹配
- 综合评分和排序
- 与 SQLite 查询集成

**Out of scope:**
- 语义向量检索（Sprint 2 STORY-010）
- 混合评分公式（Sprint 2 STORY-010）
- UserPromptSubmit Hook 集成（STORY-007）

---

## Acceptance Criteria

- [ ] engine/generator.ts 实现 keywordSearch(query, bullets) 函数
- [ ] 查询预处理：转小写、去标点、按空格和中文字符边界分词
- [ ] L1 精确匹配：完整关键词在 content 中出现 → +15 分/次
- [ ] L2 模糊匹配-英文：词干化（去 -ing, -ed, -s, -er, -ly 等常见后缀） → +5 分/次
- [ ] L2 模糊匹配-中文：2-gram 切分（"数据库" → ["数据","据库"]）→ 命中 +5 分/次
- [ ] L3 元数据匹配：related_tools 命中 → +8 分, tags 命中 → +8 分, key_entities 命中 → +10 分
- [ ] L3 前缀匹配支持：`lang:rust`, `cmd:cargo`, `tool:git` 等前缀直接匹配对应元数据字段
- [ ] 结果按 KeywordScore 降序排列
- [ ] 支持 limit 参数（默认 10）
- [ ] 支持 minScore 阈值过滤
- [ ] SQL 预过滤集成：queryBullets({ scopes, minDecayWeight }) 先缩小范围，再内存评分
- [ ] 1000 条 Bullet 规模下检索延迟 <50ms
- [ ] 单元测试：
  - 英文精确匹配
  - 英文词干化匹配（"running" 匹配 "run"）
  - 中文 2-gram 匹配
  - 元数据匹配
  - 前缀语法匹配
  - 排序正确性
  - 空查询返回空结果

---

## Technical Notes

### Generator API

```typescript
// engine/generator.ts

export interface SearchResult {
  bullet: Bullet;
  keywordScore: number;
  semanticScore: number;  // Sprint 2 填充，此 Sprint 为 0
  finalScore: number;     // Sprint 1 = keywordScore
}

export class Generator {
  // 关键词搜索（Sprint 1）
  keywordSearch(query: string, bullets: Bullet[], limit?: number): SearchResult[];

  // 混合搜索（Sprint 2 添加）
  // hybridSearch(query: string, queryEmbedding: Float32Array, bullets: Bullet[], vectors: VectorCache): SearchResult[];
}
```

### 评分详细算法

```typescript
function scoreKeyword(query: string, bullet: Bullet): number {
  const queryTokens = tokenize(query);
  let score = 0;

  // L1: Exact match in content
  for (const token of queryTokens) {
    const regex = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
    const matches = bullet.content.match(regex);
    if (matches) score += 15 * matches.length;
  }

  // L2: Fuzzy match
  const stemmedTokens = queryTokens.map(stem);
  const contentStems = tokenize(bullet.content).map(stem);
  for (const qt of stemmedTokens) {
    if (contentStems.includes(qt)) score += 5;
  }

  // L2: Chinese 2-gram
  const queryGrams = chineseNGrams(query, 2);
  const contentGrams = chineseNGrams(bullet.content, 2);
  const gramOverlap = queryGrams.filter(g => contentGrams.includes(g)).length;
  score += gramOverlap * 5;

  // L3: Metadata
  for (const token of queryTokens) {
    if (bullet.related_tools.some(t => t.toLowerCase() === token)) score += 8;
    if (bullet.tags.some(t => t.toLowerCase() === token)) score += 8;
    if (bullet.key_entities.some(e => e.toLowerCase().includes(token))) score += 10;
  }

  return score;
}
```

### 中文 2-gram

```typescript
function chineseNGrams(text: string, n: number): string[] {
  const chars = text.replace(/[^\u4e00-\u9fff]/g, ''); // 只取中文字符
  const grams: string[] = [];
  for (let i = 0; i <= chars.length - n; i++) {
    grams.push(chars.slice(i, i + n));
  }
  return grams;
}
```

### 英文词干化（轻量级）

```typescript
function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  return w;
}
```

不使用第三方 stemming 库——轻量够用。

---

## Dependencies

**Prerequisite Stories:**
- STORY-002 (SQLite 存储层 — queryBullets 预过滤)

**Blocked Stories:**
- STORY-007 (UserPromptSubmit Hook — 调用 Generator)
- STORY-010 (混合检索升级 — 在关键词基础上叠加语义)

**External Dependencies:** None

---

## Definition of Done

- [ ] Generator.keywordSearch() 完整实现
- [ ] 所有评分层 (L1/L2/L3) 单元测试通过
- [ ] 中英文混合查询测试通过
- [ ] 性能测试：1000 条 Bullet 内检索 <50ms
- [ ] TypeScript 编译通过

---

## Story Points Breakdown

- **查询预处理 + 分词:** 0.5 point
- **L1/L2/L3 评分实现:** 1.5 points
- **SQL 集成 + 排序:** 0.5 point
- **测试:** 0.5 point
- **Total:** 3 points
