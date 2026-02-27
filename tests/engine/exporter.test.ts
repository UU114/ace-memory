import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Exporter, type ExportData } from '../../engine/exporter.js';
import { AceDatabase } from '../../storage/sqlite.js';
import type { Bullet } from '../../types/bullet.js';

// Helper to create a test bullet
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  const now = new Date().toISOString();
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
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('Exporter', () => {
  let tmpDir: string;
  let db: AceDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-exporter-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new AceDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('JSON export', () => {
    it('exports empty database with correct structure', () => {
      const exporter = new Exporter(db);
      const raw = exporter.export({ format: 'json' });
      const result = JSON.parse(raw) as ExportData;

      expect(result.export_version).toBe(1);
      expect(result.bullet_count).toBe(0);
      expect(result.bullets).toEqual([]);
      expect(result.exported_at).toBeDefined();
      // exported_at should be a valid ISO string
      expect(() => new Date(result.exported_at)).not.toThrow();
      expect(new Date(result.exported_at).toISOString()).toBe(result.exported_at);
    });

    it('exports bullets with all fields and strips embedding', () => {
      const embedding = new Float32Array(384).fill(0.5);
      db.insertBullet(makeBullet({
        id: 'b1',
        content: 'Test content alpha',
        embedding,
        code_content: 'const x = 1;',
        code_language: 'typescript',
      }));
      db.insertBullet(makeBullet({
        id: 'b2',
        content: 'Test content beta',
      }));

      const exporter = new Exporter(db);
      const raw = exporter.export({ format: 'json', projectName: 'my-project' });
      const result = JSON.parse(raw) as ExportData;

      expect(result.export_version).toBe(1);
      expect(result.bullet_count).toBe(2);
      expect(result.source_project).toBe('my-project');
      expect(result.bullets).toHaveLength(2);

      // Verify embedding is stripped
      for (const b of result.bullets) {
        expect(b).not.toHaveProperty('embedding');
      }

      // Verify fields are present
      const b1 = result.bullets.find(b => b.id === 'b1')!;
      expect(b1.content).toBe('Test content alpha');
      expect(b1.code_content).toBe('const x = 1;');
      expect(b1.code_language).toBe('typescript');
      expect(b1.scope).toBe('global');
      expect(b1.section).toBe('techniques');
      expect(b1.knowledge_type).toBe('Method');
    });

    it('uses "unknown" as default project name', () => {
      const exporter = new Exporter(db);
      const raw = exporter.export({ format: 'json' });
      const result = JSON.parse(raw) as ExportData;
      expect(result.source_project).toBe('unknown');
    });
  });

  describe('Markdown export', () => {
    it('exports empty database with header', () => {
      const exporter = new Exporter(db);
      const result = exporter.export({ format: 'markdown' });

      expect(result).toContain('# ACE Playbook Export');
      expect(result).toContain('Bullets: 0');
    });

    it('exports bullets grouped by section', () => {
      db.insertBullet(makeBullet({
        id: 'md1',
        section: 'techniques',
        content: 'Technique bullet content',
        knowledge_type: 'Method',
      }));
      db.insertBullet(makeBullet({
        id: 'md2',
        section: 'pitfalls',
        content: 'Pitfall bullet content',
        knowledge_type: 'Pitfall',
      }));

      const exporter = new Exporter(db);
      const result = exporter.export({ format: 'markdown', projectName: 'test-proj' });

      expect(result).toContain('# ACE Playbook Export');
      expect(result).toContain('## Techniques');
      expect(result).toContain('## Pitfalls');
      expect(result).toContain('Technique bullet content');
      expect(result).toContain('Pitfall bullet content');
      expect(result).toContain('Project: test-proj');
      expect(result).toContain('[Method]');
      expect(result).toContain('[Pitfall]');
    });

    it('includes code content when present', () => {
      db.insertBullet(makeBullet({
        id: 'mc1',
        content: 'Code example bullet',
        code_content: 'const x = 1;',
      }));

      const exporter = new Exporter(db);
      const result = exporter.export({ format: 'markdown' });

      expect(result).toContain('`const x = 1;`');
    });
  });

  describe('scope filtering', () => {
    it('filters bullets by scope', () => {
      db.insertBullet(makeBullet({ id: 'sg1', scope: 'global', content: 'Global bullet' }));
      db.insertBullet(makeBullet({ id: 'sp1', scope: 'project:myproj', content: 'Project bullet' }));

      const exporter = new Exporter(db);

      // Global only
      const globalExport = JSON.parse(exporter.export({ format: 'json', scope: 'global' })) as ExportData;
      expect(globalExport.bullet_count).toBe(1);
      expect(globalExport.bullets[0].scope).toBe('global');

      // Project only
      const projExport = JSON.parse(exporter.export({ format: 'json', scope: 'project:myproj' })) as ExportData;
      expect(projExport.bullet_count).toBe(1);
      expect(projExport.bullets[0].scope).toBe('project:myproj');
    });

    it('returns all bullets when no scope specified', () => {
      db.insertBullet(makeBullet({ id: 'a1', scope: 'global' }));
      db.insertBullet(makeBullet({ id: 'a2', scope: 'project:proj' }));

      const exporter = new Exporter(db);
      const result = JSON.parse(exporter.export({ format: 'json' })) as ExportData;
      expect(result.bullet_count).toBe(2);
    });
  });

  describe('default format', () => {
    it('defaults to JSON when no format specified', () => {
      db.insertBullet(makeBullet({ id: 'df1' }));

      const exporter = new Exporter(db);
      const raw = exporter.export({});
      const result = JSON.parse(raw) as ExportData;
      expect(result.export_version).toBe(1);
      expect(result.bullet_count).toBe(1);
    });
  });
});
