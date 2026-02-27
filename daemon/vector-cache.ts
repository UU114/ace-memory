import { cosineSimilarity } from '../engine/embedding.js';
import type { AceDatabase } from '../storage/sqlite.js';
import { aceLog } from '../shared/logger.js';

// In-memory vector cache for brute-force semantic search
// Memory: 5000 bullets × 384 dims × 4 bytes = ~7.5MB
export class VectorCache {
  private vectors: Map<string, Float32Array> = new Map();

  // Load all active bullet embeddings from SQLite into memory
  async loadFromDb(db: AceDatabase): Promise<void> {
    const rows = db.getAllEmbeddings();
    this.vectors.clear();
    for (const row of rows) {
      this.vectors.set(row.id, row.embedding);
    }
    aceLog(`Vector cache loaded: ${this.vectors.size} embeddings`);
  }

  // Add or update a single embedding
  add(bulletId: string, embedding: Float32Array): void {
    this.vectors.set(bulletId, embedding);
  }

  // Remove an embedding by bullet ID
  remove(bulletId: string): void {
    this.vectors.delete(bulletId);
  }

  // Check if a bullet ID exists in the cache
  has(bulletId: string): boolean {
    return this.vectors.has(bulletId);
  }

  // Get embedding by bullet ID
  get(bulletId: string): Float32Array | undefined {
    return this.vectors.get(bulletId);
  }

  // Brute-force cosine similarity search over all cached vectors
  searchSimilar(
    query: Float32Array,
    limit: number,
  ): Array<{ id: string; score: number }> {
    const results: Array<{ id: string; score: number }> = [];

    for (const [id, vec] of this.vectors) {
      const score = cosineSimilarity(query, vec);
      results.push({ id, score });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  // Number of cached embeddings
  get size(): number {
    return this.vectors.size;
  }

  // Clear all cached embeddings
  clear(): void {
    this.vectors.clear();
  }
}
