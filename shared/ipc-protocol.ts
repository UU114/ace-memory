import type { IPCRequest, IPCResponse } from '../types/ipc.js';

// Encode message to newline-delimited JSON
export function encode(msg: IPCRequest | IPCResponse): string {
  return JSON.stringify(msg) + '\n';
}

// Create a frame decoder that buffers and splits on newlines
export function createFrameDecoder(onMessage: (msg: unknown) => void): (chunk: Buffer) => void {
  let buffer = '';
  return (chunk: Buffer) => {
    buffer += chunk.toString('utf-8');
    const lines = buffer.split('\n');
    buffer = lines.pop()!; // keep incomplete last line
    for (const line of lines) {
      if (line.trim()) {
        onMessage(JSON.parse(line));
      }
    }
  };
}

// Create a JSON-RPC 2.0 request
export function createRequest(id: number, method: string, params: Record<string, unknown> = {}): IPCRequest {
  return { jsonrpc: '2.0', id, method, params };
}

// Create a JSON-RPC 2.0 success response
export function createResponse(id: number, result: unknown): IPCResponse {
  return { jsonrpc: '2.0', id, result };
}

// Create a JSON-RPC 2.0 error response
export function createErrorResponse(id: number, code: number, message: string): IPCResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// Standard JSON-RPC error codes
export const RPC_ERRORS = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
