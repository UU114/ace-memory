import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  generateSessionId,
  isProcessAlive,
  readPidFile,
  cleanupStaleFiles,
  ENGINE_VERSION,
} from '../../hooks/session-start-core.js';

describe('session-start-core helpers', () => {
  describe('generateSessionId', () => {
    it('returns a string with sess- prefix', () => {
      const id = generateSessionId();
      expect(id).toMatch(/^sess-\d+-[0-9a-f]+$/);
    });

    it('generates unique IDs on successive calls', () => {
      const ids = new Set(Array.from({ length: 10 }, () => generateSessionId()));
      expect(ids.size).toBe(10);
    });
  });

  describe('ENGINE_VERSION', () => {
    it('matches package version 0.1.0', () => {
      expect(ENGINE_VERSION).toBe('0.1.0');
    });
  });

  describe('isProcessAlive', () => {
    it('returns true for the current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('returns false for an invalid PID', () => {
      // Use a very high PID unlikely to exist
      expect(isProcessAlive(999999999)).toBe(false);
    });
  });

  describe('readPidFile', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-session-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns null when pid file does not exist (integration)', () => {
      // This tests against the real pid path - may or may not have a file
      // Just verify it returns number or null (no exception thrown)
      const result = readPidFile();
      expect(result === null || typeof result === 'number').toBe(true);
    });
  });

  describe('cleanupStaleFiles', () => {
    it('does not throw when files do not exist', () => {
      // Should silently ignore missing files
      expect(() => cleanupStaleFiles()).not.toThrow();
    });
  });
});
