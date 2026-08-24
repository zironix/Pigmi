import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { PigmiBridgeClient } from '../mcp/bridge-client.mjs';

const cleanups = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function createConnectionFile() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pigmi-mcp-test-'));
  const connectionFile = path.join(directory, 'connection.json');
  await fs.writeFile(
    connectionFile,
    JSON.stringify({
      protocol: 'pigmi-local-bridge/1',
      host: '127.0.0.1',
      port: 45678,
      token: 'secret-token',
    }),
  );
  cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
  return connectionFile;
}

describe('MCP bridge client', () => {
  it('forbids direct JSON fallback when Pigmi is not running', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pigmi-mcp-missing-test-'));
    const connectionFile = path.join(directory, 'missing.json');
    cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
    const client = new PigmiBridgeClient({ connectionFile });

    await expect(client.call('get_overview')).rejects.toThrow(
      'do not edit Pigmi project JSON files directly',
    );
  });

  it('authenticates and serializes editor requests from the discovery file', async () => {
    const connectionFile = await createConnectionFile();
    const fetchImpl = vi.fn(async () => Response.json({ result: { revision: 'test-revision' } }));
    const client = new PigmiBridgeClient({ connectionFile, fetchImpl });

    await expect(client.call('get_overview', { compact: true })).resolves.toEqual({
      revision: 'test-revision',
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:45678/rpc');
    expect(request.headers.Authorization).toBe('Bearer secret-token');
    expect(JSON.parse(request.body)).toMatchObject({
      method: 'get_overview',
      params: { compact: true },
    });
  });

  it('turns low-level fetch failures into an actionable unavailable error', async () => {
    const connectionFile = await createConnectionFile();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed'));
    const client = new PigmiBridgeClient({ connectionFile, fetchImpl });

    await expect(client.call('get_overview')).rejects.toMatchObject({
      code: 'PIGMI_UNAVAILABLE',
      message: expect.stringContaining('do not claim that any change succeeded'),
    });
  });

  it('rejects invalid discovery metadata before making a request', async () => {
    const connectionFile = await createConnectionFile();
    await fs.writeFile(connectionFile, JSON.stringify({ host: '0.0.0.0', token: 'bad' }));
    const fetchImpl = vi.fn();
    const client = new PigmiBridgeClient({ connectionFile, fetchImpl });

    await expect(client.call('get_overview')).rejects.toThrow('connection file is invalid');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
