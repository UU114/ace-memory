// Bullet knowledge types
export type KnowledgeType = 'Method' | 'Trick' | 'Pitfall' | 'Preference' | 'Knowledge';

// Bullet scope
export type BulletScope = 'global' | `project:${string}`;

// Bullet section
export type BulletSection = 'techniques' | 'pitfalls' | 'preferences' | 'knowledge' | 'methods';

// Bullet source type
export type SourceType = 'auto' | 'manual' | 'imported';

// Core knowledge entity
export interface Bullet {
  // Primary
  id: string; // UUID v4
  scope: BulletScope;
  section: BulletSection;
  content: string; // ≤500 chars, distilled rule text
  distilled_rule: string | null; // "When X, do Y because Z" format

  // Code (optional, very short)
  code_content: string | null; // ≤3 lines
  code_language: string | null;

  // Metadata
  instructivity_score: number; // 0-100
  knowledge_type: KnowledgeType;
  source_type: SourceType;
  recall_count: number;
  last_recall: string | null; // ISO 8601
  decay_weight: number; // 0.0 - 1.0
  related_tools: string[];
  related_files: string[];
  key_entities: string[];

  // Tags
  tags: string[];

  // Embedding
  embedding: Float32Array | null; // 384-dim vector, stored as BLOB

  // Timestamps
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

// Bullet without embedding (for lightweight operations)
export type BulletSummary = Omit<Bullet, 'embedding'>;

// Fields required to create a new Bullet
export type BulletCreate = Omit<Bullet, 'id' | 'recall_count' | 'last_recall' | 'decay_weight' | 'created_at' | 'updated_at'> & {
  id?: string;
};
