import { describe, it, expect } from 'vitest';
import { Sanitizer } from '../../engine/sanitizer.js';
import type { SanitizeResult } from '../../engine/sanitizer.js';

describe('Sanitizer', () => {
  const sanitizer = new Sanitizer();

  // ---- API key detection ----
  describe('API key detection', () => {
    it('detects OpenAI API key (sk- pattern)', () => {
      const content = 'My key is sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons).toHaveLength(1);
      expect(result.reasons[0]).toContain('OpenAI');
      expect(result.reasons[0]).toContain('sk-a***');
    });

    it('detects GitHub PAT (ghp_ pattern)', () => {
      const content = 'token: ghp_abcdefghijklmnopqrstuvwxyz1234567890AB';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('GitHub PAT'))).toBe(true);
    });

    it('detects AWS Access Key (AKIA pattern)', () => {
      const content = 'aws_key = AKIAIOSFODNN7EXAMPLE';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('AWS Access Key'))).toBe(true);
    });

    it('detects Slack token (xoxb- pattern)', () => {
      const content = 'SLACK_TOKEN=xoxb-abcdefghij-klmnopqrst';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('Slack token'))).toBe(true);
    });

    it('detects Slack token (xoxp- pattern)', () => {
      const content = 'token: xoxp-1234567890-abcdef';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('Slack token'))).toBe(true);
    });

    it('detects GitLab PAT (glpat- pattern)', () => {
      const content = 'GITLAB_TOKEN=glpat-abcdefghijklmnopqrstuvwxyz';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('GitLab PAT'))).toBe(true);
    });

    it('detects npm token (npm_ pattern)', () => {
      const content = 'NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz1234567890AB';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('npm token'))).toBe(true);
    });
  });

  // ---- Path anonymization ----
  describe('path anonymization', () => {
    it('anonymizes Windows user paths (C:\\Users\\username)', () => {
      const content = 'File located at C:\\Users\\JohnDoe\\Documents\\project\\file.ts';
      const result = sanitizer.sanitize(content);
      expect(result.content).toContain('~\\Documents\\project\\file.ts');
      expect(result.content).not.toContain('JohnDoe');
    });

    it('anonymizes Linux user paths (/home/username)', () => {
      const content = 'Config at /home/alice/config/.bashrc';
      const result = sanitizer.sanitize(content);
      expect(result.content).toContain('~/config/.bashrc');
      expect(result.content).not.toContain('alice');
    });

    it('anonymizes macOS user paths (/Users/username)', () => {
      const content = 'Project at /Users/bob/Projects/my-app';
      const result = sanitizer.sanitize(content);
      expect(result.content).toContain('~/Projects/my-app');
      expect(result.content).not.toContain('bob');
    });

    it('applies path anonymization even when content is clean', () => {
      const content = 'Reading file from /home/user123/docs/readme.md';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
      expect(result.content).toContain('~/docs/readme.md');
      expect(result.content).not.toContain('user123');
    });
  });

  // ---- False positive avoidance ----
  describe('false positive avoidance', () => {
    it('does NOT flag "skeleton" as OpenAI key', () => {
      const content = 'Create a skeleton component for the dashboard';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('does NOT flag "skill" as OpenAI key', () => {
      const content = 'This skill requires advanced TypeScript knowledge';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('does NOT flag "sketch" as OpenAI key', () => {
      const content = 'Open the sketch file in Figma';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
      expect(result.reasons).toHaveLength(0);
    });

    it('does NOT flag short sk- tokens', () => {
      const content = 'Variable sk-abc is used for testing';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
    });
  });

  // ---- Generic secret detection ----
  describe('generic secret detection', () => {
    it('detects key=value assignment with long value', () => {
      const content = 'api_key = "abcdefghijklmnopqrstuvwxyz1234"';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('Generic secret'))).toBe(true);
    });

    it('detects token: value assignment', () => {
      const content = 'auth_token: ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('Generic secret'))).toBe(true);
    });

    it('detects password assignment', () => {
      const content = "password = 'SuperSecretPassword12345678'";
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('Generic secret'))).toBe(true);
    });

    it('detects secret assignment', () => {
      const content = 'client_secret="veryLongSecretValue1234567890abcd"';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      expect(result.reasons.some(r => r.includes('Generic secret'))).toBe(true);
    });

    it('does NOT flag short values (< 20 chars)', () => {
      const content = 'key = "short"';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
    });
  });

  // ---- Audit log safety ----
  describe('audit log never contains actual secrets', () => {
    it('masks OpenAI key in audit reason', () => {
      const secret = 'sk-abcdefghijklmnopqrstuvwxyz1234567890';
      const content = `API_KEY=${secret}`;
      const result = sanitizer.sanitize(content);
      // The full secret value must never appear in reasons
      for (const reason of result.reasons) {
        expect(reason).not.toContain(secret);
      }
    });

    it('masks GitHub PAT in audit reason', () => {
      const secret = 'ghp_abcdefghijklmnopqrstuvwxyz1234567890AB';
      const content = `GITHUB_TOKEN=${secret}`;
      const result = sanitizer.sanitize(content);
      for (const reason of result.reasons) {
        expect(reason).not.toContain(secret);
      }
    });

    it('does not leak generic secret values in reasons', () => {
      const secretValue = 'MySuperSecretPasswordThatIsVeryLong123';
      const content = `password = "${secretValue}"`;
      const result = sanitizer.sanitize(content);
      for (const reason of result.reasons) {
        expect(reason).not.toContain(secretValue);
      }
    });
  });

  // ---- Multiple secrets ----
  describe('multiple secrets in one content', () => {
    it('reports all detected secrets', () => {
      const content = [
        'OPENAI_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890',
        'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890AB',
        'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
      ].join('\n');
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(false);
      // Should have at least 3 API key reasons (possibly more from generic detection)
      expect(result.reasons.length).toBeGreaterThanOrEqual(3);
      expect(result.reasons.some(r => r.includes('OpenAI'))).toBe(true);
      expect(result.reasons.some(r => r.includes('GitHub PAT'))).toBe(true);
      expect(result.reasons.some(r => r.includes('AWS Access Key'))).toBe(true);
    });
  });

  // ---- Clean content ----
  describe('clean content', () => {
    it('passes through clean content unchanged (except path anonymization)', () => {
      const content = 'Use vitest for testing TypeScript projects. Configure strict mode in tsconfig.json.';
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
      expect(result.content).toBe(content);
      expect(result.reasons).toHaveLength(0);
    });

    it('returns clean for normal code snippets', () => {
      const content = `
function add(a: number, b: number): number {
  return a + b;
}
`;
      const result = sanitizer.sanitize(content);
      expect(result.clean).toBe(true);
    });

    it('returns clean for empty content', () => {
      const result = sanitizer.sanitize('');
      expect(result.clean).toBe(true);
      expect(result.content).toBe('');
      expect(result.reasons).toHaveLength(0);
    });
  });
});
