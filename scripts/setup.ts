import fs from 'fs';
import path from 'path';
import https from 'https';
import { getModelsDir } from '../shared/platform.js';

const MODEL_NAME = 'all-MiniLM-L6-v2';

// HuggingFace raw file URLs for the ONNX model
const MODEL_FILES = [
  {
    name: 'model.onnx',
    url: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx',
    description: 'ONNX model weights',
  },
  {
    name: 'tokenizer.json',
    url: 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json',
    description: 'Tokenizer vocabulary',
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Download a file with progress reporting, following redirects
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl: string, redirectCount: number) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      https.get(currentUrl, (res) => {
        // Follow redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          return;
        }

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
          fs.unlinkSync(dest);
          reject(err);
        });
      }).on('error', reject);
    };

    doRequest(url, 0);
  });
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
  console.error('');

  for (const file of MODEL_FILES) {
    const destPath = path.join(modelDir, file.name);
    console.error(`[ACE] Downloading ${file.description} (${file.name})...`);

    try {
      await downloadFile(file.url, destPath);
    } catch (err: any) {
      console.error(`\n[ACE] ERROR: Failed to download ${file.name}: ${err.message}`);
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
