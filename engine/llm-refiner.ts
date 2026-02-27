import { aceLog, aceWarn } from '../shared/logger.js';
import type { KnowledgeType } from '../types/bullet.js';

// LLM-based distilled_rule refinement
// Converts raw knowledge content into concise "When X, do Y because Z" rules
// Default OFF — requires anthropic_api_key and llm_evaluate: true in config
export class LLMRefiner {
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
        aceLog('LLMRefiner: initialized');
      } catch {
        aceWarn(
          'LLMRefiner: @anthropic-ai/sdk not installed, LLM features disabled',
        );
        this.client = null;
      }
    }
  }

  // Check if the LLM client is available
  isAvailable(): boolean {
    return this.client !== null;
  }

  // Refine a bullet's content into a concise distilled rule
  // Returns the refined text or null on failure/timeout
  async refine(bullet: {
    content: string;
    knowledge_type: KnowledgeType;
    code_content: string | null;
    key_entities: string[];
  }): Promise<string | null> {
    if (!this.client) return null;

    const prompt = `You are a knowledge distillation assistant. Convert the following developer knowledge into a concise rule.

Format: "When [situation], do [action] because [reason]"

Knowledge type: ${bullet.knowledge_type}
Content: ${bullet.content}
${bullet.code_content ? `Code: ${bullet.code_content}` : ''}
${bullet.key_entities.length ? `Entities: ${bullet.key_entities.join(', ')}` : ''}

Output ONLY the distilled rule, nothing else. Keep it under 200 characters.`;

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

      // Truncate to 500 chars max
      return text.slice(0, 500);
    } catch (err: any) {
      aceWarn(`LLMRefiner: API call failed - ${err.message}`);
      return null;
    }
  }
}
