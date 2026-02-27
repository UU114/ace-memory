import { describe, it, expect } from 'vitest';
import { formatAceMemory, estimateTokens } from '../../shared/ace-memory-format.js';
import type { Bullet } from '../../types/bullet.js';

// Helper to create a minimal valid Bullet for testing
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    scope: 'global',
    section: 'techniques',
    content: 'Test content',
    distilled_rule: null,
    code_content: null,
    code_language: null,
    instructivity_score: 50,
    knowledge_type: 'Method',
    source_type: 'auto',
    recall_count: 3,
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

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('a')).toBe(1);
  });
});

describe('formatAceMemory', () => {
  it('formats bullets with ace-memory tags', () => {
    const bullets = [
      makeBullet({
        content: 'Use strict mode',
        knowledge_type: 'Preference',
        recall_count: 5,
      }),
    ];
    const result = formatAceMemory(bullets, 2000);
    expect(result).toContain('<ace-memory role="reference">');
    expect(result).toContain('</ace-memory>');
    expect(result).toContain('[Preference] Use strict mode (recalled 5x)');
  });

  it('includes header text', () => {
    const result = formatAceMemory([makeBullet()], 2000);
    expect(result).toContain('仅供辅助判断');
    expect(result).toContain('当前代码库的实际状态始终优先');
  });

  it('formats multiple bullets', () => {
    const bullets = [
      makeBullet({
        content: 'First',
        knowledge_type: 'Method',
        recall_count: 1,
      }),
      makeBullet({
        content: 'Second',
        knowledge_type: 'Pitfall',
        recall_count: 2,
      }),
    ];
    const result = formatAceMemory(bullets, 2000);
    expect(result).toContain('[Method] First (recalled 1x)');
    expect(result).toContain('[Pitfall] Second (recalled 2x)');
  });

  it('truncates when exceeding token budget', () => {
    const bullets = Array.from({ length: 20 }, (_, i) =>
      makeBullet({
        content: `Bullet number ${i} with some extra text to increase size`,
        recall_count: i,
      }),
    );
    // Very small budget - should only fit header + maybe 1-2 bullets
    const result = formatAceMemory(bullets, 100);
    expect(result).toContain('<ace-memory');
    // Should not contain all 20 bullets
    const bulletCount = (result.match(/\[Method\]/g) || []).length;
    expect(bulletCount).toBeLessThan(20);
  });

  it('handles empty bullet list', () => {
    const result = formatAceMemory([], 2000);
    expect(result).toContain('<ace-memory role="reference">');
    expect(result).toContain('</ace-memory>');
    expect(result).not.toContain('[Method]');
  });
});
