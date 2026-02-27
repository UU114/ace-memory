import type { Bullet } from './bullet.js';

// JSON-RPC 2.0 request
export interface IPCRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

// JSON-RPC 2.0 response
export interface IPCResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: IPCError;
}

export interface IPCError {
  code: number;
  message: string;
}

// --- Method-specific param/result types ---

// ping
export interface PingResult {
  status: 'ok';
  version: string;
  uptime: number;
  active_sessions: number;
}

// recall
export interface RecallParams {
  query: string;
  project: string;
  limit?: number;
}

export interface RecallResult {
  bullets: Bullet[];
}

// curate
export interface CurateParams {
  insights: CandidateInsight[];
}

export interface CurateResult {
  added: number;
  merged: number;
  skipped: number;
}

export interface CandidateInsight {
  content: string;
  code_content?: string;
  code_language?: string;
  source_type: 'auto' | 'manual';
  context: {
    file?: string;
    language?: string;
    error_message?: string;
    command?: string;
    project?: string;
  };
}

// embed
export interface EmbedParams {
  text: string;
}

export interface EmbedResult {
  vector: number[];
}

// session_register
export interface SessionRegisterParams {
  session_id: string;
  pid: number;
}

// session_unregister
export interface SessionUnregisterParams {
  session_id: string;
}

// stats
export interface StatsResult {
  total_bullets: number;
  by_scope: Record<string, number>;
  by_type: Record<string, number>;
  by_section: Record<string, number>;
  active_sessions: number;
  uptime: number;
}

// decay_update
export interface DecayUpdateResult {
  updated: number;
  archived: number;
}

// conflicts_check
export interface ConflictsCheckParams {
  bullet_id: string;
}

export interface ConflictsCheckResult {
  conflicts: number;
}

// conflicts_list
export interface ConflictsListParams {
  resolved?: boolean;
}

export interface ConflictsListResult {
  conflicts: Array<{
    id: string;
    bullet_id_a: string;
    bullet_id_b: string;
    conflict_type: string;
    description: string;
    resolved: number;
    resolved_at: string | null;
    created_at: string;
  }>;
}

// IPC method names
export type IPCMethod =
  | 'ping'
  | 'recall'
  | 'curate'
  | 'embed'
  | 'session_register'
  | 'session_unregister'
  | 'shutdown'
  | 'stats'
  | 'decay_update'
  | 'conflicts_check'
  | 'conflicts_list';
