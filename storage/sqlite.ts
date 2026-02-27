import BetterSqlite3 from 'better-sqlite3';
import type { Bullet } from '../types/bullet.js';
import { initializeSchema } from './schema.js';

// Filter criteria for querying bullets
export interface BulletFilter {
  scopes?: string[];
  section?: string;
  knowledgeType?: string;
  minDecayWeight?: number;
  limit?: number;
  offset?: number;
}

// Aggregated statistics for the playbook
export interface PlaybookStats {
  total: number;
  byScope: Record<string, number>;
  byType: Record<string, number>;
  bySection: Record<string, number>;
}

// Row shape returned from SQLite for the bullets table
interface BulletRow {
  id: string;
  scope: string;
  section: string;
  content: string;
  distilled_rule: string | null;
  code_content: string | null;
  code_language: string | null;
  instructivity_score: number;
  knowledge_type: string;
  source_type: string;
  recall_count: number;
  last_recall: string | null;
  decay_weight: number;
  related_tools: string;
  related_files: string;
  key_entities: string;
  tags: string;
  embedding: Buffer | null;
  created_at: string;
  updated_at: string;
}

// Convert a database row to a Bullet object
function rowToBullet(row: BulletRow): Bullet {
  return {
    id: row.id,
    scope: row.scope as Bullet['scope'],
    section: row.section as Bullet['section'],
    content: row.content,
    distilled_rule: row.distilled_rule,
    code_content: row.code_content,
    code_language: row.code_language,
    instructivity_score: row.instructivity_score,
    knowledge_type: row.knowledge_type as Bullet['knowledge_type'],
    source_type: row.source_type as Bullet['source_type'],
    recall_count: row.recall_count,
    last_recall: row.last_recall,
    decay_weight: row.decay_weight,
    related_tools: JSON.parse(row.related_tools) as string[],
    related_files: JSON.parse(row.related_files) as string[],
    key_entities: JSON.parse(row.key_entities) as string[],
    tags: JSON.parse(row.tags) as string[],
    embedding: row.embedding
      ? new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
      : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// SQLite-backed storage for ACE bullets
export class AceDatabase {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);

    // Enable WAL mode for better concurrency
    this.db.pragma('journal_mode = WAL');

    // Initialize schema (creates tables/indexes if not present)
    initializeSchema(this.db);
  }

  // Insert a new bullet into the database
  insertBullet(bullet: Bullet): void {
    const stmt = this.db.prepare(`
      INSERT INTO bullets (
        id, scope, section, content, distilled_rule,
        code_content, code_language,
        instructivity_score, knowledge_type, source_type,
        recall_count, last_recall, decay_weight,
        related_tools, related_files, key_entities, tags,
        embedding, created_at, updated_at
      ) VALUES (
        @id, @scope, @section, @content, @distilled_rule,
        @code_content, @code_language,
        @instructivity_score, @knowledge_type, @source_type,
        @recall_count, @last_recall, @decay_weight,
        @related_tools, @related_files, @key_entities, @tags,
        @embedding, @created_at, @updated_at
      )
    `);

    stmt.run({
      id: bullet.id,
      scope: bullet.scope,
      section: bullet.section,
      content: bullet.content,
      distilled_rule: bullet.distilled_rule,
      code_content: bullet.code_content,
      code_language: bullet.code_language,
      instructivity_score: bullet.instructivity_score,
      knowledge_type: bullet.knowledge_type,
      source_type: bullet.source_type,
      recall_count: bullet.recall_count,
      last_recall: bullet.last_recall,
      decay_weight: bullet.decay_weight,
      related_tools: JSON.stringify(bullet.related_tools),
      related_files: JSON.stringify(bullet.related_files),
      key_entities: JSON.stringify(bullet.key_entities),
      tags: JSON.stringify(bullet.tags),
      embedding: bullet.embedding
        ? Buffer.from(bullet.embedding.buffer, bullet.embedding.byteOffset, bullet.embedding.byteLength)
        : null,
      created_at: bullet.created_at,
      updated_at: bullet.updated_at,
    });
  }

  // Update specific fields of an existing bullet
  updateBullet(id: string, fields: Partial<Bullet>): void {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    for (const [key, value] of Object.entries(fields)) {
      if (key === 'id') continue; // Cannot update primary key

      const paramName = key;
      setClauses.push(`${key} = @${paramName}`);

      // Handle special field types
      if (['related_tools', 'related_files', 'key_entities', 'tags'].includes(key)) {
        params[paramName] = JSON.stringify(value);
      } else if (key === 'embedding') {
        const emb = value as Float32Array | null;
        params[paramName] = emb
          ? Buffer.from(emb.buffer, emb.byteOffset, emb.byteLength)
          : null;
      } else {
        params[paramName] = value;
      }
    }

    if (setClauses.length === 0) return;

    const sql = `UPDATE bullets SET ${setClauses.join(', ')} WHERE id = @id`;
    this.db.prepare(sql).run(params);
  }

  // Delete a bullet by ID
  deleteBullet(id: string): void {
    this.db.prepare('DELETE FROM bullets WHERE id = ?').run(id);
  }

  // Retrieve a single bullet by ID
  getBulletById(id: string): Bullet | null {
    const row = this.db.prepare('SELECT * FROM bullets WHERE id = ?').get(id) as BulletRow | undefined;
    if (!row) return null;
    return rowToBullet(row);
  }

  // Query bullets with optional filters
  queryBullets(filters: BulletFilter): Bullet[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.scopes && filters.scopes.length > 0) {
      const placeholders = filters.scopes.map(() => '?').join(', ');
      conditions.push(`scope IN (${placeholders})`);
      params.push(...filters.scopes);
    }

    if (filters.section) {
      conditions.push('section = ?');
      params.push(filters.section);
    }

    if (filters.knowledgeType) {
      conditions.push('knowledge_type = ?');
      params.push(filters.knowledgeType);
    }

    if (filters.minDecayWeight !== undefined) {
      conditions.push('decay_weight >= ?');
      params.push(filters.minDecayWeight);
    }

    let sql = 'SELECT * FROM bullets';
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY decay_weight DESC';

    if (filters.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    if (filters.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    const rows = this.db.prepare(sql).all(...params) as BulletRow[];
    return rows.map(rowToBullet);
  }

  // Retrieve all embeddings (for vector search)
  getAllEmbeddings(): Array<{ id: string; embedding: Float32Array }> {
    const rows = this.db
      .prepare('SELECT id, embedding FROM bullets WHERE embedding IS NOT NULL')
      .all() as Array<{ id: string; embedding: Buffer }>;

    return rows.map(row => ({
      id: row.id,
      embedding: new Float32Array(
        row.embedding.buffer,
        row.embedding.byteOffset,
        row.embedding.byteLength / 4,
      ),
    }));
  }

  // Get aggregated statistics
  getStats(): PlaybookStats {
    const total = (this.db.prepare('SELECT COUNT(*) as cnt FROM bullets').get() as { cnt: number }).cnt;

    const scopeRows = this.db
      .prepare('SELECT scope, COUNT(*) as cnt FROM bullets GROUP BY scope')
      .all() as Array<{ scope: string; cnt: number }>;
    const byScope: Record<string, number> = {};
    for (const row of scopeRows) {
      byScope[row.scope] = row.cnt;
    }

    const typeRows = this.db
      .prepare('SELECT knowledge_type, COUNT(*) as cnt FROM bullets GROUP BY knowledge_type')
      .all() as Array<{ knowledge_type: string; cnt: number }>;
    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.knowledge_type] = row.cnt;
    }

    const sectionRows = this.db
      .prepare('SELECT section, COUNT(*) as cnt FROM bullets GROUP BY section')
      .all() as Array<{ section: string; cnt: number }>;
    const bySection: Record<string, number> = {};
    for (const row of sectionRows) {
      bySection[row.section] = row.cnt;
    }

    return { total, byScope, byType, bySection };
  }

  // Archive a bullet (move to archive table, remove from bullets)
  archiveBullet(id: string): void {
    const row = this.db.prepare('SELECT * FROM bullets WHERE id = ?').get(id) as BulletRow | undefined;
    if (!row) return;

    const archiveStmt = this.db.prepare(`
      INSERT INTO archive (id, scope, section, content, distilled_rule, knowledge_type, recall_count, decay_weight, archived_at, created_at)
      VALUES (@id, @scope, @section, @content, @distilled_rule, @knowledge_type, @recall_count, @decay_weight, @archived_at, @created_at)
    `);

    const deleteStmt = this.db.prepare('DELETE FROM bullets WHERE id = ?');

    const transaction = this.db.transaction(() => {
      archiveStmt.run({
        id: row.id,
        scope: row.scope,
        section: row.section,
        content: row.content,
        distilled_rule: row.distilled_rule,
        knowledge_type: row.knowledge_type,
        recall_count: row.recall_count,
        decay_weight: row.decay_weight,
        archived_at: new Date().toISOString(),
        created_at: row.created_at,
      });
      deleteStmt.run(id);
    });

    transaction();
  }

  // Insert a conflict record (idempotent — ignores duplicate IDs)
  insertConflict(conflict: {
    id: string;
    bullet_id_a: string;
    bullet_id_b: string;
    conflict_type: string;
    description: string;
    created_at: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO conflicts (id, bullet_id_a, bullet_id_b, conflict_type, description, resolved, created_at)
       VALUES (@id, @bullet_id_a, @bullet_id_b, @conflict_type, @description, 0, @created_at)`,
      )
      .run(conflict);
  }

  // Get conflicts, optionally filtered by resolved status
  getConflicts(
    resolved?: boolean,
  ): Array<{
    id: string;
    bullet_id_a: string;
    bullet_id_b: string;
    conflict_type: string;
    description: string;
    resolved: number;
    resolved_at: string | null;
    created_at: string;
  }> {
    if (resolved !== undefined) {
      return this.db
        .prepare('SELECT * FROM conflicts WHERE resolved = ?')
        .all(resolved ? 1 : 0) as any[];
    }
    return this.db.prepare('SELECT * FROM conflicts').all() as any[];
  }

  // Mark a conflict as resolved
  resolveConflict(id: string): void {
    this.db
      .prepare('UPDATE conflicts SET resolved = 1, resolved_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }

  // Delete a conflict record
  deleteConflict(id: string): void {
    this.db.prepare('DELETE FROM conflicts WHERE id = ?').run(id);
  }

  // Get distinct scopes with counts and average decay weight
  getProjectStats(): Array<{ scope: string; count: number; avgDecayWeight: number }> {
    return this.db
      .prepare('SELECT scope, COUNT(*) as count, AVG(decay_weight) as avgDecayWeight FROM bullets GROUP BY scope ORDER BY count DESC')
      .all() as Array<{ scope: string; count: number; avgDecayWeight: number }>;
  }

  // Get bullets filtered by exact scope
  getBulletsByScope(scope: string, options?: { minScore?: number; limit?: number }): Bullet[] {
    let sql = 'SELECT * FROM bullets WHERE scope = ?';
    const params: unknown[] = [scope];
    if (options?.minScore !== undefined) {
      sql += ' AND instructivity_score >= ?';
      params.push(options.minScore);
    }
    sql += ' ORDER BY instructivity_score DESC';
    if (options?.limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    const rows = this.db.prepare(sql).all(...params) as BulletRow[];
    return rows.map(rowToBullet);
  }

  // Update a bullet's scope
  updateBulletScope(id: string, newScope: string): void {
    this.db.prepare('UPDATE bullets SET scope = ?, updated_at = ? WHERE id = ?')
      .run(newScope, new Date().toISOString(), id);
  }

  // Close the database connection
  close(): void {
    this.db.close();
  }
}
