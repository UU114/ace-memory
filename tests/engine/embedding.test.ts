import { describe, it, expect } from 'vitest';
import { cosineSimilarity, OnnxEmbedding } from '../../engine/embedding.js';

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 5);
  });

  it('returns 0.0 for zero vector', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('returns 0.0 for mismatched lengths', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('handles normalized vectors correctly', () => {
    // Two unit vectors at ~60 degrees apart
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0.5, Math.sqrt(3) / 2]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.5, 4);
  });

  it('is scale-invariant', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([2, 4, 6]); // 2x of a
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  it('works with 384-dim vectors', () => {
    const a = new Float32Array(384);
    const b = new Float32Array(384);
    // Fill with deterministic values
    for (let i = 0; i < 384; i++) {
      a[i] = Math.sin(i);
      b[i] = Math.sin(i + 0.1);
    }
    const sim = cosineSimilarity(a, b);
    // Should be very similar but not identical
    expect(sim).toBeGreaterThan(0.99);
    expect(sim).toBeLessThan(1.0);
  });
});

describe('OnnxEmbedding static properties', () => {
  it('has correct model name', () => {
    expect(OnnxEmbedding.modelName).toBe('all-MiniLM-L6-v2');
  });

  it('has correct embedding dimension', () => {
    expect(OnnxEmbedding.embeddingDim).toBe(384);
  });

  it('returns default model directory', () => {
    const dir = OnnxEmbedding.getDefaultModelDir();
    expect(dir).toContain('all-MiniLM-L6-v2');
    expect(dir).toContain('.ace-claude');
  });
});

describe('OnnxEmbedding instance', () => {
  it('reports model as unavailable when files do not exist', () => {
    const emb = new OnnxEmbedding('/nonexistent/path');
    expect(emb.isModelAvailable()).toBe(false);
  });

  it('is not initialized before init()', () => {
    const emb = new OnnxEmbedding('/nonexistent/path');
    expect(emb.initialized).toBe(false);
  });

  it('throws on init() when model files missing', async () => {
    const emb = new OnnxEmbedding('/nonexistent/path');
    await expect(emb.init()).rejects.toThrow('ONNX model not found');
  });

  it('throws on embed() when not initialized', async () => {
    const emb = new OnnxEmbedding('/nonexistent/path');
    await expect(emb.embed('test')).rejects.toThrow('not initialized');
  });

  it('returns correct model directory', () => {
    const emb = new OnnxEmbedding('/custom/path');
    expect(emb.getModelDir()).toBe('/custom/path');
  });
});
