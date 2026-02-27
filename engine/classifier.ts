import type { KnowledgeType } from '../types/bullet.js';
import { aceLog } from '../shared/logger.js';

// Result of content classification
export interface ClassifyResult {
  knowledge_type: KnowledgeType;
  instructivity_score: number;  // 0-100
  rejected: boolean;
  reason?: string;
}

// Keyword sets for knowledge type detection (priority order)
const PITFALL_KEYWORDS = /\b(error|bug|fix|wrong|issue|fail|crash)\b/i;
const SOLUTION_CONTEXT = /\b(solution|solve|resolv|fix|workaround|instead|correct|should|must|avoid|prevent|because|caused)\b/i;
const METHOD_KEYWORDS = /\b(how to|steps|pattern|approach|procedure|method|process|implement|workflow|guide)\b/i;
const TRICK_KEYWORDS = /\b(tip|shortcut|faster|instead of|quick|hack|trick|optimization|efficient)\b/i;
const PREFERENCE_KEYWORDS = /\b(always|never|prefer|convention|use .+ not|style|standard|rule|consistent)\b/i;

// Indicators for scoring dimensions
const SPECIFICITY_INDICATORS = /\b(specifically|exactly|must|require|always|never|ensure|when .+ then|if .+ then)\b/gi;
const ACTIONABILITY_INDICATORS = /\b(use|run|add|set|change|configure|install|create|update|remove|apply|import|export)\b/gi;
const UNIQUENESS_INDICATORS = /\b(gotcha|caveat|note|important|tricky|subtle|undocumented|workaround|edge case)\b/gi;

// Default minimum quality threshold
const DEFAULT_MIN_QUALITY = 30;

export class Classifier {
  private minQuality: number;

  constructor(minQuality?: number) {
    this.minQuality = minQuality ?? DEFAULT_MIN_QUALITY;
  }

  classify(content: string, isDistilled?: boolean): ClassifyResult {
    const knowledgeType = this.detectKnowledgeType(content);
    const score = this.computeScore(content, isDistilled ?? false);
    const rejected = score < this.minQuality;

    const result: ClassifyResult = {
      knowledge_type: knowledgeType,
      instructivity_score: Math.round(score),
      rejected,
    };

    if (rejected) {
      result.reason = `Score ${Math.round(score)} below minimum threshold ${this.minQuality}`;
    }

    return result;
  }

  private detectKnowledgeType(content: string): KnowledgeType {
    // Priority 1: Pitfall (error keywords + solution context)
    if (PITFALL_KEYWORDS.test(content) && SOLUTION_CONTEXT.test(content)) {
      return 'Pitfall';
    }

    // Priority 2: Method (describes procedure/approach)
    if (METHOD_KEYWORDS.test(content)) {
      return 'Method';
    }

    // Priority 3: Trick (short optimization/shortcut)
    if (TRICK_KEYWORDS.test(content)) {
      return 'Trick';
    }

    // Priority 4: Preference (user preference/convention)
    if (PREFERENCE_KEYWORDS.test(content)) {
      return 'Preference';
    }

    // Priority 5: Default fallback
    return 'Knowledge';
  }

  private computeScore(content: string, isDistilled: boolean): number {
    // Base score from content analysis
    const specificity = (content.match(SPECIFICITY_INDICATORS) || []).length;
    const actionability = (content.match(ACTIONABILITY_INDICATORS) || []).length;
    const uniqueness = (content.match(UNIQUENESS_INDICATORS) || []).length;

    // Base score: weighted sum of indicator counts, capped at 80
    let baseScore = Math.min(
      80,
      specificity * 8 + actionability * 6 + uniqueness * 10,
    );

    // Short content penalty: very short content (< 20 chars) gets penalized
    if (content.trim().length < 20) {
      baseScore = Math.min(baseScore, 15);
    }

    // Content density adjustment
    const density = this.computeContentDensity(content);
    const finalScore = baseScore * (0.6 + 0.4 * density / 100);

    // Distilled content bonus
    const adjusted = isDistilled ? finalScore + 5 : finalScore;

    // Clamp to 0-100
    return Math.max(0, Math.min(100, adjusted));
  }

  private computeContentDensity(content: string): number {
    if (content.length === 0) return 0;
    const nonWhitespace = content.replace(/\s/g, '').length;
    return (nonWhitespace / content.length) * 100;
  }
}
