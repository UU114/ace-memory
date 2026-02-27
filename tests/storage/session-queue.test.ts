import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { SessionQueueEntry } from '../../types/hook.js';
import { appendToQueue, readQueue, markProcessed, cleanupQueue } from '../../storage/session-queue.js';

describe('session-queue', () => {
  const testDir = path.join(os.tmpdir(), `ace-queue-test-${Date.now()}`);
  let originalHomedir: () => string;

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
    originalHomedir = os.homedir;
    os.homedir = () => testDir;

    // Ensure sessions dir exists
    fs.mkdirSync(path.join(testDir, '.ace-claude', 'sessions'), { recursive: true });
  });

  afterEach(() => {
    os.homedir = originalHomedir;
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  function makeEntry(overrides: Partial<SessionQueueEntry> = {}): SessionQueueEntry {
    return {
      timestamp: new Date().toISOString(),
      tool_name: 'Edit',
      pattern_type: 'code_pattern',
      summary: 'Test entry',
      context: {},
      processed: false,
      ...overrides,
    };
  }

  it('appends and reads entries', () => {
    const entry1 = makeEntry({ timestamp: '2026-01-01T00:00:00Z', summary: 'First' });
    const entry2 = makeEntry({ timestamp: '2026-01-01T00:01:00Z', summary: 'Second' });

    appendToQueue('session-1', entry1);
    appendToQueue('session-1', entry2);

    const entries = readQueue('session-1');
    expect(entries).toHaveLength(2);
    expect(entries[0].summary).toBe('First');
    expect(entries[1].summary).toBe('Second');
  });

  it('returns empty array for non-existent queue', () => {
    const entries = readQueue('no-such-session');
    expect(entries).toEqual([]);
  });

  it('marks entries as processed', () => {
    const entry1 = makeEntry({ timestamp: '2026-01-01T00:00:00Z' });
    const entry2 = makeEntry({ timestamp: '2026-01-01T00:01:00Z' });

    appendToQueue('session-2', entry1);
    appendToQueue('session-2', entry2);

    markProcessed('session-2', ['2026-01-01T00:00:00Z']);

    const entries = readQueue('session-2');
    expect(entries[0].processed).toBe(true);
    expect(entries[1].processed).toBe(false);
  });

  it('cleans up queue file', () => {
    appendToQueue('session-3', makeEntry());
    const queuePath = path.join(testDir, '.ace-claude', 'sessions', 'session-3.jsonl');
    expect(fs.existsSync(queuePath)).toBe(true);

    cleanupQueue('session-3');
    expect(fs.existsSync(queuePath)).toBe(false);
  });

  it('cleanup is safe for non-existent queue', () => {
    // Should not throw
    cleanupQueue('no-such-session');
  });
});
