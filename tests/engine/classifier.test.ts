import { describe, it, expect } from 'vitest';
import { Classifier } from '../../engine/classifier.js';
import type { ClassifyResult } from '../../engine/classifier.js';

describe('Classifier', () => {
  const classifier = new Classifier();

  // ---- Knowledge type detection ----
  describe('knowledge type detection', () => {
    it('classifies Pitfall when error keywords + solution context present', () => {
      const content = 'When you encounter a "TypeError: cannot read property" error, the fix is to add a null check before accessing the property.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Pitfall');
    });

    it('classifies Method when procedure/approach described', () => {
      const content = 'How to set up a TypeScript project: Step 1, initialize npm. Step 2, install TypeScript. Step 3, create tsconfig.json.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Method');
    });

    it('classifies Trick when short optimization described', () => {
      const content = 'Quick tip: use Object.fromEntries instead of manual loops for faster object construction.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Trick');
    });

    it('classifies Preference when convention described', () => {
      const content = 'Always use single quotes for string literals. This is our convention for consistency across the codebase.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Preference');
    });

    it('falls back to Knowledge for generic content', () => {
      const content = 'TypeScript supports generics and union types for flexible type definitions.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Knowledge');
    });

    it('prioritizes Pitfall over Method when both match', () => {
      const content = 'How to fix the bug: follow these steps to resolve the crash when the module fails to load.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Pitfall');
    });

    it('prioritizes Method over Trick when both match', () => {
      const content = 'Here is a quick approach with detailed steps: use the pattern to configure the build system efficiently.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Method');
    });
  });

  // ---- Score computation ----
  describe('score computation', () => {
    it('scores content based on specificity, actionability, uniqueness', () => {
      const content = 'When using vitest, you must always configure the globals option. Use the defineConfig helper to set it up correctly. Note: this is a subtle gotcha with the test runner.';
      const result = classifier.classify(content);
      expect(result.instructivity_score).toBeGreaterThan(30);
    });

    it('applies content density penalty for whitespace-heavy content', () => {
      const dense = 'Use strict mode. Configure TypeScript. Add vitest. Run tests. Create types.';
      const sparse = 'Use    strict    mode.    Configure    TypeScript.    Add    vitest.    Run    tests.    Create    types.';
      const denseResult = classifier.classify(dense);
      const sparseResult = classifier.classify(sparse);
      // Dense content should score same or higher than sparse content
      expect(denseResult.instructivity_score).toBeGreaterThanOrEqual(sparseResult.instructivity_score);
    });

    it('computes density correctly for pure whitespace', () => {
      const content = '                    ';
      const result = classifier.classify(content);
      // Very low density, very short effective content → low score
      expect(result.instructivity_score).toBeLessThanOrEqual(30);
    });
  });

  // ---- Distilled bonus ----
  describe('distilled content bonus', () => {
    it('applies +5 bonus for distilled content', () => {
      const content = 'When configuring TypeScript strict mode, you must enable noImplicitAny to catch implicit any types.';
      const normal = classifier.classify(content, false);
      const distilled = classifier.classify(content, true);
      expect(distilled.instructivity_score).toBe(normal.instructivity_score + 5);
    });

    it('defaults isDistilled to false when omitted', () => {
      const content = 'When configuring TypeScript strict mode, you must enable noImplicitAny to catch implicit any types.';
      const noArg = classifier.classify(content);
      const explicitFalse = classifier.classify(content, false);
      expect(noArg.instructivity_score).toBe(explicitFalse.instructivity_score);
    });
  });

  // ---- Low score rejection ----
  describe('low score rejection', () => {
    it('rejects content with score below default threshold (30)', () => {
      const content = 'ok';
      const result = classifier.classify(content);
      expect(result.rejected).toBe(true);
      expect(result.reason).toContain('below minimum threshold');
    });

    it('accepts content with score above threshold', () => {
      const content = 'When you encounter this error, you must specifically use the workaround: add the import statement and configure the module resolver to ensure correct resolution.';
      const result = classifier.classify(content);
      expect(result.rejected).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it('respects custom minQuality threshold', () => {
      const strict = new Classifier(80);
      const content = 'Use TypeScript for type safety in projects.';
      const result = strict.classify(content);
      // With a very high threshold, moderately scored content should be rejected
      expect(result.rejected).toBe(true);
    });

    it('accepts everything with minQuality = 0', () => {
      const lenient = new Classifier(0);
      const content = 'x';
      const result = lenient.classify(content);
      expect(result.rejected).toBe(false);
    });
  });

  // ---- Very short content ----
  describe('very short content handling', () => {
    it('penalizes very short content (< 20 chars)', () => {
      const short = 'use strict';
      const result = classifier.classify(short);
      expect(result.instructivity_score).toBeLessThanOrEqual(20);
    });

    it('handles empty content without crashing', () => {
      const result = classifier.classify('');
      expect(result.instructivity_score).toBe(0);
      expect(result.rejected).toBe(true);
      expect(result.knowledge_type).toBe('Knowledge');
    });
  });

  // ---- 100% code content ----
  describe('code-heavy content', () => {
    it('scores code-only content based on density', () => {
      const code = 'const x = 1;\nconst y = 2;\nconst z = x + y;\nconsole.log(z);';
      const result = classifier.classify(code);
      // Pure code without explanatory keywords gets a lower base score
      // but density is high, so score depends on indicator matches
      expect(result.knowledge_type).toBe('Knowledge');
    });
  });

  // ---- Default Knowledge fallback ----
  describe('default fallback', () => {
    it('returns Knowledge for plain factual statements', () => {
      const content = 'JavaScript was created in 1995 by Brendan Eich at Netscape Communications.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Knowledge');
    });

    it('returns Knowledge for content with no matching keywords', () => {
      const content = 'The weather today is sunny with a high of 25 degrees.';
      const result = classifier.classify(content);
      expect(result.knowledge_type).toBe('Knowledge');
    });
  });

  // ---- Score clamping ----
  describe('score boundaries', () => {
    it('never returns score above 100', () => {
      // Content packed with indicators
      const content = 'You must specifically always ensure exactly that when you use and run and add and set and change and configure and install and create and update and remove this important gotcha caveat note tricky subtle workaround edge case.';
      const result = classifier.classify(content, true);
      expect(result.instructivity_score).toBeLessThanOrEqual(100);
    });

    it('never returns score below 0', () => {
      const result = classifier.classify('');
      expect(result.instructivity_score).toBeGreaterThanOrEqual(0);
    });
  });
});
