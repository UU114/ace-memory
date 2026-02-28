import type { Bullet } from '../types/bullet.js';
import type { SearchConfig } from '../types/config.js';
import type { VectorCache } from '../daemon/vector-cache.js';
import { cosineSimilarity } from './embedding.js';

// Search result with scoring breakdown
export interface SearchResult {
  bullet: Bullet;
  keywordScore: number;
  semanticScore: number;
  finalScore: number;
}

// Options for hybrid search
export interface HybridSearchOptions {
  keywordWeight: number;
  semanticWeight: number;
  recencyBoostDays: number;
  recencyBoostFactor: number;
  limit: number;
  minScore: number;
}

// Escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lightweight English stemming (strip common suffixes)
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ing') && w.length > 5) return w.slice(0, -3);
  if (w.endsWith('tion') && w.length > 5) return w.slice(0, -4);
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('er') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('es') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

// Extract Chinese n-grams from text
export function chineseNGrams(text: string, n: number): string[] {
  const chars = text.replace(/[^\u4e00-\u9fff]/g, '');
  const grams: string[] = [];
  for (let i = 0; i <= chars.length - n; i++) {
    grams.push(chars.slice(i, i + n));
  }
  return grams;
}

// Common English stop words to skip during keyword scoring
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up',
  'what', 'which', 'who', 'whom', 'this', 'that', 'these', 'those',
  'am', 'it', 'its', 'my', 'me', 'we', 'our', 'you', 'your', 'he',
  'him', 'his', 'she', 'her', 'they', 'them', 'their', 'i',
]);

// Tokenize query: split on whitespace and punctuation, lowercase
export function tokenize(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 0);
  return tokens;
}

// Tokenize for search: removes stop words for better precision
export function tokenizeForSearch(text: string): string[] {
  return tokenize(text).filter(t => !STOP_WORDS.has(t));
}

// Parse prefix syntax like "tool:git", "tag:react", "lang:typescript"
function extractPrefixFilters(tokens: string[]): {
  prefixTools: string[];
  prefixTags: string[];
  prefixEntities: string[];
  remainingTokens: string[];
} {
  const prefixTools: string[] = [];
  const prefixTags: string[] = [];
  const prefixEntities: string[] = [];
  const remainingTokens: string[] = [];

  for (const token of tokens) {
    if (token.startsWith('tool:') || token.startsWith('cmd:')) {
      prefixTools.push(token.split(':')[1]);
    } else if (token.startsWith('tag:')) {
      prefixTags.push(token.split(':')[1]);
    } else if (token.startsWith('lang:') || token.startsWith('entity:')) {
      prefixEntities.push(token.split(':')[1]);
    } else {
      remainingTokens.push(token);
    }
  }

  return { prefixTools, prefixTags, prefixEntities, remainingTokens };
}

// Score a single bullet against the query
function scoreKeyword(
  queryTokens: string[],
  queryStemmed: string[],
  queryGrams: string[],
  prefixTools: string[],
  prefixTags: string[],
  prefixEntities: string[],
  bullet: Bullet,
): number {
  let score = 0;
  const contentLower = bullet.content.toLowerCase();

  // L1: Exact match in content (+15 per occurrence)
  for (const token of queryTokens) {
    if (token.length < 2) continue;
    try {
      const regex = new RegExp(`\\b${escapeRegex(token)}\\b`, 'gi');
      const matches = bullet.content.match(regex);
      if (matches) score += 15 * matches.length;
    } catch {
      // Fallback for patterns where word boundaries fail (e.g. CJK)
      if (contentLower.includes(token)) score += 15;
    }
  }

  // L2: Stemmed match in content (+5 per match)
  const contentTokens = tokenize(bullet.content);
  const contentStemmed = contentTokens.map(stem);
  for (const qs of queryStemmed) {
    if (qs.length < 2) continue;
    if (contentStemmed.includes(qs)) score += 5;
  }

  // L2: Chinese 2-gram match (+5 per gram overlap)
  if (queryGrams.length > 0) {
    const contentGrams = chineseNGrams(bullet.content, 2);
    const overlap = queryGrams.filter(g => contentGrams.includes(g)).length;
    score += overlap * 5;
  }

  // L3: Metadata matching
  const toolsLower = bullet.related_tools.map(t => t.toLowerCase());
  const tagsLower = bullet.tags.map(t => t.toLowerCase());
  const entitiesLower = bullet.key_entities.map(e => e.toLowerCase());

  for (const token of queryTokens) {
    if (toolsLower.includes(token)) score += 8;
    if (tagsLower.includes(token)) score += 8;
    if (entitiesLower.some(e => e.includes(token))) score += 10;
  }

  // L3: Prefix filter matching (direct metadata hit)
  for (const tool of prefixTools) {
    if (toolsLower.includes(tool.toLowerCase())) score += 8;
  }
  for (const tag of prefixTags) {
    if (tagsLower.includes(tag.toLowerCase())) score += 8;
  }
  for (const entity of prefixEntities) {
    if (entitiesLower.some(e => e.includes(entity.toLowerCase()))) score += 10;
  }

  return score;
}

// Normalize keyword score to 0-1 range
function normalizeKeywordScore(score: number, maxPossible: number): number {
  if (maxPossible <= 0) return 0;
  return Math.min(score / maxPossible, 1.0);
}

// Calculate recency boost for a bullet
function calcRecencyBoost(bullet: Bullet, boostDays: number, boostFactor: number): number {
  const now = Date.now();
  const lastActive = bullet.last_recall
    ? Math.max(new Date(bullet.last_recall).getTime(), new Date(bullet.created_at).getTime())
    : new Date(bullet.created_at).getTime();
  const ageDays = (now - lastActive) / (1000 * 60 * 60 * 24);
  return ageDays <= boostDays ? boostFactor : 1.0;
}

// Main Generator class for bullet retrieval
export class Generator {
  // Keyword-only search (Sprint 1)
  keywordSearch(query: string, bullets: Bullet[], limit = 10, minScore = 0): SearchResult[] {
    if (!query.trim() || bullets.length === 0) return [];

    const tokens = tokenizeForSearch(query);
    const { prefixTools, prefixTags, prefixEntities, remainingTokens } = extractPrefixFilters(tokens);
    const allSearchTokens = remainingTokens;
    const stemmed = allSearchTokens.map(stem);
    const grams = chineseNGrams(query, 2);

    const results: SearchResult[] = [];

    for (const bullet of bullets) {
      const keywordScore = scoreKeyword(
        allSearchTokens, stemmed, grams,
        prefixTools, prefixTags, prefixEntities,
        bullet,
      );
      if (keywordScore > minScore) {
        results.push({
          bullet,
          keywordScore,
          semanticScore: 0,
          finalScore: keywordScore,
        });
      }
    }

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results.slice(0, limit);
  }

  // Hybrid keyword + semantic search (Sprint 2)
  hybridSearch(
    query: string,
    queryVec: Float32Array | null,
    vectorCache: VectorCache,
    bullets: Bullet[],
    options: HybridSearchOptions,
  ): SearchResult[] {
    if (!query.trim() || bullets.length === 0) return [];

    // Normalize weights so they sum to 1.0
    let kwWeight = options.keywordWeight;
    let semWeight = options.semanticWeight;
    const weightSum = kwWeight + semWeight;
    if (weightSum > 0 && weightSum !== 1.0) {
      kwWeight = kwWeight / weightSum;
      semWeight = semWeight / weightSum;
    }

    // If no query vector or very short query (1-2 chars), fall back to keyword-only
    const isSemanticAvailable = queryVec !== null && query.trim().length > 2 && vectorCache.size > 0;

    const tokens = tokenizeForSearch(query);
    const { prefixTools, prefixTags, prefixEntities, remainingTokens } = extractPrefixFilters(tokens);
    const allSearchTokens = remainingTokens;
    const stemmed = allSearchTokens.map(stem);
    const grams = chineseNGrams(query, 2);

    // First pass: compute all raw keyword scores to find max for normalization
    const rawKeywordScores = new Map<string, number>();
    let maxKeywordScore = 0;
    for (const bullet of bullets) {
      const ks = scoreKeyword(
        allSearchTokens, stemmed, grams,
        prefixTools, prefixTags, prefixEntities,
        bullet,
      );
      rawKeywordScores.set(bullet.id, ks);
      if (ks > maxKeywordScore) maxKeywordScore = ks;
    }

    const results: SearchResult[] = [];

    for (const bullet of bullets) {
      const rawKs = rawKeywordScores.get(bullet.id) ?? 0;
      const keywordScore = normalizeKeywordScore(rawKs, maxKeywordScore);

      // Semantic score: cosine similarity from cache
      let semanticScore = 0;
      if (isSemanticAvailable && bullet.embedding && vectorCache.has(bullet.id)) {
        semanticScore = cosineSimilarity(queryVec!, vectorCache.get(bullet.id)!);
        // Clamp to [0, 1]
        semanticScore = Math.max(0, Math.min(1, semanticScore));
      }

      // Hybrid formula
      const blendedScore = isSemanticAvailable
        ? keywordScore * kwWeight + semanticScore * semWeight
        : keywordScore; // keyword-only fallback

      const decayWeight = bullet.decay_weight;
      const recencyBoost = calcRecencyBoost(bullet, options.recencyBoostDays, options.recencyBoostFactor);

      const finalScore = blendedScore * decayWeight * recencyBoost;

      if (finalScore > options.minScore) {
        results.push({
          bullet,
          keywordScore: rawKs,
          semanticScore,
          finalScore,
        });
      }
    }

    results.sort((a, b) => b.finalScore - a.finalScore);
    return results.slice(0, options.limit);
  }
}
