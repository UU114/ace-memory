import fs from 'fs';
import path from 'path';
import { readQueue, markProcessed } from '../storage/session-queue.js';
import { IPCClient } from '../shared/ipc-client.js';
import { aceLog, aceWarn, aceDebug } from '../shared/logger.js';
import type { StopInput } from '../types/hook.js';

const BATCH_THRESHOLD = 3;
const IPC_CONNECT_TIMEOUT = 200;
const IPC_CURATE_TIMEOUT = 10000;

// Exported for testability
export async function stopMain(input: StopInput): Promise<void> {
  const { session_id, cwd } = input;

  if (!session_id) {
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Read session queue
  const entries = readQueue(session_id);
  const unprocessed = entries.filter(e => !e.processed);

  aceDebug(`Stop: session=${session_id}, total_entries=${entries.length}, unprocessed=${unprocessed.length}, threshold=${BATCH_THRESHOLD}`);

  // Threshold check: skip if too few candidates
  if (unprocessed.length < BATCH_THRESHOLD) {
    aceDebug(`Stop: below threshold (${unprocessed.length} < ${BATCH_THRESHOLD}), deferring to SessionEnd`);
    aceLog(`Stop: ${unprocessed.length} unprocessed entries, below threshold ${BATCH_THRESHOLD}`);
    process.stdout.write(JSON.stringify({}));
    return;
  }

  // Connect to daemon
  const client = await IPCClient.connect(IPC_CONNECT_TIMEOUT);
  if (!client) {
    aceWarn('Daemon unavailable, deferring distillation to SessionEnd');
    process.stdout.write(JSON.stringify({}));
    return;
  }

  try {
    const projectName = path.basename(cwd || '');
    aceDebug(`Stop: sending ${unprocessed.length} entries to curate for project=${projectName}`);
    await client.call('curate', {
      insights: unprocessed,
      project: projectName,
    }, IPC_CURATE_TIMEOUT);

    // Mark processed
    const timestamps = unprocessed.map(e => e.timestamp);
    markProcessed(session_id, timestamps);
    aceDebug(`Stop: curate complete, marked ${timestamps.length} entries as processed`);
    aceLog(`Stop: curated ${unprocessed.length} entries`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    aceWarn(`Stop curate failed: ${message}`);
  } finally {
    client.disconnect();
  }

  process.stdout.write(JSON.stringify({}));
}

// Entry point: read stdin, parse, run
async function main(): Promise<void> {
  const raw = fs.readFileSync(0, 'utf-8');
  const input: StopInput = JSON.parse(raw);
  await stopMain(input);
}

main().catch(() => {
  process.stdout.write(JSON.stringify({}));
});
