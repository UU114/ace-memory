import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { SessionQueueEntry } from '../../types/hook.js';

// Mock dependencies before importing the module under test
vi.mock('../../storage/session-queue.js', () => ({
  readQueue: vi.fn(() => []),
  cleanupQueue: vi.fn(),
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

import { sessionEndMain } from '../../hooks/session-end.js';
import { readQueue, cleanupQueue } from '../../storage/session-queue.js';
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
function captureStdout(): { output_value: string; restore: () => void } {
  const state = { output: '' };
  const mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    state.output += String(chunk);
    return true;
  });
  return {
    get output_value() { return state.output; },
    restore: () => mockWrite.mockRestore(),
  };
}

describe('session-end hook', () => {
  let stdoutCapture: ReturnType<typeof captureStdout>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutCapture = captureStdout();
  });

  afterEach(() => {
    stdoutCapture.restore();
  });

  it('outputs {} when session_id is missing', async () => {
    await sessionEndMain({ session_id: '', cwd: '/test' });

    expect(stdoutCapture.output_value).toBe('{}');
    expect(readQueue).not.toHaveBeenCalled();
    expect(cleanupQueue).not.toHaveBeenCalled();
  });

  it('cleans up queue even when it is empty', async () => {
    vi.mocked(readQueue).mockReturnValue([]);
    vi.mocked(IPCClient.connect).mockResolvedValue(null);

    await sessionEndMain({ session_id: 'sess-001', cwd: '/test' });

    expect(cleanupQueue).toHaveBeenCalledWith('sess-001');
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('logs summary even with no entries', async () => {
    vi.mocked(readQueue).mockReturnValue([]);
    vi.mocked(IPCClient.connect).mockResolvedValue(null);

    await sessionEndMain({ session_id: 'sess-002', cwd: '/test' });

    expect(aceLog).toHaveBeenCalledWith(
      'Session complete. +0 new, ~0 merged, -0 skipped',
    );
  });

  it('handles daemon unavailable gracefully and still cleans up', async () => {
    vi.mocked(readQueue).mockReturnValue([
      makeEntry({ processed: false }),
    ]);
    vi.mocked(IPCClient.connect).mockResolvedValue(null);

    await sessionEndMain({ session_id: 'sess-003', cwd: '/project' });

    expect(aceWarn).toHaveBeenCalledWith('Daemon unavailable for SessionEnd processing');
    expect(cleanupQueue).toHaveBeenCalledWith('sess-003');
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('processes unprocessed entries and calls session_unregister', async () => {
    const entries = [
      makeEntry({ processed: false, timestamp: 't1' }),
      makeEntry({ processed: false, timestamp: 't2' }),
    ];
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn()
        .mockResolvedValueOnce({ added: 1, merged: 1, skipped: 0 }) // curate
        .mockResolvedValueOnce({ status: 'ok' }), // session_unregister
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-004', cwd: '/my-project' });

    // Curate called with entries
    expect(mockClient.call).toHaveBeenCalledWith(
      'curate',
      { insights: entries, project: 'my-project' },
      30000,
    );
    // Session unregister called
    expect(mockClient.call).toHaveBeenCalledWith(
      'session_unregister',
      { session_id: 'sess-004' },
      5000,
    );
    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(cleanupQueue).toHaveBeenCalledWith('sess-004');
    expect(aceLog).toHaveBeenCalledWith(
      'Session complete. +1 new, ~1 merged, -0 skipped',
    );
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('skips already processed entries', async () => {
    const entries = [
      makeEntry({ processed: true, timestamp: 't1' }),
      makeEntry({ processed: false, timestamp: 't2' }),
    ];
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn()
        .mockResolvedValueOnce({ added: 1, merged: 0, skipped: 0 })
        .mockResolvedValueOnce({ status: 'ok' }),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-005', cwd: '/project' });

    // Only 1 unprocessed entry sent
    expect(mockClient.call).toHaveBeenCalledWith(
      'curate',
      { insights: [entries[1]], project: 'project' },
      30000,
    );
  });

  it('processes large queues in batches of 20', async () => {
    // Create 45 unprocessed entries
    const entries: SessionQueueEntry[] = [];
    for (let i = 0; i < 45; i++) {
      entries.push(makeEntry({ processed: false, timestamp: `t${i}` }));
    }
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn()
        .mockResolvedValueOnce({ added: 10, merged: 5, skipped: 5 })  // batch 1 (20 items)
        .mockResolvedValueOnce({ added: 8, merged: 7, skipped: 5 })   // batch 2 (20 items)
        .mockResolvedValueOnce({ added: 2, merged: 1, skipped: 2 })   // batch 3 (5 items)
        .mockResolvedValueOnce({ status: 'ok' }),                      // session_unregister
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-006', cwd: '/project' });

    // 3 curate calls + 1 session_unregister = 4 total
    expect(mockClient.call).toHaveBeenCalledTimes(4);

    // Verify batch sizes
    const curateCalls = mockClient.call.mock.calls.filter(
      (c: unknown[]) => c[0] === 'curate',
    );
    expect(curateCalls).toHaveLength(3);
    expect((curateCalls[0][1] as { insights: unknown[] }).insights).toHaveLength(20);
    expect((curateCalls[1][1] as { insights: unknown[] }).insights).toHaveLength(20);
    expect((curateCalls[2][1] as { insights: unknown[] }).insights).toHaveLength(5);

    // Verify aggregated stats
    expect(aceLog).toHaveBeenCalledWith(
      'Session complete. +20 new, ~13 merged, -12 skipped',
    );
  });

  it('continues processing remaining batches when one batch fails', async () => {
    const entries: SessionQueueEntry[] = [];
    for (let i = 0; i < 25; i++) {
      entries.push(makeEntry({ processed: false, timestamp: `t${i}` }));
    }
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error('batch 1 failed'))           // batch 1 fails
        .mockResolvedValueOnce({ added: 3, merged: 2, skipped: 0 })   // batch 2 succeeds
        .mockResolvedValueOnce({ status: 'ok' }),                      // session_unregister
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-007', cwd: '/project' });

    expect(aceWarn).toHaveBeenCalledWith(
      expect.stringContaining('SessionEnd curate batch failed'),
    );
    // Stats only reflect successful batch
    expect(aceLog).toHaveBeenCalledWith(
      'Session complete. +3 new, ~2 merged, -0 skipped',
    );
    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(cleanupQueue).toHaveBeenCalledWith('sess-007');
  });

  it('handles session_unregister failure gracefully', async () => {
    vi.mocked(readQueue).mockReturnValue([]);

    const mockClient = {
      call: vi.fn().mockRejectedValue(new Error('unregister failed')),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-008', cwd: '/project' });

    expect(aceWarn).toHaveBeenCalledWith(
      expect.stringContaining('Session unregister failed'),
    );
    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(cleanupQueue).toHaveBeenCalledWith('sess-008');
    expect(stdoutCapture.output_value).toBe('{}');
  });

  it('disconnects client even when curate throws', async () => {
    vi.mocked(readQueue).mockReturnValue([
      makeEntry({ processed: false }),
    ]);

    const mockClient = {
      call: vi.fn()
        .mockRejectedValueOnce(new Error('curate error'))
        .mockResolvedValueOnce({ status: 'ok' }),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-009', cwd: '/project' });

    expect(mockClient.disconnect).toHaveBeenCalled();
    expect(cleanupQueue).toHaveBeenCalledWith('sess-009');
  });

  it('uses path.basename(cwd) as project name', async () => {
    vi.mocked(readQueue).mockReturnValue([
      makeEntry({ processed: false }),
    ]);

    const mockClient = {
      call: vi.fn()
        .mockResolvedValueOnce({ added: 1, merged: 0, skipped: 0 })
        .mockResolvedValueOnce({ status: 'ok' }),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-010', cwd: '/home/user/my-app' });

    expect(mockClient.call).toHaveBeenCalledWith(
      'curate',
      expect.objectContaining({ project: 'my-app' }),
      expect.any(Number),
    );
  });

  it('always outputs valid JSON', async () => {
    vi.mocked(readQueue).mockReturnValue([]);
    vi.mocked(IPCClient.connect).mockResolvedValue(null);

    await sessionEndMain({ session_id: 'sess-011', cwd: '/test' });

    expect(() => JSON.parse(stdoutCapture.output_value)).not.toThrow();
    expect(JSON.parse(stdoutCapture.output_value)).toEqual({});
  });

  it('does not call curate when all entries are already processed', async () => {
    const entries = [
      makeEntry({ processed: true }),
      makeEntry({ processed: true }),
    ];
    vi.mocked(readQueue).mockReturnValue(entries);

    const mockClient = {
      call: vi.fn().mockResolvedValue({ status: 'ok' }),
      disconnect: vi.fn(),
    };
    vi.mocked(IPCClient.connect).mockResolvedValue(mockClient as any);

    await sessionEndMain({ session_id: 'sess-012', cwd: '/project' });

    // Only session_unregister should be called, no curate
    expect(mockClient.call).toHaveBeenCalledTimes(1);
    expect(mockClient.call).toHaveBeenCalledWith(
      'session_unregister',
      { session_id: 'sess-012' },
      5000,
    );
    expect(cleanupQueue).toHaveBeenCalledWith('sess-012');
  });
});
