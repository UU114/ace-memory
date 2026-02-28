import type { PatternType } from '../types/hook.js';
import { aceDebug } from '../shared/logger.js';

export interface PatternCandidate {
  pattern_type: PatternType;
  summary: string;
  context: {
    file?: string;
    language?: string;
    error_message?: string;
    command?: string;
  };
}

// Max bytes to analyze from tool_response to avoid processing huge outputs
const MAX_RESPONSE_LEN = 100_000;

// Trivial commands that should NOT be captured as command_usage
const TRIVIAL_COMMANDS = new Set([
  'ls', 'dir', 'cd', 'cat', 'echo', 'pwd', 'head', 'tail', 'wc',
  'which', 'whoami', 'date', 'clear', 'true', 'false', 'type',
]);

// Notable command prefixes that indicate meaningful operations
const NOTABLE_COMMAND_PATTERNS = [
  /\b(npm|npx|pnpm|yarn|bun)\s+(run|test|build|start|install|ci|publish|exec)\b/,
  /\b(cargo)\s+(build|test|run|bench|check|clippy|publish)\b/,
  /\b(go)\s+(build|test|run|vet|generate)\b/,
  /\b(python|python3|pip|pip3)\s/,
  /\b(docker|docker-compose|podman)\s/,
  /\b(git)\s+(push|pull|merge|rebase|cherry-pick|tag)\b/,
  /\b(make|cmake|msbuild)\b/,
  /\b(vitest|jest|mocha|pytest|cargo\s+test)\b/,
  /\b(tsc|tsup|esbuild|vite|webpack|rollup)\b/,
  /\b(deploy|migrate|seed|prisma|typeorm|knex)\b/,
  /\b(curl|wget|ssh|scp|rsync)\b/,
];

// Error keywords in stderr / response
// Uses word boundaries and negative lookbehind where needed to avoid
// false positives like "0 failed" in test summary lines.
const ERROR_KEYWORDS = [
  '\\berror\\b', '\\bError\\b', '\\bERROR\\b',
  '(?<!0 )\\bfailed\\b', '(?<!0 )\\bFailed\\b', '(?<!0 )\\bFAILED\\b',
  '\\bnot found\\b', '\\bNot found\\b',
  '\\bcannot\\b', '\\bCannot\\b',
  '\\bTypeError\\b', '\\bReferenceError\\b', '\\bSyntaxError\\b',
  '\\bENOENT\\b', '\\bEACCES\\b', '\\bEPERM\\b',
  '\\bpanic', '\\bPANIC',
  '\\bfatal\\b', '\\bFatal\\b',
  '\\bexception\\b', '\\bException\\b',
  'TS\\d{4}', // TypeScript error codes
];
const ERROR_RE = new RegExp(ERROR_KEYWORDS.join('|'));

// Language detection from file extension
const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c', '.h': 'c',
  '.cpp': 'cpp', '.hpp': 'cpp', '.cc': 'cpp',
  '.cs': 'csharp',
  '.rb': 'ruby',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.json': 'json',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.toml': 'toml',
  '.md': 'markdown',
  '.html': 'html', '.htm': 'html',
  '.css': 'css', '.scss': 'scss',
  '.sql': 'sql',
  '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
  '.ps1': 'powershell',
};

function inferLanguage(filePath: string): string | undefined {
  const dot = filePath.lastIndexOf('.');
  if (dot === -1) return undefined;
  return EXT_LANG[filePath.slice(dot).toLowerCase()];
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

// Extract first meaningful line from error output for summary
function extractErrorLine(text: string, maxLen = 200): string {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && ERROR_RE.test(trimmed)) {
      return truncate(trimmed, maxLen);
    }
  }
  // Fallback: first non-empty line
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return truncate(trimmed, maxLen);
  }
  return '';
}

// Extract the base command name from a full command string
function getBaseCommand(cmd: string): string {
  const trimmed = cmd.trim();
  // Skip env vars like KEY=value at the start
  const parts = trimmed.split(/\s+/);
  for (const part of parts) {
    if (!part.includes('=')) return part.replace(/^.*[/\\]/, '');
  }
  return parts[0] || '';
}

export class RulesEngine {
  detect(
    toolName: string,
    toolInput: unknown,
    toolResponse: unknown,
  ): PatternCandidate | null {
    if (!toolInput || typeof toolInput !== 'object') return null;

    const input = toolInput as Record<string, unknown>;
    const response = typeof toolResponse === 'string'
      ? truncate(toolResponse, MAX_RESPONSE_LEN)
      : '';

    aceDebug(`RulesEngine.detect: tool=${toolName}, input_keys=${Object.keys(input).join(',')}, response_len=${response.length}`);

    // Priority order: error_fix > code_pattern > command_usage > file_creation
    if (toolName === 'Bash') {
      const result = this.detectErrorFix(input, response)
        ?? this.detectCommandUsage(input, response)
        ?? null;
      aceDebug(`RulesEngine.detect: Bash → ${result ? result.pattern_type : 'none'}`);
      return result;
    }

    if (toolName === 'Write') {
      const result = this.detectFileCreation(input, response)
        ?? this.detectCodePattern(toolName, input)
        ?? null;
      aceDebug(`RulesEngine.detect: Write → ${result ? result.pattern_type : 'none'}`);
      return result;
    }

    if (toolName === 'Edit') {
      const result = this.detectCodePattern(toolName, input) ?? null;
      aceDebug(`RulesEngine.detect: Edit → ${result ? result.pattern_type : 'none'}`);
      return result;
    }

    aceDebug(`RulesEngine.detect: tool ${toolName} not monitored`);
    return null;
  }

  private detectErrorFix(
    input: Record<string, unknown>,
    response: string,
  ): PatternCandidate | null {
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command) return null;

    // Check for error indicators in response
    const hasError = ERROR_RE.test(response);
    if (!hasError) return null;

    const errorLine = extractErrorLine(response);
    if (!errorLine) return null;

    return {
      pattern_type: 'error_fix',
      summary: `Command failed: ${truncate(command, 100)} — ${errorLine}`,
      context: {
        command: truncate(command, 300),
        error_message: errorLine,
      },
    };
  }

  private detectCodePattern(
    toolName: string,
    input: Record<string, unknown>,
  ): PatternCandidate | null {
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    if (!filePath) return null;

    // For Edit: check old_string/new_string for meaningful patterns
    if (toolName === 'Edit') {
      const newStr = typeof input.new_string === 'string' ? input.new_string : '';
      const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
      if (!newStr) return null;

      const pattern = this.classifyCodeChange(newStr, oldStr, filePath);
      if (!pattern) return null;

      return {
        pattern_type: 'code_pattern',
        summary: pattern,
        context: {
          file: filePath,
          language: inferLanguage(filePath),
        },
      };
    }

    // For Write: check content for patterns (only if not caught by file_creation)
    if (toolName === 'Write') {
      const content = typeof input.content === 'string' ? input.content : '';
      if (!content) return null;

      const pattern = this.classifyCodeChange(content, '', filePath);
      if (!pattern) return null;

      return {
        pattern_type: 'code_pattern',
        summary: pattern,
        context: {
          file: filePath,
          language: inferLanguage(filePath),
        },
      };
    }

    return null;
  }

  private classifyCodeChange(
    newText: string,
    oldText: string,
    filePath: string,
  ): string | null {
    const lower = filePath.toLowerCase();
    const isConfig = /\.(json|yaml|yml|toml|ini|env|config\.\w+)$/i.test(lower)
      || /config|settings|\.rc$/i.test(lower);

    // Import/require additions
    const importRe = /^[+]?\s*(import\s+.+|const\s+\w+\s*=\s*require\(.+\)|from\s+['"]).*/m;
    if (!oldText && importRe.test(newText)) {
      const match = newText.match(importRe);
      if (match) return `Added import: ${truncate(match[0].trim(), 120)} in ${fileBasename(filePath)}`;
    }
    if (oldText && !importRe.test(oldText) && importRe.test(newText)) {
      const match = newText.match(importRe);
      if (match) return `Added import: ${truncate(match[0].trim(), 120)} in ${fileBasename(filePath)}`;
    }

    // Error handling additions (try-catch, .catch, if err)
    const errorHandlingRe = /\b(try\s*\{|\.catch\s*\(|catch\s*\(|if\s*\(\s*err|\.on\s*\(\s*['"]error)/;
    if (errorHandlingRe.test(newText) && !errorHandlingRe.test(oldText)) {
      return `Added error handling in ${fileBasename(filePath)}`;
    }

    // Config file changes
    if (isConfig && newText.length > 10) {
      return `Modified config: ${fileBasename(filePath)}`;
    }

    // Type definition changes
    const typeRe = /\b(interface|type|enum)\s+\w+/;
    if (typeRe.test(newText) && !typeRe.test(oldText)) {
      const match = newText.match(typeRe);
      if (match) return `Added type definition: ${match[0]} in ${fileBasename(filePath)}`;
    }

    return null;
  }

  private detectCommandUsage(
    input: Record<string, unknown>,
    response: string,
  ): PatternCandidate | null {
    const command = typeof input.command === 'string' ? input.command : '';
    if (!command) return null;

    // Skip if the response looks like an error
    if (ERROR_RE.test(response)) return null;

    const base = getBaseCommand(command);
    if (TRIVIAL_COMMANDS.has(base)) return null;

    // Check against notable command patterns
    const isNotable = NOTABLE_COMMAND_PATTERNS.some(re => re.test(command));
    if (!isNotable) return null;

    return {
      pattern_type: 'command_usage',
      summary: `Executed: ${truncate(command, 200)}`,
      context: {
        command: truncate(command, 300),
      },
    };
  }

  private detectFileCreation(
    input: Record<string, unknown>,
    _response: string,
  ): PatternCandidate | null {
    const filePath = typeof input.file_path === 'string' ? input.file_path : '';
    const content = typeof input.content === 'string' ? input.content : '';
    if (!filePath || !content) return null;

    // Meaningful content: > 5 lines or > 100 chars
    const lineCount = content.split('\n').length;
    if (lineCount <= 5 && content.length <= 100) return null;

    return {
      pattern_type: 'file_creation',
      summary: `Created file: ${fileBasename(filePath)} (${lineCount} lines)`,
      context: {
        file: filePath,
        language: inferLanguage(filePath),
      },
    };
  }
}

function fileBasename(fp: string): string {
  const sep = fp.lastIndexOf('/');
  const sep2 = fp.lastIndexOf('\\');
  const idx = Math.max(sep, sep2);
  return idx === -1 ? fp : fp.slice(idx + 1);
}
