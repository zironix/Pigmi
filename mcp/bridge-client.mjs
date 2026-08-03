import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REQUEST_TIMEOUT_MS = 35_000;

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : String(process.argv[index + 1] || '').trim();
}

export function defaultConnectionFile() {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'Pigmi',
      'mcp-connection.json',
    );
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Pigmi',
      'mcp-connection.json',
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'Pigmi',
    'mcp-connection.json',
  );
}

export function resolveConnectionFile() {
  return (
    argumentValue('--connection-file') ||
    String(process.env.PIGMI_MCP_CONNECTION || '').trim() ||
    defaultConnectionFile()
  );
}

export class PigmiBridgeClient {
  constructor({ connectionFile = resolveConnectionFile(), fetchImpl = globalThis.fetch } = {}) {
    this.connectionFile = connectionFile;
    this.fetch = fetchImpl;
    this.clientId = randomUUID();
  }

  async readConnection() {
    let source;
    try {
      source = await fs.readFile(this.connectionFile, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(
          `Pigmi is not running (connection file not found: ${this.connectionFile})`,
          { cause: error },
        );
      }
      throw error;
    }

    const connection = JSON.parse(source);
    if (
      connection?.protocol !== 'pigmi-local-bridge/1' ||
      connection?.host !== '127.0.0.1' ||
      !Number.isInteger(connection?.port) ||
      typeof connection?.token !== 'string'
    ) {
      throw new Error('Pigmi MCP connection file is invalid');
    }
    return connection;
  }

  async call(method, params = {}) {
    const connection = await this.readConnection();
    const response = await this.fetch(`http://${connection.host}:${connection.port}/rpc`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clientId: this.clientId, method, params }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const payload = await response.json();
    if (!response.ok || payload?.error) {
      const error = new Error(
        payload?.error?.message || `Pigmi bridge returned HTTP ${response.status}`,
      );
      error.code = payload?.error?.code || 'BRIDGE_ERROR';
      throw error;
    }
    return payload.result;
  }
}
