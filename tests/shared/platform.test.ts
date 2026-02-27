import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import {
  getDataDir,
  getSocketPath,
  getPidPath,
  getMetaPath,
  getSessionDir,
  getDbPath,
  getConfigPath,
} from '../../shared/platform.js';

describe('platform', () => {
  const home = os.homedir();
  const dataDir = path.join(home, '.ace-claude');

  it('getDataDir returns ~/.ace-claude', () => {
    expect(getDataDir()).toBe(dataDir);
  });

  it('getSocketPath returns platform-appropriate path', () => {
    const socketPath = getSocketPath();
    if (process.platform === 'win32') {
      expect(socketPath).toBe('\\\\.\\pipe\\ace-claude-daemon');
    } else {
      expect(socketPath).toBe(path.join(dataDir, 'daemon.sock'));
    }
  });

  it('getPidPath returns daemon.pid path', () => {
    expect(getPidPath()).toBe(path.join(dataDir, 'daemon.pid'));
  });

  it('getMetaPath returns daemon.meta.json path', () => {
    expect(getMetaPath()).toBe(path.join(dataDir, 'daemon.meta.json'));
  });

  it('getSessionDir returns sessions directory path', () => {
    expect(getSessionDir()).toBe(path.join(dataDir, 'sessions'));
  });

  it('getDbPath returns playbook.db path', () => {
    expect(getDbPath()).toBe(path.join(dataDir, 'playbook.db'));
  });

  it('getConfigPath returns config.json path', () => {
    expect(getConfigPath()).toBe(path.join(dataDir, 'config.json'));
  });
});
