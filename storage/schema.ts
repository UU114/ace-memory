import type BetterSqlite3 from 'better-sqlite3';

// Current schema version
export const SCHEMA_VERSION = 1;

// DDL for bullets table (core knowledge storage)
export const BULLETS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS bullets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL DEFAULT 'global',
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  distilled_rule TEXT,
  code_content TEXT,
  code_language TEXT,
  instructivity_score REAL NOT NULL DEFAULT 0,
  knowledge_type TEXT NOT NULL DEFAULT 'Knowledge',
  source_type TEXT NOT NULL DEFAULT 'auto',
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recall TEXT,
  decay_weight REAL NOT NULL DEFAULT 1.0,
  related_tools TEXT NOT NULL DEFAULT '[]',
  related_files TEXT NOT NULL DEFAULT '[]',
  key_entities TEXT NOT NULL DEFAULT '[]',
  tags TEXT NOT NULL DEFAULT '[]',
  embedding BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// Indexes for bullets table
export const BULLETS_INDEXES_DDL = `
CREATE INDEX IF NOT EXISTS idx_bullets_scope ON bullets(scope);
CREATE INDEX IF NOT EXISTS idx_bullets_section ON bullets(section);
CREATE INDEX IF NOT EXISTS idx_bullets_knowledge_type ON bullets(knowledge_type);
CREATE INDEX IF NOT EXISTS idx_bullets_decay_weight ON bullets(decay_weight);
CREATE INDEX IF NOT EXISTS idx_bullets_scope_decay ON bullets(scope, decay_weight);
`;

// DDL for archive table (decayed bullets)
export const ARCHIVE_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS archive (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  section TEXT NOT NULL,
  content TEXT NOT NULL,
  distilled_rule TEXT,
  knowledge_type TEXT NOT NULL,
  recall_count INTEGER NOT NULL DEFAULT 0,
  decay_weight REAL NOT NULL DEFAULT 0,
  archived_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

// DDL for conflicts table
export const CONFLICTS_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  bullet_id_a TEXT NOT NULL,
  bullet_id_b TEXT NOT NULL,
  conflict_type TEXT NOT NULL,
  description TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  created_at TEXT NOT NULL
);
`;

// DDL for schema_version table
export const SCHEMA_VERSION_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);
`;

// All DDL statements combined
export const ALL_DDL = [
  BULLETS_TABLE_DDL,
  BULLETS_INDEXES_DDL,
  ARCHIVE_TABLE_DDL,
  CONFLICTS_TABLE_DDL,
  SCHEMA_VERSION_TABLE_DDL,
];

// Initialize database schema - creates all tables and indexes
export function initializeSchema(db: BetterSqlite3.Database): void {
  db.exec(BULLETS_TABLE_DDL);

  // Execute indexes one at a time (each CREATE INDEX is a separate statement)
  const indexStatements = BULLETS_INDEXES_DDL.trim().split(';').filter(s => s.trim());
  for (const stmt of indexStatements) {
    db.exec(stmt + ';');
  }

  db.exec(ARCHIVE_TABLE_DDL);
  db.exec(CONFLICTS_TABLE_DDL);
  db.exec(SCHEMA_VERSION_TABLE_DDL);

  // Record schema version if not already present
  const existing = db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as { version: number } | undefined;
  if (!existing) {
    db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(
      SCHEMA_VERSION,
      new Date().toISOString(),
    );
  }
}
