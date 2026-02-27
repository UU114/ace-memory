import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { loadConfig, saveConfig } from '../../shared/config-loader.js';
import { DEFAULT_CONFIG } from '../../types/config.js';

describe('config-loader', () => {
  const testDir = path.join(os.tmpdir(), `ace-test-${Date.now()}`);
  let originalHomedir: () => string;

  beforeEach(() => {
    // Create isolated test directory
    fs.mkdirSync(testDir, { recursive: true });

    // Override os.homedir()
    originalHomedir = os.homedir;
    os.homedir = () => testDir;
  });

  afterEach(() => {
    // Restore os.homedir
    os.homedir = originalHomedir;

    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('creates default config when none exists', () => {
    const config = loadConfig();

    // Config should match defaults
    expect(config.decay.half_life_days).toBe(30);
    expect(config.reflector.max_content_length).toBe(500);
    expect(config.search.keyword_weight).toBe(0.6);
    expect(config.daemon.idle_timeout_minutes).toBe(5);

    // Config file should be created
    const configPath = path.join(testDir, '.ace-claude', 'config.json');
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it('creates data directory when not exists', () => {
    loadConfig();
    const dataDir = path.join(testDir, '.ace-claude');
    expect(fs.existsSync(dataDir)).toBe(true);
  });

  it('merges partial user config with defaults', () => {
    // Create partial config
    const dataDir = path.join(testDir, '.ace-claude');
    fs.mkdirSync(dataDir, { recursive: true });
    const partialConfig = {
      decay: { half_life_days: 60 },
      search: { max_results: 10 },
    };
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify(partialConfig),
      'utf-8',
    );

    const config = loadConfig();

    // Overridden values
    expect(config.decay.half_life_days).toBe(60);
    expect(config.search.max_results).toBe(10);

    // Default values still present
    expect(config.decay.grace_period_days).toBe(7);
    expect(config.search.keyword_weight).toBe(0.6);
    expect(config.reflector.max_content_length).toBe(500);
    expect(config.daemon.idle_timeout_minutes).toBe(5);
  });

  it('returns defaults on invalid JSON', () => {
    const dataDir = path.join(testDir, '.ace-claude');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'config.json'), 'not-json{{{', 'utf-8');

    const config = loadConfig();
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it('saveConfig writes config to disk', () => {
    const dataDir = path.join(testDir, '.ace-claude');
    fs.mkdirSync(dataDir, { recursive: true });

    const customConfig = {
      ...DEFAULT_CONFIG,
      decay: { ...DEFAULT_CONFIG.decay, half_life_days: 45 },
    };
    saveConfig(customConfig);

    const configPath = path.join(dataDir, 'config.json');
    const written = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(written.decay.half_life_days).toBe(45);
  });
});
