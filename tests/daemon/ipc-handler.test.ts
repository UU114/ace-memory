import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { AceDatabase } from '../../storage/sqlite.js';
import { LifecycleManager } from '../../daemon/lifecycle.js';
import { IPCHandler } from '../../daemon/ipc-handler.js';
import { OnnxEmbedding } from '../../engine/embedding.js';
import { VectorCache } from '../../daemon/vector-cache.js';
import type { DaemonConfig, SearchConfig } from '../../types/config.js';
import type { Bullet } from '../../types/bullet.js';

const daemonConfig: DaemonConfig = {
  idle_timeout_minutes: 5,
  max_idle_minutes: 10,
  session_check_interval_seconds: 60,
};

const searchConfig: SearchConfig = {
  keyword_weight: 0.6,
  semantic_weight: 0.4,
  recency_boost_days: 7,
  recency_boost_factor: 1.2,
  max_results: 5,
  max_context_tokens: 2000,
  min_score_threshold: 0.1,
};

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

describe('IPCHandler', () => {
  let tmpDir: string;
  let db: AceDatabase;
  let lifecycle: LifecycleManager;
  let handler: IPCHandler;
  let vectorCache: VectorCache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-handler-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new AceDatabase(dbPath);
    lifecycle = new LifecycleManager(daemonConfig);
    vectorCache = new VectorCache();
    // Use a non-existent path so embedding is unavailable (graceful degradation)
    const embedding = new OnnxEmbedding(path.join(tmpDir, 'no-model'));
    handler = new IPCHandler(db, lifecycle, embedding, vectorCache, searchConfig);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ping returns status, version, uptime, and active_sessions', async () => {
    const result = await handler.handle('ping', {}) as {
      status: string;
      version: string;
      uptime: number;
      active_sessions: number;
    };
    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.1.0');
    expect(typeof result.uptime).toBe('number');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.active_sessions).toBe(0);
  });

  it('recall returns empty bullets when DB is empty', async () => {
    const result = await handler.handle('recall', { query: 'test', project: 'demo' }) as {
      bullets: unknown[];
    };
    expect(result.bullets).toEqual([]);
  });

  it('recall returns matching bullets via keyword search', async () => {
    const bullet = makeBullet({
      id: 'b1',
      content: 'Use TypeScript strict mode for safety',
      scope: 'global',
    });
    db.insertBullet(bullet);

    const result = await handler.handle('recall', {
      query: 'TypeScript strict mode',
      project: 'demo',
    }) as { bullets: Bullet[] };

    expect(result.bullets.length).toBeGreaterThan(0);
    expect(result.bullets[0].id).toBe('b1');
  });

  it('recall updates recall_count after returning bullets', async () => {
    const bullet = makeBullet({
      id: 'b1',
      content: 'Use TypeScript strict mode',
      scope: 'global',
      recall_count: 0,
    });
    db.insertBullet(bullet);

    await handler.handle('recall', {
      query: 'TypeScript strict',
      project: 'demo',
    });

    const updated = db.getBulletById('b1')!;
    expect(updated.recall_count).toBe(1);
    expect(updated.last_recall).not.toBeNull();
  });

  it('recall scopes to project and global', async () => {
    const globalBullet = makeBullet({
      id: 'g1',
      content: 'TypeScript global tip',
      scope: 'global',
    });
    const projectBullet = makeBullet({
      id: 'p1',
      content: 'TypeScript project tip',
      scope: 'project:myapp',
    });
    const otherProjectBullet = makeBullet({
      id: 'o1',
      content: 'TypeScript other project tip',
      scope: 'project:other',
    });

    db.insertBullet(globalBullet);
    db.insertBullet(projectBullet);
    db.insertBullet(otherProjectBullet);

    const result = await handler.handle('recall', {
      query: 'TypeScript',
      project: 'myapp',
    }) as { bullets: Bullet[] };

    const ids = result.bullets.map(b => b.id);
    expect(ids).toContain('g1');
    expect(ids).toContain('p1');
    expect(ids).not.toContain('o1');
  });

  it('recall returns empty for empty query', async () => {
    db.insertBullet(makeBullet({ id: 'b1', content: 'TypeScript tips' }));
    const result = await handler.handle('recall', {
      query: '',
      project: 'demo',
    }) as { bullets: unknown[] };
    expect(result.bullets).toEqual([]);
  });

  it('curate returns zero-count stub', async () => {
    const result = await handler.handle('curate', { insights: [] }) as {
      added: number;
      merged: number;
      skipped: number;
    };
    expect(result).toEqual({ added: 0, merged: 0, skipped: 0 });
  });

  it('embed returns empty vector stub', async () => {
    const result = await handler.handle('embed', { text: 'hello' }) as {
      vector: number[];
    };
    expect(result.vector).toEqual([]);
  });

  it('session_register increases active session count', async () => {
    expect(lifecycle.getActiveSessionCount()).toBe(0);
    const result = await handler.handle('session_register', {
      session_id: 'sess-1',
      pid: process.pid,
    }) as { status: string };
    expect(result.status).toBe('ok');
    expect(lifecycle.getActiveSessionCount()).toBe(1);
  });

  it('session_unregister decreases active session count', async () => {
    await handler.handle('session_register', {
      session_id: 'sess-1',
      pid: process.pid,
    });
    expect(lifecycle.getActiveSessionCount()).toBe(1);

    const result = await handler.handle('session_unregister', {
      session_id: 'sess-1',
    }) as { status: string };
    expect(result.status).toBe('ok');
    expect(lifecycle.getActiveSessionCount()).toBe(0);
  });

  it('stats returns database statistics', async () => {
    const result = await handler.handle('stats', {}) as {
      total: number;
      byScope: Record<string, number>;
      byType: Record<string, number>;
      bySection: Record<string, number>;
    };
    expect(result.total).toBe(0);
    expect(result.byScope).toEqual({});
    expect(result.byType).toEqual({});
    expect(result.bySection).toEqual({});
  });

  it('decay_update returns zero-count stub', async () => {
    const result = await handler.handle('decay_update', {}) as {
      updated: number;
      archived: number;
    };
    expect(result).toEqual({ updated: 0, archived: 0 });
  });

  it('unknown method throws an error', async () => {
    await expect(
      handler.handle('nonexistent_method', {}),
    ).rejects.toThrow('Method not found: nonexistent_method');
  });
});
