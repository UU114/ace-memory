import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Mock platform to use temp directories
const testDir = path.join(os.tmpdir(), `ace-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const dataDir = path.join(testDir, '.ace-claude');
const dbPath = path.join(dataDir, 'playbook.db');
const pidPath = path.join(dataDir, 'daemon.pid');
const socketPath = path.join(dataDir, 'daemon.sock');
const modelsDir = path.join(dataDir, 'models');

vi.mock('../../shared/platform.js', () => ({
  getDataDir: () => dataDir,
  getDbPath: () => dbPath,
  getPidPath: () => pidPath,
  getSocketPath: () => socketPath,
  getConfigPath: () => path.join(dataDir, 'config.json'),
  getModelsDir: () => modelsDir,
  getModelPath: (name: string) => path.join(modelsDir, name),
  getMetaPath: () => path.join(dataDir, 'daemon.meta.json'),
  getSessionDir: () => path.join(dataDir, 'sessions'),
}));

// Mock IPC client to avoid real socket connections
vi.mock('../../shared/ipc-client.js', () => ({
  IPCClient: {
    connect: vi.fn().mockResolvedValue(null),
  },
}));

import { statusCmd, searchCmd, configCmd, healthCmd, exportCmd, importCmd, clearCmd, conflictsCmd, projectsCmd, promoteCmd } from '../../scripts/ace-cli.js';
import { AceDatabase } from '../../storage/sqlite.js';
import type { Bullet } from '../../types/bullet.js';

// Helper to create a test bullet
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  return {
    id: overrides.id ?? `test-${Math.random().toString(36).slice(2)}`,
    scope: 'global',
    section: 'techniques',
    content: 'Use vi.mock for testing module dependencies',
    distilled_rule: 'When testing, mock external deps',
    code_content: null,
    code_language: null,
    instructivity_score: 80,
    knowledge_type: 'Method',
    source_type: 'auto',
    recall_count: 0,
    last_recall: null,
    decay_weight: 1.0,
    related_tools: ['vitest'],
    related_files: [],
    key_entities: ['testing'],
    tags: ['test'],
    embedding: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ace-cli', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Create test data directory
    fs.mkdirSync(dataDir, { recursive: true });
    // Capture console.log output
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Parse the JSON output that was written to console.log
  function getOutput(): unknown {
    const call = consoleSpy.mock.calls[0];
    if (!call) return undefined;
    return JSON.parse(call[0] as string);
  }

  describe('statusCmd', () => {
    it('returns stats structure with empty database', async () => {
      await statusCmd();
      const result = getOutput() as Record<string, unknown>;
      expect(result).toHaveProperty('total', 0);
      expect(result).toHaveProperty('byScope');
      expect(result).toHaveProperty('byType');
      expect(result).toHaveProperty('bySection');
    });

    it('returns correct counts after inserting bullets', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'b1', scope: 'global', knowledge_type: 'Method' }));
      db.insertBullet(makeBullet({ id: 'b2', scope: 'global', knowledge_type: 'Pitfall' }));
      db.insertBullet(makeBullet({ id: 'b3', scope: 'project:myproj', knowledge_type: 'Method' }));
      db.close();

      await statusCmd();
      const result = getOutput() as { total: number; byScope: Record<string, number>; byType: Record<string, number> };
      expect(result.total).toBe(3);
      expect(result.byScope['global']).toBe(2);
      expect(result.byScope['project:myproj']).toBe(1);
      expect(result.byType['Method']).toBe(2);
      expect(result.byType['Pitfall']).toBe(1);
    });
  });

  describe('searchCmd', () => {
    it('returns empty array when no bullets match', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 's1', content: 'Alpha beta gamma' }));
      db.close();

      await searchCmd('zzzznotfound');
      const result = getOutput() as unknown[];
      expect(result).toEqual([]);
    });

    it('finds matching bullets by keyword', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 's2', content: 'Always use strict mode in TypeScript' }));
      db.insertBullet(makeBullet({ id: 's3', content: 'Prefer functional components in React' }));
      db.close();

      await searchCmd('TypeScript strict');
      const result = getOutput() as Array<{ id: string; content: string; finalScore: number }>;
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe('s2');
      expect(result[0]).toHaveProperty('content');
      expect(result[0]).toHaveProperty('finalScore');
    });

    it('exits with error for empty query', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      try {
        await searchCmd('   ');
      } catch {
        // expected
      }
      const result = getOutput() as { error: string };
      expect(result.error).toBe('Search query is required');
      exitSpy.mockRestore();
    });
  });

  describe('configCmd', () => {
    it('returns current config with no arguments', async () => {
      await configCmd([]);
      const result = getOutput() as Record<string, unknown>;
      expect(result).toHaveProperty('decay');
      expect(result).toHaveProperty('reflector');
      expect(result).toHaveProperty('search');
      expect(result).toHaveProperty('daemon');
    });

    it('updates a config value with set subcommand', async () => {
      await configCmd(['set', 'decay.half_life_days', '60']);
      const result = getOutput() as { updated: string; value: number };
      expect(result.updated).toBe('decay.half_life_days');
      expect(result.value).toBe(60);
    });

    it('rejects invalid config key', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      try {
        await configCmd(['set', 'nonexistent.key', '42']);
      } catch {
        // expected
      }
      const result = getOutput() as { error: string };
      expect(result.error).toContain('Invalid config key');
      exitSpy.mockRestore();
    });
  });

  describe('healthCmd', () => {
    it('returns health info with no daemon running', async () => {
      await healthCmd();
      const result = getOutput() as { daemon: string; ipc: string; onnx: string; pidFile: boolean };
      expect(result.daemon).toBe('stopped');
      expect(result.ipc).toBe('unreachable');
      expect(result.pidFile).toBe(false);
    });

    it('detects pid file when present', async () => {
      fs.writeFileSync(pidPath, '12345', 'utf-8');
      await healthCmd();
      const result = getOutput() as { daemon: string; pidFile: boolean };
      expect(result.daemon).toBe('running');
      expect(result.pidFile).toBe(true);
    });

    it('reports onnx as available when models dir exists', async () => {
      fs.mkdirSync(modelsDir, { recursive: true });
      await healthCmd();
      const result = getOutput() as { onnx: string };
      expect(result.onnx).toBe('available');
    });
  });

  describe('exportCmd', () => {
    it('returns ExportData format for empty database', async () => {
      await exportCmd();
      // Default export now uses Exporter, output via console.log
      const rawOutput = consoleSpy.mock.calls[0]?.[0] as string;
      const result = JSON.parse(rawOutput);
      expect(result.export_version).toBe(1);
      expect(result.bullet_count).toBe(0);
      expect(result.bullets).toEqual([]);
    });

    it('returns ExportData with all bullets (no args)', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'e1' }));
      db.insertBullet(makeBullet({ id: 'e2' }));
      db.close();

      await exportCmd();
      const rawOutput = consoleSpy.mock.calls[0]?.[0] as string;
      const result = JSON.parse(rawOutput);
      expect(result.export_version).toBe(1);
      expect(result.bullet_count).toBe(2);
      expect(result.bullets).toHaveLength(2);
      const ids = result.bullets.map((b: { id: string }) => b.id).sort();
      expect(ids).toEqual(['e1', 'e2']);
    });

    it('returns structured ExportData with --format json', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'ej1' }));
      db.close();

      await exportCmd(['--format', 'json']);
      // Structured formats use console.log directly (not output()), so parse the raw call
      const rawOutput = consoleSpy.mock.calls[0]?.[0] as string;
      const result = JSON.parse(rawOutput);
      expect(result.export_version).toBe(1);
      expect(result.bullet_count).toBe(1);
      expect(result.bullets).toHaveLength(1);
      expect(result.exported_at).toBeDefined();
    });

    it('returns markdown string with --format markdown', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'em1', section: 'techniques', content: 'Test markdown bullet' }));
      db.close();

      await exportCmd(['--format', 'markdown']);
      const rawOutput = consoleSpy.mock.calls[0]?.[0] as string;
      expect(rawOutput).toContain('# ACE Playbook Export');
      expect(rawOutput).toContain('Test markdown bullet');
      expect(rawOutput).toContain('## Techniques');
    });

    it('filters by scope with --scope', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'es1', scope: 'global' }));
      db.insertBullet(makeBullet({ id: 'es2', scope: 'project:myproj' }));
      db.close();

      await exportCmd(['--format', 'json', '--scope', 'global']);
      const rawOutput = consoleSpy.mock.calls[0]?.[0] as string;
      const result = JSON.parse(rawOutput);
      expect(result.bullet_count).toBe(1);
      expect(result.bullets[0].scope).toBe('global');
    });

    it('writes to file with --output', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'eo1' }));
      db.close();

      const outputFile = path.join(testDir, 'export-output.json');
      await exportCmd(['--format', 'json', '--output', outputFile]);

      // output() was called with { exported, format }
      const result = getOutput() as { exported: string; format: string };
      expect(result.exported).toBe(outputFile);
      expect(result.format).toBe('json');

      // File should exist with valid JSON
      const fileContent = fs.readFileSync(outputFile, 'utf-8');
      const parsed = JSON.parse(fileContent);
      expect(parsed.export_version).toBe(1);
      expect(parsed.bullet_count).toBe(1);
    });
  });

  describe('importCmd', () => {
    it('imports bullets from a valid JSON export file', async () => {
      // Create export data file
      const exportData = {
        export_version: 1,
        exported_at: new Date().toISOString(),
        source_project: 'test',
        bullet_count: 1,
        bullets: [{
          id: 'imp1',
          scope: 'global',
          section: 'techniques',
          content: 'Imported bullet content for testing',
          distilled_rule: null,
          code_content: null,
          code_language: null,
          instructivity_score: 70,
          knowledge_type: 'Method',
          source_type: 'auto',
          recall_count: 5,
          last_recall: null,
          decay_weight: 1.0,
          related_tools: ['vitest'],
          related_files: [],
          key_entities: ['testing'],
          tags: ['import_test'],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
      };

      const importFile = path.join(testDir, 'import-test.json');
      fs.writeFileSync(importFile, JSON.stringify(exportData), 'utf-8');

      await importCmd([importFile]);
      const result = getOutput() as { added: number; merged: number; skipped: number; errors: number };
      expect(result.added).toBe(1);
      expect(result.merged).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);

      // Verify bullet was inserted in DB
      const db = new AceDatabase(dbPath);
      const bullets = db.queryBullets({});
      expect(bullets.length).toBe(1);
      expect(bullets[0].content).toBe('Imported bullet content for testing');
      expect(bullets[0].source_type).toBe('imported');
      db.close();
    });

    it('shows usage error when no file argument', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      try {
        await importCmd([]);
      } catch {
        // expected
      }
      const result = getOutput() as { error: string };
      expect(result.error).toContain('Usage');
      exitSpy.mockRestore();
    });
  });

  describe('clearCmd', () => {
    it('clears all bullets and returns count', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'c1' }));
      db.insertBullet(makeBullet({ id: 'c2' }));
      db.insertBullet(makeBullet({ id: 'c3' }));
      db.close();

      await clearCmd();
      const result = getOutput() as { cleared: number };
      expect(result.cleared).toBe(3);

      // Verify database is empty
      const db2 = new AceDatabase(dbPath);
      const stats = db2.getStats();
      expect(stats.total).toBe(0);
      db2.close();
    });

    it('returns zero when database is already empty', async () => {
      await clearCmd();
      const result = getOutput() as { cleared: number };
      expect(result.cleared).toBe(0);
    });
  });

  describe('conflictsCmd', () => {
    it('lists unresolved conflicts', async () => {
      const db = new AceDatabase(dbPath);
      db.insertConflict({
        id: 'c1',
        bullet_id_a: 'ba',
        bullet_id_b: 'bb',
        conflict_type: 'semantic',
        description: 'Test conflict',
        created_at: new Date().toISOString(),
      });
      db.close();

      await conflictsCmd([]);
      const result = getOutput() as Array<{ id: string; type: string }>;
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('c1');
      expect(result[0].type).toBe('semantic');
    });

    it('returns empty array when no conflicts', async () => {
      await conflictsCmd([]);
      const result = getOutput() as unknown[];
      expect(result).toEqual([]);
    });

    it('resolves a conflict with keep_both', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'ra' }));
      db.insertBullet(makeBullet({ id: 'rb' }));
      db.insertConflict({
        id: 'c-resolve',
        bullet_id_a: 'ra',
        bullet_id_b: 'rb',
        conflict_type: 'negation',
        description: 'Negation conflict',
        created_at: new Date().toISOString(),
      });
      db.close();

      await conflictsCmd(['resolve', 'c-resolve', 'keep_both']);
      const result = getOutput() as { resolved: string; action: string };
      expect(result.resolved).toBe('c-resolve');
      expect(result.action).toBe('keep_both');

      // Both bullets should still exist
      const db2 = new AceDatabase(dbPath);
      expect(db2.getBulletById('ra')).not.toBeNull();
      expect(db2.getBulletById('rb')).not.toBeNull();
      db2.close();
    });

    it('resolves conflict with keep_a (archives bullet B)', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'ka' }));
      db.insertBullet(makeBullet({ id: 'kb' }));
      db.insertConflict({
        id: 'c-keep-a',
        bullet_id_a: 'ka',
        bullet_id_b: 'kb',
        conflict_type: 'version',
        description: 'Version conflict',
        created_at: new Date().toISOString(),
      });
      db.close();

      await conflictsCmd(['resolve', 'c-keep-a', 'keep_a']);
      const result = getOutput() as { resolved: string; action: string };
      expect(result.action).toBe('keep_a');

      // Bullet B should be archived
      const db2 = new AceDatabase(dbPath);
      expect(db2.getBulletById('ka')).not.toBeNull();
      expect(db2.getBulletById('kb')).toBeNull(); // Archived
      db2.close();
    });

    it('resolves conflict with keep_b (archives bullet A)', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'kba' }));
      db.insertBullet(makeBullet({ id: 'kbb' }));
      db.insertConflict({
        id: 'c-keep-b',
        bullet_id_a: 'kba',
        bullet_id_b: 'kbb',
        conflict_type: 'semantic',
        description: 'Semantic conflict',
        created_at: new Date().toISOString(),
      });
      db.close();

      await conflictsCmd(['resolve', 'c-keep-b', 'keep_b']);

      const db2 = new AceDatabase(dbPath);
      expect(db2.getBulletById('kba')).toBeNull(); // Archived
      expect(db2.getBulletById('kbb')).not.toBeNull();
      db2.close();
    });

    it('reports error for non-existent conflict ID', async () => {
      await conflictsCmd(['resolve', 'nonexistent']);
      const result = getOutput() as { error: string };
      expect(result.error).toContain('not found');
    });
  });

  describe('projectsCmd', () => {
    it('lists scope stats', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'p1', scope: 'global', decay_weight: 0.8 }));
      db.insertBullet(makeBullet({ id: 'p2', scope: 'global', decay_weight: 0.6 }));
      db.insertBullet(makeBullet({ id: 'p3', scope: 'project:myapp', decay_weight: 0.9 }));
      db.close();

      await projectsCmd([]);
      const result = getOutput() as Array<{ scope: string; count: number }>;
      expect(result).toHaveLength(2);
      expect(result.find(s => s.scope === 'global')?.count).toBe(2);
    });

    it('lists bullets for specific scope', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'p4', scope: 'project:test' }));
      db.insertBullet(makeBullet({ id: 'p5', scope: 'global' }));
      db.close();

      await projectsCmd(['project:test']);
      const result = getOutput() as Array<{ id: string }>;
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p4');
    });

    it('returns empty array for unknown scope', async () => {
      await projectsCmd(['project:unknown']);
      const result = getOutput() as unknown[];
      expect(result).toEqual([]);
    });
  });

  describe('promoteCmd', () => {
    it('errors without scope argument', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
      try {
        await promoteCmd([]);
      } catch {}
      const result = getOutput() as { error: string };
      expect(result.error).toContain('Usage');
      exitSpy.mockRestore();
    });

    it('errors when promoting from global', async () => {
      await promoteCmd(['global']);
      const result = getOutput() as { error: string };
      expect(result.error).toContain('Cannot promote from global');
    });

    it('lists bullets in review mode (no --all)', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'pr1', scope: 'project:app', instructivity_score: 80 }));
      db.insertBullet(makeBullet({ id: 'pr2', scope: 'project:app', instructivity_score: 60 }));
      db.close();

      await promoteCmd(['project:app']);
      const result = getOutput() as Array<{ id: string }>;
      expect(result).toHaveLength(2);
    });

    it('promotes all bullets with --all', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'pa1', scope: 'project:app2' }));
      db.insertBullet(makeBullet({ id: 'pa2', scope: 'project:app2' }));
      db.close();

      await promoteCmd(['project:app2', '--all']);
      const result = getOutput() as { promoted: number; newScope: string };
      expect(result.promoted).toBe(2);
      expect(result.newScope).toBe('global');

      // Verify scope changed
      const db2 = new AceDatabase(dbPath);
      const b1 = db2.getBulletById('pa1')!;
      const b2 = db2.getBulletById('pa2')!;
      expect(b1.scope).toBe('global');
      expect(b2.scope).toBe('global');
      db2.close();
    });

    it('promotes only high-score bullets with --min-score', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'pm1', scope: 'project:lib', instructivity_score: 90 }));
      db.insertBullet(makeBullet({ id: 'pm2', scope: 'project:lib', instructivity_score: 40 }));
      db.close();

      await promoteCmd(['project:lib', '--min-score', '60']);
      const result = getOutput() as { promoted: number };
      expect(result.promoted).toBe(1);

      const db2 = new AceDatabase(dbPath);
      expect(db2.getBulletById('pm1')!.scope).toBe('global');
      expect(db2.getBulletById('pm2')!.scope).toBe('project:lib'); // unchanged
      db2.close();
    });

    it('promotes single bullet by --id', async () => {
      const db = new AceDatabase(dbPath);
      db.insertBullet(makeBullet({ id: 'pid1', scope: 'project:x' }));
      db.close();

      await promoteCmd(['project:x', '--id', 'pid1']);
      const result = getOutput() as { promoted: number };
      expect(result.promoted).toBe(1);

      const db2 = new AceDatabase(dbPath);
      expect(db2.getBulletById('pid1')!.scope).toBe('global');
      db2.close();
    });

    it('returns 0 promoted for empty scope with --all', async () => {
      await promoteCmd(['project:empty', '--all']);
      const result = getOutput() as { promoted: number };
      expect(result.promoted).toBe(0);
    });
  });
});
