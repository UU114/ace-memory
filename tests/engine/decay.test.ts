import { describe, it, expect } from 'vitest';
import { DecayManager } from '../../engine/decay.js';
import type { DecayConfig } from '../../types/config.js';
import type { Bullet } from '../../types/bullet.js';

const DEFAULT_DECAY_CONFIG: DecayConfig = {
  half_life_days: 30,
  grace_period_days: 7,
  recall_boost_factor: 0.3,
  permanent_recall_threshold: 15,
  archive_threshold: 0.02,
};

// Helper to create a bullet with specific overrides
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'test-' + Math.random().toString(36).slice(2),
    scope: 'global',
    section: 'techniques',
    content: 'Test bullet content',
    distilled_rule: null,
    code_content: null,
    code_language: null,
    instructivity_score: 50,
    knowledge_type: 'Knowledge',
    source_type: 'auto',
    recall_count: 0,
    last_recall: null,
    decay_weight: 1.0,
    related_tools: [],
    related_files: [],
    key_entities: [],
    tags: [],
    embedding: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

// Helper: create a date N days in the past
function daysAgo(days: number): string {
  const d = new Date();
  d.setTime(d.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

describe('DecayManager', () => {
  const manager = new DecayManager(DEFAULT_DECAY_CONFIG);

  describe('computeDecayWeight', () => {
    it('returns 1.0 for permanent recall (recall_count >= 15)', () => {
      const bullet = makeBullet({
        recall_count: 15,
        created_at: daysAgo(100),
      });
      expect(manager.computeDecayWeight(bullet)).toBe(1.0);
    });

    it('returns 1.0 for recall_count exceeding threshold (e.g., 20)', () => {
      const bullet = makeBullet({
        recall_count: 20,
        created_at: daysAgo(365),
      });
      expect(manager.computeDecayWeight(bullet)).toBe(1.0);
    });

    it('returns 1.0 for bullet within grace period (< 7 days)', () => {
      const bullet = makeBullet({
        recall_count: 0,
        created_at: daysAgo(3),
      });
      expect(manager.computeDecayWeight(bullet)).toBe(1.0);
    });

    it('returns 1.0 for bullet exactly at grace period boundary (7 days)', () => {
      const bullet = makeBullet({
        recall_count: 0,
        created_at: daysAgo(7),
      });
      expect(manager.computeDecayWeight(bullet)).toBe(1.0);
    });

    it('returns 1.0 for bullet created right now (age = 0)', () => {
      const bullet = makeBullet({
        recall_count: 0,
        created_at: new Date().toISOString(),
      });
      expect(manager.computeDecayWeight(bullet)).toBe(1.0);
    });

    it('follows decay formula after grace period', () => {
      // 30 days old, 0 recalls → base = 2^(-30/30) = 0.5, boost = 1.0 → weight = 0.5
      const bullet = makeBullet({
        recall_count: 0,
        created_at: daysAgo(30),
      });
      const weight = manager.computeDecayWeight(bullet);
      expect(weight).toBeCloseTo(0.5, 1);
    });

    it('decays to ~0.25 at 60 days with 0 recalls', () => {
      // 60 days old → base = 2^(-60/30) = 2^(-2) = 0.25
      const bullet = makeBullet({
        recall_count: 0,
        created_at: daysAgo(60),
      });
      const weight = manager.computeDecayWeight(bullet);
      expect(weight).toBeCloseTo(0.25, 1);
    });

    it('applies recall boost factor correctly', () => {
      // 30 days old, 5 recalls → base = 0.5, boost = 1 + 0.3*5 = 2.5 → weight = 1.25 → clamped to 1.0
      const bullet = makeBullet({
        recall_count: 5,
        created_at: daysAgo(30),
      });
      const weight = manager.computeDecayWeight(bullet);
      // 0.5 * 2.5 = 1.25, clamped to 1.0
      expect(weight).toBe(1.0);
    });

    it('recall boost partially counteracts decay', () => {
      // 60 days old, 3 recalls → base = 0.25, boost = 1 + 0.3*3 = 1.9 → weight = 0.475
      const bullet = makeBullet({
        recall_count: 3,
        created_at: daysAgo(60),
      });
      const weight = manager.computeDecayWeight(bullet);
      expect(weight).toBeCloseTo(0.475, 2);
    });

    it('very old bullet with 0 recalls has very low weight', () => {
      // 300 days old → base = 2^(-300/30) = 2^(-10) = ~0.000977
      const bullet = makeBullet({
        recall_count: 0,
        created_at: daysAgo(300),
      });
      const weight = manager.computeDecayWeight(bullet);
      expect(weight).toBeCloseTo(0.000977, 3);
      expect(weight).toBeLessThan(DEFAULT_DECAY_CONFIG.archive_threshold);
    });

    it('clamps weight to maximum of 1.0', () => {
      // 10 days old, 14 recalls → base = 2^(-10/30) ≈ 0.794, boost = 1 + 0.3*14 = 5.2
      // weight = 0.794 * 5.2 ≈ 4.13 → clamped to 1.0
      const bullet = makeBullet({
        recall_count: 14,
        created_at: daysAgo(10),
      });
      const weight = manager.computeDecayWeight(bullet);
      expect(weight).toBe(1.0);
    });

    it('weight is never negative', () => {
      // Even extremely old bullets should not go negative
      const bullet = makeBullet({
        recall_count: 0,
        created_at: daysAgo(10000),
      });
      const weight = manager.computeDecayWeight(bullet);
      expect(weight).toBeGreaterThanOrEqual(0);
    });

    it('respects custom config values', () => {
      const customConfig: DecayConfig = {
        half_life_days: 10,
        grace_period_days: 3,
        recall_boost_factor: 0.5,
        permanent_recall_threshold: 5,
        archive_threshold: 0.05,
      };
      const customManager = new DecayManager(customConfig);

      // 10 days old, 0 recalls → base = 2^(-10/10) = 0.5
      const bullet = makeBullet({
        recall_count: 0,
        created_at: daysAgo(10),
      });
      expect(customManager.computeDecayWeight(bullet)).toBeCloseTo(0.5, 1);

      // recall_count = 5 → permanent
      const permanent = makeBullet({
        recall_count: 5,
        created_at: daysAgo(100),
      });
      expect(customManager.computeDecayWeight(permanent)).toBe(1.0);
    });
  });

  describe('processAll', () => {
    it('returns empty results for empty array', () => {
      const result = manager.processAll([]);
      expect(result.updates).toEqual([]);
      expect(result.toArchive).toEqual([]);
    });

    it('detects bullets that need weight update (> 0.001 change)', () => {
      // 30-day-old bullet with current decay_weight of 1.0 → new weight ~0.5
      const bullet = makeBullet({
        id: 'b1',
        recall_count: 0,
        decay_weight: 1.0,
        created_at: daysAgo(30),
      });

      const result = manager.processAll([bullet]);
      expect(result.updates.length).toBe(1);
      expect(result.updates[0].id).toBe('b1');
      expect(result.updates[0].decay_weight).toBeCloseTo(0.5, 1);
    });

    it('skips bullets with negligible weight change (<= 0.001)', () => {
      // Bullet within grace period, weight already 1.0
      const bullet = makeBullet({
        id: 'b1',
        recall_count: 0,
        decay_weight: 1.0,
        created_at: daysAgo(2),
      });

      const result = manager.processAll([bullet]);
      expect(result.updates.length).toBe(0);
    });

    it('identifies bullets for archiving below threshold', () => {
      // Very old bullet → weight < 0.02
      const bullet = makeBullet({
        id: 'old-bullet',
        recall_count: 0,
        decay_weight: 0.05,
        created_at: daysAgo(300),
      });

      const result = manager.processAll([bullet]);
      expect(result.toArchive).toContain('old-bullet');
    });

    it('does not archive bullets above threshold', () => {
      const bullet = makeBullet({
        id: 'recent-bullet',
        recall_count: 0,
        decay_weight: 1.0,
        created_at: daysAgo(30),
      });

      const result = manager.processAll([bullet]);
      expect(result.toArchive).not.toContain('recent-bullet');
    });

    it('handles mixed set of bullets correctly', () => {
      const bullets = [
        // Fresh bullet, no change needed
        makeBullet({
          id: 'fresh',
          recall_count: 0,
          decay_weight: 1.0,
          created_at: daysAgo(2),
        }),
        // Permanent bullet (high recall count), no change
        makeBullet({
          id: 'permanent',
          recall_count: 20,
          decay_weight: 1.0,
          created_at: daysAgo(100),
        }),
        // Decaying bullet (needs update)
        makeBullet({
          id: 'decaying',
          recall_count: 0,
          decay_weight: 1.0,
          created_at: daysAgo(30),
        }),
        // Ancient bullet (needs update + archive)
        makeBullet({
          id: 'ancient',
          recall_count: 0,
          decay_weight: 0.1,
          created_at: daysAgo(300),
        }),
      ];

      const result = manager.processAll(bullets);

      // fresh and permanent should not be in updates
      const updateIds = result.updates.map(u => u.id);
      expect(updateIds).not.toContain('fresh');
      expect(updateIds).not.toContain('permanent');
      expect(updateIds).toContain('decaying');
      expect(updateIds).toContain('ancient');

      // Only ancient should be archived
      expect(result.toArchive).toContain('ancient');
      expect(result.toArchive).not.toContain('fresh');
      expect(result.toArchive).not.toContain('permanent');
      expect(result.toArchive).not.toContain('decaying');
    });

    it('archived bullets also appear in updates list', () => {
      // A bullet going from weight 0.1 to ~0.001 is both updated and archived
      const bullet = makeBullet({
        id: 'dying',
        recall_count: 0,
        decay_weight: 0.1,
        created_at: daysAgo(300),
      });

      const result = manager.processAll([bullet]);
      const updateIds = result.updates.map(u => u.id);
      expect(updateIds).toContain('dying');
      expect(result.toArchive).toContain('dying');
    });
  });
});
