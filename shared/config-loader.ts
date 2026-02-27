import fs from 'fs';
import path from 'path';
import type { AceConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { getDataDir, getConfigPath } from './platform.js';
import { aceLog, aceWarn } from './logger.js';

// Deep merge source into target (source overrides target)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      srcVal !== undefined &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal) &&
      tgtVal !== null
    ) {
      result[key] = deepMerge(tgtVal, srcVal);
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

// Load config from ~/.ace-claude/config.json
// Creates default config if not exists
export function loadConfig(): AceConfig {
  const dataDir = getDataDir();
  const configPath = getConfigPath();

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    aceLog(`Created data directory: ${dataDir}`);
  }

  // Create default config if not exists
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    aceLog(`Created default config: ${configPath}`);
    return { ...DEFAULT_CONFIG };
  }

  // Read and merge with defaults (user config may be partial)
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(raw) as Partial<AceConfig>;
    return deepMerge(DEFAULT_CONFIG, userConfig);
  } catch (err) {
    aceWarn(`Failed to parse config, using defaults: ${err}`);
    return { ...DEFAULT_CONFIG };
  }
}

// Save config to disk
export function saveConfig(config: AceConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
