import net from 'net';
import { getSocketPath } from './platform.js';
import { encode, createFrameDecoder, createRequest } from './ipc-protocol.js';
import type { IPCResponse } from '../types/ipc.js';

export class IPCClient {
  private socket: net.Socket;
  private nextId = 1;
  private pendingRequests = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  private constructor(socket: net.Socket) {
    this.socket = socket;
    const decoder = createFrameDecoder((msg: unknown) => {
      const response = msg as IPCResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(response.error.message));
        } else {
          pending.resolve(response.result);
        }
      }
    });
    socket.on('data', decoder);
    socket.on('error', () => this.rejectAll('Connection error'));
    socket.on('close', () => this.rejectAll('Connection closed'));
  }

  // Connect to daemon, returns null on failure
  static async connect(timeout = 50): Promise<IPCClient | null> {
    const socketPath = getSocketPath();
    return IPCClient.connectTo(socketPath, timeout);
  }

  // Connect to a specific socket path, returns null on failure
  static async connectTo(socketPath: string, timeout = 50): Promise<IPCClient | null> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ path: socketPath });
      const timer = setTimeout(() => {
        socket.destroy();
        resolve(null);
      }, timeout);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve(new IPCClient(socket));
      });
      socket.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
  }

  // Send request and wait for response
  async call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeout = 5000): Promise<T> {
    const id = this.nextId++;
    const request = createRequest(id, method, params);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`IPC call '${method}' timed out after ${timeout}ms`));
      }, timeout);
      this.pendingRequests.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v as T); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.socket.write(encode(request));
    });
  }

  disconnect(): void {
    this.socket.destroy();
    this.rejectAll('Disconnected');
  }

  private rejectAll(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }
}
