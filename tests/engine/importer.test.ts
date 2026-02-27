import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { Importer, type ImportResult } from '../../engine/importer.js';
import { Curator } from '../../engine/curator.js';
import { AceDatabase } from '../../storage/sqlite.js';
import type { ExportData } from '../../engine/exporter.js';
import type { Bullet } from '../../types/bullet.js';

// Helper to create a valid export data object
function makeExportData(bullets: Partial<Bullet>[] = []): ExportData {
  const now = new Date().toISOString();
  const fullBullets = bullets.map((b, i) => ({
    id: b.id ?? `exp-${i}`,
    scope: b.scope ?? 'global',
    section: b.section ?? 'techniques',
    content: b.content ?? `Bullet content ${i}`,
    distilled_rule: b.distilled_rule ?? null,
    code_content: b.code_content ?? null,
    code_language: b.code_language ?? null,
    instructivity_score: b.instructivity_score ?? 50,
    knowledge_type: b.knowledge_type ?? 'Method',
    source_type: b.source_type ?? 'auto',
    recall_count: b.recall_count ?? 0,
    last_recall: b.last_recall ?? null,
    decay_weight: b.decay_weight ?? 1.0,
    related_tools: b.related_tools ?? [],
    related_files: b.related_files ?? [],
    key_entities: b.key_entities ?? [],
    tags: b.tags ?? [],
    created_at: b.created_at ?? now,
    updated_at: b.updated_at ?? now,
  }));

  return {
    export_version: 1,
    exported_at: now,
    source_project: 'test-project',
    bullet_count: fullBullets.length,
    bullets: fullBullets as any,
  };
}

// Write export data to a temp file and return the path
function writeExportFile(dir: string, data: unknown, filename?: string): string {
  const filePath = path.join(dir, filename ?? 'import.json');
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  return filePath;
}

describe('Importer', () => {
  let tmpDir: string;
  let db: AceDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-importer-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new AceDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('importFromFile', () => {
    it('imports valid JSON export file and adds bullets', async () => {
      const exportData = makeExportData([
        { content: 'First imported bullet' },
        { content: 'Second imported bullet' },
      ]);
      const filePath = writeExportFile(tmpDir, exportData);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);
      const result = await importer.importFromFile(filePath);

      expect(result.added).toBe(2);
      expect(result.merged).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);

      // Verify bullets in database
      const bullets = db.queryBullets({});
      expect(bullets.length).toBe(2);
    });

    it('sets source_type to imported on imported bullets', async () => {
      const exportData = makeExportData([
        { content: 'Imported with source type check', source_type: 'auto' },
      ]);
      const filePath = writeExportFile(tmpDir, exportData);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);
      await importer.importFromFile(filePath);

      const bullets = db.queryBullets({});
      expect(bullets.length).toBe(1);
      expect(bullets[0].source_type).toBe('imported');
    });

    it('merges duplicate content bullets', async () => {
      // Insert existing bullet with same content
      const now = new Date().toISOString();
      const existing: Bullet = {
        id: 'existing-1',
        scope: 'global',
        section: 'techniques',
        content: 'Duplicate content for merge test',
        distilled_rule: null,
        code_content: null,
        code_language: null,
        instructivity_score: 30,
        knowledge_type: 'Method',
        source_type: 'auto',
        recall_count: 5,
        last_recall: null,
        decay_weight: 1.0,
        related_tools: [],
        related_files: [],
        key_entities: [],
        tags: ['existing'],
        embedding: null,
        created_at: now,
        updated_at: now,
      };
      db.insertBullet(existing);

      const exportData = makeExportData([
        { content: 'Duplicate content for merge test', instructivity_score: 60, tags: ['imported'] },
      ]);
      const filePath = writeExportFile(tmpDir, exportData);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);
      const result = await importer.importFromFile(filePath);

      expect(result.merged).toBe(1);
      expect(result.added).toBe(0);

      // Verify merge happened
      const bullets = db.queryBullets({});
      expect(bullets.length).toBe(1);
      expect(bullets[0].instructivity_score).toBe(60); // Higher score wins
    });

    it('returns correct result counts', async () => {
      const exportData = makeExportData([
        { content: 'New bullet A' },
        { content: 'New bullet B' },
        { content: 'New bullet C' },
      ]);
      const filePath = writeExportFile(tmpDir, exportData);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);
      const result = await importer.importFromFile(filePath);

      expect(result.added).toBe(3);
      expect(result.merged).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
      // Verify total adds up
      expect(result.added + result.merged + result.skipped + result.errors).toBe(3);
    });
  });

  describe('error handling', () => {
    it('throws for file not found', async () => {
      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);

      await expect(
        importer.importFromFile('/nonexistent/path/file.json'),
      ).rejects.toThrow('File not found');
    });

    it('throws for invalid JSON', async () => {
      const filePath = path.join(tmpDir, 'invalid.json');
      fs.writeFileSync(filePath, 'not valid json {{{', 'utf-8');

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);

      await expect(
        importer.importFromFile(filePath),
      ).rejects.toThrow('Invalid JSON format');
    });

    it('throws for missing export_version', async () => {
      const data = { bullets: [] };
      const filePath = writeExportFile(tmpDir, data);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);

      await expect(
        importer.importFromFile(filePath),
      ).rejects.toThrow('Missing or invalid export_version');
    });

    it('throws for missing bullets array', async () => {
      const data = { export_version: 1 };
      const filePath = writeExportFile(tmpDir, data);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);

      await expect(
        importer.importFromFile(filePath),
      ).rejects.toThrow('Missing or invalid bullets array');
    });

    it('throws for non-object data', async () => {
      const filePath = writeExportFile(tmpDir, 'just a string');

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);

      await expect(
        importer.importFromFile(filePath),
      ).rejects.toThrow('Export data must be an object');
    });
  });

  describe('bullet conversion', () => {
    it('handles missing optional fields with defaults', async () => {
      // Minimal bullet with only content
      const data = {
        export_version: 1,
        exported_at: new Date().toISOString(),
        source_project: 'test',
        bullet_count: 1,
        bullets: [{ content: 'Minimal bullet' }],
      };
      const filePath = writeExportFile(tmpDir, data);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);
      const result = await importer.importFromFile(filePath);

      expect(result.added).toBe(1);

      const bullets = db.queryBullets({});
      expect(bullets[0].scope).toBe('global');
      expect(bullets[0].section).toBe('knowledge');
      expect(bullets[0].source_type).toBe('imported');
      expect(bullets[0].knowledge_type).toBe('Knowledge');
    });

    it('skips bullets with empty content', async () => {
      const data = {
        export_version: 1,
        exported_at: new Date().toISOString(),
        source_project: 'test',
        bullet_count: 2,
        bullets: [
          { content: '' },
          { content: 'Valid content' },
        ],
      };
      const filePath = writeExportFile(tmpDir, data);

      const curator = new Curator(db, null);
      const importer = new Importer(db, curator, null);
      const result = await importer.importFromFile(filePath);

      // Empty content bullet is skipped by Curator
      expect(result.skipped).toBe(1);
      expect(result.added).toBe(1);
    });
  });
});
