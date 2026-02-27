import type { DecayConfig } from '../types/config.js';
import type { Bullet } from '../types/bullet.js';
import { aceLog } from '../shared/logger.js';

// Result of processing all bullets through decay
export interface DecayProcessResult {
  updates: Array<{ id: string; decay_weight: number }>;
  toArchive: string[];
}

// Manages decay weight calculations for knowledge bullets
export class DecayManager {
  constructor(private config: DecayConfig) {}

  // Compute the current decay weight for a single bullet
  computeDecayWeight(bullet: Bullet): number {
    // Permanent: high recall count locks weight at 1.0
    if (bullet.recall_count >= this.config.permanent_recall_threshold) {
      return 1.0;
    }

    const now = Date.now();
    const createdAt = new Date(bullet.created_at).getTime();
    const ageDays = (now - createdAt) / (1000 * 60 * 60 * 24);

    // Grace period: young bullets always have full weight
    if (ageDays <= this.config.grace_period_days) {
      return 1.0;
    }

    // Exponential decay: 2^(-age / half_life)
    const base = Math.pow(2, -ageDays / this.config.half_life_days);

    // Recall boost: more recalls slow the decay
    const boost = 1 + this.config.recall_boost_factor * bullet.recall_count;

    const weight = base * boost;

    // Clamp to [0.0, 1.0]
    return Math.min(1.0, Math.max(0.0, weight));
  }

  // Process all bullets: compute updated weights and identify archives
  processAll(bullets: Bullet[]): DecayProcessResult {
    const updates: Array<{ id: string; decay_weight: number }> = [];
    const toArchive: string[] = [];

    for (const bullet of bullets) {
      const newWeight = this.computeDecayWeight(bullet);

      // Only record update if weight changed meaningfully (> 0.001 difference)
      if (Math.abs(newWeight - bullet.decay_weight) > 0.001) {
        updates.push({ id: bullet.id, decay_weight: newWeight });
      }

      // Archive if weight fell below threshold
      if (newWeight < this.config.archive_threshold) {
        toArchive.push(bullet.id);
      }
    }

    aceLog(`Decay processed ${bullets.length} bullets: ${updates.length} updated, ${toArchive.length} to archive`);
    return { updates, toArchive };
  }
}
