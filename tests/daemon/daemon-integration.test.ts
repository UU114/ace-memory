import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { IPCServer } from '../../shared/ipc-server.js';
import { IPCClient } from '../../shared/ipc-client.js';
import { AceDatabase } from '../../storage/sqlite.js';
import { LifecycleManager } from '../../daemon/lifecycle.js';
import { IPCHandler } from '../../daemon/ipc-handler.js';
import { OnnxEmbedding } from '../../engine/embedding.js';
import type { DaemonConfig } from '../../types/config.js';

const daemonConfig: DaemonConfig = {
  idle_timeout_minutes: 5,
  max_idle_minutes: 10,
  session_check_interval_seconds: 60,
};

// Generate a unique named pipe path for each test run (Windows)
function getTestSocketPath(): string {
  const id = crypto.randomBytes(8).toString('hex');
  return `\\\\.\\pipe\\ace-daemon-test-${id}`;
}

describe('daemon integration', () => {
  let tmpDir: string;
  let db: AceDatabase;
  let server: IPCServer;
  let lifecycle: LifecycleManager;
  let handler: IPCHandler;
  let socketPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ace-daemon-int-'));
    const dbPath = path.join(tmpDir, 'test.db');
    db = new AceDatabase(dbPath);
    lifecycle = new LifecycleManager(daemonConfig);
    const embedding = new OnnxEmbedding(path.join(tmpDir, 'no-model'));
    handler = new IPCHandler(db, lifecycle, embedding);
    server = new IPCServer();

    // Wire up request handler (same as daemon/index.ts main)
    server.onRequest(async (method, params) => {
      lifecycle.recordRequest();
      return handler.handle(method, params);
    });

    socketPath = getTestSocketPath();
    await server.listen(socketPath);
  });

  afterEach(async () => {
    lifecycle.stop();
    await server.close();
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('client connects and pings daemon successfully', async () => {
    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    const result = await client!.call<{
      status: string;
      version: string;
      uptime: number;
      active_sessions: number;
    }>('ping');

    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.1.0');
    expect(typeof result.uptime).toBe('number');
    expect(result.active_sessions).toBe(0);

    client!.disconnect();
  });

  it('session register + unregister flow updates active_sessions', async () => {
    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    // Register a session
    const regResult = await client!.call<{ status: string }>('session_register', {
      session_id: 'test-session-1',
      pid: process.pid,
    });
    expect(regResult.status).toBe('ok');

    // Verify active_sessions is now 1
    const pingAfterReg = await client!.call<{ active_sessions: number }>('ping');
    expect(pingAfterReg.active_sessions).toBe(1);

    // Unregister the session
    const unregResult = await client!.call<{ status: string }>('session_unregister', {
      session_id: 'test-session-1',
    });
    expect(unregResult.status).toBe('ok');

    // Verify active_sessions is back to 0
    const pingAfterUnreg = await client!.call<{ active_sessions: number }>('ping');
    expect(pingAfterUnreg.active_sessions).toBe(0);

    client!.disconnect();
  });

  it('shutdown method returns shutting_down status', async () => {
    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    // Intercept process.emit so SIGTERM does not kill the test process
    const originalEmit = process.emit.bind(process);
    let sigTermEmitted = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.emit = function (event: string, ...args: any[]) {
      if (event === 'SIGTERM') {
        sigTermEmitted = true;
        return true;
      }
      return originalEmit(event, ...args);
    } as typeof process.emit;

    try {
      const result = await client!.call<{ status: string }>('shutdown');
      expect(result.status).toBe('shutting_down');

      // Wait for the setTimeout in shutdown handler to fire
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(sigTermEmitted).toBe(true);
    } finally {
      process.emit = originalEmit;
      client!.disconnect();
    }
  });

  it('stats returns database statistics over IPC', async () => {
    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    const result = await client!.call<{
      total: number;
      byScope: Record<string, number>;
      byType: Record<string, number>;
      bySection: Record<string, number>;
    }>('stats');

    expect(result.total).toBe(0);
    expect(result.byScope).toEqual({});

    client!.disconnect();
  });

  it('unknown method returns error to client', async () => {
    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    await expect(
      client!.call('totally_bogus_method'),
    ).rejects.toThrow('Method not found: totally_bogus_method');

    client!.disconnect();
  });
});
