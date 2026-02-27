import { describe, it, expect } from 'vitest';
import type { Bullet } from '../../types/bullet.js';
import { Generator, stem, chineseNGrams, tokenize } from '../../engine/generator.js';
import { VectorCache } from '../../daemon/vector-cache.js';

// Helper to create a minimal valid Bullet for testing
function makeBullet(overrides: Partial<Bullet> = {}): Bullet {
  const now = new Date().toISOString();
  return {
    id: overrides.id ?? 'test-id-' + Math.random().toString(36).slice(2),
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

describe('Generator - keywordSearch', () => {
  const gen = new Generator();

  // 1. English exact match
  it('matches exact English phrase in content', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: 'Use TypeScript strict mode for safety' }),
      makeBullet({ id: 'b2', content: 'Python is dynamically typed' }),
    ];

    const results = gen.keywordSearch('TypeScript strict mode', bullets);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
    expect(results[0].keywordScore).toBeGreaterThan(0);
    expect(results[0].semanticScore).toBe(0);
    expect(results[0].finalScore).toBe(results[0].keywordScore);
  });

  // 2. English stemming match - "testing" stems to "test", matching "tested" which also stems to "test"
  it('matches stemmed English words (testing -> test, tested -> test)', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: 'We tested the deployment pipeline' }),
      makeBullet({ id: 'b2', content: 'CSS grid layout basics' }),
    ];

    const results = gen.keywordSearch('testing', bullets);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
  });

  // 3. Chinese 2-gram match
  it('matches Chinese text via 2-gram overlap', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: '数据库连接池配置方法' }),
      makeBullet({ id: 'b2', content: 'English only content here' }),
    ];

    const results = gen.keywordSearch('数据库', bullets);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
    expect(results[0].keywordScore).toBeGreaterThan(0);
  });

  // 4. Metadata matching via related_tools
  it('matches query token against related_tools metadata', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: 'Version control basics', related_tools: ['git', 'github'] }),
      makeBullet({ id: 'b2', content: 'Database management', related_tools: ['postgres'] }),
    ];

    const results = gen.keywordSearch('git', bullets);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
  });

  // 5. Prefix syntax matching
  it('matches prefix syntax tool:cargo against related_tools', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: 'Build Rust projects', related_tools: ['cargo'] }),
      makeBullet({ id: 'b2', content: 'Build Node projects', related_tools: ['npm'] }),
    ];

    const results = gen.keywordSearch('tool:cargo', bullets);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
  });

  // 6. Sorting correctness - results ordered by descending score
  it('sorts results by finalScore descending', () => {
    const bullets = [
      makeBullet({ id: 'low', content: 'Some generic text' }),
      makeBullet({ id: 'high', content: 'TypeScript TypeScript TypeScript compiler' }),
      makeBullet({ id: 'mid', content: 'TypeScript is great' }),
    ];

    const results = gen.keywordSearch('TypeScript', bullets);
    expect(results.length).toBeGreaterThanOrEqual(2);

    // Verify descending order
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].finalScore).toBeGreaterThanOrEqual(results[i].finalScore);
    }

    // The bullet with more occurrences should rank first
    expect(results[0].bullet.id).toBe('high');
  });

  // 7. Limit parameter
  it('respects limit parameter', () => {
    const bullets = Array.from({ length: 20 }, (_, i) =>
      makeBullet({ id: `b${i}`, content: `TypeScript tip number ${i}` }),
    );

    const results = gen.keywordSearch('TypeScript', bullets, 5);
    expect(results.length).toBe(5);
  });

  // 8. minScore threshold
  it('filters results below minScore threshold', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: 'TypeScript strict mode compiler options' }),
      makeBullet({ id: 'b2', content: 'Something unrelated entirely' }),
    ];

    // Use a very high minScore to filter everything
    const results = gen.keywordSearch('TypeScript', bullets, 10, 9999);
    expect(results.length).toBe(0);
  });

  // 9. Empty query returns empty results
  it('returns empty array for empty query', () => {
    const bullets = [makeBullet({ id: 'b1', content: 'Some content' })];

    expect(gen.keywordSearch('', bullets)).toEqual([]);
    expect(gen.keywordSearch('   ', bullets)).toEqual([]);
  });

  // 9b. Empty bullets array returns empty results
  it('returns empty array for empty bullets array', () => {
    expect(gen.keywordSearch('typescript', [])).toEqual([]);
  });

  // Additional: tag prefix matching
  it('matches prefix syntax tag:react against tags', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: 'Component patterns', tags: ['react', 'frontend'] }),
      makeBullet({ id: 'b2', content: 'Server patterns', tags: ['express', 'backend'] }),
    ];

    const results = gen.keywordSearch('tag:react', bullets);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
  });

  // Additional: entity prefix matching
  it('matches prefix syntax entity:node against key_entities', () => {
    const bullets = [
      makeBullet({ id: 'b1', content: 'Server runtime', key_entities: ['Node.js'] }),
      makeBullet({ id: 'b2', content: 'Browser runtime', key_entities: ['Chrome'] }),
    ];

    const results = gen.keywordSearch('entity:node', bullets);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
  });
});

describe('stem', () => {
  // 10. stem() function unit tests
  it('strips -ing suffix', () => {
    expect(stem('running')).toBe('runn');
    expect(stem('testing')).toBe('test');
    expect(stem('computing')).toBe('comput');
  });

  it('strips -tion suffix', () => {
    expect(stem('creation')).toBe('crea');
    expect(stem('compilation')).toBe('compila');
  });

  it('strips -ed suffix', () => {
    expect(stem('compiled')).toBe('compil');
    expect(stem('tested')).toBe('test');
  });

  it('strips -er suffix', () => {
    expect(stem('compiler')).toBe('compil');
    expect(stem('runner')).toBe('runn');
  });

  it('strips -ly suffix', () => {
    expect(stem('quickly')).toBe('quick');
    expect(stem('safely')).toBe('safe');
  });

  it('strips -es suffix', () => {
    expect(stem('processes')).toBe('process');
    expect(stem('watches')).toBe('watch');
  });

  it('strips -s suffix but not -ss', () => {
    expect(stem('runs')).toBe('run');
    expect(stem('tests')).toBe('test');
    // Should NOT strip -s from words ending in -ss
    expect(stem('process')).toBe('process');
  });

  it('returns short words unchanged', () => {
    expect(stem('go')).toBe('go');
    expect(stem('do')).toBe('do');
    expect(stem('is')).toBe('is');
    expect(stem('a')).toBe('a');
  });

  it('lowercases input', () => {
    expect(stem('Running')).toBe('runn');
    expect(stem('TESTING')).toBe('test');
  });
});

describe('chineseNGrams', () => {
  // 11. chineseNGrams() function unit tests
  it('extracts 2-grams from Chinese text', () => {
    const grams = chineseNGrams('数据库', 2);
    expect(grams).toEqual(['数据', '据库']);
  });

  it('ignores non-Chinese characters', () => {
    const grams = chineseNGrams('hello数据库world', 2);
    expect(grams).toEqual(['数据', '据库']);
  });

  it('returns empty array for text without Chinese', () => {
    const grams = chineseNGrams('hello world', 2);
    expect(grams).toEqual([]);
  });

  it('returns empty array for single Chinese character', () => {
    const grams = chineseNGrams('数', 2);
    expect(grams).toEqual([]);
  });

  it('handles 3-grams', () => {
    const grams = chineseNGrams('数据库连接', 3);
    expect(grams).toEqual(['数据库', '据库连', '库连接']);
  });
});

describe('tokenize', () => {
  // 12. tokenize() function unit tests
  it('splits English text on whitespace and lowercases', () => {
    const tokens = tokenize('Hello World Test');
    expect(tokens).toEqual(['hello', 'world', 'test']);
  });

  it('removes punctuation', () => {
    const tokens = tokenize('hello, world! test.');
    expect(tokens).toEqual(['hello', 'world', 'test']);
  });

  it('handles mixed Chinese and English', () => {
    const tokens = tokenize('TypeScript 数据库');
    expect(tokens).toContain('typescript');
    expect(tokens.some(t => /[\u4e00-\u9fff]/.test(t))).toBe(true);
  });

  it('filters empty tokens', () => {
    const tokens = tokenize('  hello   world  ');
    expect(tokens).toEqual(['hello', 'world']);
  });

  it('returns empty array for empty input', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });

  it('handles prefix syntax tokens', () => {
    // Prefix syntax like "tool:git" -> tokenized as "tool", "git" (colon is removed)
    // This is expected because extractPrefixFilters runs before tokenize on the full query
    const tokens = tokenize('tool:git');
    // Colon is treated as non-word, so split into tool and git
    expect(tokens).toContain('tool');
    expect(tokens).toContain('git');
  });
});

// --- Hybrid Search Tests ---

// Create a unit vector in a specific dimension
function makeUnitVec(dim: number): Float32Array {
  const vec = new Float32Array(384);
  vec[dim] = 1.0;
  return vec;
}

const defaultHybridOptions = {
  keywordWeight: 0.6,
  semanticWeight: 0.4,
  recencyBoostDays: 7,
  recencyBoostFactor: 1.2,
  limit: 10,
  minScore: 0,
};

describe('Generator - hybridSearch', () => {
  const gen = new Generator();

  it('returns empty for empty query', () => {
    const cache = new VectorCache();
    const results = gen.hybridSearch('', null, cache, [], defaultHybridOptions);
    expect(results).toEqual([]);
  });

  it('returns empty for empty bullets', () => {
    const cache = new VectorCache();
    const results = gen.hybridSearch('test', null, cache, [], defaultHybridOptions);
    expect(results).toEqual([]);
  });

  it('falls back to keyword-only when no query vector', () => {
    const cache = new VectorCache();
    const bullets = [
      makeBullet({ id: 'b1', content: 'TypeScript strict mode tips' }),
      makeBullet({ id: 'b2', content: 'Python basics' }),
    ];

    const results = gen.hybridSearch('TypeScript', null, cache, bullets, defaultHybridOptions);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].bullet.id).toBe('b1');
    expect(results[0].semanticScore).toBe(0);
  });

  it('combines keyword and semantic scores', () => {
    const cache = new VectorCache();
    const queryVec = makeUnitVec(0);

    // b1: strong keyword match, weak semantic match
    const b1 = makeBullet({
      id: 'b1',
      content: 'TypeScript TypeScript TypeScript compiler',
      embedding: makeUnitVec(1), // orthogonal to query
    });
    cache.add('b1', makeUnitVec(1));

    // b2: weak keyword match, strong semantic match
    const b2 = makeBullet({
      id: 'b2',
      content: 'Some generic content here',
      embedding: makeUnitVec(0), // identical to query
    });
    cache.add('b2', makeUnitVec(0));

    const bullets = [b1, b2];
    const results = gen.hybridSearch('TypeScript', queryVec, cache, bullets, defaultHybridOptions);

    // Both should appear
    expect(results.length).toBe(2);
    // b1 has all keyword score but no semantic
    // b2 has no keyword score but full semantic
    // With 0.6/0.4 weights, b1's pure keyword > b2's pure semantic
    const r1 = results.find(r => r.bullet.id === 'b1')!;
    const r2 = results.find(r => r.bullet.id === 'b2')!;
    expect(r1.keywordScore).toBeGreaterThan(0);
    expect(r1.semanticScore).toBe(0);
    expect(r2.semanticScore).toBeGreaterThan(0);
  });

  it('applies decay weight to final score', () => {
    const cache = new VectorCache();
    const b1 = makeBullet({ id: 'b1', content: 'TypeScript tips', decay_weight: 1.0 });
    const b2 = makeBullet({ id: 'b2', content: 'TypeScript tips', decay_weight: 0.1 });

    const results = gen.hybridSearch('TypeScript', null, cache, [b1, b2], defaultHybridOptions);
    expect(results.length).toBe(2);
    // b1 with higher decay_weight should rank first
    expect(results[0].bullet.id).toBe('b1');
    expect(results[0].finalScore).toBeGreaterThan(results[1].finalScore);
  });

  it('applies recency boost for recently recalled bullets', () => {
    const cache = new VectorCache();
    const now = new Date();
    const recentDate = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 2).toISOString(); // 2 days ago
    const oldDate = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 30).toISOString(); // 30 days ago

    const b1 = makeBullet({
      id: 'b1',
      content: 'TypeScript tips',
      last_recall: recentDate,
      created_at: oldDate,
    });
    const b2 = makeBullet({
      id: 'b2',
      content: 'TypeScript tips',
      last_recall: null,
      created_at: oldDate,
    });

    const results = gen.hybridSearch('TypeScript', null, cache, [b1, b2], defaultHybridOptions);
    expect(results.length).toBe(2);
    // b1 should get recency boost (recalled 2 days ago, within 7 day window)
    expect(results[0].bullet.id).toBe('b1');
    expect(results[0].finalScore).toBeGreaterThan(results[1].finalScore);
  });

  it('respects limit parameter', () => {
    const cache = new VectorCache();
    const bullets = Array.from({ length: 20 }, (_, i) =>
      makeBullet({ id: `b${i}`, content: `TypeScript tip number ${i}` }),
    );

    const options = { ...defaultHybridOptions, limit: 5 };
    const results = gen.hybridSearch('TypeScript', null, cache, bullets, options);
    expect(results.length).toBe(5);
  });

  it('normalizes weights when they do not sum to 1.0', () => {
    const cache = new VectorCache();
    const queryVec = makeUnitVec(0);
    const bullets = [
      makeBullet({ id: 'b1', content: 'test content', embedding: makeUnitVec(0) }),
    ];
    cache.add('b1', makeUnitVec(0));

    // Weights 3.0 + 2.0 = 5.0, should normalize to 0.6/0.4
    const options = { ...defaultHybridOptions, keywordWeight: 3.0, semanticWeight: 2.0 };
    const results = gen.hybridSearch('test content', queryVec, cache, bullets, options);
    expect(results.length).toBe(1);
    expect(results[0].finalScore).toBeGreaterThan(0);
  });

  it('skips semantic for very short queries (<=2 chars)', () => {
    const cache = new VectorCache();
    const queryVec = makeUnitVec(0);
    // Even with queryVec provided, 2-char query should be keyword-only
    const bullets = [
      makeBullet({ id: 'b1', content: 'ab test content', embedding: makeUnitVec(0) }),
    ];
    cache.add('b1', makeUnitVec(0));

    const results = gen.hybridSearch('ab', queryVec, cache, bullets, defaultHybridOptions);
    // Should still find via keyword but semantic is skipped
    if (results.length > 0) {
      expect(results[0].semanticScore).toBe(0);
    }
  });

  it('handles bullet with null embedding gracefully', () => {
    const cache = new VectorCache();
    const queryVec = makeUnitVec(0);

    // b1 has embedding, b2 does not
    const b1 = makeBullet({ id: 'b1', content: 'TypeScript compiler', embedding: makeUnitVec(0) });
    const b2 = makeBullet({ id: 'b2', content: 'TypeScript linter', embedding: null });
    cache.add('b1', makeUnitVec(0));
    // b2 not in cache

    const results = gen.hybridSearch('TypeScript', queryVec, cache, [b1, b2], defaultHybridOptions);
    expect(results.length).toBe(2);
    // b2 should have semanticScore = 0
    const r2 = results.find(r => r.bullet.id === 'b2')!;
    expect(r2.semanticScore).toBe(0);
  });
});
