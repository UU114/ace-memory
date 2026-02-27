import type { AceDatabase } from '../storage/sqlite.js';
import type { VectorCache } from '../daemon/vector-cache.js';
import type { Bullet } from '../types/bullet.js';
import { cosineSimilarity } from './embedding.js';
import { randomUUID } from 'crypto';
import { aceLog } from '../shared/logger.js';

// Antonym pairs for semantic contradiction detection
const ANTONYM_PAIRS: [string, string][] = [
  ['always', 'never'],
  ['use', 'avoid'],
  ['enable', 'disable'],
  ['must', 'must not'],
  ['recommend', 'discourage'],
  ['始终', '不要'],
  ['使用', '避免'],
  ['开启', '关闭'],
];

// Regex for entity+version extraction (e.g., "Node 18", "Python 3.11")
const ENTITY_VERSION_RE = /\b(\w+)\s+v?(\d+(?:\.\d+)*)\b/gi;

// Positive/negative pattern pairs for negation detection
// Note: \b does not work with CJK characters, so Chinese words use lookaround-free matching
const NEGATION_PAIRS: [RegExp, RegExp][] = [
  [/(?:\balways\b|\bmust\b|始终)/i, /(?:\bnever\b|\bmust not\b|不要)/i],
  [/(?:\buse\b|使用)/i, /(?:\bavoid\b|\bdon't use\b|避免)/i],
  [/(?:\benable\b|开启)/i, /(?:\bdisable\b|关闭)/i],
  [/(?:\brecommend\b|推荐)/i, /(?:\bdiscourage\b|不推荐)/i],
];

// Conflict record structure
export interface Conflict {
  id: string;
  bullet_id_a: string;
  bullet_id_b: string;
  conflict_type: 'semantic' | 'negation' | 'version';
  description: string;
  created_at: string;
}

export class ConflictDetector {
  constructor(
    private db: AceDatabase,
    private vectorCache: VectorCache | null,
  ) {}

  // Scan a new bullet against existing bullets for conflicts
  async detect(newBullet: Bullet): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    // Only compare against bullets in the same scope
    const existing = this.db.queryBullets({
      scopes: [newBullet.scope],
    });

    for (const bullet of existing) {
      // Skip self-comparison
      if (bullet.id === newBullet.id) continue;

      // Check each conflict type, at most one per bullet pair
      const semantic = this.checkSemantic(newBullet, bullet);
      if (semantic) {
        conflicts.push(semantic);
        continue;
      }

      const negation = this.checkNegation(newBullet, bullet);
      if (negation) {
        conflicts.push(negation);
        continue;
      }

      const version = this.checkVersion(newBullet, bullet);
      if (version) {
        conflicts.push(version);
      }
    }

    const deduped = this.deduplicateConflicts(conflicts);
    if (deduped.length > 0) {
      aceLog(`ConflictDetector: found ${deduped.length} conflict(s) for bullet ${newBullet.id}`);
    }
    return deduped;
  }

  // Semantic contradiction: high cosine similarity + antonym keywords
  private checkSemantic(a: Bullet, b: Bullet): Conflict | null {
    if (!a.embedding || !b.embedding) return null;
    if (a.section !== b.section) return null;

    const similarity = cosineSimilarity(a.embedding, b.embedding);
    if (similarity < 0.75) return null;

    const contentA = a.content.toLowerCase();
    const contentB = b.content.toLowerCase();

    for (const [word1, word2] of ANTONYM_PAIRS) {
      if (
        (contentA.includes(word1) && contentB.includes(word2)) ||
        (contentA.includes(word2) && contentB.includes(word1))
      ) {
        return this.makeConflict(
          a.id,
          b.id,
          'semantic',
          `Semantic contradiction (similarity: ${similarity.toFixed(2)}, antonyms: ${word1}/${word2}): "${a.content.slice(0, 80)}" vs "${b.content.slice(0, 80)}"`,
        );
      }
    }

    return null;
  }

  // Negation conflict: positive/negative pattern pairs with shared context
  private checkNegation(a: Bullet, b: Bullet): Conflict | null {
    const contentA = a.content;
    const contentB = b.content;

    for (const [positive, negative] of NEGATION_PAIRS) {
      if (
        (positive.test(contentA) && negative.test(contentB)) ||
        (positive.test(contentB) && negative.test(contentA))
      ) {
        // Check shared context: same section or shared key entities
        const sharedEntities = a.key_entities.filter(e =>
          b.key_entities.some(be => be.toLowerCase() === e.toLowerCase()),
        );

        if (sharedEntities.length > 0 || a.section === b.section) {
          return this.makeConflict(
            a.id,
            b.id,
            'negation',
            `Direct negation: "${a.content.slice(0, 80)}" vs "${b.content.slice(0, 80)}"`,
          );
        }
      }
    }

    return null;
  }

  // Version conflict: same entity with different version numbers
  private checkVersion(a: Bullet, b: Bullet): Conflict | null {
    const aVersions = this.extractEntityVersions(a.content);
    const bVersions = this.extractEntityVersions(b.content);

    for (const [entity, versionA] of aVersions) {
      const versionB = bVersions.get(entity);
      if (versionB && versionA !== versionB) {
        return this.makeConflict(
          a.id,
          b.id,
          'version',
          `Version mismatch: ${entity} ${versionA} vs ${versionB}`,
        );
      }
    }

    return null;
  }

  // Extract entity+version pairs from content (e.g., "Node 18" -> { node: "18" })
  private extractEntityVersions(content: string): Map<string, string> {
    const versions = new Map<string, string>();
    const re = new RegExp(ENTITY_VERSION_RE.source, ENTITY_VERSION_RE.flags);
    let match;
    while ((match = re.exec(content)) !== null) {
      const entity = match[1].toLowerCase();
      const version = match[2];
      versions.set(entity, version);
    }
    return versions;
  }

  // Create a Conflict record
  private makeConflict(
    bulletA: string,
    bulletB: string,
    type: Conflict['conflict_type'],
    desc: string,
  ): Conflict {
    return {
      id: randomUUID(),
      bullet_id_a: bulletA,
      bullet_id_b: bulletB,
      conflict_type: type,
      description: desc,
      created_at: new Date().toISOString(),
    };
  }

  // Prevent duplicate conflicts for the same bullet pair
  private deduplicateConflicts(conflicts: Conflict[]): Conflict[] {
    const seen = new Set<string>();
    return conflicts.filter(c => {
      const key = [c.bullet_id_a, c.bullet_id_b].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
