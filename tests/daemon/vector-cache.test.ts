import { describe, it, expect } from 'vitest';
import { VectorCache } from '../../daemon/vector-cache.js';

// Create a simple Float32Array embedding for testing
function makeVec(values: number[]): Float32Array {
  const vec = new Float32Array(384);
  for (let i = 0; i < values.length && i < 384; i++) {
    vec[i] = values[i];
  }
  return vec;
}

// Create a normalized unit vector in a specific direction
function makeUnitVec(dim: number, value = 1.0): Float32Array {
  const vec = new Float32Array(384);
  vec[dim] = value;
  return vec;
}

describe('VectorCache', () => {
  describe('add / remove / has / get / size', () => {
    it('starts empty', () => {
      const cache = new VectorCache();
      expect(cache.size).toBe(0);
    });

    it('adds and retrieves an embedding', () => {
      const cache = new VectorCache();
      const vec = makeVec([1, 2, 3]);
      cache.add('b1', vec);

      expect(cache.size).toBe(1);
      expect(cache.has('b1')).toBe(true);
      expect(cache.get('b1')).toBe(vec);
    });

    it('removes an embedding', () => {
      const cache = new VectorCache();
      cache.add('b1', makeVec([1, 2, 3]));
      cache.remove('b1');

      expect(cache.size).toBe(0);
      expect(cache.has('b1')).toBe(false);
      expect(cache.get('b1')).toBeUndefined();
    });

    it('removing non-existent ID is a no-op', () => {
      const cache = new VectorCache();
      cache.remove('nonexistent');
      expect(cache.size).toBe(0);
    });

    it('overwrites existing embedding on add', () => {
      const cache = new VectorCache();
      const vec1 = makeVec([1, 0, 0]);
      const vec2 = makeVec([0, 1, 0]);
      cache.add('b1', vec1);
      cache.add('b1', vec2);

      expect(cache.size).toBe(1);
      expect(cache.get('b1')).toBe(vec2);
    });

    it('handles multiple entries', () => {
      const cache = new VectorCache();
      cache.add('b1', makeVec([1]));
      cache.add('b2', makeVec([2]));
      cache.add('b3', makeVec([3]));

      expect(cache.size).toBe(3);
      expect(cache.has('b1')).toBe(true);
      expect(cache.has('b2')).toBe(true);
      expect(cache.has('b3')).toBe(true);
    });

    it('clear removes all entries', () => {
      const cache = new VectorCache();
      cache.add('b1', makeVec([1]));
      cache.add('b2', makeVec([2]));
      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has('b1')).toBe(false);
    });
  });

  describe('searchSimilar', () => {
    it('returns empty array for empty cache', () => {
      const cache = new VectorCache();
      const query = makeUnitVec(0);
      const results = cache.searchSimilar(query, 5);
      expect(results).toEqual([]);
    });

    it('finds the most similar vector', () => {
      const cache = new VectorCache();
      // Three unit vectors in orthogonal directions
      cache.add('x', makeUnitVec(0));
      cache.add('y', makeUnitVec(1));
      cache.add('z', makeUnitVec(2));

      // Query in x-direction → should match 'x'
      const query = makeUnitVec(0);
      const results = cache.searchSimilar(query, 3);

      expect(results.length).toBe(3);
      expect(results[0].id).toBe('x');
      expect(results[0].score).toBeCloseTo(1.0, 5);
      // Others should be ~0 (orthogonal)
      expect(results[1].score).toBeCloseTo(0, 5);
      expect(results[2].score).toBeCloseTo(0, 5);
    });

    it('respects limit parameter', () => {
      const cache = new VectorCache();
      for (let i = 0; i < 20; i++) {
        cache.add(`b${i}`, makeUnitVec(i % 384));
      }

      const query = makeUnitVec(0);
      const results = cache.searchSimilar(query, 5);
      expect(results.length).toBe(5);
    });

    it('returns results sorted by score descending', () => {
      const cache = new VectorCache();
      // Create vectors with varying similarity to query
      const query = makeVec([1, 0, 0]);

      // Vector closely aligned with query
      const close = makeVec([0.9, 0.1, 0]);
      cache.add('close', close);

      // Vector partially aligned
      const mid = makeVec([0.5, 0.5, 0]);
      cache.add('mid', mid);

      // Vector orthogonal
      const far = makeVec([0, 1, 0]);
      cache.add('far', far);

      const results = cache.searchSimilar(query, 3);
      expect(results.length).toBe(3);
      // Verify descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
      expect(results[0].id).toBe('close');
    });

    it('handles identical vectors (score = 1.0)', () => {
      const cache = new VectorCache();
      const vec = makeUnitVec(5);
      cache.add('b1', vec);

      const query = makeUnitVec(5);
      const results = cache.searchSimilar(query, 1);
      expect(results.length).toBe(1);
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });
  });
});
