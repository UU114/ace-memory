import type { AceDatabase } from '../storage/sqlite.js';
import type { LifecycleManager } from './lifecycle.js';
import type { OnnxEmbedding } from '../engine/embedding.js';
import type { VectorCache } from './vector-cache.js';
import type { SearchConfig } from '../types/config.js';
import type { SessionQueueEntry } from '../types/hook.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { Generator } from '../engine/generator.js';
import { DecayManager } from '../engine/decay.js';
import { Reflector } from '../engine/reflector.js';
import { Curator } from '../engine/curator.js';
import { Sanitizer } from '../engine/sanitizer.js';
import { Classifier } from '../engine/classifier.js';
import { ConflictDetector } from '../engine/conflict-detector.js';
import { aceLog, aceWarn } from '../shared/logger.js';

const VERSION = '0.1.0';

// Routes IPC requests to the appropriate handler logic
export class IPCHandler {
  private generator = new Generator();

  constructor(
    private db: AceDatabase,
    private lifecycle: LifecycleManager,
    private embedding: OnnxEmbedding,
    private vectorCache: VectorCache,
    private searchConfig: SearchConfig,
  ) {}

  // Dispatch a method call and return the result
  async handle(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'ping':
        return {
          status: 'ok',
          version: VERSION,
          uptime: this.lifecycle.getUptime(),
          active_sessions: this.lifecycle.getActiveSessionCount(),
        };

      case 'recall':
        return this.handleRecall(params);

      case 'curate':
        return this.handleCurate(params);

      case 'embed': {
        if (!this.embedding.initialized) {
          return { vector: [] };
        }
        const text = params.text as string;
        const vec = await this.embedding.embed(text);
        return { vector: Array.from(vec) };
      }

      case 'session_register': {
        const sessionId = params.session_id as string;
        const pid = params.pid as number;
        this.lifecycle.registerSession(sessionId, pid);
        return { status: 'ok' };
      }

      case 'session_unregister': {
        const sessionId = params.session_id as string;
        this.lifecycle.unregisterSession(sessionId);
        return { status: 'ok' };
      }

      case 'shutdown':
        // Trigger graceful shutdown after response is sent
        setTimeout(() => process.emit('SIGTERM' as NodeJS.Signals), 100);
        return { status: 'shutting_down' };

      case 'stats':
        return this.db.getStats();

      case 'decay_update':
        return this.handleDecayUpdate();

      case 'conflicts_check': {
        const bulletId = params.bullet_id as string;
        const bullet = this.db.getBulletById(bulletId);
        if (!bullet) return { conflicts: 0 };
        const detector = new ConflictDetector(this.db, this.vectorCache);
        const detected = await detector.detect(bullet);
        for (const c of detected) {
          this.db.insertConflict(c);
        }
        return { conflicts: detected.length };
      }

      case 'conflicts_list': {
        const resolved = params.resolved as boolean | undefined;
        return { conflicts: this.db.getConflicts(resolved) };
      }

      default:
        throw new Error(`Method not found: ${method}`);
    }
  }

  // Handle curate: distill session insights into bullets and store them
  private async handleCurate(params: Record<string, unknown>): Promise<{ added: number; merged: number; skipped: number }> {
    const insights = params.insights as SessionQueueEntry[];
    const projectName = (params.project as string) || 'unknown';

    const reflector = new Reflector(
      new Sanitizer(),
      new Classifier(DEFAULT_CONFIG.reflector.min_interaction_quality * 100),
      this.embedding.initialized ? this.embedding : null,
    );

    const curator = new Curator(this.db, this.vectorCache);

    const { bullets, skipped } = await reflector.distill(insights, projectName);

    let added = 0, merged = 0;
    let curatorSkipped = 0;
    for (const bullet of bullets) {
      const result = await curator.curate(bullet);
      if (result === 'added') added++;
      else if (result === 'merged') merged++;
      else curatorSkipped++;
    }

    return { added, merged, skipped: skipped + curatorSkipped };
  }

  // Handle decay update: recompute weights, archive decayed bullets
  private handleDecayUpdate(): { updated: number; archived: number } {
    const bullets = this.db.queryBullets({});
    const decayManager = new DecayManager(DEFAULT_CONFIG.decay);
    const { updates, toArchive } = decayManager.processAll(bullets);

    for (const { id, decay_weight } of updates) {
      this.db.updateBullet(id, { decay_weight });
    }

    for (const id of toArchive) {
      this.db.archiveBullet(id);
      this.vectorCache.remove(id);
    }

    aceLog(`Decay update complete: ${updates.length} updated, ${toArchive.length} archived`);
    return { updated: updates.length, archived: toArchive.length };
  }

  // Handle recall: hybrid search when ONNX available, keyword-only otherwise
  private async handleRecall(params: Record<string, unknown>): Promise<{ bullets: unknown[] }> {
    const query = params.query as string;
    const project = params.project as string;
    const limit = (params.limit as number) ?? this.searchConfig.max_results;

    if (!query?.trim()) {
      return { bullets: [] };
    }

    // Fetch bullets from DB (scoped to project + global)
    const scopes = [`project:${project}`, 'global'];
    const bullets = this.db.queryBullets({
      scopes,
      minDecayWeight: 0.02, // archive_threshold
    });

    if (bullets.length === 0) {
      return { bullets: [] };
    }

    // Compute query embedding if ONNX is available
    let queryVec: Float32Array | null = null;
    if (this.embedding.initialized) {
      try {
        queryVec = await this.embedding.embed(query);
      } catch (err: any) {
        aceWarn(`Embedding query failed, using keyword-only: ${err.message}`);
      }
    } else {
      aceLog('keyword-only mode');
    }

    // Run hybrid search
    const results = this.generator.hybridSearch(
      query,
      queryVec,
      this.vectorCache,
      bullets,
      {
        keywordWeight: this.searchConfig.keyword_weight,
        semanticWeight: this.searchConfig.semantic_weight,
        recencyBoostDays: this.searchConfig.recency_boost_days,
        recencyBoostFactor: this.searchConfig.recency_boost_factor,
        limit,
        minScore: this.searchConfig.min_score_threshold,
      },
    );

    // Update recall_count and last_recall for returned bullets
    const now = new Date().toISOString();
    for (const r of results) {
      try {
        this.db.updateBullet(r.bullet.id, {
          recall_count: r.bullet.recall_count + 1,
          last_recall: now,
        });
      } catch {
        // Non-critical, continue
      }
    }

    return { bullets: results.map(r => r.bullet) };
  }
}
