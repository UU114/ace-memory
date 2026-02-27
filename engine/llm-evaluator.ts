import { aceLog, aceWarn } from '../shared/logger.js';
import type { KnowledgeType } from '../types/bullet.js';

// LLM evaluation result
export interface LLMEvaluation {
  should_record: boolean;
  category: KnowledgeType;
  score: number; // 0-100
  reason: string;
}

const VALID_CATEGORIES: KnowledgeType[] = ['Method', 'Trick', 'Pitfall', 'Preference', 'Knowledge'];

// LLM-based knowledge quality evaluation
// Default OFF — requires anthropic_api_key and llm_evaluate: true in config
export class LLMEvaluator {
  private client: any | null = null;
  private model: string;
  private timeoutMs: number;

  constructor(config: {
    apiKey?: string;
    model?: 'haiku' | 'sonnet';
    timeoutMs?: number;
  }) {
    this.model =
      config.model === 'sonnet'
        ? 'claude-sonnet-4-6'
        : 'claude-haiku-4-5-20251001';
    this.timeoutMs = config.timeoutMs ?? 5000;

    if (config.apiKey && config.apiKey.startsWith('sk-ant-')) {
      try {
        // Dynamic import to avoid crash when SDK not installed
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const Anthropic = require('@anthropic-ai/sdk');
        this.client = new Anthropic({ apiKey: config.apiKey });
        aceLog('LLMEvaluator: initialized');
      } catch {
        aceWarn('LLMEvaluator: @anthropic-ai/sdk not installed, LLM evaluation disabled');
        this.client = null;
      }
    }
  }

  // Check if the LLM client is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  // Evaluate knowledge candidate quality
  // Returns evaluation result or null on failure/timeout
  async evaluate(
    content: string,
    context: {
      pattern_type: string;
      tool_name?: string;
      file_path?: string;
    },
  ): Promise<LLMEvaluation | null> {
    if (!this.client) return null;

    const prompt = `You are a developer knowledge quality evaluator. Assess whether this developer interaction contains knowledge worth remembering.

Content: ${content}
Pattern type: ${context.pattern_type}
${context.tool_name ? `Tool: ${context.tool_name}` : ''}
${context.file_path ? `File: ${context.file_path}` : ''}

Respond with ONLY valid JSON:
{
  "should_record": true/false,
  "category": "Method|Trick|Pitfall|Preference|Knowledge",
  "score": 0-100,
  "reason": "brief explanation"
}

Scoring guidelines:
- 80-100: Highly specific, actionable insight that would save time
- 60-79: Useful knowledge with some specificity
- 40-59: Generic but potentially helpful
- 20-39: Too vague or common knowledge
- 0-19: Not worth recording (boilerplate, trivial)

Reject (should_record: false) if:
- Content is trivial (e.g., "ran ls", "read a file")
- Content is too generic (e.g., "use git")
- Content is temporary/session-specific`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 256,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal },
      );

      clearTimeout(timer);

      const text = response.content?.[0]?.text?.trim();
      if (!text) return null;

      return this.parseResponse(text);
    } catch (err: any) {
      aceWarn(`LLMEvaluator: API call failed - ${err.message}`);
      return null;
    }
  }

  // Parse and validate LLM response JSON
  private parseResponse(text: string): LLMEvaluation | null {
    try {
      // Strip markdown code fences if present
      const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      const parsed = JSON.parse(cleaned);

      if (typeof parsed.should_record !== 'boolean') return null;
      if (typeof parsed.score !== 'number') return null;

      // Clamp score to 0-100
      const score = Math.max(0, Math.min(100, Math.round(parsed.score)));

      // Validate category, fallback to 'Knowledge'
      const category: KnowledgeType = VALID_CATEGORIES.includes(parsed.category)
        ? parsed.category
        : 'Knowledge';

      const reason = typeof parsed.reason === 'string' ? parsed.reason : '';

      return {
        should_record: parsed.should_record,
        category,
        score,
        reason,
      };
    } catch {
      aceWarn('LLMEvaluator: failed to parse response JSON');
      return null;
    }
  }
}
