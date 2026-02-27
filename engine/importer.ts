import fs from 'fs';
import type { AceDatabase } from '../storage/sqlite.js';
import type { Curator } from './curator.js';
import type { OnnxEmbedding } from './embedding.js';
import type { ExportData } from './exporter.js';
import type { DistilledBullet } from './reflector.js';
import type {
  BulletScope,
  BulletSection,
  KnowledgeType,
} from '../types/bullet.js';
import { aceLog, aceWarn } from '../shared/logger.js';

export interface ImportResult {
  added: number;
  merged: number;
  skipped: number;
  errors: number;
}

export class Importer {
  constructor(
    private db: AceDatabase,
    private curator: Curator,
    private embedding: OnnxEmbedding | null,
  ) {}

  // Import bullets from a JSON export file
  async importFromFile(filePath: string): Promise<ImportResult> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf-8');
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Invalid JSON format');
    }

    const exportData = this.validateExport(data);

    const result: ImportResult = {
      added: 0,
      merged: 0,
      skipped: 0,
      errors: 0,
    };

    for (let i = 0; i < exportData.bullets.length; i++) {
      try {
        const bullet = this.toBullet(exportData.bullets[i]);

        // Recompute embedding if ONNX available
        if (this.embedding?.initialized) {
          try {
            bullet.embedding = await this.embedding.embed(bullet.content);
          } catch {
            // Non-critical
          }
        }

        const curateResult = await this.curator.curate(bullet);
        if (curateResult === 'added') result.added++;
        else if (curateResult === 'merged') result.merged++;
        else result.skipped++;

        // Progress logging every 100 bullets
        if ((i + 1) % 100 === 0) {
          aceLog(`Import progress: ${i + 1}/${exportData.bullets.length}`);
        }
      } catch (err: any) {
        aceWarn(`Import error for bullet ${i}: ${err.message}`);
        result.errors++;
      }
    }

    aceLog(
      `Import complete: +${result.added} added, ~${result.merged} merged, -${result.skipped} skipped, !${result.errors} errors`,
    );
    return result;
  }

  // Validate export data structure
  private validateExport(data: unknown): ExportData {
    if (!data || typeof data !== 'object') {
      throw new Error('Export data must be an object');
    }

    const obj = data as Record<string, unknown>;

    if (typeof obj.export_version !== 'number') {
      throw new Error('Missing or invalid export_version');
    }

    if (!Array.isArray(obj.bullets)) {
      throw new Error('Missing or invalid bullets array');
    }

    return obj as unknown as ExportData;
  }

  // Convert a raw exported bullet to DistilledBullet for Curator
  private toBullet(raw: Record<string, unknown>): DistilledBullet {
    return {
      scope: (raw.scope as BulletScope) || 'global',
      section: (raw.section as BulletSection) || 'knowledge',
      content: (raw.content as string) || '',
      distilled_rule: (raw.distilled_rule as string | null) ?? null,
      code_content: (raw.code_content as string | null) ?? null,
      code_language: (raw.code_language as string | null) ?? null,
      knowledge_type:
        (raw.knowledge_type as KnowledgeType) || 'Knowledge',
      instructivity_score: (raw.instructivity_score as number) || 0,
      source_type: 'imported',
      related_tools: (raw.related_tools as string[]) || [],
      related_files: (raw.related_files as string[]) || [],
      key_entities: (raw.key_entities as string[]) || [],
      tags: (raw.tags as string[]) || [],
      embedding: null, // Recomputed if ONNX available
    };
  }
}
