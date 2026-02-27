import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SessionQueueEntry } from '../../types/hook.js';
import { readQueue } from '../../storage/session-queue.js';

describe('post-tool-use hook (integration)', () => {
  const testDir = path.join(os.tmpdir(), `ace-ptu-test-${Date.now()}`);
  let originalHomedir: () => string;

  beforeEach(() => {
    fs.mkdirSync(path.join(testDir, '.ace-claude', 'sessions'), { recursive: true });
    originalHomedir = os.homedir;
    os.homedir = () => testDir;
  });

  afterEach(() => {
    os.homedir = originalHomedir;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  // Helper: simulate what the hook does (direct import of engine + queue)
  // We test the engine + queue integration rather than process spawning
  async function simulateHook(input: {
    tool_name: string;
    tool_input: Record<string, unknown>;
    tool_response: string;
    session_id: string;
  }): Promise<void> {
    const { RulesEngine } = await import('../../engine/rules-engine.js');
    const { appendToQueue } = await import('../../storage/session-queue.js');

    const engine = new RulesEngine();
    const candidate = engine.detect(input.tool_name, input.tool_input, input.tool_response);
    if (candidate) {
      const entry: SessionQueueEntry = {
        timestamp: new Date().toISOString(),
        tool_name: input.tool_name,
        pattern_type: candidate.pattern_type,
        summary: candidate.summary,
        context: candidate.context,
        processed: false,
      };
      appendToQueue(input.session_id, entry);
    }
  }

  it('writes error_fix pattern to session queue', async () => {
    await simulateHook({
      tool_name: 'Bash',
      tool_input: { command: 'npx tsc --noEmit' },
      tool_response: "error TS2339: Property 'x' does not exist\n",
      session_id: 'sess-001',
    });

    const entries = readQueue('sess-001');
    expect(entries).toHaveLength(1);
    expect(entries[0].pattern_type).toBe('error_fix');
    expect(entries[0].tool_name).toBe('Bash');
    expect(entries[0].processed).toBe(false);
  });

  it('writes file_creation pattern to session queue', async () => {
    const content = Array(15).fill('export function foo() {}').join('\n');
    await simulateHook({
      tool_name: 'Write',
      tool_input: { file_path: 'src/new.ts', content },
      tool_response: '',
      session_id: 'sess-002',
    });

    const entries = readQueue('sess-002');
    expect(entries).toHaveLength(1);
    expect(entries[0].pattern_type).toBe('file_creation');
    expect(entries[0].context.file).toBe('src/new.ts');
  });

  it('writes code_pattern for Edit with import', async () => {
    await simulateHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: 'src/app.ts',
        old_string: '',
        new_string: "import express from 'express';",
      },
      tool_response: '',
      session_id: 'sess-003',
    });

    const entries = readQueue('sess-003');
    expect(entries).toHaveLength(1);
    expect(entries[0].pattern_type).toBe('code_pattern');
  });

  it('writes nothing for trivial Bash (ls)', async () => {
    await simulateHook({
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      tool_response: 'file1.txt\nfile2.txt\n',
      session_id: 'sess-004',
    });

    const entries = readQueue('sess-004');
    expect(entries).toHaveLength(0);
  });

  it('accumulates multiple entries in same session', async () => {
    await simulateHook({
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' },
      tool_response: "Error: Module not found\n",
      session_id: 'sess-005',
    });
    await simulateHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: 'src/index.ts',
        old_string: '',
        new_string: "import missing from './missing';",
      },
      tool_response: '',
      session_id: 'sess-005',
    });

    const entries = readQueue('sess-005');
    expect(entries).toHaveLength(2);
    expect(entries[0].pattern_type).toBe('error_fix');
    expect(entries[1].pattern_type).toBe('code_pattern');
  });

  it('each entry has valid timestamp and processed=false', async () => {
    await simulateHook({
      tool_name: 'Bash',
      tool_input: { command: 'cargo build' },
      tool_response: "error[E0308]: mismatched types\n",
      session_id: 'sess-006',
    });

    const entries = readQueue('sess-006');
    expect(entries).toHaveLength(1);
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entries[0].processed).toBe(false);
  });
});
