import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionQueueEntry } from '../../types/hook.js';

// Mock dependencies before importing the module under test
vi.mock('../../storage/session-queue.js', () => ({
  readQueue: vi.fn(() => []),
  markProcessed: vi.fn(),
}));

vi.mock('../../shared/ipc-client.js', () => ({
  IPCClient: {
    connect: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock('../../shared/logger.js', () => ({
  aceLog: vi.fn(),
  aceWarn: vi.fn(),
  aceDebug: vi.fn(),
}));

import { stopMain } from '../../hooks/stop.js';
import { readQueue, markProcessed } from '../../storage/session-queue.js';
import { IPCClient } from '../../shared/ipc-client.js';
import { aceLog, aceWarn } from '../../shared/logger.js';

// Helper to create a queue entry
function makeEntry(overrides: Partial<SessionQueueEntry> = {}): SessionQueueEntry {
  return {
    timestamp: new Date().toISOString(),
    tool_name: 'Edit',
    pattern_type: 'code_pattern',
    summary: 'Test pattern',
    context: { file: 'test.ts' },
    processed: false,
    ...overrides,
  };
}

// Helper to capture stdout writes
function captureStdout(): { output: string; restore: () => void } {
  const state = { output: '' };
  const original = process.stdout.write.bind(process.stdout);
  const mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    state.output += String(chunk);
    return true;
  });
  return {
    output: '', // accessed via getter below
    get output_value() { return state.output; },
    restore: () => mockWrite.mockRestore(),
  };
}

describe('stop hook', () => {
  let stdoutCapture: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutCapture = captureStdout();
  });

  afterEach(() => {
    stdoutCapture.restore();
  });

  it('outputs {} when session_id is missing', async () => {
    await stopMain({ session_id: '', cwd: '/test' });

    expect(stdoutCapture.output_value).toBe('{}');
    expect(readQueue).not.toHaveBeenCalled();
  });

  it('outputs {} when queue is empty', async () => {
    vi.mocked(readQueue).mockReturnValue([]);

    await stopMain({ session_id: 'sess-001', cwd: '/test' });

    expect(stdoutCapture.output_value).toBe('{}');
    expect(readQueue).toHaveBeenCalledWith('sess-001');
  });

  it('skips curate when unprocessed count is below threshold (< 3)', async () => {
    vi.mocked(readQueue).mockReturnValue([
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
    ]);

    await stopMain({ session_id: 'sess-002', cwd: '/project' });

    expect(stdoutCapture.output_value).toBe('{}');
    expect(IPCClient.connect).not.toHaveBeenCalled();
    expect(aceLog).toHaveBeenCalledWith(expect.stringContaining('below threshold'));
  });

  it('skips already processed entries when counting', async () => {
    vi.mocked(readQueue).mockReturnValue([
      makeEntry({ processed: true }),
      makeEntry({ processed: true }),
      makeEntry({ processed: true }),
      makeEntry({ processed: false }),
    ]);

    await stopMain({ session_id: 'sess-003', cwd: '/project' });

    // Only 1 unprocessed, below threshold
    expect(stdoutCapture.output_value).toBe('{}');
    expect(IPCClient.connect).not.toHaveBeenCalled();
  });

  it('outputs {} when daemon is unavailable', async () => {
    vi.mocked(readQueue).mockReturnValue([
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
    ]);
    vi.mocked(IPCClient.connect).mockResolvedValue(null);

    await stopMain({ session_id: 'sess-004', cwd: '/project' });

    expect(stdoutCapture.output_value).toBe('{}');
    expect(aceWarn).toHaveBeenCalledWith(expect.stringContaining('Daemon unavailable'));
  });

  it('calls curate and marks processed when >= 3 unprocessed entries', async () => {
    const entries = [
      makeEntry({ processed: false, timestamp: 't1' }),
      makeEntry({ processed: false, timestamp: 't2' }),
      makeEntry({ processed: false, timestamp: 't3' }),
    ];
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn().mockResolvedValue({ added: 2, merged: 1, skipped: 0 }),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await stopMain({ session_id: 'sess-005', cwd: '/my-project' });

    expect(mockClient.call).toHaveBeenCalledWith(
      'curate',
      { insights: entries, project: 'my-project' },
      10000,
    );
    expect(markProcessed).toHaveBeenCalledWith('sess-005', ['t1', 't2', 't3']);
    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('disconnects client even when curate fails', async () => {
    const entries = [
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
    ];
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn().mockRejectedValue(new Error('curate failed')),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await stopMain({ session_id: 'sess-006', cwd: '/project' });

    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(markProcessed).not.toHaveBeenCalled();
    expect(aceWarn).toHaveBeenCalledWith(expect.stringContaining('Stop curate failed'));
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('uses path.basename(cwd) as project name', async () => {
    const entries = [
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
    ];
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn().mockResolvedValue({ added: 0, merged: 0, skipped: 3 }),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await stopMain({ session_id: 'sess-007', cwd: '/home/user/deep/nested/project-name' });

    expect(mockClient.call).toHaveBeenCalledWith(
      'curate',
      expect.objectContaining({ project: 'project-name' }),
      expect.any(Number),
    );
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('handles empty cwd gracefully', async () => {
    const entries = [
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
      makeEntry({ processed: false }),
    ];
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn().mockResolvedValue({ added: 1, merged: 0, skipped: 0 }),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await stopMain({ session_id: 'sess-008', cwd: '' });

    // path.basename('') returns ''
    expect(mockClient.call).toHaveBeenCalledWith(
      'curate',
      expect.objectContaining({ project: '' }),
      expect.any(Number),
    );
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('always outputs valid JSON', async () => {
    vi.mocked(readQueue).mockReturnValue([]);

    await stopMain({ session_id: 'sess-009', cwd: '/test' });

    expect(() => JSON.parse(stdoutCapture.output_value)).not.toThrow();
    expect(JSON.parse(stdoutCapture.output_value)).toEqual({});
  });
});
