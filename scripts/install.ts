import fs from 'fs';
import path from 'path';
import { getDataDir } from '../shared/platform.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { aceLog } from '../shared/logger.js';
import { injectClaudeMd } from '../shared/claude-md.js';

// Create required data directories
function ensureDirectories(): void {
  const dataDir = getDataDir();
  fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'models'), { recursive: true });
}

// Write default config.json if it does not exist
function ensureConfig(): void {
  const configPath = path.join(getDataDir(), 'config.json');
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    aceLog('Created default config');
  }
}

function main(): void {
  try {
    ensureDirectories();
    ensureConfig();
    injectClaudeMd(process.cwd());
    aceLog('Installed successfully. Run /ace setup to download the ONNX embedding model.');
  } catch (err) {
    aceLog(`Install warning: ${err}`);
  }
}

main();
