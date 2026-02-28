import type { AceDatabase } from '../storage/sqlite.js';
import type { VectorCache } from '../daemon/vector-cache.js';
import type { ConflictDetector } from './conflict-detector.js';
import type { DistilledBullet } from './reflector.js';
import type { Bullet } from '../types/bullet.js';
import { cosineSimilarity } from './embedding.js';
import { aceLog, aceDebug } from '../shared/logger.js';
import { randomUUID } from 'crypto';

// Union two string arrays, deduplicating
function unionArrays(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}

export class Curator {
  private dedupThreshold: number;

  constructor(
    private db: AceDatabase,
    private vectorCache: VectorCache | null,
    dedupThreshold?: number,
    private conflictDetector?: ConflictDetector | null,
  ) {
    this.dedupThreshold = dedupThreshold ?? 0.8;
  }

  async curate(bullet: DistilledBullet): Promise<'added' | 'merged' | 'skipped'> {
    aceDebug(`Curator.curate: content="${bullet.content.slice(0, 60)}", type=${bullet.knowledge_type}, scope=${bullet.scope}`);

    // Skip empty content
    if (!bullet.content || bullet.content.trim().length === 0) {
      aceDebug(`Curator: skipped (empty content)`);
      return 'skipped';
    }

    // Path 1: Semantic dedup via vector cache
    if (bullet.embedding && this.vectorCache) {
      const similar = this.vectorCache.searchSimilar(bullet.embedding, 1);
      if (similar.length > 0 && similar[0].score >= this.dedupThreshold) {
        const existingId = similar[0].id;
        aceDebug(`Curator: semantic match found id=${existingId}, score=${similar[0].score.toFixed(3)} (threshold=${this.dedupThreshold})`);
        const existing = this.db.getBulletById(existingId);
        if (existing) {
          this.mergeBullet(existing, bullet);
          return 'merged';
        }
      } else {
        aceDebug(`Curator: no semantic match (best=${similar.length > 0 ? similar[0].score.toFixed(3) : 'none'})`);
      }
    }

    // Path 2: Exact-match fallback when no embeddings/vectorCache
    if (!bullet.embedding || !this.vectorCache) {
      const allBullets = this.db.queryBullets({});
      const exactMatch = allBullets.find(b => b.content === bullet.content);
      if (exactMatch) {
        aceDebug(`Curator: exact match found id=${exactMatch.id}`);
        this.mergeBullet(exactMatch, bullet);
        return 'merged';
      }
      aceDebug(`Curator: no exact match among ${allBullets.length} existing bullets`);
    }

    // Path 3: Insert new bullet
    aceDebug(`Curator: inserting new bullet`);
    const insertedId = this.insertBullet(bullet);

    // Async conflict detection (non-blocking, fire-and-forget)
    if (this.conflictDetector && insertedId) {
      const inserted = this.db.getBulletById(insertedId);
      if (inserted) {
        this.conflictDetector
          .detect(inserted)
          .then(conflicts => {
            for (const c of conflicts) {
              this.db.insertConflict(c);
            }
          })
          .catch(() => {}); // Non-critical — swallow errors
      }
    }

    return 'added';
  }

  // Merge incoming distilled bullet into an existing bullet
  private mergeBullet(existing: Bullet, incoming: DistilledBullet): void {
    const now = new Date().toISOString();

    // Keep more specific (longer) content
    const content = incoming.content.length > existing.content.length
      ? incoming.content
      : existing.content;

    // Keep higher instructivity_score
    const instructivity_score = Math.max(
      existing.instructivity_score,
      incoming.instructivity_score,
    );

    // Union arrays
    const tags = unionArrays(existing.tags, incoming.tags);
    const key_entities = unionArrays(existing.key_entities, incoming.key_entities);
    const related_files = unionArrays(existing.related_files, incoming.related_files);
    const related_tools = unionArrays(existing.related_tools, incoming.related_tools);

    // Use newer embedding if available
    const embedding = incoming.embedding ?? existing.embedding;

    const updates: Partial<Bullet> = {
      content,
      instructivity_score,
      tags,
      key_entities,
      related_files,
      related_tools,
      embedding,
      updated_at: now,
    };

    this.db.updateBullet(existing.id, updates);

    // Update vector cache with new embedding
    if (embedding && this.vectorCache) {
      this.vectorCache.add(existing.id, embedding);
    }

    aceLog(`Curator: merged bullet into ${existing.id}`);
  }

  // Insert a brand new bullet, return the generated ID
  private insertBullet(incoming: DistilledBullet): string {
    const now = new Date().toISOString();
    const id = randomUUID();

    const fullBullet: Bullet = {
      id,
      scope: incoming.scope,
      section: incoming.section,
      content: incoming.content,
      distilled_rule: incoming.distilled_rule,
      code_content: incoming.code_content,
      code_language: incoming.code_language,
      instructivity_score: incoming.instructivity_score,
      knowledge_type: incoming.knowledge_type,
      source_type: incoming.source_type,
      recall_count: 0,
      last_recall: null,
      decay_weight: 1.0,
      related_tools: incoming.related_tools,
      related_files: incoming.related_files,
      key_entities: incoming.key_entities,
      tags: incoming.tags,
      embedding: incoming.embedding,
      created_at: now,
      updated_at: now,
    };

    this.db.insertBullet(fullBullet);

    // Add to vector cache if embedding exists
    if (incoming.embedding && this.vectorCache) {
      this.vectorCache.add(id, incoming.embedding);
    }

    aceLog(`Curator: inserted new bullet ${id}`);
    return id;
  }
}
