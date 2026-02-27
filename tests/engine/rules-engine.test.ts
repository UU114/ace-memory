import { describe, it, expect } from 'vitest';
import { RulesEngine } from '../../engine/rules-engine.js';
import type { PatternCandidate } from '../../engine/rules-engine.js';

describe('RulesEngine', () => {
  const engine = new RulesEngine();

  // ---- error_fix ----
  describe('error_fix', () => {
    it('detects TypeScript compilation error from Bash', () => {
      const result = engine.detect('Bash',
        { command: 'npx tsc --noEmit' },
        "src/index.ts(10,5): error TS2339: Property 'foo' does not exist on type 'Bar'.\n",
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('error_fix');
      expect(result!.context.command).toContain('tsc');
      expect(result!.context.error_message).toContain('TS2339');
    });

    it('detects test failure', () => {
      const result = engine.detect('Bash',
        { command: 'npm test' },
        'FAIL src/utils.test.ts\n  ● should return true\n    Expected: true\n    Received: false\n\nTests: 1 failed, 2 passed\n',
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('error_fix');
    });

    it('detects command not found error', () => {
      const result = engine.detect('Bash',
        { command: 'foo-tool build' },
        'bash: foo-tool: command not found\n',
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('error_fix');
      expect(result!.context.error_message).toContain('not found');
    });

    it('detects Rust panic', () => {
      const result = engine.detect('Bash',
        { command: 'cargo run' },
        "thread 'main' panicked at 'index out of bounds', src/main.rs:42:5\n",
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('error_fix');
    });

    it('does not detect error_fix for successful command output', () => {
      const result = engine.detect('Bash',
        { command: 'npm test' },
        'Tests: 5 passed, 5 total\nTime: 1.2s\n',
      );
      // Should not be error_fix (no error keywords match)
      if (result) {
        expect(result.pattern_type).not.toBe('error_fix');
      }
    });

    it('does not detect error_fix when command is empty', () => {
      const result = engine.detect('Bash', { command: '' }, 'Error: something\n');
      expect(result).toBeNull();
    });
  });

  // ---- code_pattern ----
  describe('code_pattern', () => {
    it('detects import addition via Edit', () => {
      const result = engine.detect('Edit', {
        file_path: 'src/index.ts',
        old_string: '',
        new_string: "import path from 'path';",
      }, '');
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('code_pattern');
      expect(result!.summary).toContain('import');
      expect(result!.context.language).toBe('typescript');
    });

    it('detects require addition via Edit', () => {
      const result = engine.detect('Edit', {
        file_path: 'src/app.js',
        old_string: '',
        new_string: "const fs = require('fs');",
      }, '');
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('code_pattern');
      expect(result!.summary).toContain('import');
    });

    it('detects error handling addition', () => {
      const result = engine.detect('Edit', {
        file_path: 'src/handler.ts',
        old_string: 'doSomething();',
        new_string: 'try {\n  doSomething();\n} catch (err) {\n  log(err);\n}',
      }, '');
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('code_pattern');
      expect(result!.summary).toContain('error handling');
    });

    it('detects config file modification', () => {
      const result = engine.detect('Edit', {
        file_path: 'tsconfig.json',
        old_string: '"strict": false',
        new_string: '"strict": true, "noUncheckedIndexedAccess": true',
      }, '');
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('code_pattern');
      expect(result!.summary).toContain('config');
    });

    it('detects type definition addition', () => {
      const result = engine.detect('Edit', {
        file_path: 'types/models.ts',
        old_string: '',
        new_string: 'interface User {\n  id: string;\n  name: string;\n}',
      }, '');
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('code_pattern');
      expect(result!.summary).toContain('type definition');
    });

    it('returns null for trivial Edit with no recognized pattern', () => {
      const result = engine.detect('Edit', {
        file_path: 'src/index.ts',
        old_string: 'foo()',
        new_string: 'bar()',
      }, '');
      expect(result).toBeNull();
    });

    it('returns null when file_path is missing', () => {
      const result = engine.detect('Edit', {
        old_string: 'a',
        new_string: 'b',
      }, '');
      expect(result).toBeNull();
    });
  });

  // ---- command_usage ----
  describe('command_usage', () => {
    it('detects npm build command', () => {
      const result = engine.detect('Bash',
        { command: 'npm run build' },
        'Build completed successfully.\n',
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('command_usage');
      expect(result!.context.command).toContain('npm run build');
    });

    it('detects cargo test', () => {
      const result = engine.detect('Bash',
        { command: 'cargo test' },
        'test result: ok. 10 passed; 0 failed\n',
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('command_usage');
    });

    it('detects docker compose', () => {
      const result = engine.detect('Bash',
        { command: 'docker compose up -d' },
        'Container started\n',
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('command_usage');
    });

    it('detects vitest', () => {
      const result = engine.detect('Bash',
        { command: 'vitest run' },
        'Test Files  5 passed\nTests  20 passed\n',
      );
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('command_usage');
    });

    it('ignores trivial commands (ls)', () => {
      const result = engine.detect('Bash',
        { command: 'ls -la' },
        'drwxr-xr-x 5 user user 4096 Jan 1 00:00 .\n',
      );
      expect(result).toBeNull();
    });

    it('ignores trivial commands (cat)', () => {
      const result = engine.detect('Bash',
        { command: 'cat package.json' },
        '{ "name": "test" }\n',
      );
      expect(result).toBeNull();
    });

    it('ignores trivial commands (echo)', () => {
      const result = engine.detect('Bash',
        { command: 'echo hello' },
        'hello\n',
      );
      expect(result).toBeNull();
    });

    it('ignores commands with errors (promotes to error_fix instead)', () => {
      const result = engine.detect('Bash',
        { command: 'npm run build' },
        'Error: Build failed with 3 errors\n',
      );
      // Should be error_fix, not command_usage
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('error_fix');
    });
  });

  // ---- file_creation ----
  describe('file_creation', () => {
    it('detects meaningful file creation', () => {
      const content = Array(10).fill('line of code').join('\n');
      const result = engine.detect('Write', {
        file_path: 'src/new-module.ts',
        content,
      }, '');
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('file_creation');
      expect(result!.summary).toContain('new-module.ts');
      expect(result!.context.language).toBe('typescript');
    });

    it('detects creation by char count (> 100 chars, few lines)', () => {
      const content = 'a'.repeat(150);
      const result = engine.detect('Write', {
        file_path: 'data/output.json',
        content,
      }, '');
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('file_creation');
    });

    it('ignores tiny file creation (<=5 lines and <=100 chars)', () => {
      const result = engine.detect('Write', {
        file_path: 'src/empty.ts',
        content: '// stub\n',
      }, '');
      // Tiny file → null (no file_creation), and no code_pattern since content is trivial
      expect(result).toBeNull();
    });

    it('ignores Write with no content', () => {
      const result = engine.detect('Write', {
        file_path: 'src/x.ts',
        content: '',
      }, '');
      expect(result).toBeNull();
    });

    it('infers language from extension', () => {
      const content = Array(10).fill('def foo(): pass').join('\n');
      const result = engine.detect('Write', {
        file_path: 'scripts/run.py',
        content,
      }, '');
      expect(result).not.toBeNull();
      expect(result!.context.language).toBe('python');
    });
  });

  // ---- Edge cases ----
  describe('edge cases', () => {
    it('returns null for null toolInput', () => {
      const result = engine.detect('Bash', null, '');
      expect(result).toBeNull();
    });

    it('returns null for non-object toolInput', () => {
      const result = engine.detect('Bash', 'string input' as unknown, '');
      expect(result).toBeNull();
    });

    it('returns null for unknown tool name', () => {
      const result = engine.detect('Read', { file_path: '/tmp/x' }, 'content');
      expect(result).toBeNull();
    });

    it('handles very large response by truncating without throwing', () => {
      const hugeResponse = 'x'.repeat(200_000);
      // Should not throw or hang; npm test is a notable command with no error → command_usage
      const result = engine.detect('Bash', { command: 'npm test' }, hugeResponse);
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('command_usage');
    });

    it('handles response with error in huge output', () => {
      const hugeResponse = 'x'.repeat(50_000) + '\nError: something broke\n' + 'x'.repeat(50_000);
      const result = engine.detect('Bash', { command: 'npm run build' }, hugeResponse);
      expect(result).not.toBeNull();
      expect(result!.pattern_type).toBe('error_fix');
    });
  });
});
