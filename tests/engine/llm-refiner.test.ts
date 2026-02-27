import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMRefiner } from '../../engine/llm-refiner.js';

describe('LLMRefiner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('is unavailable without API key', () => {
      const refiner = new LLMRefiner({});
      expect(refiner.isAvailable()).toBe(false);
    });

    it('is unavailable with invalid API key format', () => {
      const refiner = new LLMRefiner({ apiKey: 'invalid-key-format' });
      expect(refiner.isAvailable()).toBe(false);
    });

    it('is unavailable with empty API key', () => {
      const refiner = new LLMRefiner({ apiKey: '' });
      expect(refiner.isAvailable()).toBe(false);
    });

    it('is unavailable when SDK not installed', () => {
      // @anthropic-ai/sdk is not in dependencies, so require() fails
      const refiner = new LLMRefiner({ apiKey: 'sk-ant-test123' });
      expect(refiner.isAvailable()).toBe(false);
    });
  });

  describe('refine without client', () => {
    it('returns null when client is unavailable', async () => {
      const refiner = new LLMRefiner({});
      const result = await refiner.refine({
        content: 'Some content',
        knowledge_type: 'Knowledge',
        code_content: null,
        key_entities: [],
      });
      expect(result).toBeNull();
    });
  });

  // Test core refine logic by injecting a mock client into the instance
  describe('refine with injected mock client', () => {
    function createRefinerWithMock(mockCreate: any): LLMRefiner {
      const refiner = new LLMRefiner({});
      // Inject mock client directly
      (refiner as any).client = {
        messages: { create: mockCreate },
      };
      return refiner;
    }

    it('returns refined text on successful API call', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [
          {
            text: 'When encountering TypeError, add null checks because undefined properties cause crashes',
          },
        ],
      });

      const refiner = createRefinerWithMock(mockCreate);
      expect(refiner.isAvailable()).toBe(true);

      const result = await refiner.refine({
        content: 'Fix TypeError by adding null check',
        knowledge_type: 'Pitfall',
        code_content: null,
        key_entities: ['TypeError'],
      });

      expect(result).toBe(
        'When encountering TypeError, add null checks because undefined properties cause crashes',
      );
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('returns null on API error', async () => {
      const mockCreate = vi
        .fn()
        .mockRejectedValue(new Error('API quota exceeded'));

      const refiner = createRefinerWithMock(mockCreate);
      const result = await refiner.refine({
        content: 'Some content',
        knowledge_type: 'Method',
        code_content: null,
        key_entities: [],
      });

      expect(result).toBeNull();
    });

    it('returns null on empty response text', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ text: '' }],
      });

      const refiner = createRefinerWithMock(mockCreate);
      const result = await refiner.refine({
        content: 'Some content',
        knowledge_type: 'Trick',
        code_content: null,
        key_entities: [],
      });

      expect(result).toBeNull();
    });

    it('returns null when response content array is empty', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ content: [] });

      const refiner = createRefinerWithMock(mockCreate);
      const result = await refiner.refine({
        content: 'Some content',
        knowledge_type: 'Knowledge',
        code_content: null,
        key_entities: [],
      });

      expect(result).toBeNull();
    });

    it('truncates response to 500 characters', async () => {
      const longText = 'A'.repeat(600);
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ text: longText }],
      });

      const refiner = createRefinerWithMock(mockCreate);
      const result = await refiner.refine({
        content: 'Some content',
        knowledge_type: 'Method',
        code_content: null,
        key_entities: [],
      });

      expect(result).not.toBeNull();
      expect(result!.length).toBe(500);
    });

    it('includes code_content and entities in prompt', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ text: 'Refined rule' }],
      });

      const refiner = createRefinerWithMock(mockCreate);
      await refiner.refine({
        content: 'Use async/await with try-catch',
        knowledge_type: 'Method',
        code_content: 'try { await fetch() } catch {}',
        key_entities: ['async', 'fetch'],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const promptText = callArgs.messages[0].content;
      expect(promptText).toContain('Code: try { await fetch() } catch {}');
      expect(promptText).toContain('Entities: async, fetch');
    });

    it('uses haiku model by default', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ text: 'Rule' }],
      });

      const refiner = createRefinerWithMock(mockCreate);
      await refiner.refine({
        content: 'Test',
        knowledge_type: 'Knowledge',
        code_content: null,
        key_entities: [],
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
    });

    it('trims whitespace from response', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ text: '  When X, do Y because Z  \n' }],
      });

      const refiner = createRefinerWithMock(mockCreate);
      const result = await refiner.refine({
        content: 'Content',
        knowledge_type: 'Knowledge',
        code_content: null,
        key_entities: [],
      });

      expect(result).toBe('When X, do Y because Z');
    });
  });
});
