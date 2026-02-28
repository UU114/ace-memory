import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '../../engine/reflector.js';
import type { DistilledBullet } from '../../engine/reflector.js';
import { Sanitizer } from '../../engine/sanitizer.js';
import { Classifier } from '../../engine/classifier.js';
import type { SessionQueueEntry } from '../../types/hook.js';

// Mock OnnxEmbedding
function createMockEmbedding(initialized = false) {
  return {
    initialized,
    embed: vi.fn().mockResolvedValue(new Float32Array(384).fill(0.1)),
    embedBatch: vi.fn().mockResolvedValue([new Float32Array(384).fill(0.1)]),
  } as any;
}

// Helper to create a SessionQueueEntry
function makeEntry(overrides: Partial<SessionQueueEntry> = {}): SessionQueueEntry {
  return {
    timestamp: new Date().toISOString(),
    tool_name: 'Edit',
    pattern_type: 'error_fix',
    summary: 'add null check before accessing property',
    context: {
      error_message: 'TypeError: cannot read property of undefined',
    },
    processed: false,
    ...overrides,
  };
}

describe('Reflector', () => {
  let sanitizer: Sanitizer;
  // Use Classifier(0) for most tests to isolate Reflector logic from classifier scoring.
  // Classifier rejection is tested separately with a realistic threshold.
  let lenientClassifier: Classifier;

  beforeEach(() => {
    sanitizer = new Sanitizer();
    lenientClassifier = new Classifier(0);
  });

  // ---- Content distillation for each pattern type ----
  describe('content distillation', () => {
    it('distills error_fix entries correctly', async () => {
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'add null check before accessing the property to avoid crashes',
        context: {
          error_message: 'TypeError: cannot read property of undefined',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].content).toContain('encountering');
      expect(bullets[0].content).toContain('add null check');
    });

    it('distills code_pattern entries correctly', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'the pattern of using async/await with error handling for robust async operations',
        context: {
          language: 'typescript',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].content).toContain('typescript');
      expect(bullets[0].content).toContain('Apply and use this correctly');
    });

    it('distills command_usage entries correctly', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the test suite with verbose output to diagnose test failures quickly',
        context: {
          command: 'npx vitest run --reporter verbose',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].content).toContain('`npx vitest run --reporter verbose`');
      expect(bullets[0].content).toContain('running the test suite');
    });

    it('distills file_creation entries correctly', async () => {
      const entry = makeEntry({
        pattern_type: 'file_creation',
        summary: 'the standard configuration for TypeScript strict mode and module resolution settings',
        context: {
          file: 'tsconfig.json',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].content).toContain('tsconfig.json');
      expect(bullets[0].content).toContain('Apply this approach');
    });

    it('uses fallback for unknown pattern types', async () => {
      const entry = makeEntry({
        pattern_type: 'unknown_type' as any,
        summary: 'some important note about configuring the build process correctly',
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      // Fallback uses summary directly
      expect(bullets[0].content).toBe('some important note about configuring the build process correctly');
    });
  });

  // ---- Content length enforcement ----
  describe('content length enforcement', () => {
    it('truncates content to 500 characters', async () => {
      const longSummary = 'x'.repeat(600);
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: longSummary,
        context: {
          error_message: 'SomeError',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].content.length).toBeLessThanOrEqual(500);
    });
  });

  // ---- Entity extraction ----
  describe('entity extraction', () => {
    it('extracts CamelCase words from content', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'use the SessionQueueEntry and DistilledBullet types to ensure type safety in processing',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].key_entities).toContain('SessionQueueEntry');
      expect(bullets[0].key_entities).toContain('DistilledBullet');
    });

    it('extracts backtick-quoted strings from content', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running `vitest` and `tsc --noEmit` for validation in the CI pipeline ensures code correctness',
        context: { command: 'vitest' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].key_entities).toContain('vitest');
      expect(bullets[0].key_entities).toContain('tsc --noEmit');
    });

    it('extracts import/require references from content', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: "use import 'lodash' and require('express') to handle utility functions and server setup properly",
        context: { language: 'javascript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].key_entities).toContain('lodash');
      expect(bullets[0].key_entities).toContain('express');
    });
  });

  // ---- Scope inference ----
  describe('scope inference', () => {
    it('infers project scope when file references project name', async () => {
      const entry = makeEntry({
        pattern_type: 'file_creation',
        summary: 'the configuration for handling module resolution and strict type checking settings',
        context: {
          file: 'myapp/src/config.ts',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'myapp');

      expect(bullets.length).toBe(1);
      expect(bullets[0].scope).toBe('project:myapp');
    });

    it('infers global scope when no project references', async () => {
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'apply the workaround by checking for null before accessing nested properties to prevent crashes',
        context: {
          error_message: 'TypeError',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'myapp');

      expect(bullets.length).toBe(1);
      expect(bullets[0].scope).toBe('global');
    });

    it('infers project scope for relative file paths', async () => {
      const entry = makeEntry({
        pattern_type: 'file_creation',
        summary: 'proper configuration setup with all required fields and validation logic for the project',
        context: {
          file: './src/config.ts',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'demo');

      expect(bullets.length).toBe(1);
      expect(bullets[0].scope).toBe('project:demo');
    });

    it('infers project scope for src/ paths', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'the recommended pattern for handling async operations with proper error boundaries and retries',
        context: {
          file: 'src/utils/async.ts',
          language: 'typescript',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'demo');

      expect(bullets.length).toBe(1);
      expect(bullets[0].scope).toBe('project:demo');
    });
  });

  // ---- Section mapping ----
  describe('section mapping from knowledge type', () => {
    it('maps Pitfall to pitfalls section', async () => {
      // error + solution keywords to trigger Pitfall classification
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'the fix is to avoid the bug by checking the error condition because the crash is caused by missing null check',
        context: { error_message: 'the error caused a crash that must be resolved with a workaround' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].knowledge_type).toBe('Pitfall');
      expect(bullets[0].section).toBe('pitfalls');
    });

    it('maps Method to methods section', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'the step-by-step approach and procedure to implement the method for proper module configuration workflow',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].knowledge_type).toBe('Method');
      expect(bullets[0].section).toBe('methods');
    });

    it('maps Trick to techniques section', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'a quick shortcut tip: use faster destructuring instead of manual property access for efficient code',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].knowledge_type).toBe('Trick');
      expect(bullets[0].section).toBe('techniques');
    });

    it('maps Preference to preferences section', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'always prefer using single quotes and never use double quotes for string literal convention consistency',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].knowledge_type).toBe('Preference');
      expect(bullets[0].section).toBe('preferences');
    });

    it('maps Knowledge to knowledge section (fallback)', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'TypeScript supports generics and union types for flexible type definitions in modern applications',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].knowledge_type).toBe('Knowledge');
      expect(bullets[0].section).toBe('knowledge');
    });
  });

  // ---- Pipeline: sanitizer rejects dirty content ----
  describe('sanitizer rejection', () => {
    it('skips entries with dirty content (secrets)', async () => {
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'configure API with key sk-abcdefghijklmnopqrstuvwxyz1234567890',
        context: { error_message: 'Auth error' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets, skipped } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(0);
      expect(skipped).toBe(1);
    });
  });

  // ---- Pipeline: classifier rejects low quality ----
  describe('classifier rejection', () => {
    it('skips entries classified as low quality', async () => {
      // Very short, uninformative content with high threshold
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'ok',
        context: { error_message: 'e' },
      });

      const strictClassifier = new Classifier(80);
      const reflector = new Reflector(sanitizer, strictClassifier, null);
      const { bullets, skipped } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(0);
      expect(skipped).toBe(1);
    });

    it('accepts entries that pass the classifier threshold', async () => {
      // Content with many actionable keywords
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'you must specifically always ensure to add the import, configure the module, and use the workaround when encountering this subtle gotcha',
        context: { error_message: 'the error caused a crash that requires a fix' },
      });

      const moderateClassifier = new Classifier(30);
      const reflector = new Reflector(sanitizer, moderateClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
    });
  });

  // ---- Pipeline: clean content passes through ----
  describe('clean content passes through', () => {
    it('produces a DistilledBullet for valid entries', async () => {
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'apply the workaround by adding null check specifically before accessing nested properties to avoid the crash',
        context: {
          error_message: 'TypeError: cannot read property of undefined',
          file: 'src/utils.ts',
          language: 'typescript',
        },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets, skipped } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(skipped).toBe(0);

      const b = bullets[0];
      expect(b.source_type).toBe('auto');
      expect(b.related_tools).toContain('Edit');
      expect(b.related_files).toContain('src/utils.ts');
      expect(b.tags).toContain('error_fix');
      expect(b.tags).toContain('typescript');
      expect(b.embedding).toBeNull(); // No ONNX
      expect(b.distilled_rule).toBe(b.content);
    });
  });

  // ---- Embedding ----
  describe('embedding handling', () => {
    it('skips embedding when ONNX is unavailable', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the complete test suite with verbose output to diagnose intermittent test failures',
        context: { command: 'npx vitest run' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].embedding).toBeNull();
    });

    it('computes embedding when ONNX is available', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the complete test suite with verbose output to diagnose intermittent test failures',
        context: { command: 'npx vitest run' },
      });

      const mockEmbed = createMockEmbedding(true);
      const reflector = new Reflector(sanitizer, lenientClassifier, mockEmbed);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].embedding).toBeInstanceOf(Float32Array);
      expect(mockEmbed.embed).toHaveBeenCalled();
    });

    it('handles embedding errors gracefully', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the complete test suite with verbose output to diagnose intermittent test failures',
        context: { command: 'npx vitest run' },
      });

      const mockEmbed = createMockEmbedding(true);
      mockEmbed.embed.mockRejectedValue(new Error('ONNX failure'));

      const reflector = new Reflector(sanitizer, lenientClassifier, mockEmbed);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].embedding).toBeNull();
    });

    it('passes through with non-initialized embedding (null-like)', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the test suite for verification and diagnosis of failures in continuous integration',
        context: { command: 'npm test' },
      });

      const mockEmbed = createMockEmbedding(false); // initialized = false
      const reflector = new Reflector(sanitizer, lenientClassifier, mockEmbed);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].embedding).toBeNull();
      expect(mockEmbed.embed).not.toHaveBeenCalled();
    });
  });

  // ---- Multiple entries ----
  describe('multiple entries', () => {
    it('processes multiple entries and counts skipped correctly', async () => {
      const goodEntry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'apply the workaround by checking null and resolving the error before accessing nested properties',
        context: { error_message: 'TypeError: cannot read property' },
      });

      const badEntry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'set token sk-abcdefghijklmnopqrstuvwxyz1234567890 in config',
        context: { error_message: 'Auth error' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets, skipped } = await reflector.distill([goodEntry, badEntry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(skipped).toBe(1);
    });

    it('returns empty when all entries are skipped', async () => {
      const bad1 = makeEntry({
        pattern_type: 'error_fix',
        summary: 'set token sk-abcdefghijklmnopqrstuvwxyz1234567890 in config',
        context: { error_message: 'Auth error' },
      });
      const bad2 = makeEntry({
        pattern_type: 'error_fix',
        summary: 'use ghp_abcdefghijklmnopqrstuvwxyz1234567890AB for access',
        context: { error_message: 'Auth' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets, skipped } = await reflector.distill([bad1, bad2], 'test-project');

      expect(bullets.length).toBe(0);
      expect(skipped).toBe(2);
    });

    it('handles empty input array', async () => {
      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets, skipped } = await reflector.distill([], 'test-project');

      expect(bullets.length).toBe(0);
      expect(skipped).toBe(0);
    });
  });

  // ---- Tags ----
  describe('tags extraction', () => {
    it('includes pattern_type in tags', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the complete test suite with verbose output to diagnose intermittent test failures',
        context: { command: 'npm test' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].tags).toContain('command_usage');
    });

    it('includes language in tags when present', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'the pattern of using async/await with error handling and retry logic for robust operations',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].tags).toContain('code_pattern');
      expect(bullets[0].tags).toContain('typescript');
    });

    it('omits language from tags when not present', async () => {
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'check for null before accessing properties to prevent runtime errors in the application',
        context: { error_message: 'NullPointer' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].tags).toEqual(['error_fix']);
    });
  });

  // ---- LLM refinement integration ----
  describe('LLM refinement', () => {
    it('uses LLM-refined distilled_rule for high-score bullets', async () => {
      const mockRefiner = {
        isAvailable: () => true,
        refine: vi.fn().mockResolvedValue('When X, do Y because Z'),
      } as any;

      // Entry that triggers high-score classification
      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary:
          'you must specifically always ensure to add the import, configure the module, and use the workaround when encountering this subtle gotcha',
        context: {
          error_message:
            'the error caused a crash that requires a fix, and the solution must be applied',
        },
      });

      const reflector = new Reflector(
        sanitizer,
        lenientClassifier,
        null,
        mockRefiner,
        30, // Low threshold to ensure LLM triggers
      );
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].distilled_rule).toBe('When X, do Y because Z');
      expect(mockRefiner.refine).toHaveBeenCalled();
    });

    it('keeps original distilled_rule when score below threshold', async () => {
      const mockRefiner = {
        isAvailable: () => true,
        refine: vi.fn(),
      } as any;

      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary:
          'running the complete test suite with verbose output to diagnose failures',
        context: { command: 'npm test' },
      });

      const reflector = new Reflector(
        sanitizer,
        lenientClassifier,
        null,
        mockRefiner,
        99, // Very high threshold — LLM won't trigger
      );
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].distilled_rule).toBe(bullets[0].content);
      expect(mockRefiner.refine).not.toHaveBeenCalled();
    });

    it('falls back to original when refiner returns null', async () => {
      const mockRefiner = {
        isAvailable: () => true,
        refine: vi.fn().mockResolvedValue(null),
      } as any;

      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary:
          'you must specifically always ensure to add the import and configure the module for this subtle gotcha workaround',
        context: {
          error_message: 'the error crash requires a fix solution',
        },
      });

      const reflector = new Reflector(
        sanitizer,
        lenientClassifier,
        null,
        mockRefiner,
        0,
      );
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].distilled_rule).toBe(bullets[0].content);
    });

    it('works without refiner (backward compatible)', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary:
          'running the complete test suite with verbose output to diagnose failures',
        context: { command: 'npm test' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].distilled_rule).toBe(bullets[0].content);
    });
  });

  // ---- LLM evaluation integration ----
  describe('LLM evaluation', () => {
    it('overrides classifier result when evaluator returns should_record true', async () => {
      const mockEvaluator = {
        isAvailable: () => true,
        evaluate: vi.fn().mockResolvedValue({
          should_record: true,
          category: 'Trick',
          score: 92,
          reason: 'Highly actionable trick',
        }),
      } as any;

      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'TypeScript supports generics for type definitions in applications',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(
        sanitizer,
        lenientClassifier,
        null,
        null, // no refiner
        undefined,
        mockEvaluator,
      );
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].knowledge_type).toBe('Trick');
      expect(bullets[0].instructivity_score).toBe(92);
      expect(bullets[0].section).toBe('techniques'); // mapped from Trick
      expect(mockEvaluator.evaluate).toHaveBeenCalled();
    });

    it('skips entry when evaluator returns should_record false', async () => {
      const mockEvaluator = {
        isAvailable: () => true,
        evaluate: vi.fn().mockResolvedValue({
          should_record: false,
          category: 'Knowledge',
          score: 10,
          reason: 'Too trivial',
        }),
      } as any;

      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running ls command to list files in the current directory',
        context: { command: 'ls' },
      });

      const reflector = new Reflector(
        sanitizer,
        lenientClassifier,
        null,
        null,
        undefined,
        mockEvaluator,
      );
      const { bullets, skipped } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(0);
      expect(skipped).toBe(1);
    });

    it('falls back to heuristic when evaluator returns null', async () => {
      const mockEvaluator = {
        isAvailable: () => true,
        evaluate: vi.fn().mockResolvedValue(null),
      } as any;

      const entry = makeEntry({
        pattern_type: 'error_fix',
        summary: 'apply the workaround by checking null and resolving the error before accessing nested properties',
        context: { error_message: 'the error caused a crash that requires a fix' },
      });

      const reflector = new Reflector(
        sanitizer,
        lenientClassifier,
        null,
        null,
        undefined,
        mockEvaluator,
      );
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      // Heuristic result used — Pitfall from error keywords
      expect(bullets[0].knowledge_type).toBe('Pitfall');
    });

    it('falls back to heuristic when evaluator throws', async () => {
      const mockEvaluator = {
        isAvailable: () => true,
        evaluate: vi.fn().mockRejectedValue(new Error('API timeout')),
      } as any;

      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'the step-by-step approach and procedure to implement the method for configuration',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(
        sanitizer,
        lenientClassifier,
        null,
        null,
        undefined,
        mockEvaluator,
      );
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      // Heuristic used — Method from keywords
      expect(bullets[0].knowledge_type).toBe('Method');
    });

    it('works without evaluator (backward compatible)', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the complete test suite with verbose output to diagnose failures',
        context: { command: 'npm test' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
    });
  });

  // ---- Code content extraction ----
  describe('code content extraction', () => {
    it('extracts code language from context', async () => {
      const entry = makeEntry({
        pattern_type: 'code_pattern',
        summary: 'use ```typescript\nconst x = 1;\n``` for initialization in strict mode modules',
        context: { language: 'typescript' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].code_language).toBe('typescript');
    });

    it('infers language from file extension when not specified', async () => {
      const entry = makeEntry({
        pattern_type: 'file_creation',
        summary: 'create the proper configuration with all required fields',
        context: { file: 'src/config.py' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].code_language).toBe('python');
    });

    it('returns null code for non-code pattern types', async () => {
      const entry = makeEntry({
        pattern_type: 'command_usage',
        summary: 'running the build process with verbose logging for debugging purposes',
        context: { command: 'npm run build' },
      });

      const reflector = new Reflector(sanitizer, lenientClassifier, null);
      const { bullets } = await reflector.distill([entry], 'test-project');

      expect(bullets.length).toBe(1);
      expect(bullets[0].code_content).toBeNull();
    });
  });
});
