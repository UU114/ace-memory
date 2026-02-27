import fs from 'fs';
import path from 'path';
import { getModelPath } from '../shared/platform.js';
import { aceLog, aceWarn, aceError } from '../shared/logger.js';

const MODEL_NAME = 'all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;
const MAX_SEQ_LENGTH = 256;

// Tokenizer vocabulary and config loaded from tokenizer.json
interface TokenizerConfig {
  vocab: Map<string, number>;
  unkTokenId: number;
  clsTokenId: number;
  sepTokenId: number;
  padTokenId: number;
}

// Load and parse tokenizer.json (HuggingFace format)
function loadTokenizer(tokenizerPath: string): TokenizerConfig {
  const raw = JSON.parse(fs.readFileSync(tokenizerPath, 'utf-8'));
  const vocab = new Map<string, number>();

  // HuggingFace tokenizer.json has model.vocab as array of [token, id] pairs
  if (raw.model?.vocab) {
    if (Array.isArray(raw.model.vocab)) {
      for (const [token, id] of raw.model.vocab) {
        vocab.set(token, id);
      }
    } else {
      // Object format { token: id }
      for (const [token, id] of Object.entries(raw.model.vocab)) {
        vocab.set(token, id as number);
      }
    }
  }

  return {
    vocab,
    unkTokenId: vocab.get('[UNK]') ?? 100,
    clsTokenId: vocab.get('[CLS]') ?? 101,
    sepTokenId: vocab.get('[SEP]') ?? 102,
    padTokenId: vocab.get('[PAD]') ?? 0,
  };
}

// Simple WordPiece tokenization
function wordPieceTokenize(text: string, config: TokenizerConfig): number[] {
  const ids: number[] = [config.clsTokenId];

  // Basic pre-tokenization: lowercase, split on whitespace and punctuation
  const words = text
    .toLowerCase()
    .replace(/([^\w\u4e00-\u9fff])/g, ' $1 ')
    .split(/\s+/)
    .filter(w => w.length > 0);

  for (const word of words) {
    // Try to tokenize each word with WordPiece
    let remaining = word;
    let isFirst = true;

    while (remaining.length > 0) {
      if (ids.length >= MAX_SEQ_LENGTH - 1) break;

      let matched = false;
      // Try longest match first
      for (let end = remaining.length; end > 0; end--) {
        const sub = isFirst ? remaining.slice(0, end) : '##' + remaining.slice(0, end);
        if (config.vocab.has(sub)) {
          ids.push(config.vocab.get(sub)!);
          remaining = remaining.slice(end);
          matched = true;
          isFirst = false;
          break;
        }
      }

      if (!matched) {
        // Single CJK character check
        if (remaining.length > 0) {
          const char = remaining[0];
          if (config.vocab.has(char)) {
            ids.push(config.vocab.get(char)!);
          } else {
            ids.push(config.unkTokenId);
          }
          remaining = remaining.slice(1);
          isFirst = false;
        }
      }
    }

    if (ids.length >= MAX_SEQ_LENGTH - 1) break;
  }

  ids.push(config.sepTokenId);
  return ids;
}

// Cosine similarity between two vectors
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dotProduct / denom;
}

// L2-normalize a vector in place
function l2Normalize(vec: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < vec.length; i++) {
      vec[i] /= norm;
    }
  }
  return vec;
}

// Mean pooling over token embeddings with attention mask
function meanPool(
  lastHiddenState: Float32Array,
  attentionMask: BigInt64Array,
  seqLen: number,
  hiddenDim: number,
): Float32Array {
  const result = new Float32Array(hiddenDim);
  let maskSum = 0;

  for (let i = 0; i < seqLen; i++) {
    const mask = Number(attentionMask[i]);
    if (mask === 0) continue;
    maskSum += mask;
    const offset = i * hiddenDim;
    for (let j = 0; j < hiddenDim; j++) {
      result[j] += lastHiddenState[offset + j] * mask;
    }
  }

  if (maskSum > 0) {
    for (let j = 0; j < hiddenDim; j++) {
      result[j] /= maskSum;
    }
  }

  return result;
}

export class OnnxEmbedding {
  private session: any | null = null;
  private tokenizer: TokenizerConfig | null = null;
  private modelDir: string;
  private _initialized = false;

  constructor(modelDir?: string) {
    this.modelDir = modelDir ?? getModelPath(MODEL_NAME);
  }

  // Check if model files exist on disk
  isModelAvailable(): boolean {
    const modelFile = path.join(this.modelDir, 'model.onnx');
    const tokenizerFile = path.join(this.modelDir, 'tokenizer.json');
    return fs.existsSync(modelFile) && fs.existsSync(tokenizerFile);
  }

  get initialized(): boolean {
    return this._initialized;
  }

  getModelDir(): string {
    return this.modelDir;
  }

  static getDefaultModelDir(): string {
    return getModelPath(MODEL_NAME);
  }

  static get modelName(): string {
    return MODEL_NAME;
  }

  static get embeddingDim(): number {
    return EMBEDDING_DIM;
  }

  // Initialize ONNX session and tokenizer
  async init(): Promise<void> {
    if (this._initialized) return;

    if (!this.isModelAvailable()) {
      throw new Error(
        `[ACE] ONNX model not found at ${this.modelDir}. Run "ace setup" to download.`,
      );
    }

    const modelFile = path.join(this.modelDir, 'model.onnx');
    const tokenizerFile = path.join(this.modelDir, 'tokenizer.json');

    // Dynamic import to avoid crash when onnxruntime-node is not installed
    const ort = await import('onnxruntime-node');

    aceLog(`Loading ONNX model from ${this.modelDir}...`);
    this.session = await ort.InferenceSession.create(modelFile, {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    });

    this.tokenizer = loadTokenizer(tokenizerFile);
    this._initialized = true;
    aceLog(`ONNX model loaded (${EMBEDDING_DIM}-dim, vocab size: ${this.tokenizer.vocab.size})`);
  }

  // Embed a single text string → Float32Array (384-dim)
  async embed(text: string): Promise<Float32Array> {
    if (!this._initialized || !this.session || !this.tokenizer) {
      throw new Error('[ACE] OnnxEmbedding not initialized. Call init() first.');
    }

    const ort = await import('onnxruntime-node');

    // Tokenize
    const inputIds = wordPieceTokenize(text, this.tokenizer);
    const seqLen = inputIds.length;
    const attentionMask = new Array(seqLen).fill(1);
    const tokenTypeIds = new Array(seqLen).fill(0);

    // Create tensors
    const inputIdsTensor = new ort.Tensor('int64', BigInt64Array.from(inputIds.map(BigInt)), [1, seqLen]);
    const attentionMaskTensor = new ort.Tensor('int64', BigInt64Array.from(attentionMask.map(BigInt)), [1, seqLen]);
    const tokenTypeIdsTensor = new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds.map(BigInt)), [1, seqLen]);

    // Run inference
    const feeds: Record<string, any> = {
      input_ids: inputIdsTensor,
      attention_mask: attentionMaskTensor,
      token_type_ids: tokenTypeIdsTensor,
    };

    const results = await this.session.run(feeds);

    // Get the last_hidden_state output (shape: [1, seq_len, 384])
    const outputName = this.session.outputNames[0];
    const output = results[outputName];
    const hiddenState = output.data as Float32Array;

    // Mean pooling + L2 normalize
    const pooled = meanPool(hiddenState, attentionMaskTensor.data as BigInt64Array, seqLen, EMBEDDING_DIM);
    return l2Normalize(pooled);
  }

  // Embed multiple texts (sequential for simplicity, ONNX session is single-threaded anyway)
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  // Release ONNX session resources
  async dispose(): Promise<void> {
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.tokenizer = null;
    this._initialized = false;
    aceLog('ONNX session released');
  }
}
