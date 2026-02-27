import { describe, it, expect, afterEach } from 'vitest';
import crypto from 'crypto';
import { IPCServer } from '../../shared/ipc-server.js';
import { IPCClient } from '../../shared/ipc-client.js';
import {
  encode,
  createFrameDecoder,
  createRequest,
  createResponse,
  createErrorResponse,
  RPC_ERRORS,
} from '../../shared/ipc-protocol.js';

// Generate a unique named pipe path for each test run (Windows)
function getTestSocketPath(): string {
  const id = crypto.randomBytes(8).toString('hex');
  return `\\\\.\\pipe\\ace-test-${id}`;
}

describe('ipc-protocol', () => {
  it('encode produces newline-delimited JSON', () => {
    const req = createRequest(1, 'ping');
    const encoded = encode(req);
    expect(encoded.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(encoded.trim());
    expect(parsed.jsonrpc).toBe('2.0');
    expect(parsed.id).toBe(1);
    expect(parsed.method).toBe('ping');
  });

  it('createFrameDecoder handles split chunks', () => {
    const messages: unknown[] = [];
    const decoder = createFrameDecoder((msg) => messages.push(msg));

    const full = encode(createRequest(1, 'a')) + encode(createRequest(2, 'b'));
    // Split in the middle
    const mid = Math.floor(full.length / 2);
    decoder(Buffer.from(full.slice(0, mid)));
    decoder(Buffer.from(full.slice(mid)));

    expect(messages).toHaveLength(2);
    expect((messages[0] as { id: number }).id).toBe(1);
    expect((messages[1] as { id: number }).id).toBe(2);
  });

  it('createResponse creates success response', () => {
    const res = createResponse(42, { status: 'ok' });
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(42);
    expect(res.result).toEqual({ status: 'ok' });
    expect(res.error).toBeUndefined();
  });

  it('createErrorResponse creates error response', () => {
    const res = createErrorResponse(7, RPC_ERRORS.METHOD_NOT_FOUND, 'Not found');
    expect(res.jsonrpc).toBe('2.0');
    expect(res.id).toBe(7);
    expect(res.error).toEqual({ code: -32601, message: 'Not found' });
    expect(res.result).toBeUndefined();
  });
});

describe('ipc client-server', () => {
  let server: IPCServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('full roundtrip: server listen -> client connect -> call -> response', async () => {
    const socketPath = getTestSocketPath();
    server = new IPCServer();
    server.onRequest(async (method, _params) => {
      if (method === 'ping') {
        return { status: 'ok', version: '0.1.0' };
      }
      throw new Error(`Unknown method: ${method}`);
    });
    await server.listen(socketPath);

    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    const result = await client!.call<{ status: string; version: string }>('ping');
    expect(result.status).toBe('ok');
    expect(result.version).toBe('0.1.0');

    client!.disconnect();
  });

  it('multiple calls with different methods', async () => {
    const socketPath = getTestSocketPath();
    server = new IPCServer();
    server.onRequest(async (method, params) => {
      if (method === 'add') {
        const a = params.a as number;
        const b = params.b as number;
        return { sum: a + b };
      }
      if (method === 'echo') {
        return { msg: params.msg };
      }
      throw new Error(`Unknown method: ${method}`);
    });
    await server.listen(socketPath);

    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    const addResult = await client!.call<{ sum: number }>('add', { a: 3, b: 4 });
    expect(addResult.sum).toBe(7);

    const echoResult = await client!.call<{ msg: string }>('echo', { msg: 'hello' });
    expect(echoResult.msg).toBe('hello');

    client!.disconnect();
  });

  it('server handler throws -> client receives error', async () => {
    const socketPath = getTestSocketPath();
    server = new IPCServer();
    server.onRequest(async (_method, _params) => {
      throw new Error('Intentional failure');
    });
    await server.listen(socketPath);

    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    await expect(client!.call('fail')).rejects.toThrow('Intentional failure');

    client!.disconnect();
  });

  it('client connect returns null when no server is listening', async () => {
    const socketPath = getTestSocketPath();
    const client = await IPCClient.connectTo(socketPath, 200);
    expect(client).toBeNull();
  });

  it('client call times out when server does not respond', async () => {
    const socketPath = getTestSocketPath();
    server = new IPCServer();
    // Register a handler that never resolves
    server.onRequest(async () => {
      return new Promise(() => {
        // intentionally never resolves
      });
    });
    await server.listen(socketPath);

    const client = await IPCClient.connectTo(socketPath, 2000);
    expect(client).not.toBeNull();

    await expect(client!.call('hang', {}, 200)).rejects.toThrow(/timed out/);

    client!.disconnect();
  });

  it('multiple clients connect concurrently', async () => {
    const socketPath = getTestSocketPath();
    server = new IPCServer();
    let callCount = 0;
    server.onRequest(async (method) => {
      callCount++;
      return { method, seq: callCount };
    });
    await server.listen(socketPath);

    // Connect 3 clients in parallel
    const clients = await Promise.all([
      IPCClient.connectTo(socketPath, 2000),
      IPCClient.connectTo(socketPath, 2000),
      IPCClient.connectTo(socketPath, 2000),
    ]);

    for (const c of clients) {
      expect(c).not.toBeNull();
    }

    // Each client makes a call
    const results = await Promise.all(
      clients.map((c, i) => c!.call<{ method: string; seq: number }>(`method_${i}`))
    );

    expect(results).toHaveLength(3);
    // All 3 calls should have been handled
    expect(callCount).toBe(3);
    for (const r of results) {
      expect(r.seq).toBeGreaterThan(0);
    }

    for (const c of clients) {
      c!.disconnect();
    }
  });
});
