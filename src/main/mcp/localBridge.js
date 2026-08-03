import { randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

const HOST = '127.0.0.1';
const MAX_REQUEST_BYTES = 1024 * 1024;
const CLIENT_TTL_MS = 60_000;

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) {
      const error = new Error('MCP bridge request is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const source = Buffer.concat(chunks).toString('utf8');
  return source ? JSON.parse(source) : {};
}

function serializeError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'BRIDGE_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Starts the private loopback endpoint used by the standalone stdio MCP server.
 * A random bearer token is written to a user-only discovery file so that no
 * editor data or mutation endpoint is exposed to other network hosts.
 */
export async function startLocalMcpBridge({ connectionFile, dispatch, onStatusChange }) {
  const token = randomBytes(32).toString('hex');
  const clients = new Map();
  let closed = false;

  const notifyStatus = () => {
    const now = Date.now();
    for (const [clientId, lastSeen] of clients) {
      if (now - lastSeen > CLIENT_TTL_MS) clients.delete(clientId);
    }
    onStatusChange?.({ running: !closed, clientCount: clients.size });
  };
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/rpc') {
      jsonResponse(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
      return;
    }

    if (request.headers.authorization !== `Bearer ${token}`) {
      jsonResponse(response, 401, {
        error: { code: 'UNAUTHORIZED', message: 'Invalid MCP bridge token' },
      });
      return;
    }

    try {
      const body = await readJsonBody(request);
      const clientId = String(body?.clientId || '').trim();
      const method = String(body?.method || '').trim();
      if (!clientId || !method) {
        jsonResponse(response, 400, {
          error: { code: 'INVALID_REQUEST', message: 'clientId and method are required' },
        });
        return;
      }

      clients.set(clientId, Date.now());
      notifyStatus();
      const result =
        method === '__ping' ? { ok: true } : await dispatch(method, body?.params ?? {});
      jsonResponse(response, 200, { result });
    } catch (error) {
      jsonResponse(response, Number(error?.statusCode) || 500, { error: serializeError(error) });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  const statusTimer = setInterval(notifyStatus, CLIENT_TTL_MS);
  statusTimer.unref();

  const address = server.address();
  const metadata = {
    protocol: 'pigmi-local-bridge/1',
    host: HOST,
    port: address.port,
    token,
    pid: process.pid,
    instanceId: randomUUID(),
  };

  try {
    await fs.mkdir(path.dirname(connectionFile), { recursive: true });
    await fs.writeFile(connectionFile, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(connectionFile, 0o600);
  } catch (error) {
    clearInterval(statusTimer);
    await new Promise((resolve) => server.close(resolve));
    throw error;
  }
  notifyStatus();

  return {
    metadata,
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(statusTimer);
      notifyStatus();
      await new Promise((resolve) => server.close(resolve));
      try {
        await fs.unlink(connectionFile);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    },
  };
}
