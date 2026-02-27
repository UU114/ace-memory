# STORY-013: Reflector Distiller + Curator Semantic Dedup

**Epic:** EPIC-003 (Knowledge Learning) + EPIC-004 (Knowledge Lifecycle)
**Priority:** Should Have
**Story Points:** 5
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 2

---

## User Story

As a developer,
I want raw patterns distilled into concise knowledge rules and deduplicated,
So that the Playbook stays clean, focused, and free of redundancy.

---

## Description

### Background
The Reflector and Curator are the heart of the learning pipeline. Raw pattern candidates captured by PostToolUse Hook (STORY-011) are messy — they contain verbose tool outputs, raw code, and noise. The Reflector distills each candidate into a structured Bullet with concise content, proper metadata, and quality filtering. The Curator then checks if a semantically similar Bullet already exists and either merges or inserts.

This is the critical path from "raw observation" to "useful knowledge in Playbook."

### Scope
**In scope:**
- `engine/reflector.ts`: SessionQueueEntry → Bullet conversion pipeline
- `engine/curator.ts`: Semantic dedup before DB insert
- Full pipeline: Sanitize → Distill → Classify → Embed → Dedup → Insert
- Daemon IPC `curate` method implementation (replace stub)

**Out of scope:**
- LLM-assisted distillation (STORY-020 backlog) — pure rule-based here
- Conflict detection (STORY-019 backlog)
- The Hooks that call this pipeline (STORY-014)

### User Flow
1. Stop/SessionEnd Hook reads session queue candidates
2. Sends candidates to Daemon via IPC `curate`
3. Daemon invokes Reflector for each candidate:
   a. Sanitizer strips secrets → reject if dirty
   b. Distiller extracts concise content + code snippet
   c. Classifier assigns type + score → reject if low quality
   d. Embedding module computes 384-dim vector
4. Curator receives distilled Bullet:
   a. Searches vector cache for similar existing Bullets (cosine > 0.8)
   b. If match found → merge: combine content, keep higher recall_count, update timestamps
   c. If no match → insert new Bullet into DB + update vector cache
5. Returns stats: `{ added: N, merged: N, skipped: N }`

---

## Acceptance Criteria

### Reflector
- [ ] `engine/reflector.ts` created
- [ ] Input: `SessionQueueEntry[]` (from session JSONL queue)
- [ ] Output: `DistilledBullet[]` (ready for Curator)
- [ ] Pipeline: Sanitizer → Distill → Classify → Embed
- [ ] Content control: `content` field ≤ 500 characters
- [ ] Content control: `code_content` field ≤ 3 lines
- [ ] Content control: candidates with code ratio > 60% get score penalty or rejection
- [ ] Distillation format: "When X, do Y because Z" style whenever possible
- [ ] Auto-extract `key_entities` from content (function names, class names, package names)
- [ ] Auto-extract `related_files` from candidate context
- [ ] Auto-determine `scope`: content references project-specific paths → `project:{name}`, otherwise `global`
- [ ] Calls Sanitizer (STORY-012) for privacy filtering
- [ ] Calls Classifier (STORY-012) for type + score assignment
- [ ] Calls Embedding (STORY-009) for vector computation
- [ ] Skips embedding if ONNX unavailable (Bullet stored without vector)

### Curator
- [ ] `engine/curator.ts` created
- [ ] Input: single `DistilledBullet` (with embedding)
- [ ] Semantic dedup: cosine similarity threshold 0.8 (configurable via `curator.dedup_threshold`)
- [ ] When similarity ≥ threshold → **merge**:
  - Combine content (keep newer if more specific, or append delta)
  - Preserve higher `recall_count`
  - Update `updated_at` to now
  - Keep higher `instructivity_score`
  - Merge `tags`, `key_entities`, `related_files` (union)
- [ ] When similarity < threshold → **insert**: new Bullet into DB
- [ ] Update in-memory vector cache after insert or merge
- [ ] Without ONNX/embeddings → fallback to exact content match dedup only
- [ ] Dedup check < 100ms for 5000 Bullet scale

### IPC Integration
- [ ] Daemon `curate` IPC method: replace stub with real Reflector → Curator pipeline
- [ ] Returns `{ added: number, merged: number, skipped: number }`
- [ ] `skipped` = rejected by Sanitizer + rejected by Classifier low score

---

## Technical Notes

### Components
- **engine/reflector.ts** — New module: `Reflector` class
- **engine/curator.ts** — New module: `Curator` class
- **daemon/ipc-handler.ts** — Upgrade `curate` handler from stub
- **engine/sanitizer.ts** — Called by Reflector (from STORY-012)
- **engine/classifier.ts** — Called by Reflector (from STORY-012)
- **engine/embedding.ts** — Called by Reflector (from STORY-009)
- **daemon/vector-cache.ts** — Updated by Curator (from STORY-010)
- **storage/sqlite.ts** — Insert/update Bullets

### Reflector Design
```typescript
interface DistilledBullet {
  scope: string;
  section: string;
  content: string;
  code_content: string | null;
  code_language: string | null;
  knowledge_type: string;
  instructivity_score: number;
  source_type: 'auto';
  related_tools: string[];
  related_files: string[];
  key_entities: string[];
  tags: string[];
  embedding: Float32Array | null;
}

class Reflector {
  constructor(
    private sanitizer: Sanitizer,
    private classifier: Classifier,
    private embedding: OnnxEmbedding | null,
  );

  async distill(entries: SessionQueueEntry[], projectName: string): Promise<{
    bullets: DistilledBullet[];
    skipped: number;
  }>;

  private distillContent(entry: SessionQueueEntry): string;
  private extractEntities(content: string): string[];
  private inferScope(entry: SessionQueueEntry, projectName: string): string;
  private inferSection(knowledgeType: string): string;
}
```

### Curator Design
```typescript
class Curator {
  constructor(
    private db: AceDatabase,
    private vectorCache: VectorCache | null,
  );

  async curate(bullet: DistilledBullet): Promise<'added' | 'merged' | 'skipped'>;

  private findSimilar(embedding: Float32Array): { bulletId: string; score: number } | null;
  private mergeBullets(existing: Bullet, incoming: DistilledBullet): void;
  private insertBullet(bullet: DistilledBullet): void;
}
```

### Distillation Heuristics
- **error_fix** → "When encountering {error}, fix by {action} because {reason}"
- **code_pattern** → "When {context}, use {pattern} because {benefit}"
- **command_usage** → "Use `{command}` for {purpose}"
- **file_creation** → "Create {file_type} with {key_content} for {purpose}"

### Entity Extraction (Simple Heuristics)
- CamelCase words → likely class/type names
- Words following `import`/`require`/`from` → package names
- File extensions → related_tools (`.rs` → `rust`, `.ts` → `typescript`)
- Quoted strings in backticks → likely code entities

### Edge Cases
- Candidate has no meaningful content after sanitization → skip
- Embedding service unavailable → store without vector, skip semantic dedup
- Multiple candidates from same session map to same Bullet → merge all
- Content exceeds 500 chars → truncate with "..." suffix
- Code content exceeds 3 lines → keep first 3 lines

---

## Dependencies

**Prerequisite Stories:**
- STORY-009: ONNX embedding (completed) — embedding computation
- STORY-010: Vector cache + hybrid retrieval — vector cache for dedup search
- STORY-012: Sanitizer + Classifier — called in Reflector pipeline

**Blocked Stories:**
- STORY-014: Stop + SessionEnd Hooks (calls curate IPC method)
- STORY-017: /learn Skill (uses Curator for manual entries)

**External Dependencies:**
- None beyond already-installed packages

---

## Definition of Done

- [ ] Code implemented and committed to feature branch
- [ ] TypeScript strict mode compiles with zero errors
- [ ] Unit tests written and passing
  - [ ] Reflector: content distillation for each pattern type
  - [ ] Reflector: content length enforcement (500 chars, 3 lines code)
  - [ ] Reflector: entity extraction accuracy
  - [ ] Reflector: scope inference (project vs global)
  - [ ] Curator: semantic dedup with merge
  - [ ] Curator: insert new Bullet
  - [ ] Curator: fallback to exact-match dedup without ONNX
  - [ ] Integration: full pipeline from SessionQueueEntry to DB
- [ ] ESLint zero warnings
- [ ] Dedup performance: < 100ms for 5000 Bullets
- [ ] Manual verification on Windows
- [ ] Acceptance criteria all satisfied

---

## Story Points Breakdown

- **Reflector (distillation + entity extraction):** 2.5 points
- **Curator (dedup + merge logic):** 1.5 points
- **IPC integration + testing:** 1 point
- **Total:** 5 points

**Rationale:** The Reflector is the most complex module — it orchestrates multiple engine components and implements non-trivial content distillation heuristics. The Curator is simpler but requires careful merge logic. Together they form the complete learning pipeline backend.

---

## Progress Tracking

**Status History:**
- 2026-02-27: Created by Scrum Master

**Actual Effort:** TBD

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
