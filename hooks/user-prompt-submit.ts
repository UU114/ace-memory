import fs from 'fs';
import path from 'path';
import { IPCClient } from '../shared/ipc-client.js';
import { getDbPath } from '../shared/platform.js';
import { loadConfig } from '../shared/config-loader.js';
import { aceWarn, aceError, aceDebug } from '../shared/logger.js';
import { AceDatabase } from '../storage/sqlite.js';
import { Generator } from '../engine/generator.js';
import { formatAceMemory } from '../shared/ace-memory-format.js';
import type { Bullet } from '../types/bullet.js';

// Read stdin synchronously
function readStdinSync(): string {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '{}';
  }
}

// Write to stdout
function write(data: string): void {
  process.stdout.write(data);
}

// Build the hook output JSON
function buildOutput(context: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: context,
    },
  });
}

// Try recall via Daemon IPC
async function recallViaDaemon(
  prompt: string,
  projectName: string,
  maxResults: number,
): Promise<Bullet[] | null> {
  const client = await IPCClient.connect(50);
  if (!client) return null;

  try {
    const result = await client.call<{ bullets: Bullet[] }>(
      'recall',
      {
        query: prompt,
        project: projectName,
        limit: maxResults,
      },
      80,
    );
    return result.bullets;
  } catch {
    return null;
  } finally {
    client.disconnect();
  }
}

// Fallback: direct SQLite + keyword search
function recallFallback(
  prompt: string,
  scopes: string[],
  config: ReturnType<typeof loadConfig>,
): Bullet[] {
  aceWarn('keyword-only mode');
  let db: AceDatabase | null = null;
  try {
    db = new AceDatabase(getDbPath());
    const bullets = db.queryBullets({
      scopes,
      minDecayWeight: config.decay.archive_threshold,
    });
    const generator = new Generator();
    const results = generator.keywordSearch(
      prompt,
      bullets,
      config.search.max_results,
      config.search.min_score_threshold,
    );
    // Update recall counts in degraded mode
    for (const r of results) {
      db.updateBullet(r.bullet.id, {
        recall_count: r.bullet.recall_count + 1,
        last_recall: new Date().toISOString(),
      });
    }
    return results.map((r) => ({
      ...r.bullet,
      recall_count: r.bullet.recall_count + 1,
    }));
  } catch (err) {
    aceError(`Fallback recall error: ${err}`);
    return [];
  } finally {
    if (db) db.close();
  }
}

async function main() {
  let input: { prompt?: string; cwd?: string; session_id?: string };
  try {
    input = JSON.parse(readStdinSync());
  } catch {
    write('{}');
    return;
  }

  const prompt = input.prompt?.trim();
  if (!prompt) {
    write('{}');
    return;
  }

  const cwd = input.cwd || process.cwd();
  const projectName = path.basename(cwd);
  const scopes = [`project:${projectName}`, 'global'];
  const config = loadConfig();

  aceDebug(`UserPromptSubmit: query="${prompt.slice(0, 80)}", project=${projectName}`);

  try {
    // Try Daemon first
    aceDebug(`UserPromptSubmit: attempting recall via daemon...`);
    let bullets = await recallViaDaemon(
      prompt,
      projectName,
      config.search.max_results,
    );

    // Fallback to direct SQLite
    if (bullets === null) {
      aceDebug(`UserPromptSubmit: daemon unavailable, falling back to direct SQLite`);
      bullets = recallFallback(prompt, scopes, config);
    }

    aceDebug(`UserPromptSubmit: recall returned ${bullets?.length ?? 0} bullets`);

    if (bullets && bullets.length > 0) {
      const context = formatAceMemory(
        bullets,
        config.search.max_context_tokens,
      );
      aceDebug(`UserPromptSubmit: injecting ${bullets.length} bullets as <ace-memory> (${context.length} chars)`);
      write(buildOutput(context));
      return;
    }

    aceDebug(`UserPromptSubmit: no relevant bullets found, skipping injection`);
  } catch (err) {
    aceError(`UserPromptSubmit error: ${err}`);
  }

  write('{}');
}

main().catch((err) => {
  aceError(`UserPromptSubmit fatal: ${err}`);
  write('{}');
});
