import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { startLocalMcpBridge } from './localBridge';

const RENDERER_TIMEOUT_MS = 30_000;

function serializeRendererError(error) {
  if (error && typeof error === 'object') {
    return {
      code: typeof error.code === 'string' ? error.code : 'EDITOR_ERROR',
      message: String(error.message || 'Editor request failed'),
    };
  }
  return { code: 'EDITOR_ERROR', message: String(error || 'Editor request failed') };
}

export function createMcpIntegration({ app, ipcMain, getMainWindow }) {
  const pending = new Map();
  let bridge = null;
  let status = { running: false, clientCount: 0 };

  const getServerPath = () => {
    if (app.isPackaged) return path.join(process.resourcesPath, 'mcp', 'server.mjs');
    return path.join(app.getAppPath(), 'mcp', 'server.mjs');
  };
  const getConnectionFile = () => path.join(app.getPath('userData'), 'mcp-connection.json');

  const getInfo = () => ({
    ...status,
    connectionFile: getConnectionFile(),
    serverPath: getServerPath(),
  });

  const publishStatus = () => {
    const window = getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.mcpStatus, getInfo());
    }
  };

  const dispatch = (method, params) => {
    const window = getMainWindow();
    if (!window || window.isDestroyed()) {
      throw new Error('Pigmi editor window is not available');
    }

    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Editor request timed out: ${method}`));
      }, RENDERER_TIMEOUT_MS);

      pending.set(requestId, { resolve, reject, timer });
      window.webContents.send(IPC_CHANNELS.mcpRequest, { requestId, method, params });
    });
  };

  ipcMain.handle(IPC_CHANNELS.mcpInfo, getInfo);
  ipcMain.on(IPC_CHANNELS.mcpResponse, (event, message) => {
    const window = getMainWindow();
    if (!window || event.sender.id !== window.webContents.id) return;
    const entry = pending.get(message?.requestId);
    if (!entry) return;

    clearTimeout(entry.timer);
    pending.delete(message.requestId);
    if (message.error) {
      const details = serializeRendererError(message.error);
      const error = new Error(details.message);
      error.code = details.code;
      entry.reject(error);
    } else {
      entry.resolve(message.result);
    }
  });

  return {
    async start() {
      bridge = await startLocalMcpBridge({
        connectionFile: getConnectionFile(),
        dispatch,
        onStatusChange(nextStatus) {
          status = nextStatus;
          publishStatus();
        },
      });
      return getInfo();
    },
    async stop() {
      for (const { reject, timer } of pending.values()) {
        clearTimeout(timer);
        reject(new Error('Pigmi MCP bridge stopped'));
      }
      pending.clear();
      await bridge?.close();
      bridge = null;
      status = { running: false, clientCount: 0 };
    },
  };
}
