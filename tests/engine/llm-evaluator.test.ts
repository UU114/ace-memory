import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMEvaluator } from '../../engine/llm-evaluator.js';

describe('LLMEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('is unavailable without API key', () => {
      const evaluator = new LLMEvaluator({});
      expect(evaluator.isAvailable()).toBe(false);
    });

    it('is unavailable with invalid API key format', () => {
      const evaluator = new LLMEvaluator({ apiKey: 'invalid-key' });
      expect(evaluator.isAvailable()).toBe(false);
    });

    it('is unavailable with empty API key', () => {
      const evaluator = new LLMEvaluator({ apiKey: '' });
      expect(evaluator.isAvailable()).toBe(false);
    });

    it('is unavailable when SDK not installed', () => {
      const evaluator = new LLMEvaluator({ apiKey: 'sk-ant-test123' });
      expect(evaluator.isAvailable()).toBe(false);
    });
  });

  describe('evaluate without client', () => {
    it('returns null when client is unavailable', async () => {
      const evaluator = new LLMEvaluator({});
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });
      expect(result).toBeNull();
    });
  });

  describe('evaluate with injected mock client', () => {
    function createEvaluatorWithMock(mockCreate: any): LLMEvaluator {
      const evaluator = new LLMEvaluator({});
      (evaluator as any).client = {
        messages: { create: mockCreate },
      };
      return evaluator;
    }

    it('returns evaluation on valid JSON response', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: true,
            category: 'Pitfall',
            score: 85,
            reason: 'Specific error handling insight',
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      expect(evaluator.isAvailable()).toBe(true);

      const result = await evaluator.evaluate('When TypeError occurs, add null check', {
        pattern_type: 'error_fix',
        tool_name: 'Write',
      });

      expect(result).not.toBeNull();
      expect(result!.should_record).toBe(true);
      expect(result!.category).toBe('Pitfall');
      expect(result!.score).toBe(85);
      expect(result!.reason).toBe('Specific error handling insight');
      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it('returns should_record false when LLM rejects', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: false,
            category: 'Knowledge',
            score: 10,
            reason: 'Too trivial',
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('ran ls command', { pattern_type: 'command_usage' });

      expect(result!.should_record).toBe(false);
      expect(result!.score).toBe(10);
      expect(result!.reason).toBe('Too trivial');
    });

    it('returns null on API error', async () => {
      const mockCreate = vi.fn().mockRejectedValue(new Error('Rate limited'));

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result).toBeNull();
    });

    it('returns null on empty response content', async () => {
      const mockCreate = vi.fn().mockResolvedValue({ content: [] });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result).toBeNull();
    });

    it('returns null on empty text', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ text: '' }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result).toBeNull();
    });

    it('returns null on invalid JSON response', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{ text: 'This is not JSON at all' }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result).toBeNull();
    });

    it('returns null when response missing should_record', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({ category: 'Method', score: 50, reason: 'ok' }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result).toBeNull();
    });

    it('returns null when response missing score', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({ should_record: true, category: 'Method', reason: 'ok' }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result).toBeNull();
    });

    it('clamps score above 100 to 100', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: true,
            category: 'Method',
            score: 150,
            reason: 'very high',
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result!.score).toBe(100);
    });

    it('clamps negative score to 0', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: false,
            category: 'Knowledge',
            score: -10,
            reason: 'terrible',
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result!.score).toBe(0);
    });

    it('falls back to Knowledge for unknown category', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: true,
            category: 'InvalidType',
            score: 60,
            reason: 'unknown type',
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result!.category).toBe('Knowledge');
    });

    it('handles response wrapped in markdown code fences', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: '```json\n' + JSON.stringify({
            should_record: true,
            category: 'Trick',
            score: 75,
            reason: 'neat trick',
          }) + '\n```',
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result!.category).toBe('Trick');
      expect(result!.score).toBe(75);
    });

    it('uses haiku model by default', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: true,
            category: 'Method',
            score: 70,
            reason: 'ok',
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-haiku-4-5-20251001');
    });

    it('includes tool and file in prompt when provided', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: true,
            category: 'Method',
            score: 70,
            reason: 'ok',
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      await evaluator.evaluate('Use async generators', {
        pattern_type: 'code_pattern',
        tool_name: 'Write',
        file_path: 'src/app.ts',
      });

      const callArgs = mockCreate.mock.calls[0][0];
      const promptText = callArgs.messages[0].content;
      expect(promptText).toContain('Tool: Write');
      expect(promptText).toContain('File: src/app.ts');
    });

    it('handles missing reason field gracefully', async () => {
      const mockCreate = vi.fn().mockResolvedValue({
        content: [{
          text: JSON.stringify({
            should_record: true,
            category: 'Method',
            score: 60,
          }),
        }],
      });

      const evaluator = createEvaluatorWithMock(mockCreate);
      const result = await evaluator.evaluate('content', { pattern_type: 'code_pattern' });

      expect(result!.reason).toBe('');
    });
  });
});
