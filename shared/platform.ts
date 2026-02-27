import os from 'os';
import path from 'path';

export function getDataDir(): string {
  return path.join(os.homedir(), '.ace-claude');
}

export function getSocketPath(): string {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\ace-claude-daemon';
  }
  return path.join(getDataDir(), 'daemon.sock');
}

export function getPidPath(): string {
  return path.join(getDataDir(), 'daemon.pid');
}

export function getMetaPath(): string {
  return path.join(getDataDir(), 'daemon.meta.json');
}

export function getSessionDir(): string {
  return path.join(getDataDir(), 'sessions');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'playbook.db');
}

export function getConfigPath(): string {
  return path.join(getDataDir(), 'config.json');
}

export function getModelsDir(): string {
  return path.join(getDataDir(), 'models');
}

export function getModelPath(modelName: string): string {
  return path.join(getModelsDir(), modelName);
}
