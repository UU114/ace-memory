import fs from 'fs';
import { loadConfig } from '../shared/config-loader.js';
import { getSocketPath, getPidPath, getMetaPath, getDbPath, getDataDir } from '../shared/platform.js';
import { aceLog, aceWarn, aceError } from '../shared/logger.js';
import { IPCServer } from '../shared/ipc-server.js';
import { AceDatabase } from '../storage/sqlite.js';
import { OnnxEmbedding } from '../engine/embedding.js';
import { LifecycleManager } from './lifecycle.js';
import { IPCHandler } from './ipc-handler.js';
import { VectorCache } from './vector-cache.js';

const VERSION = '0.1.0';

// Write daemon PID to file for external discovery
function writePidFile(pid: number): void {
  fs.writeFileSync(getPidPath(), String(pid), 'utf-8');
}

// Write daemon metadata (version, socket path, sessions) to file
function writeMetaFile(pid: number, socketPath: string, sessions: string[]): void {
  const meta = {
    pid,
    engine_version: VERSION,
    started_at: new Date().toISOString(),
    socket_path: socketPath,
    active_sessions: sessions,
  };
  fs.writeFileSync(getMetaPath(), JSON.stringify(meta, null, 2), 'utf-8');
}

// Remove PID, meta, and socket files on shutdown
function cleanup(): void {
  try { fs.unlinkSync(getPidPath()); } catch { /* ignore */ }
  try { fs.unlinkSync(getMetaPath()); } catch { /* ignore */ }
  const socketPath = getSocketPath();
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
  }
}

async function main() {
  // Ensure data directory exists
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });

  const config = loadConfig();
  const db = new AceDatabase(getDbPath());
  const server = new IPCServer();
  const lifecycle = new LifecycleManager(config.daemon);

  // Load ONNX embedding model (optional — graceful degradation if unavailable)
  const embedding = new OnnxEmbedding();
  if (embedding.isModelAvailable()) {
    try {
      await embedding.init();
    } catch (err: any) {
      aceWarn(`ONNX model load failed, running keyword-only mode: ${err.message}`);
    }
  } else {
    aceLog('ONNX model not found, running keyword-only mode. Run "ace setup" to enable semantic search.');
  }

  // Load vector cache for hybrid semantic search
  const vectorCache = new VectorCache();
  try {
    await vectorCache.loadFromDb(db);
  } catch (err: any) {
    aceWarn(`Failed to load vector cache: ${err.message}`);
  }

  const handler = new IPCHandler(db, lifecycle, embedding, vectorCache, config.search);

  // Graceful shutdown procedure
  let shutdownCalled = false;
  async function shutdown() {
    if (shutdownCalled) return;
    shutdownCalled = true;
    aceLog('Shutting down daemon...');
    lifecycle.stop();
    await server.close();
    await embedding.dispose();
    db.close();
    cleanup();
    aceLog('Daemon stopped');
    process.exit(0);
  }

  // Register request handler
  server.onRequest(async (method, params) => {
    lifecycle.recordRequest();
    // Update meta file when sessions change
    const result = await handler.handle(method, params);
    if (method === 'session_register' || method === 'session_unregister') {
      writeMetaFile(process.pid, getSocketPath(), lifecycle.getActiveSessions());
    }
    return result;
  });

  // Start IPC server
  const socketPath = getSocketPath();
  await server.listen(socketPath);

  // Write PID + meta
  writePidFile(process.pid);
  writeMetaFile(process.pid, socketPath, []);

  // Start lifecycle timers
  lifecycle.start(() => {
    shutdown();
  });

  // Signal handlers
  process.on('SIGTERM', () => shutdown());
  process.on('SIGINT', () => shutdown());
  process.on('uncaughtException', (err) => {
    aceError(`Uncaught exception: ${err.message}`);
    cleanup();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    aceError(`Unhandled rejection: ${reason}`);
  });

  aceLog(`Daemon started (pid: ${process.pid}, socket: ${socketPath})`);
}

main().catch((err) => {
  aceError(`Daemon failed to start: ${err.message}`);
  cleanup();
  process.exit(1);
});
