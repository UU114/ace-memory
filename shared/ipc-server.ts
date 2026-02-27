import net from 'net';
import fs from 'fs';
import { encode, createFrameDecoder, createResponse, createErrorResponse, RPC_ERRORS } from './ipc-protocol.js';
import type { IPCRequest } from '../types/ipc.js';

type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class IPCServer {
  private server: net.Server;
  private handler: RequestHandler | null = null;
  private connections = new Set<net.Socket>();

  constructor() {
    this.server = net.createServer((socket) => {
      this.connections.add(socket);
      const decoder = createFrameDecoder(async (msg: unknown) => {
        const request = msg as IPCRequest;
        if (!this.handler) {
          socket.write(encode(createErrorResponse(request.id, RPC_ERRORS.INTERNAL_ERROR, 'No handler registered')));
          return;
        }
        try {
          const result = await this.handler(request.method, request.params);
          socket.write(encode(createResponse(request.id, result)));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          socket.write(encode(createErrorResponse(request.id, RPC_ERRORS.INTERNAL_ERROR, message)));
        }
      });
      socket.on('data', decoder);
      socket.on('close', () => this.connections.delete(socket));
      socket.on('error', () => this.connections.delete(socket));
    });
  }

  onRequest(handler: RequestHandler): void {
    this.handler = handler;
  }

  async listen(socketPath: string): Promise<void> {
    // Clean up stale socket file (Unix only)
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath); } catch { /* ignore */ }
    }
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(socketPath, () => {
        this.server.removeListener('error', reject);
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  getConnectionCount(): number {
    return this.connections.size;
  }
}
