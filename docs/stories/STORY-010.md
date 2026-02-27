# STORY-010: In-Memory Vector Cache + Hybrid Retrieval Upgrade

**Epic:** EPIC-002 (Knowledge Recall)
**Priority:** Should Have
**Story Points:** 5
**Status:** Completed
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 2

---

## User Story

As a developer,
I want hybrid keyword + semantic search,
So that fuzzy intent-based queries also return relevant knowledge.

---

## Description

### Background
Sprint 1 delivered keyword-only recall via `engine/generator.ts`. STORY-009 delivered the ONNX embedding module. This story bridges the gap: load all active Bullet embeddings into an in-memory cache at Daemon startup, implement brute-force cosine similarity ranking, and upgrade the Generator to produce a blended `FinalScore` combining keyword and semantic signals.

### Scope
**In scope:**
- daemon/vector-cache.ts: in-memory Float32Array cache
- Generator hybrid scoring formula
- Incremental cache updates on insert/delete
- Configurable weight parameters
- UserPromptSubmit Hook auto-upgrade to hybrid mode
- Graceful fallback when ONNX model unavailable

**Out of scope:**
- ANN index (brute-force is sufficient for ≤5000 Bullets)
- Embedding re-computation for existing Bullets (assume already embedded)
- Changes to keyword scoring logic (keep as-is from STORY-006)

### User Flow
1. Daemon starts → loads all Bullet embeddings from SQLite into memory
2. User types prompt in Claude Code
3. UserPromptSubmit Hook sends prompt to Daemon via IPC `recall`
4. Generator extracts keywords AND computes prompt embedding
5. Keyword scoring runs (existing L1/L2/L3)
6. Semantic scoring: cosine similarity against all cached vectors
7. Hybrid formula combines both scores with decay and recency
8. Top-K results returned to Hook for context injection

---

## Acceptance Criteria

- [ ] `daemon/vector-cache.ts` created: loads all active Bullet embeddings into memory at Daemon startup
- [ ] Memory footprint ≈ 5000 × 384 × 4 bytes = ~7.5MB for 5000 Bullets
- [ ] Incremental update: new Bullet insert → add vector to cache
- [ ] Incremental update: Bullet delete → remove vector from cache
- [ ] Brute-force cosine similarity over full cache: 5000 Bullets < 20ms
- [ ] Hybrid scoring formula: `FinalScore = (KeywordScore × 0.6 + SemanticScore × 0.4) × DecayWeight × RecencyBoost`
- [ ] RecencyBoost: Bullets created/recalled within 7 days get ×1.2 multiplier
- [ ] Weights configurable via `config.json` (`search.keyword_weight`, `search.semantic_weight`)
- [ ] `engine/generator.ts` upgraded: `hybridSearch()` method alongside existing `keywordSearch()`
- [ ] Daemon IPC `recall` method upgraded: uses hybrid search when ONNX available
- [ ] UserPromptSubmit Hook auto-detects ONNX availability and uses hybrid mode
- [ ] Without ONNX model: falls back to keyword-only mode silently (no error, log `[ACE] keyword-only mode`)
- [ ] Performance: 5000-Bullet hybrid retrieval end-to-end < 80ms
- [ ] Unit tests: vector cache CRUD, hybrid scoring, fallback behavior

---

## Technical Notes

### Components
- **daemon/vector-cache.ts** — New module: `VectorCache` class
- **engine/generator.ts** — Extend with `hybridSearch()` method
- **daemon/ipc-handler.ts** — Upgrade `recall` handler from stub to real logic
- **engine/embedding.ts** — Already complete (STORY-009), used for query embedding

### VectorCache Design
```typescript
class VectorCache {
  private vectors: Map<string, Float32Array>; // bulletId → embedding

  async loadFromDb(db: AceDatabase): Promise<void>;
  add(bulletId: string, embedding: Float32Array): void;
  remove(bulletId: string): void;
  searchSimilar(query: Float32Array, limit: number): Array<{ id: string; score: number }>;
  get size(): number;
}
```

### Hybrid Scoring
```
KeywordScore = L1 + L2 + L3  (normalized 0-1)
SemanticScore = cosineSimilarity(queryVec, bulletVec)  (already 0-1)
FinalScore = (KeywordScore × kw_weight + SemanticScore × sem_weight) × DecayWeight × RecencyBoost
```

Where:
- `kw_weight` default 0.6, `sem_weight` default 0.4
- `RecencyBoost` = 1.2 if (now - max(created_at, last_recall)) < 7 days, else 1.0
- `DecayWeight` is stored per-Bullet (0.0-1.0)

### IPC recall Upgrade
Current stub in `ipc-handler.ts` returns empty bullets. Replace with:
1. Embed the query text via `OnnxEmbedding.embed(query)`
2. Call `Generator.hybridSearch(query, queryVec, vectorCache, db, options)`
3. Update recall_count and last_recall for returned Bullets

### Edge Cases
- Daemon starts with 0 Bullets → empty cache, keyword-only until first Bullet ingested
- Bullet has NULL embedding → skip in semantic scoring, keyword-only for that Bullet
- Config weights don't sum to 1.0 → normalize at runtime
- Very short queries (1-2 chars) → skip semantic, keyword-only

---

## Dependencies

**Prerequisite Stories:**
- STORY-004: ACE Daemon core (completed) — provides Daemon lifecycle
- STORY-006: Keyword search engine (completed) — provides keyword scoring
- STORY-009: ONNX embedding module (completed) — provides embedding computation

**Blocked Stories:**
- STORY-013: Reflector + Curator (needs vector cache for semantic dedup)

**External Dependencies:**
- onnxruntime-node (already installed via STORY-009)

---

## Definition of Done

- [ ] Code implemented and committed to feature branch
- [ ] TypeScript strict mode compiles with zero errors
- [ ] Unit tests written and passing
  - [ ] VectorCache load/add/remove/search
  - [ ] Hybrid scoring formula correctness
  - [ ] Fallback to keyword-only when no ONNX
  - [ ] RecencyBoost calculation
- [ ] ESLint zero warnings
- [ ] Performance benchmark: 5000 Bullets hybrid search < 80ms
- [ ] Manual verification on Windows
- [ ] Acceptance criteria all satisfied

---

## Story Points Breakdown

- **VectorCache module:** 2 points
- **Generator hybrid upgrade:** 2 points
- **IPC handler + integration:** 1 point
- **Total:** 5 points

**Rationale:** Core logic (cache + scoring formula) is straightforward but requires careful performance tuning and edge case handling. Integration with existing Generator and IPC handler adds moderate complexity.

---

## Progress Tracking

**Status History:**
- 2026-02-27: Created by Scrum Master
- 2026-02-27: Implemented by Claude

**Actual Effort:** 5 points (matched estimate)

**Implementation Notes:**
- VectorCache: Map<string, Float32Array> with brute-force cosine similarity
- Hybrid formula: FinalScore = (NormalizedKeywordScore × kw_weight + SemanticScore × sem_weight) × DecayWeight × RecencyBoost
- Keyword scores normalized to 0-1 range for fair blending with cosine similarity
- RecencyBoost uses max(last_recall, created_at) for recency window
- IPC recall handler upgraded from stub to real hybrid search pipeline
- Graceful fallback: keyword-only when ONNX unavailable or query too short
- Test coverage: 28 new tests (12 VectorCache + 10 hybrid search + 6 IPC handler)

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
