import fs from 'fs';
import { RulesEngine } from '../engine/rules-engine.js';
import { appendToQueue } from '../storage/session-queue.js';
import { aceError } from '../shared/logger.js';
import type { PostToolUseInput, SessionQueueEntry } from '../types/hook.js';

function readStdinSync(): string {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '{}';
  }
}

function main(): void {
  let input: PostToolUseInput;
  try {
    input = JSON.parse(readStdinSync());
  } catch {
    process.stdout.write('{}');
    return;
  }

  const { tool_name, tool_input, tool_response, session_id } = input;
  if (!tool_name || !session_id) {
    process.stdout.write('{}');
    return;
  }

  const engine = new RulesEngine();
  const candidate = engine.detect(tool_name, tool_input, tool_response);

  if (!candidate) {
    process.stdout.write('{}');
    return;
  }

  const entry: SessionQueueEntry = {
    timestamp: new Date().toISOString(),
    tool_name,
    pattern_type: candidate.pattern_type,
    summary: candidate.summary,
    context: candidate.context,
    processed: false,
  };

  try {
    appendToQueue(session_id, entry);
  } catch (err) {
    aceError(`Failed to write session queue: ${err}`);
  }

  process.stdout.write('{}');
}

try {
  main();
} catch (err) {
  aceError(`PostToolUse fatal: ${err}`);
  process.stdout.write('{}');
}
