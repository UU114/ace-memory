import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { IPCClient } from '../shared/ipc-client.js';
import { getPidPath, getSocketPath, getMetaPath } from '../shared/platform.js';
import { aceLog, aceWarn, aceError, aceDebug } from '../shared/logger.js';
import type { PingResult } from '../types/ipc.js';

export const ENGINE_VERSION = '0.1.0';

/** Read stdin synchronously (Windows-compatible using fd 0) */
export function readStdinSync(): string {
  try {
    return fs.readFileSync(0, 'utf-8');
  } catch {
    return '{}';
  }
}

/** Generate a session ID if not provided */
export function generateSessionId(): string {
  const hex = Math.random().toString(16).slice(2, 10);
  return `sess-${Date.now()}-${hex}`;
}

/** Check if a process is alive by PID */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read PID from daemon.pid file */
export function readPidFile(): number | null {
  const pidPath = getPidPath();
  if (!fs.existsSync(pidPath)) return null;
  try {
    const content = fs.readFileSync(pidPath, 'utf-8').trim();
    const pid = parseInt(content, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

/** Clean up stale PID, meta, and socket files */
export function cleanupStaleFiles(): void {
  try { fs.unlinkSync(getPidPath()); } catch { /* ignore */ }
  try { fs.unlinkSync(getMetaPath()); } catch { /* ignore */ }
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(getSocketPath()); } catch { /* ignore */ }
  }
}

/** Spawn daemon as detached background process */
export function spawnDaemon(): void {
  const daemonPath = path.join(__dirname, '..', 'daemon', 'index.js');
  const child = spawn('node', [daemonPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, ACE_DAEMON: '1' },
  });
  child.unref();
  aceLog(`Spawned daemon process`);
}

/** Wait for a process to exit (with timeout) */
export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return;
    await new Promise(r => setTimeout(r, 200));
  }
}

/** Poll daemon until ready (IPC ping succeeds) */
export async function pollDaemonReady(timeoutMs: number, intervalMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const client = await IPCClient.connect(500);
    if (client) {
      try {
        await client.call('ping', {}, 1000);
        client.disconnect();
        return true;
      } catch {
        client.disconnect();
      }
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/** Core session-start logic */
export async function sessionStartMain(): Promise<void> {
  const raw = readStdinSync();
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    input = {};
  }
  const sessionId = (typeof input.session_id === 'string' && input.session_id)
    ? input.session_id
    : generateSessionId();

  try {
    // Step 1: Check existing daemon via PID file
    aceDebug(`SessionStart: checking existing daemon...`);
    const existingPid = readPidFile();
    if (existingPid !== null && isProcessAlive(existingPid)) {
      aceDebug(`SessionStart: found alive daemon pid=${existingPid}, attempting IPC ping`);
      const client = await IPCClient.connect(500);
      if (client) {
        try {
          const pong = await client.call<PingResult>('ping', {}, 1000);
          if (pong.version === ENGINE_VERSION) {
            // Reuse existing daemon
            await client.call('session_register', { session_id: sessionId, pid: process.ppid }, 1000);
            client.disconnect();
            aceDebug(`SessionStart: reusing existing daemon (version=${pong.version})`);
            aceLog(`Reused existing daemon (session: ${sessionId})`);
            process.stdout.write('{}');
            return;
          }
          // Version mismatch - shutdown old daemon
          aceDebug(`SessionStart: version mismatch (running=${pong.version}, expected=${ENGINE_VERSION})`);
          aceLog(`Version mismatch (${pong.version} != ${ENGINE_VERSION}), restarting daemon`);
          await client.call('shutdown', {}, 1000);
          client.disconnect();
          await waitForProcessExit(existingPid, 3000);
        } catch {
          client.disconnect();
        }
      }
    } else {
      aceDebug(`SessionStart: no running daemon found (pid=${existingPid})`);
    }

    // Step 2: Cleanup stale files
    aceDebug(`SessionStart: cleaning up stale files`);
    cleanupStaleFiles();

    // Step 3: Spawn new daemon
    aceDebug(`SessionStart: spawning new daemon process`);
    spawnDaemon();

    // Step 4: Wait for daemon to become ready
    aceDebug(`SessionStart: polling daemon readiness (timeout=5000ms)`);
    const ready = await pollDaemonReady(5000, 200);
    if (ready) {
      aceDebug(`SessionStart: daemon is ready, registering session`);
      const client = await IPCClient.connect(500);
      if (client) {
        await client.call('session_register', { session_id: sessionId, pid: process.ppid }, 1000);
        client.disconnect();
        aceLog(`Daemon started and session registered (session: ${sessionId})`);
      }
    } else {
      aceDebug(`SessionStart: daemon failed to respond within timeout`);
      aceWarn('Daemon failed to start, running in degraded mode');
    }
  } catch (err) {
    aceError(`SessionStart error: ${err}`);
  }

  process.stdout.write('{}');
}
