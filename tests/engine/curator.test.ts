import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Curator } from '../../engine/curator.js';
import type { DistilledBullet } from '../../engine/reflector.js';
import { AceDatabase } from '../../storage/sqlite.js';
import { VectorCache } from '../../daemon/vector-cache.js';
import type { Bullet } from '../../types/bullet.js';

// Helper to create a DistilledBullet
function makeDistilledBullet(overrides: Partial<DistilledBullet> = {}): DistilledBullet {
  return {
    scope: 'global',
    section: 'techniques',
    content: 'When encountering a TypeError, fix by adding a null check before accessing nested properties',
    distilled_rule: 'When encountering a TypeError, fix by adding a null check',
    code_content: null,
    code_language: null,
    knowledge_type: 'Pitfall',
    instructivity_score: 50,
    source_type: 'auto',
    related_tools: ['Edit'],
    related_files: [],
    key_entities: ['TypeError'],
    tags: ['error_fix'],
    embedding: null,
    ...overrides,
  };
}

// Helper to create a full Bullet (as stored in DB)
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  const now = new Date().toISOString();
  return {
    id: 'existing-' + Math.random().toString(36).slice(2),
    scope: 'global',
    section: 'techniques',
    content: 'Existing bullet content for testing',
    distilled_rule: null,
    code_content: null,
    code_language: null,
    instructivity_score: 40,
    knowledge_type: 'Knowledge',
    source_type: 'auto',
    recall_count: 3,
    last_recall: null,
    decay_weight: 1.0,
    related_tools: ['Bash'],
    related_files: [],
    key_entities: [],
    tags: ['command_usage'],
    embedding: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('Curator', () => {
  let tmpDir: string;
  let db: AceDatabase;
  let vectorCache: VectorCache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-curator-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new AceDatabase(dbPath);
    vectorCache = new VectorCache();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- Insert new bullet ----
  describe('insert new bullet', () => {
    it('inserts a new bullet when no similar exists', async () => {
      const curator = new Curator(db, vectorCache);
      const bullet = makeDistilledBullet();

      const result = await curator.curate(bullet);

      expect(result).toBe('added');

      // Verify bullet was inserted into DB
      const allBullets = db.queryBullets({});
      expect(allBullets.length).toBe(1);
      expect(allBullets[0].content).toBe(bullet.content);
      expect(allBullets[0].recall_count).toBe(0);
      expect(allBullets[0].last_recall).toBeNull();
      expect(allBullets[0].decay_weight).toBe(1.0);
    });

    it('inserts bullet with embedding and adds to vector cache', async () => {
      const curator = new Curator(db, vectorCache);
      const embedding = new Float32Array(384).fill(0.5);
      const bullet = makeDistilledBullet({ embedding });

      const result = await curator.curate(bullet);

      expect(result).toBe('added');
      expect(vectorCache.size).toBe(1);
    });
  });

  // ---- Merge when similar bullet exists (semantic) ----
  describe('merge via semantic similarity', () => {
    it('merges when cosine similarity exceeds threshold', async () => {
      // Insert existing bullet with embedding
      const existingEmbedding = new Float32Array(384).fill(0.5);
      const existing = makeBullet({
        id: 'existing-1',
        content: 'Short content',
        instructivity_score: 40,
        tags: ['error_fix'],
        key_entities: ['TypeError'],
        related_files: ['old.ts'],
        related_tools: ['Bash'],
        embedding: existingEmbedding,
      });
      db.insertBullet(existing);
      vectorCache.add('existing-1', existingEmbedding);

      // Incoming bullet with nearly identical embedding (same vector = cosine 1.0)
      const incomingEmbedding = new Float32Array(384).fill(0.5);
      const incoming = makeDistilledBullet({
        content: 'When encountering a TypeError, fix by adding a null check before accessing nested properties',
        instructivity_score: 60,
        tags: ['code_pattern'],
        key_entities: ['NullCheck'],
        related_files: ['new.ts'],
        related_tools: ['Edit'],
        embedding: incomingEmbedding,
      });

      const curator = new Curator(db, vectorCache);
      const result = await curator.curate(incoming);

      expect(result).toBe('merged');

      // Verify merge result
      const merged = db.getBulletById('existing-1')!;
      // Longer content should win
      expect(merged.content).toBe(incoming.content);
      // Higher score
      expect(merged.instructivity_score).toBe(60);
      // Union tags
      expect(merged.tags).toContain('error_fix');
      expect(merged.tags).toContain('code_pattern');
      // Union entities
      expect(merged.key_entities).toContain('TypeError');
      expect(merged.key_entities).toContain('NullCheck');
      // Union files
      expect(merged.related_files).toContain('old.ts');
      expect(merged.related_files).toContain('new.ts');
      // Union tools
      expect(merged.related_tools).toContain('Bash');
      expect(merged.related_tools).toContain('Edit');
    });
  });

  // ---- Exact-match dedup fallback without ONNX ----
  describe('exact-match fallback (no ONNX)', () => {
    it('merges when content matches exactly and no embeddings', async () => {
      const content = 'Use TypeScript strict mode for better type safety in all projects';
      const existing = makeBullet({
        id: 'exact-1',
        content,
        instructivity_score: 30,
        tags: ['preference'],
      });
      db.insertBullet(existing);

      const incoming = makeDistilledBullet({
        content,
        instructivity_score: 50,
        tags: ['typescript'],
        embedding: null,
      });

      // No vector cache - forces exact match path
      const curator = new Curator(db, null);
      const result = await curator.curate(incoming);

      expect(result).toBe('merged');

      const merged = db.getBulletById('exact-1')!;
      expect(merged.instructivity_score).toBe(50);
      expect(merged.tags).toContain('preference');
      expect(merged.tags).toContain('typescript');
    });

    it('inserts new bullet when no exact match without ONNX', async () => {
      const existing = makeBullet({
        id: 'other-1',
        content: 'Different content entirely',
      });
      db.insertBullet(existing);

      const incoming = makeDistilledBullet({
        content: 'Completely new and unique content about error handling patterns',
        embedding: null,
      });

      const curator = new Curator(db, null);
      const result = await curator.curate(incoming);

      expect(result).toBe('added');
      expect(db.queryBullets({}).length).toBe(2);
    });
  });

  // ---- Merge preserves higher recall_count ----
  describe('merge preserves metadata', () => {
    it('preserves existing recall_count (merge does not reset it)', async () => {
      const existing = makeBullet({
        id: 'recall-1',
        content: 'Test content for recall preservation',
        recall_count: 10,
        last_recall: '2025-01-01T00:00:00.000Z',
      });
      db.insertBullet(existing);

      const incoming = makeDistilledBullet({
        content: 'Test content for recall preservation',
        embedding: null,
      });

      const curator = new Curator(db, null);
      await curator.curate(incoming);

      const merged = db.getBulletById('recall-1')!;
      // recall_count should remain unchanged (merge updates content/score/arrays, not recall_count)
      expect(merged.recall_count).toBe(10);
    });
  });

  // ---- Merge unions tags and entities ----
  describe('merge unions arrays', () => {
    it('unions tags without duplicates', async () => {
      const existing = makeBullet({
        id: 'union-1',
        content: 'Union test content',
        tags: ['tag1', 'tag2', 'shared'],
      });
      db.insertBullet(existing);

      const incoming = makeDistilledBullet({
        content: 'Union test content',
        tags: ['tag3', 'shared'],
        embedding: null,
      });

      const curator = new Curator(db, null);
      await curator.curate(incoming);

      const merged = db.getBulletById('union-1')!;
      expect(merged.tags).toContain('tag1');
      expect(merged.tags).toContain('tag2');
      expect(merged.tags).toContain('tag3');
      expect(merged.tags).toContain('shared');
      // No duplicates
      expect(merged.tags.filter(t => t === 'shared').length).toBe(1);
    });

    it('unions key_entities without duplicates', async () => {
      const existing = makeBullet({
        id: 'union-2',
        content: 'Entity union test',
        key_entities: ['TypeScript', 'React'],
      });
      db.insertBullet(existing);

      const incoming = makeDistilledBullet({
        content: 'Entity union test',
        key_entities: ['React', 'Vitest'],
        embedding: null,
      });

      const curator = new Curator(db, null);
      await curator.curate(incoming);

      const merged = db.getBulletById('union-2')!;
      expect(merged.key_entities).toContain('TypeScript');
      expect(merged.key_entities).toContain('React');
      expect(merged.key_entities).toContain('Vitest');
      expect(merged.key_entities.filter(e => e === 'React').length).toBe(1);
    });
  });

  // ---- Skip when content is empty ----
  describe('skip empty content', () => {
    it('skips when content is empty string', async () => {
      const curator = new Curator(db, vectorCache);
      const bullet = makeDistilledBullet({ content: '' });

      const result = await curator.curate(bullet);

      expect(result).toBe('skipped');
      expect(db.queryBullets({}).length).toBe(0);
    });

    it('skips when content is only whitespace', async () => {
      const curator = new Curator(db, vectorCache);
      const bullet = makeDistilledBullet({ content: '   \n\t  ' });

      const result = await curator.curate(bullet);

      expect(result).toBe('skipped');
      expect(db.queryBullets({}).length).toBe(0);
    });
  });

  // ---- Works with null vectorCache ----
  describe('null vectorCache', () => {
    it('inserts new bullet with null vectorCache', async () => {
      const curator = new Curator(db, null);
      const bullet = makeDistilledBullet({
        content: 'A completely new bullet about TypeScript configuration best practices',
      });

      const result = await curator.curate(bullet);

      expect(result).toBe('added');
      expect(db.queryBullets({}).length).toBe(1);
    });

    it('does not crash with embedding and null vectorCache', async () => {
      const curator = new Curator(db, null);
      const bullet = makeDistilledBullet({
        content: 'A brand new bullet about TypeScript module resolution configuration',
        embedding: new Float32Array(384).fill(0.3),
      });

      // With embedding but null vectorCache, should fall through to exact-match then insert
      const result = await curator.curate(bullet);

      expect(result).toBe('added');
    });
  });

  // ---- Custom dedup threshold ----
  describe('custom dedup threshold', () => {
    it('respects custom dedupThreshold', async () => {
      // Insert existing bullet with one embedding direction
      const existingEmbedding = new Float32Array(384);
      for (let i = 0; i < 384; i++) existingEmbedding[i] = i < 192 ? 1.0 : 0.0;
      const existing = makeBullet({
        id: 'thresh-1',
        content: 'Existing content',
        embedding: existingEmbedding,
      });
      db.insertBullet(existing);
      vectorCache.add('thresh-1', existingEmbedding);

      // Incoming embedding in a very different direction (orthogonal-ish)
      const incomingEmbedding = new Float32Array(384);
      for (let i = 0; i < 384; i++) incomingEmbedding[i] = i >= 192 ? 1.0 : 0.0;
      const incoming = makeDistilledBullet({
        content: 'Different content for threshold testing of curator deduplication',
        embedding: incomingEmbedding,
      });

      // Threshold of 0.5 - the two orthogonal vectors should have cosine ~0
      const curator = new Curator(db, vectorCache, 0.5);
      const result = await curator.curate(incoming);

      // Because the cosine similarity of orthogonal vectors is 0, it should add
      expect(result).toBe('added');
    });
  });

  // ---- Merge updates vector cache ----
  describe('vector cache updates', () => {
    it('updates vector cache after merge', async () => {
      const existingEmbedding = new Float32Array(384).fill(0.5);
      const existing = makeBullet({
        id: 'vc-1',
        content: 'Short',
        embedding: existingEmbedding,
      });
      db.insertBullet(existing);
      vectorCache.add('vc-1', existingEmbedding);

      const newEmbedding = new Float32Array(384).fill(0.5);
      const incoming = makeDistilledBullet({
        content: 'Longer content that should replace the short one during merge',
        embedding: newEmbedding,
      });

      const curator = new Curator(db, vectorCache);
      await curator.curate(incoming);

      // Vector cache should still have the entry
      expect(vectorCache.has('vc-1')).toBe(true);
    });

    it('adds to vector cache after insert', async () => {
      const embedding = new Float32Array(384).fill(0.7);
      const incoming = makeDistilledBullet({
        content: 'Brand new bullet with embedding for vector cache insertion test',
        embedding,
      });

      const curator = new Curator(db, vectorCache);
      await curator.curate(incoming);

      expect(vectorCache.size).toBe(1);
    });
  });
});
