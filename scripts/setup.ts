import fs from 'fs';
import path from 'path';
import https from 'https';
import { getModelsDir } from '../shared/platform.js';

const MODEL_NAME = 'all-MiniLM-L6-v2';

// Download sources in priority order: HuggingFace → hf-mirror → ModelScope
const SOURCES = [
  {
    name: 'HuggingFace',
    baseUrl: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main',
  },
  {
    name: 'hf-mirror',
    baseUrl: 'https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main',
  },
  {
    name: 'ModelScope',
    baseUrl: 'https://modelscope.cn/models/sentence-transformers/all-MiniLM-L6-v2/resolve/master',
  },
];

const MODEL_FILES = [
  { name: 'model.onnx', path: 'onnx/model.onnx', description: 'ONNX model weights' },
  { name: 'tokenizer.json', path: 'tokenizer.json', description: 'Tokenizer vocabulary' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DOWNLOAD_TIMEOUT_MS = 30000;

// Download a file with progress reporting, following redirects and timeout
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const req = https.get(currentUrl, (res) => {
        // Follow redirects (resolve relative URLs against the current URL)
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, currentUrl).href;
          doRequest(redirectUrl, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        clearTimeout(timeout);

        const totalSize = parseInt(res.headers['content-length'] ?? '0', 10);
        let downloaded = 0;
        let lastPercent = -1;

        const file = fs.createWriteStream(dest);
        res.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          if (totalSize > 0) {
            const percent = Math.floor((downloaded / totalSize) * 100);
            if (percent !== lastPercent && percent % 10 === 0) {
              lastPercent = percent;
              process.stderr.write(`\r  [ACE] Downloading... ${formatBytes(downloaded)} / ${formatBytes(totalSize)} (${percent}%)`);
            }
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          if (totalSize > 0) {
            process.stderr.write('\n');
          }
          resolve();
        });
        file.on('error', (err) => {
          try { fs.unlinkSync(dest); } catch { /* ignore */ }
          reject(err);
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      const timeout = setTimeout(() => {
        req.destroy();
        reject(new Error('Connection timeout'));
      }, DOWNLOAD_TIMEOUT_MS);
    };

    doRequest(url, 0);
  });
}

// Try downloading a file from multiple sources, fallback on failure
async function downloadWithFallback(filePath: string, dest: string, description: string): Promise<string> {
  for (let i = 0; i < SOURCES.length; i++) {
    const source = SOURCES[i];
    const url = `${source.baseUrl}/${filePath}`;
    try {
      process.stderr.write(`[ACE] [${source.name}] Downloading ${description}...\n`);
      await downloadFile(url, dest);
      return source.name;
    } catch (err: any) {
      try { fs.unlinkSync(dest); } catch { /* ignore */ }
      if (i < SOURCES.length - 1) {
        process.stderr.write(`[ACE] [${source.name}] Failed: ${err.message}, trying next mirror...\n`);
      } else {
        throw new Error(`All sources failed for ${description}. Last error: ${err.message}`);
      }
    }
  }
  throw new Error('Unreachable');
}

export async function setup(): Promise<void> {
  const modelDir = path.join(getModelsDir(), MODEL_NAME);

  // Check if already downloaded
  const modelPath = path.join(modelDir, 'model.onnx');
  const tokenizerPath = path.join(modelDir, 'tokenizer.json');

  if (fs.existsSync(modelPath) && fs.existsSync(tokenizerPath)) {
    const stats = fs.statSync(modelPath);
    console.error(`[ACE] ONNX model already exists at ${modelDir} (${formatBytes(stats.size)})`);
    console.error('[ACE] To re-download, delete the directory and run setup again.');
    return;
  }

  // Create model directory
  fs.mkdirSync(modelDir, { recursive: true });

  console.error(`[ACE] Setting up ONNX embedding model: ${MODEL_NAME}`);
  console.error(`[ACE] Target directory: ${modelDir}`);
  console.error(`[ACE] Sources: ${SOURCES.map(s => s.name).join(' → ')}`);
  console.error('');

  for (const file of MODEL_FILES) {
    const destPath = path.join(modelDir, file.name);

    try {
      await downloadWithFallback(file.path, destPath, `${file.description} (${file.name})`);
    } catch (err: any) {
      console.error(`\n[ACE] ERROR: ${err.message}`);
      // Cleanup partial downloads
      try { fs.unlinkSync(destPath); } catch { /* ignore */ }
      throw err;
    }
  }

  // Verify files
  console.error('');
  for (const file of MODEL_FILES) {
    const destPath = path.join(modelDir, file.name);
    if (!fs.existsSync(destPath)) {
      throw new Error(`[ACE] Verification failed: ${file.name} not found after download`);
    }
    const stats = fs.statSync(destPath);
    console.error(`[ACE] ✓ ${file.name} (${formatBytes(stats.size)})`);
  }

  console.error('');
  console.error('[ACE] ONNX model setup complete! Semantic search is now available.');
  console.error('[ACE] Restart your Claude Code session to activate hybrid search.');
}

// CLI entry point
if (process.argv[1] && (process.argv[1].endsWith('setup.js') || process.argv[1].endsWith('setup.ts'))) {
  setup().catch((err) => {
    console.error(`[ACE] Setup failed: ${err.message}`);
    process.exit(1);
  });
}
