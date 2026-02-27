import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { ConflictDetector } from '../../engine/conflict-detector.js';
import { AceDatabase } from '../../storage/sqlite.js';
import { VectorCache } from '../../daemon/vector-cache.js';
import type { Bullet } from '../../types/bullet.js';

// Helper to create a full Bullet
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  const now = new Date().toISOString();
  return {
    id: 'bullet-' + Math.random().toString(36).slice(2),
    scope: 'global',
    section: 'techniques',
    content: 'Test bullet content',
    distilled_rule: null,
    code_content: null,
    code_language: null,
    instructivity_score: 50,
    knowledge_type: 'Knowledge',
    source_type: 'auto',
    recall_count: 0,
    last_recall: null,
    decay_weight: 1.0,
    related_tools: [],
    related_files: [],
    key_entities: [],
    tags: [],
    embedding: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('ConflictDetector', () => {
  let tmpDir: string;
  let db: AceDatabase;
  let vectorCache: VectorCache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-conflict-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new AceDatabase(dbPath);
    vectorCache = new VectorCache();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- Semantic conflict detection ----
  describe('semantic conflicts', () => {
    it('detects semantic conflict with high similarity and antonym keywords (always/never)', async () => {
      const embedding = new Float32Array(384).fill(0.5);
      const bulletA = makeBullet({
        id: 'sem-a',
        content: 'Always use pnpm for package management',
        section: 'preferences',
        embedding,
        key_entities: ['pnpm'],
      });
      const bulletB = makeBullet({
        id: 'sem-b',
        content: 'Never use pnpm in production environments',
        section: 'preferences',
        embedding, // Same embedding = cosine 1.0
        key_entities: ['pnpm'],
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflict_type).toBe('semantic');
      expect(conflicts[0].bullet_id_a).toBe('sem-b');
      expect(conflicts[0].bullet_id_b).toBe('sem-a');
    });

    it('detects semantic conflict with use/avoid antonyms', async () => {
      const embedding = new Float32Array(384).fill(0.3);
      const bulletA = makeBullet({
        id: 'sem-use',
        content: 'Use yarn for installing dependencies',
        section: 'preferences',
        embedding,
      });
      const bulletB = makeBullet({
        id: 'sem-avoid',
        content: 'Avoid yarn, it has compatibility issues',
        section: 'preferences',
        embedding,
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflict_type).toBe('semantic');
    });

    it('detects semantic conflict with enable/disable antonyms', async () => {
      const embedding = new Float32Array(384).fill(0.4);
      const bulletA = makeBullet({
        id: 'sem-enable',
        content: 'Enable strict mode in TypeScript config',
        section: 'preferences',
        embedding,
      });
      const bulletB = makeBullet({
        id: 'sem-disable',
        content: 'Disable strict mode for legacy compatibility',
        section: 'preferences',
        embedding,
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflict_type).toBe('semantic');
    });

    it('no semantic conflict when embeddings are orthogonal', async () => {
      const embA = new Float32Array(384);
      const embB = new Float32Array(384);
      for (let i = 0; i < 384; i++) {
        embA[i] = i < 192 ? 1.0 : 0.0;
        embB[i] = i >= 192 ? 1.0 : 0.0;
      }

      // Content without negation trigger words to isolate the semantic check
      const bulletA = makeBullet({
        id: 'orth-a',
        content: 'TypeScript generics provide flexibility',
        section: 'knowledge',
        embedding: embA,
      });
      const bulletB = makeBullet({
        id: 'orth-b',
        content: 'React hooks simplify state management',
        section: 'knowledge',
        embedding: embB,
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      // Cosine similarity of orthogonal vectors is 0, below 0.75 threshold
      expect(conflicts.length).toBe(0);
    });

    it('no semantic conflict when different sections', async () => {
      const embedding = new Float32Array(384).fill(0.5);
      const bulletA = makeBullet({
        id: 'sect-a',
        content: 'Always use pnpm',
        section: 'preferences',
        embedding,
      });
      const bulletB = makeBullet({
        id: 'sect-b',
        content: 'Never use pnpm in tests',
        section: 'pitfalls', // Different section
        embedding,
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(0);
    });

    it('no semantic conflict without embeddings', async () => {
      const bulletA = makeBullet({
        id: 'noemb-a',
        content: 'Always use pnpm',
        section: 'preferences',
        embedding: null,
      });
      const bulletB = makeBullet({
        id: 'noemb-b',
        content: 'Never use pnpm',
        section: 'preferences',
        embedding: null,
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      // No embeddings → no semantic check → might still catch negation
      const semanticConflicts = conflicts.filter(c => c.conflict_type === 'semantic');
      expect(semanticConflicts.length).toBe(0);
    });
  });

  // ---- Negation conflict detection ----
  describe('negation conflicts', () => {
    it('detects negation with always/never and shared section', async () => {
      const bulletA = makeBullet({
        id: 'neg-always',
        content: 'You must always lint before committing',
        section: 'preferences',
      });
      const bulletB = makeBullet({
        id: 'neg-never',
        content: 'You must not lint every time, it slows down commits',
        section: 'preferences',
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflict_type).toBe('negation');
    });

    it('detects negation with use/avoid and shared key entities', async () => {
      const bulletA = makeBullet({
        id: 'neg-use',
        content: 'Use ESLint for code quality',
        section: 'techniques',
        key_entities: ['ESLint'],
      });
      const bulletB = makeBullet({
        id: 'neg-avoid',
        content: "Avoid ESLint, it's too slow",
        section: 'pitfalls', // Different section but same entity
        key_entities: ['ESLint'],
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflict_type).toBe('negation');
    });

    it('detects negation with Chinese keywords (使用/避免)', async () => {
      const bulletA = makeBullet({
        id: 'neg-cn-use',
        content: '使用 Prettier 格式化代码',
        section: 'preferences',
        key_entities: ['Prettier'],
      });
      const bulletB = makeBullet({
        id: 'neg-cn-avoid',
        content: '避免 Prettier，它会破坏代码风格',
        section: 'preferences',
        key_entities: ['Prettier'],
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(1);
      expect(conflicts[0].conflict_type).toBe('negation');
    });

    it('no negation when different sections and no shared entities', async () => {
      const bulletA = makeBullet({
        id: 'neg-diff-a',
        content: 'Always run tests before deploying',
        section: 'techniques',
        key_entities: ['tests'],
      });
      const bulletB = makeBullet({
        id: 'neg-diff-b',
        content: 'Never eat spicy food at lunch',
        section: 'pitfalls',
        key_entities: ['food'],
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(0);
    });
  });

  // ---- Version conflict detection ----
  describe('version conflicts', () => {
    it('detects version mismatch for same entity', async () => {
      const bulletA = makeBullet({
        id: 'ver-a',
        content: 'Use Node 18 for this project',
        section: 'preferences',
      });
      const bulletB = makeBullet({
        id: 'ver-b',
        content: 'Use Node 20 for better performance',
        section: 'preferences',
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      const versionConflict = conflicts.find(c => c.conflict_type === 'version');
      expect(versionConflict).toBeDefined();
      expect(versionConflict!.description).toContain('node');
    });

    it('detects version mismatch with dotted versions', async () => {
      const bulletA = makeBullet({
        id: 'ver-dot-a',
        content: 'Python 3.11 is required',
        section: 'preferences',
      });
      const bulletB = makeBullet({
        id: 'ver-dot-b',
        content: 'Python 3.9 is the minimum supported version',
        section: 'preferences',
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      const versionConflict = conflicts.find(c => c.conflict_type === 'version');
      expect(versionConflict).toBeDefined();
      expect(versionConflict!.description).toContain('python');
    });

    it('no version conflict when same entity same version', async () => {
      const bulletA = makeBullet({
        id: 'ver-same-a',
        content: 'Use Node 18 for development',
        section: 'preferences',
      });
      const bulletB = makeBullet({
        id: 'ver-same-b',
        content: 'Node 18 is our standard runtime',
        section: 'preferences',
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      const versionConflict = conflicts.find(c => c.conflict_type === 'version');
      expect(versionConflict).toBeUndefined();
    });

    it('no version conflict when different entities', async () => {
      const bulletA = makeBullet({
        id: 'ver-diff-a',
        content: 'Use Node 18 in production',
        section: 'preferences',
      });
      const bulletB = makeBullet({
        id: 'ver-diff-b',
        content: 'Use Python 3.11 for scripting',
        section: 'preferences',
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      const versionConflict = conflicts.find(c => c.conflict_type === 'version');
      expect(versionConflict).toBeUndefined();
    });
  });

  // ---- Edge cases ----
  describe('edge cases', () => {
    it('does not conflict with itself', async () => {
      const bullet = makeBullet({
        id: 'self-1',
        content: 'Always use strict mode',
        section: 'preferences',
      });
      db.insertBullet(bullet);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bullet);

      expect(conflicts.length).toBe(0);
    });

    it('does not detect conflicts across different scopes', async () => {
      const bulletA = makeBullet({
        id: 'scope-a',
        content: 'Always use pnpm',
        scope: 'project:alpha',
        section: 'preferences',
      });
      const bulletB = makeBullet({
        id: 'scope-b',
        content: 'Never use pnpm',
        scope: 'project:beta',
        section: 'preferences',
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      // bulletB is in project:beta, bulletA is in project:alpha — not compared
      expect(conflicts.length).toBe(0);
    });

    it('deduplicates conflicts for the same bullet pair', async () => {
      // This scenario is less likely to occur naturally
      // but we ensure the dedup logic works
      const embedding = new Float32Array(384).fill(0.5);
      const bulletA = makeBullet({
        id: 'dedup-a',
        content: 'Always enable strict mode',
        section: 'preferences',
        embedding,
      });
      const bulletB = makeBullet({
        id: 'dedup-b',
        content: 'Never disable strict mode for any reason',
        section: 'preferences',
        embedding,
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      // Even if multiple checks would match, dedup ensures at most 1 per pair
      const pairs = conflicts.map(c =>
        [c.bullet_id_a, c.bullet_id_b].sort().join('|'),
      );
      const uniquePairs = new Set(pairs);
      expect(pairs.length).toBe(uniquePairs.size);
    });

    it('returns empty for bullet with no conflicts', async () => {
      const bulletA = makeBullet({
        id: 'clean-a',
        content: 'TypeScript supports generics',
        section: 'knowledge',
      });
      const bulletB = makeBullet({
        id: 'clean-b',
        content: 'React uses virtual DOM for rendering',
        section: 'knowledge',
      });

      db.insertBullet(bulletA);
      db.insertBullet(bulletB);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bulletB);

      expect(conflicts.length).toBe(0);
    });

    it('returns empty when database has no other bullets', async () => {
      const bullet = makeBullet({
        id: 'alone-1',
        content: 'Some standalone knowledge',
      });
      db.insertBullet(bullet);

      const detector = new ConflictDetector(db, vectorCache);
      const conflicts = await detector.detect(bullet);

      expect(conflicts.length).toBe(0);
    });
  });
});
