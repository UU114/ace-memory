import type { DaemonConfig } from '../types/config.js';
import { aceLog, aceWarn } from '../shared/logger.js';

interface SessionInfo {
  pid: number;
  registeredAt: Date;
}

// Manages daemon lifecycle: idle timeouts and session liveness tracking
export class LifecycleManager {
  private activeSessions = new Map<string, SessionInfo>();
  private lastRequestAt = new Date();
  private startedAt = new Date();
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private sessionCheckTimer: ReturnType<typeof setInterval> | null = null;
  private onShutdown: (() => void) | null = null;

  constructor(private config: DaemonConfig) {}

  // Start idle check and session liveness timers
  start(onShutdown: () => void): void {
    this.onShutdown = onShutdown;

    // Idle check every 30 seconds
    this.idleTimer = setInterval(() => this.checkIdle(), 30_000);

    // Session liveness check at configured interval
    this.sessionCheckTimer = setInterval(
      () => this.checkSessions(),
      this.config.session_check_interval_seconds * 1000,
    );
  }

  // Stop all timers
  stop(): void {
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.sessionCheckTimer) clearInterval(this.sessionCheckTimer);
  }

  // Record that a request was received (resets idle timer)
  recordRequest(): void {
    this.lastRequestAt = new Date();
  }

  // Register an active session by ID and PID
  registerSession(sessionId: string, pid: number): void {
    this.activeSessions.set(sessionId, { pid, registeredAt: new Date() });
    aceLog(`Session registered: ${sessionId} (pid: ${pid})`);
  }

  // Unregister a session by ID
  unregisterSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    aceLog(`Session unregistered: ${sessionId}`);
  }

  // Return IDs of all active sessions
  getActiveSessions(): string[] {
    return Array.from(this.activeSessions.keys());
  }

  // Return count of active sessions
  getActiveSessionCount(): number {
    return this.activeSessions.size;
  }

  // Return uptime in seconds
  getUptime(): number {
    return (Date.now() - this.startedAt.getTime()) / 1000;
  }

  // Check idle timeout conditions
  private checkIdle(): void {
    const now = Date.now();
    const idleMs = this.config.idle_timeout_minutes * 60 * 1000;
    const maxIdleMs = this.config.max_idle_minutes * 60 * 1000;

    // Hard timeout: no request for max_idle_minutes
    if (now - this.lastRequestAt.getTime() > maxIdleMs) {
      aceLog('Max idle timeout reached, shutting down');
      this.triggerShutdown();
      return;
    }

    // Soft timeout: no active sessions AND idle for idle_timeout_minutes
    if (this.activeSessions.size === 0 && now - this.lastRequestAt.getTime() > idleMs) {
      aceLog('No active sessions and idle timeout reached, shutting down');
      this.triggerShutdown();
    }
  }

  // Check if registered session processes are still alive
  private checkSessions(): void {
    for (const [sessionId, info] of this.activeSessions) {
      try {
        process.kill(info.pid, 0); // Check if process exists
      } catch {
        aceWarn(`Session ${sessionId} (pid: ${info.pid}) is dead, removing`);
        this.activeSessions.delete(sessionId);
      }
    }
  }

  // Invoke the shutdown callback
  private triggerShutdown(): void {
    if (this.onShutdown) this.onShutdown();
  }
}
