import fs from 'fs';
import path from 'path';
import { readQueue, cleanupQueue } from '../storage/session-queue.js';
import { IPCClient } from '../shared/ipc-client.js';
import { aceLog, aceWarn, aceDebug } from '../shared/logger.js';
import type { SessionEndInput } from '../types/hook.js';

const IPC_CONNECT_TIMEOUT = 500;
const IPC_CURATE_TIMEOUT = 30000;
const BATCH_SIZE = 20;

// Exported for testability
export async function sessionEndMain(input: SessionEndInput): Promise<void> {
  const { session_id, cwd } = input;

  if (!session_id) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Read remaining unprocessed entries
  const entries = readQueue(session_id);
  const unprocessed = entries.filter(e => !e.processed);

  aceDebug(`SessionEnd: session=${session_id}, total_entries=${entries.length}, unprocessed=${unprocessed.length}`);

  const client = await IPCClient.connect(IPC_CONNECT_TIMEOUT);
  let stats = { added: 0, merged: 0, skipped: 0 };

  if (client) {
    try {
      // Process remaining candidates in batches
      if (unprocessed.length > 0) {
        const projectName = path.basename(cwd || '');
        aceDebug(`SessionEnd: curating ${unprocessed.length} entries for project=${projectName}`);

        for (let i = 0; i < unprocessed.length; i += BATCH_SIZE) {
          const batch = unprocessed.slice(i, i + BATCH_SIZE);
          aceDebug(`SessionEnd: processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} entries)`);
          try {
            const result = await client.call<{ added: number; merged: number; skipped: number }>(
              'curate',
              { insights: batch, project: projectName },
              IPC_CURATE_TIMEOUT,
            );
            stats.added += result.added;
            stats.merged += result.merged;
            stats.skipped += result.skipped;
            aceDebug(`SessionEnd: batch result — added=${result.added}, merged=${result.merged}, skipped=${result.skipped}`);
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            aceWarn(`SessionEnd curate batch failed: ${message}`);
          }
        }
      }

      // Unregister session
      try {
        await client.call('session_unregister', { session_id }, 5000);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        aceWarn(`Session unregister failed: ${message}`);
      }
    } finally {
      client.disconnect();
    }
  } else {
    aceWarn('Daemon unavailable for SessionEnd processing');
  }

  // Always cleanup queue file regardless of daemon availability
  cleanupQueue(session_id);

  // Log summary
  aceLog(`Session complete. +${stats.added} new, ~${stats.merged} merged, -${stats.skipped} skipped`);

  process.stdout.write(JSON.stringify({}));
}

// Entry point: read stdin, parse, run
async function main(): Promise<void> {
  const raw = fs.readFileSync(0, 'utf-8');
  const input: SessionEndInput = JSON.parse(raw);
  await sessionEndMain(input);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
