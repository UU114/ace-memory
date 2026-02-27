import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { AceDatabase } from '../../storage/sqlite.js';
import type { Bullet } from '../../types/bullet.js';

// Helper to create a minimal valid Bullet for testing
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'test-id-' + Math.random().toString(36).slice(2),
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

describe('AceDatabase', () => {
  let db: AceDatabase;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `ace-db-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    dbPath = path.join(tmpDir, 'test.db');
    db = new AceDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // --- Schema initialization ---

  it('creates database and tables on construction', () => {
    // DB file should exist
    expect(fs.existsSync(dbPath)).toBe(true);

    // Should be able to query bullets table without error
    const bullets = db.queryBullets({});
    expect(bullets).toEqual([]);
  });

  it('enables WAL journal mode', () => {
    // Verify by inserting and querying - WAL allows this to work well
    const bullet = makeBullet();
    db.insertBullet(bullet);
    const result = db.getBulletById(bullet.id);
    expect(result).not.toBeNull();
  });

  // --- CRUD operations ---

  it('inserts and retrieves a bullet', () => {
    const bullet = makeBullet({
      id: 'bullet-1',
      content: 'Use strict mode in TypeScript',
      knowledge_type: 'Preference',
      tags: ['typescript', 'config'],
      related_tools: ['tsc'],
      related_files: ['tsconfig.json'],
      key_entities: ['TypeScript'],
    });

    db.insertBullet(bullet);
    const result = db.getBulletById('bullet-1');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('bullet-1');
    expect(result!.content).toBe('Use strict mode in TypeScript');
    expect(result!.knowledge_type).toBe('Preference');
    expect(result!.tags).toEqual(['typescript', 'config']);
    expect(result!.related_tools).toEqual(['tsc']);
    expect(result!.related_files).toEqual(['tsconfig.json']);
    expect(result!.key_entities).toEqual(['TypeScript']);
  });

  it('returns null for non-existent bullet', () => {
    const result = db.getBulletById('non-existent');
    expect(result).toBeNull();
  });

  it('updates bullet fields', () => {
    const bullet = makeBullet({ id: 'bullet-update' });
    db.insertBullet(bullet);

    db.updateBullet('bullet-update', {
      content: 'Updated content',
      decay_weight: 0.5,
      recall_count: 3,
      tags: ['updated'],
    });

    const result = db.getBulletById('bullet-update');
    expect(result).not.toBeNull();
    expect(result!.content).toBe('Updated content');
    expect(result!.decay_weight).toBe(0.5);
    expect(result!.recall_count).toBe(3);
    expect(result!.tags).toEqual(['updated']);
  });

  it('updateBullet with empty fields is a no-op', () => {
    const bullet = makeBullet({ id: 'bullet-noop' });
    db.insertBullet(bullet);

    // Should not throw
    db.updateBullet('bullet-noop', {});

    const result = db.getBulletById('bullet-noop');
    expect(result!.content).toBe(bullet.content);
  });

  it('deletes a bullet', () => {
    const bullet = makeBullet({ id: 'bullet-delete' });
    db.insertBullet(bullet);

    db.deleteBullet('bullet-delete');
    const result = db.getBulletById('bullet-delete');
    expect(result).toBeNull();
  });

  // --- Embedding BLOB conversion ---

  it('stores and retrieves Float32Array embedding', () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, -0.5, 1.0]);
    const bullet = makeBullet({ id: 'bullet-embed', embedding });
    db.insertBullet(bullet);

    const result = db.getBulletById('bullet-embed');
    expect(result).not.toBeNull();
    expect(result!.embedding).toBeInstanceOf(Float32Array);
    expect(result!.embedding!.length).toBe(5);
    expect(result!.embedding![0]).toBeCloseTo(0.1);
    expect(result!.embedding![1]).toBeCloseTo(0.2);
    expect(result!.embedding![3]).toBeCloseTo(-0.5);
    expect(result!.embedding![4]).toBeCloseTo(1.0);
  });

  it('handles null embedding correctly', () => {
    const bullet = makeBullet({ id: 'bullet-no-embed', embedding: null });
    db.insertBullet(bullet);

    const result = db.getBulletById('bullet-no-embed');
    expect(result!.embedding).toBeNull();
  });

  it('getAllEmbeddings returns only bullets with embeddings', () => {
    const emb1 = new Float32Array([1.0, 2.0]);
    const emb2 = new Float32Array([3.0, 4.0]);

    db.insertBullet(makeBullet({ id: 'e1', embedding: emb1 }));
    db.insertBullet(makeBullet({ id: 'e2', embedding: null }));
    db.insertBullet(makeBullet({ id: 'e3', embedding: emb2 }));

    const embeddings = db.getAllEmbeddings();
    expect(embeddings).toHaveLength(2);

    const ids = embeddings.map(e => e.id).sort();
    expect(ids).toEqual(['e1', 'e3']);

    const e1 = embeddings.find(e => e.id === 'e1')!;
    expect(e1.embedding).toBeInstanceOf(Float32Array);
    expect(e1.embedding[0]).toBeCloseTo(1.0);
    expect(e1.embedding[1]).toBeCloseTo(2.0);
  });

  // --- JSON array fields ---

  it('round-trips JSON array fields correctly', () => {
    const bullet = makeBullet({
      id: 'json-arrays',
      related_tools: ['git', 'npm', 'vitest'],
      related_files: ['package.json', 'tsconfig.json'],
      key_entities: ['TypeScript', 'Node.js'],
      tags: ['dev', 'config'],
    });
    db.insertBullet(bullet);

    const result = db.getBulletById('json-arrays')!;
    expect(result.related_tools).toEqual(['git', 'npm', 'vitest']);
    expect(result.related_files).toEqual(['package.json', 'tsconfig.json']);
    expect(result.key_entities).toEqual(['TypeScript', 'Node.js']);
    expect(result.tags).toEqual(['dev', 'config']);
  });

  it('handles empty JSON arrays', () => {
    const bullet = makeBullet({ id: 'empty-arrays' });
    db.insertBullet(bullet);

    const result = db.getBulletById('empty-arrays')!;
    expect(result.related_tools).toEqual([]);
    expect(result.related_files).toEqual([]);
    expect(result.key_entities).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  // --- Filter queries ---

  it('filters by scopes', () => {
    db.insertBullet(makeBullet({ id: 'g1', scope: 'global' }));
    db.insertBullet(makeBullet({ id: 'p1', scope: 'project:foo' }));
    db.insertBullet(makeBullet({ id: 'p2', scope: 'project:bar' }));

    const globals = db.queryBullets({ scopes: ['global'] });
    expect(globals).toHaveLength(1);
    expect(globals[0].id).toBe('g1');

    const projects = db.queryBullets({ scopes: ['project:foo', 'project:bar'] });
    expect(projects).toHaveLength(2);
  });

  it('filters by section', () => {
    db.insertBullet(makeBullet({ id: 's1', section: 'techniques' }));
    db.insertBullet(makeBullet({ id: 's2', section: 'pitfalls' }));
    db.insertBullet(makeBullet({ id: 's3', section: 'techniques' }));

    const techs = db.queryBullets({ section: 'techniques' });
    expect(techs).toHaveLength(2);
  });

  it('filters by knowledgeType', () => {
    db.insertBullet(makeBullet({ id: 'k1', knowledge_type: 'Method' }));
    db.insertBullet(makeBullet({ id: 'k2', knowledge_type: 'Pitfall' }));

    const methods = db.queryBullets({ knowledgeType: 'Method' });
    expect(methods).toHaveLength(1);
    expect(methods[0].id).toBe('k1');
  });

  it('filters by minDecayWeight', () => {
    db.insertBullet(makeBullet({ id: 'dw1', decay_weight: 0.9 }));
    db.insertBullet(makeBullet({ id: 'dw2', decay_weight: 0.3 }));
    db.insertBullet(makeBullet({ id: 'dw3', decay_weight: 0.7 }));

    const high = db.queryBullets({ minDecayWeight: 0.5 });
    expect(high).toHaveLength(2);
    const ids = high.map(b => b.id).sort();
    expect(ids).toEqual(['dw1', 'dw3']);
  });

  it('applies limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      db.insertBullet(makeBullet({ id: `lim-${i}`, decay_weight: 1.0 - i * 0.1 }));
    }

    const limited = db.queryBullets({ limit: 2 });
    expect(limited).toHaveLength(2);

    const offset = db.queryBullets({ limit: 2, offset: 2 });
    expect(offset).toHaveLength(2);
  });

  it('combines multiple filters', () => {
    db.insertBullet(makeBullet({ id: 'c1', scope: 'global', section: 'techniques', decay_weight: 0.8 }));
    db.insertBullet(makeBullet({ id: 'c2', scope: 'global', section: 'pitfalls', decay_weight: 0.8 }));
    db.insertBullet(makeBullet({ id: 'c3', scope: 'project:x', section: 'techniques', decay_weight: 0.8 }));
    db.insertBullet(makeBullet({ id: 'c4', scope: 'global', section: 'techniques', decay_weight: 0.2 }));

    const result = db.queryBullets({
      scopes: ['global'],
      section: 'techniques',
      minDecayWeight: 0.5,
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('c1');
  });

  // --- Stats ---

  it('returns correct stats', () => {
    db.insertBullet(makeBullet({ id: 'st1', scope: 'global', section: 'techniques', knowledge_type: 'Method' }));
    db.insertBullet(makeBullet({ id: 'st2', scope: 'global', section: 'pitfalls', knowledge_type: 'Pitfall' }));
    db.insertBullet(makeBullet({ id: 'st3', scope: 'project:a', section: 'techniques', knowledge_type: 'Method' }));

    const stats = db.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byScope).toEqual({ global: 2, 'project:a': 1 });
    expect(stats.byType).toEqual({ Method: 2, Pitfall: 1 });
    expect(stats.bySection).toEqual({ techniques: 2, pitfalls: 1 });
  });

  it('returns empty stats for empty database', () => {
    const stats = db.getStats();
    expect(stats.total).toBe(0);
    expect(stats.byScope).toEqual({});
    expect(stats.byType).toEqual({});
    expect(stats.bySection).toEqual({});
  });

  // --- Archive ---

  it('archives a bullet (moves to archive, removes from bullets)', () => {
    const bullet = makeBullet({ id: 'arch-1', content: 'To be archived' });
    db.insertBullet(bullet);

    db.archiveBullet('arch-1');

    // Should no longer be in bullets
    expect(db.getBulletById('arch-1')).toBeNull();

    // Stats should reflect removal
    const stats = db.getStats();
    expect(stats.total).toBe(0);
  });

  it('archiving non-existent bullet is a no-op', () => {
    // Should not throw
    db.archiveBullet('non-existent');
  });

  // --- Update embedding ---

  it('can update embedding on an existing bullet', () => {
    const bullet = makeBullet({ id: 'emb-up', embedding: null });
    db.insertBullet(bullet);

    const newEmb = new Float32Array([0.5, 0.6, 0.7]);
    db.updateBullet('emb-up', { embedding: newEmb });

    const result = db.getBulletById('emb-up')!;
    expect(result.embedding).toBeInstanceOf(Float32Array);
    expect(result.embedding!.length).toBe(3);
    expect(result.embedding![0]).toBeCloseTo(0.5);
  });

  // --- Conflict CRUD ---

  describe('conflict operations', () => {
    it('inserts and retrieves a conflict', () => {
      const conflict = {
        id: 'conf-1',
        bullet_id_a: 'b1',
        bullet_id_b: 'b2',
        conflict_type: 'semantic',
        description: 'Test conflict',
        created_at: new Date().toISOString(),
      };
      db.insertConflict(conflict);

      const all = db.getConflicts();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe('conf-1');
      expect(all[0].conflict_type).toBe('semantic');
      expect(all[0].resolved).toBe(0);
      expect(all[0].resolved_at).toBeNull();
    });

    it('inserts duplicate ID silently (OR IGNORE)', () => {
      const conflict = {
        id: 'conf-dup',
        bullet_id_a: 'b1',
        bullet_id_b: 'b2',
        conflict_type: 'negation',
        description: 'First',
        created_at: new Date().toISOString(),
      };
      db.insertConflict(conflict);
      db.insertConflict({ ...conflict, description: 'Second' });

      const all = db.getConflicts();
      expect(all).toHaveLength(1);
      expect(all[0].description).toBe('First'); // First insert wins
    });

    it('filters conflicts by resolved status', () => {
      db.insertConflict({
        id: 'conf-r1',
        bullet_id_a: 'b1',
        bullet_id_b: 'b2',
        conflict_type: 'semantic',
        description: 'Unresolved',
        created_at: new Date().toISOString(),
      });
      db.insertConflict({
        id: 'conf-r2',
        bullet_id_a: 'b3',
        bullet_id_b: 'b4',
        conflict_type: 'version',
        description: 'Will resolve',
        created_at: new Date().toISOString(),
      });
      db.resolveConflict('conf-r2');

      const unresolved = db.getConflicts(false);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].id).toBe('conf-r1');

      const resolved = db.getConflicts(true);
      expect(resolved).toHaveLength(1);
      expect(resolved[0].id).toBe('conf-r2');
      expect(resolved[0].resolved).toBe(1);
      expect(resolved[0].resolved_at).not.toBeNull();
    });

    it('resolves a conflict with timestamp', () => {
      db.insertConflict({
        id: 'conf-resolve',
        bullet_id_a: 'b1',
        bullet_id_b: 'b2',
        conflict_type: 'negation',
        description: 'To resolve',
        created_at: new Date().toISOString(),
      });

      db.resolveConflict('conf-resolve');

      const all = db.getConflicts();
      expect(all[0].resolved).toBe(1);
      expect(all[0].resolved_at).toBeTruthy();
    });

    it('deletes a conflict', () => {
      db.insertConflict({
        id: 'conf-del',
        bullet_id_a: 'b1',
        bullet_id_b: 'b2',
        conflict_type: 'version',
        description: 'To delete',
        created_at: new Date().toISOString(),
      });

      db.deleteConflict('conf-del');

      const all = db.getConflicts();
      expect(all).toHaveLength(0);
    });

    it('returns empty array when no conflicts exist', () => {
      const all = db.getConflicts();
      expect(all).toEqual([]);
    });
  });

  describe('project management', () => {
    it('getProjectStats returns scope counts and avg decay', () => {
      db.insertBullet(makeBullet({ id: 'ps1', scope: 'global', decay_weight: 0.8 }));
      db.insertBullet(makeBullet({ id: 'ps2', scope: 'global', decay_weight: 0.6 }));
      db.insertBullet(makeBullet({ id: 'ps3', scope: 'project:myapp', decay_weight: 0.9 }));

      const stats = db.getProjectStats();
      expect(stats).toHaveLength(2);

      const globalStat = stats.find(s => s.scope === 'global');
      expect(globalStat).toBeDefined();
      expect(globalStat!.count).toBe(2);
      expect(globalStat!.avgDecayWeight).toBeCloseTo(0.7, 1);

      const projectStat = stats.find(s => s.scope === 'project:myapp');
      expect(projectStat).toBeDefined();
      expect(projectStat!.count).toBe(1);
    });

    it('getProjectStats returns empty array for empty db', () => {
      const stats = db.getProjectStats();
      expect(stats).toEqual([]);
    });

    it('getBulletsByScope returns only matching scope', () => {
      db.insertBullet(makeBullet({ id: 'bs1', scope: 'global' }));
      db.insertBullet(makeBullet({ id: 'bs2', scope: 'project:app' }));
      db.insertBullet(makeBullet({ id: 'bs3', scope: 'project:app' }));

      const results = db.getBulletsByScope('project:app');
      expect(results).toHaveLength(2);
      expect(results.every(b => b.scope === 'project:app')).toBe(true);
    });

    it('getBulletsByScope filters by minScore', () => {
      db.insertBullet(makeBullet({ id: 'ms1', scope: 'project:x', instructivity_score: 90 }));
      db.insertBullet(makeBullet({ id: 'ms2', scope: 'project:x', instructivity_score: 40 }));
      db.insertBullet(makeBullet({ id: 'ms3', scope: 'project:x', instructivity_score: 70 }));

      const results = db.getBulletsByScope('project:x', { minScore: 60 });
      expect(results).toHaveLength(2);
      expect(results.every(b => b.instructivity_score >= 60)).toBe(true);
    });

    it('getBulletsByScope respects limit', () => {
      db.insertBullet(makeBullet({ id: 'lm1', scope: 'project:y', instructivity_score: 90 }));
      db.insertBullet(makeBullet({ id: 'lm2', scope: 'project:y', instructivity_score: 80 }));
      db.insertBullet(makeBullet({ id: 'lm3', scope: 'project:y', instructivity_score: 70 }));

      const results = db.getBulletsByScope('project:y', { limit: 2 });
      expect(results).toHaveLength(2);
    });

    it('updateBulletScope changes scope and updates updated_at', async () => {
      db.insertBullet(makeBullet({ id: 'us1', scope: 'project:old' }));
      const before = db.getBulletById('us1')!;

      // Wait a tick so updated_at changes
      await new Promise(resolve => setTimeout(resolve, 10));
      db.updateBulletScope('us1', 'global');
      const after = db.getBulletById('us1')!;
      expect(after.scope).toBe('global');
      expect(after.updated_at).not.toBe(before.updated_at);
    });

    it('getBulletsByScope returns empty for non-existent scope', () => {
      const results = db.getBulletsByScope('project:nonexistent');
      expect(results).toEqual([]);
    });
  });
});
