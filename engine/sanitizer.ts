import { aceLog, aceWarn } from '../shared/logger.js';

// Result of sanitization pass
export interface SanitizeResult {
  clean: boolean;       // false = reject entirely (secret found)
  content: string;      // sanitized content (paths anonymized)
  reasons: string[];    // audit reasons (NEVER contains actual secret values)
}

// Known API key patterns with named identifiers
const API_KEY_PATTERNS = [
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, name: 'OpenAI' },
  { pattern: /ghp_[a-zA-Z0-9]{36,}/g, name: 'GitHub PAT' },
  { pattern: /AKIA[A-Z0-9]{16}/g, name: 'AWS Access Key' },
  { pattern: /xox[bp]-[a-zA-Z0-9-]{10,}/g, name: 'Slack token' },
  { pattern: /glpat-[a-zA-Z0-9_-]{20,}/g, name: 'GitLab PAT' },
  { pattern: /npm_[a-zA-Z0-9]{36,}/g, name: 'npm token' },
];

// Generic secret assignment pattern
const GENERIC_SECRET_PATTERN = /(?:key|token|password|secret|credential|auth)[\s]*[=:]\s*["']?([a-zA-Z0-9+/=_-]{20,})["']?/gi;

// OS-specific user path pattern for anonymization
const USER_PATH_PATTERN = /(?:C:\\\\Users\\[^\\]+|C:\\Users\\[^\\]+|\/home\/[^/]+|\/Users\/[^/]+)/g;

export class Sanitizer {
  sanitize(content: string): SanitizeResult {
    const reasons: string[] = [];

    // Detect API keys
    const apiKeyReasons = this.detectApiKeys(content);
    reasons.push(...apiKeyReasons);

    // Detect generic secrets
    const genericReasons = this.detectGenericSecrets(content);
    reasons.push(...genericReasons);

    // Anonymize paths (always applied)
    const anonymized = this.anonymizePaths(content);

    const clean = reasons.length === 0;

    if (!clean) {
      aceWarn(`Sanitizer rejected content: ${reasons.length} issue(s) found`);
    }

    return { clean, content: anonymized, reasons };
  }

  private detectApiKeys(content: string): string[] {
    const reasons: string[] = [];

    for (const { pattern, name } of API_KEY_PATTERNS) {
      // Reset lastIndex for each scan (regex is global)
      const re = new RegExp(pattern.source, pattern.flags);
      const matches = content.match(re);
      if (matches) {
        for (const match of matches) {
          // Audit log: mask the actual value, only show prefix pattern
          const prefix = match.slice(0, Math.min(4, match.length));
          reasons.push(`API key detected: ${prefix}*** (${name} pattern)`);
        }
      }
    }

    return reasons;
  }

  private detectGenericSecrets(content: string): string[] {
    const reasons: string[] = [];
    const re = new RegExp(GENERIC_SECRET_PATTERN.source, GENERIC_SECRET_PATTERN.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(content)) !== null) {
      // Extract the keyword that matched (key, token, password, etc.)
      const keyword = match[0].split(/[\s=:]/)[0];
      reasons.push(`Generic secret detected near keyword "${keyword}"`);
    }

    return reasons;
  }

  private anonymizePaths(content: string): string {
    return content.replace(USER_PATH_PATTERN, '~');
  }
}
