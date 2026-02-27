import fs from 'fs';
import path from 'path';
import { getSessionDir } from '../shared/platform.js';
import type { SessionQueueEntry } from '../types/hook.js';

// Get the file path for a session's JSONL queue
function getQueuePath(sessionId: string): string {
  return path.join(getSessionDir(), `${sessionId}.jsonl`);
}

// Append an entry to the session queue (one JSON per line)
export function appendToQueue(sessionId: string, entry: SessionQueueEntry): void {
  const dir = getSessionDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(getQueuePath(sessionId), line, 'utf-8');
}

// Read all entries from the session queue
export function readQueue(sessionId: string): SessionQueueEntry[] {
  const filePath = getQueuePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.trim().split('\n').filter(line => line.trim() !== '');
  return lines.map(line => JSON.parse(line) as SessionQueueEntry);
}

// Mark entries as processed by their timestamps
export function markProcessed(sessionId: string, timestamps: string[]): void {
  const entries = readQueue(sessionId);
  const tsSet = new Set(timestamps);
  const updated = entries.map(entry => {
    if (tsSet.has(entry.timestamp)) {
      return { ...entry, processed: true };
    }
    return entry;
  });
  // Rewrite the file with updated entries
  const filePath = getQueuePath(sessionId);
  const content = updated.map(e => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, content, 'utf-8');
}

// Clean up a session's queue file
export function cleanupQueue(sessionId: string): void {
  const filePath = getQueuePath(sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
