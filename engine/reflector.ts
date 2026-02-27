import { Sanitizer } from './sanitizer.js';
import { Classifier } from './classifier.js';
import type { LLMRefiner } from './llm-refiner.js';
import type { LLMEvaluator } from './llm-evaluator.js';
import type { OnnxEmbedding } from './embedding.js';
import type { SessionQueueEntry } from '../types/hook.js';
import type { BulletSection, BulletScope, KnowledgeType } from '../types/bullet.js';
import { aceLog, aceWarn } from '../shared/logger.js';

const MAX_CONTENT_LENGTH = 500;
const MAX_CODE_LINES = 3;

// Distilled bullet ready for Curator
export interface DistilledBullet {
  scope: BulletScope;
  section: BulletSection;
  content: string;
  distilled_rule: string | null;
  code_content: string | null;
  code_language: string | null;
  knowledge_type: KnowledgeType;
  instructivity_score: number;
  source_type: 'auto' | 'imported';
  related_tools: string[];
  related_files: string[];
  key_entities: string[];
  tags: string[];
  embedding: Float32Array | null;
}

// Entity extraction regex patterns
const CAMEL_CASE_RE = /[A-Z][a-z]+(?:[A-Z][a-z]+)+/g;
const BACKTICK_QUOTED_RE = /`([^`]+)`/g;
const IMPORT_RE = /(?:import|from)\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

// Map KnowledgeType to BulletSection
function inferSection(knowledgeType: KnowledgeType): BulletSection {
  switch (knowledgeType) {
    case 'Pitfall':
      return 'pitfalls';
    case 'Method':
      return 'methods';
    case 'Trick':
      return 'techniques';
    case 'Preference':
      return 'preferences';
    case 'Knowledge':
      return 'knowledge';
  }
}

// Determine scope from entry context and project name
function inferScope(entry: SessionQueueEntry, projectName: string): BulletScope {
  // If content references project-specific paths, scope to project
  const file = entry.context.file;
  if (file && (file.includes(projectName) || file.startsWith('.') || file.startsWith('src/'))) {
    return `project:${projectName}`;
  }
  // If the summary references project-specific patterns
  if (entry.summary.includes(projectName)) {
    return `project:${projectName}`;
  }
  return 'global';
}

// Generate concise content from a SessionQueueEntry
function distillContent(entry: SessionQueueEntry): string {
  let content: string;

  switch (entry.pattern_type) {
    case 'error_fix':
      content = `When encountering ${entry.context.error_message || 'an error'}, fix by ${entry.summary}`;
      break;
    case 'code_pattern':
      content = `When ${entry.context.language || 'coding'}, use ${entry.summary}`;
      break;
    case 'command_usage':
      content = `Use \`${entry.context.command || entry.tool_name}\` for ${entry.summary}`;
      break;
    case 'file_creation':
      content = `Create ${entry.context.file || 'file'} with ${entry.summary}`;
      break;
    default:
      content = entry.summary;
  }

  // Truncate to max length
  if (content.length > MAX_CONTENT_LENGTH) {
    content = content.slice(0, MAX_CONTENT_LENGTH);
  }

  return content;
}

// Extract key entities from content
function extractEntities(content: string): string[] {
  const entities = new Set<string>();

  // CamelCase words
  const camelMatches = content.match(CAMEL_CASE_RE);
  if (camelMatches) {
    for (const m of camelMatches) {
      entities.add(m);
    }
  }

  // Backtick-quoted strings
  let match: RegExpExecArray | null;
  const backtickRe = new RegExp(BACKTICK_QUOTED_RE.source, BACKTICK_QUOTED_RE.flags);
  while ((match = backtickRe.exec(content)) !== null) {
    entities.add(match[1]);
  }

  // Import/require/from references
  const importRe = new RegExp(IMPORT_RE.source, IMPORT_RE.flags);
  while ((match = importRe.exec(content)) !== null) {
    // match[1] is from import/from pattern, match[2] is from require() pattern
    const captured = match[1] || match[2];
    if (captured) {
      entities.add(captured);
    }
  }

  return Array.from(entities);
}

// Extract code content from summary for code_pattern and file_creation
function extractCodeContent(entry: SessionQueueEntry): { code: string | null; language: string | null } {
  if (entry.pattern_type !== 'code_pattern' && entry.pattern_type !== 'file_creation') {
    return { code: null, language: null };
  }

  // Try to extract code blocks from summary (```...```)
  const codeBlockMatch = entry.summary.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  let code: string | null = null;
  if (codeBlockMatch) {
    code = codeBlockMatch[1].trim();
  }

  if (code) {
    // Limit to MAX_CODE_LINES lines
    const lines = code.split('\n');
    if (lines.length > MAX_CODE_LINES) {
      code = lines.slice(0, MAX_CODE_LINES).join('\n');
    }
  }

  // Detect language from context or file extension
  let language = entry.context.language || null;
  if (!language && entry.context.file) {
    const ext = entry.context.file.split('.').pop()?.toLowerCase();
    if (ext) {
      const extMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescript',
        js: 'javascript',
        jsx: 'javascript',
        py: 'python',
        rs: 'rust',
        go: 'go',
        rb: 'ruby',
        java: 'java',
        sh: 'bash',
        css: 'css',
        html: 'html',
        json: 'json',
        yaml: 'yaml',
        yml: 'yaml',
        md: 'markdown',
      };
      language = extMap[ext] || ext;
    }
  }

  return { code, language };
}

export class Reflector {
  constructor(
    private sanitizer: Sanitizer,
    private classifier: Classifier,
    private embedding: OnnxEmbedding | null,
    private llmRefiner?: LLMRefiner | null,
    private llmScoreThreshold?: number,
    private llmEvaluator?: LLMEvaluator | null,
  ) {}

  async distill(entries: SessionQueueEntry[], projectName: string): Promise<{
    bullets: DistilledBullet[];
    skipped: number;
  }> {
    const bullets: DistilledBullet[] = [];
    let skipped = 0;

    for (const entry of entries) {
      // Step 1: Generate content from entry
      const content = distillContent(entry);

      // Step 2: Sanitize
      const sanitizeResult = this.sanitizer.sanitize(content);
      if (!sanitizeResult.clean) {
        aceWarn(`Reflector: skipping entry (sanitizer rejected) - ${sanitizeResult.reasons.join(', ')}`);
        skipped++;
        continue;
      }

      const cleanContent = sanitizeResult.content;

      // Step 3: Classify
      let classifyResult = this.classifier.classify(cleanContent, true);

      // Step 3.5: Optional LLM evaluation override
      if (this.llmEvaluator?.isAvailable()) {
        try {
          const llmResult = await this.llmEvaluator.evaluate(cleanContent, {
            pattern_type: entry.pattern_type,
            tool_name: entry.tool_name,
            file_path: entry.context.file || undefined,
          });
          if (llmResult) {
            classifyResult = {
              knowledge_type: llmResult.category,
              instructivity_score: llmResult.score,
              rejected: !llmResult.should_record,
              reason: llmResult.should_record ? undefined : llmResult.reason,
            };
          }
          // If llmResult is null (error/timeout), keep heuristic result
        } catch {
          // Non-critical — keep heuristic classifyResult
        }
      }

      if (classifyResult.rejected) {
        aceWarn(`Reflector: skipping entry (classifier rejected) - ${classifyResult.reason}`);
        skipped++;
        continue;
      }

      // Step 4: Extract metadata
      const keyEntities = extractEntities(cleanContent);
      const relatedFiles = entry.context.file ? [entry.context.file] : [];
      const relatedTools = [entry.tool_name];
      const tags: string[] = [entry.pattern_type];
      if (entry.context.language) {
        tags.push(entry.context.language);
      }

      // Step 5: Infer scope
      const scope = inferScope(entry, projectName);

      // Step 6: Infer section
      const section = inferSection(classifyResult.knowledge_type);

      // Step 7: Compute embedding if available
      let embedding: Float32Array | null = null;
      if (this.embedding && this.embedding.initialized) {
        try {
          embedding = await this.embedding.embed(cleanContent);
        } catch (err: any) {
          aceWarn(`Reflector: embedding failed - ${err.message}`);
        }
      }

      // Step 8: Extract code content
      const { code, language } = extractCodeContent(entry);

      // Step 8.5: LLM refinement for high-quality bullets
      let distilledRule: string | null = cleanContent;
      if (
        this.llmRefiner?.isAvailable() &&
        classifyResult.instructivity_score > (this.llmScoreThreshold ?? 70)
      ) {
        try {
          const refined = await this.llmRefiner.refine({
            content: cleanContent,
            knowledge_type: classifyResult.knowledge_type,
            code_content: code,
            key_entities: keyEntities,
          });
          if (refined) {
            distilledRule = refined;
          }
        } catch {
          // Non-critical — keep original distilledRule
        }
      }

      // Step 9: Build DistilledBullet
      const bullet: DistilledBullet = {
        scope,
        section,
        content: cleanContent,
        distilled_rule: distilledRule,
        code_content: code,
        code_language: language,
        knowledge_type: classifyResult.knowledge_type,
        instructivity_score: classifyResult.instructivity_score,
        source_type: 'auto',
        related_tools: relatedTools,
        related_files: relatedFiles,
        key_entities: keyEntities,
        tags,
        embedding,
      };

      bullets.push(bullet);
    }

    aceLog(`Reflector: distilled ${bullets.length} bullets, skipped ${skipped}`);
    return { bullets, skipped };
  }
}
