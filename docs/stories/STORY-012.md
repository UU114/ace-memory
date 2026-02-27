# STORY-012: Privacy Sanitizer + Content Classifier

**Epic:** EPIC-003 (Knowledge Learning)
**Priority:** Must Have (Sanitizer) + Should Have (Classifier)
**Story Points:** 3
**Status:** Not Started
**Assigned To:** Unassigned
**Created:** 2026-02-27
**Sprint:** 2

---

## User Story

As a developer,
I want sensitive information filtered and knowledge properly classified,
So that no secrets leak into the Playbook and each Bullet has the right metadata.

---

## Description

### Background
Before any knowledge candidate is persisted as a Bullet, two critical steps must happen:
1. **Sanitizer**: Strip API keys, tokens, passwords, and identifiable paths — this is a security requirement.
2. **Classifier**: Assign `knowledge_type` (Method/Trick/Pitfall/Preference/Knowledge) and compute `instructivity_score` — this ensures retrieval quality.

These two modules sit at the front of the Reflector pipeline (STORY-013): Sanitizer runs first to reject or clean sensitive data, then Classifier scores and categorizes the cleaned content.

### Scope
**In scope:**
- `engine/sanitizer.ts`: Regex-based secret detection and path anonymization
- `engine/classifier.ts`: Rule-based knowledge type classification and quality scoring
- Audit logging (reason only, never content)
- Integration interfaces for Reflector pipeline

**Out of scope:**
- LLM-based classification (STORY-023 backlog)
- Full NLP/NER for entity extraction (simple regex/heuristic)
- Network-based secret scanning services

### User Flow
1. PostToolUse Hook captures a pattern candidate
2. Stop/SessionEnd Hook triggers distillation via Reflector
3. Reflector calls Sanitizer first:
   - If secret detected → candidate rejected, audit log written
   - If path contains username → path anonymized to `~`
4. Reflector calls Classifier on cleaned content:
   - Assigns knowledge_type based on content analysis
   - Computes instructivity_score
   - Low score (< threshold) → candidate rejected
5. Only clean, classified candidates proceed to embedding + dedup + storage

---

## Acceptance Criteria

### Sanitizer
- [ ] `engine/sanitizer.ts` created
- [ ] Detects API keys: `sk-*` (OpenAI), `ghp_*` (GitHub PAT), `AKIA*` (AWS), `xoxb-*`/`xoxp-*` (Slack)
- [ ] Detects generic high-entropy secrets: base64 strings > 20 chars following `key=`, `token=`, `password=`, `secret=`
- [ ] Detects password-like strings in config contexts
- [ ] Replaces absolute paths containing OS username with `~` placeholder (e.g., `C:\Users\TPY\...` → `~\...`, `/home/tpy/...` → `~/...`)
- [ ] Returns sanitization result: `{ clean: boolean, content: string, reasons: string[] }`
- [ ] When `clean = false`: content is rejected (not stored), reasons logged
- [ ] When content is partially cleaned: modified content returned with paths anonymized
- [ ] Audit log: records filter reason (e.g., "API key detected: sk-*** pattern") but NEVER logs the actual secret value
- [ ] Unit tests: all API key formats, path replacement, false positive avoidance

### Classifier
- [ ] `engine/classifier.ts` created
- [ ] Classifies `knowledge_type` into: Method, Trick, Pitfall, Preference, Knowledge
- [ ] Classification rules:
  - **Pitfall**: Contains error keywords (error, bug, fix, wrong, issue, fail, crash) + solution context
  - **Method**: Describes a procedure or approach (how to, steps, pattern, approach)
  - **Trick**: Short optimization or shortcut (tip, shortcut, faster, instead of)
  - **Preference**: User preference or convention (always, never, prefer, use X not Y)
  - **Knowledge**: Default fallback for factual information
- [ ] Computes `instructivity_score` (0-100):
  - Base score from content analysis (specificity, actionability, uniqueness)
  - Content density penalty: `final_score = base_score × (0.6 + 0.4 × content_density / 100)`
  - Distilled content bonus: +5 points
- [ ] `content_density` = ratio of non-whitespace, non-code characters to total length (0-100)
- [ ] Low score filter: score < `min_interaction_quality` (default 30) → reject candidate
- [ ] Returns: `{ knowledge_type, instructivity_score, rejected: boolean, reason?: string }`
- [ ] Unit tests: classification accuracy for each type, scoring edge cases

---

## Technical Notes

### Components
- **engine/sanitizer.ts** — New module
- **engine/classifier.ts** — New module
- **types/bullet.ts** — Already defines KnowledgeType (verify alignment)

### Sanitizer Design
```typescript
interface SanitizeResult {
  clean: boolean;       // false = reject entirely
  content: string;      // sanitized content (paths anonymized)
  reasons: string[];    // audit reasons (never contains actual secrets)
}

class Sanitizer {
  sanitize(content: string): SanitizeResult;

  private detectApiKeys(content: string): string[];
  private detectGenericSecrets(content: string): string[];
  private anonymizePaths(content: string): string;
}
```

### Regex Patterns
```typescript
const API_KEY_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI
  /ghp_[a-zA-Z0-9]{36,}/g,          // GitHub PAT
  /AKIA[A-Z0-9]{16}/g,              // AWS Access Key
  /xox[bp]-[a-zA-Z0-9-]{10,}/g,     // Slack tokens
  /glpat-[a-zA-Z0-9_-]{20,}/g,      // GitLab PAT
  /npm_[a-zA-Z0-9]{36,}/g,          // npm token
];

const GENERIC_SECRET_PATTERN =
  /(?:key|token|password|secret|credential|auth)[\s]*[=:]\s*["']?([a-zA-Z0-9+/=_-]{20,})["']?/gi;

const USER_PATH_PATTERN =
  /(?:C:\\Users\\[^\\]+|\/home\/[^/]+|\/Users\/[^/]+)/g;
```

### Classifier Design
```typescript
interface ClassifyResult {
  knowledge_type: 'Method' | 'Trick' | 'Pitfall' | 'Preference' | 'Knowledge';
  instructivity_score: number;
  rejected: boolean;
  reason?: string;
}

class Classifier {
  classify(content: string, isDistilled: boolean): ClassifyResult;

  private detectKnowledgeType(content: string): string;
  private computeScore(content: string, isDistilled: boolean): number;
  private computeContentDensity(content: string): number;
}
```

### Edge Cases
- Content with no recognizable patterns → Knowledge type, moderate score
- Very short content (<20 chars) → low density score, likely rejected
- Content that is 100% code → very low content_density, penalized
- Path anonymization must handle both forward and back slashes
- Multiple secrets in one candidate → reject with all reasons listed
- False positive avoidance: `skeleton`, `skill`, `sketch` should not trigger `sk-` pattern (require minimum length)

---

## Dependencies

**Prerequisite Stories:**
- STORY-001: Project scaffolding + types (completed)

**Blocked Stories:**
- STORY-013: Reflector + Curator (calls Sanitizer and Classifier in its pipeline)

**External Dependencies:**
- None (pure regex/heuristic, no external libraries)

---

## Definition of Done

- [ ] Code implemented and committed to feature branch
- [ ] TypeScript strict mode compiles with zero errors
- [ ] Unit tests written and passing (≥80% coverage)
  - [ ] Sanitizer: all API key formats detected
  - [ ] Sanitizer: path anonymization (Windows + Unix)
  - [ ] Sanitizer: false positive avoidance
  - [ ] Sanitizer: audit log format (no secret leakage)
  - [ ] Classifier: correct type for each knowledge category
  - [ ] Classifier: score computation with density penalty
  - [ ] Classifier: distilled bonus applied
  - [ ] Classifier: low-score rejection
- [ ] ESLint zero warnings
- [ ] Manual verification on Windows
- [ ] Acceptance criteria all satisfied

---

## Story Points Breakdown

- **Sanitizer (regex + path handling):** 1.5 points
- **Classifier (rules + scoring):** 1.5 points
- **Total:** 3 points

**Rationale:** Both modules are self-contained with clear input/output contracts. Complexity is moderate — regex patterns need careful tuning to avoid false positives, and the scoring formula requires balancing multiple signals.

---

## Progress Tracking

**Status History:**
- 2026-02-27: Created by Scrum Master

**Actual Effort:** TBD

---

**This story was created using BMAD Method v6 - Phase 4 (Implementation Planning)**
