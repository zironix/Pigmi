import { app, BrowserWindow, ipcMain } from 'electron';
import started from 'electron-squirrel-startup';

import { registerIpcHandlers } from './main/ipc';
import { createMcpIntegration } from './main/mcp/integration';
import { createMainWindow } from './main/window/createMainWindow';

let mainWindow = null;

if (started) {
  app.quit();
}

registerIpcHandlers(ipcMain, () => mainWindow);
const mcpIntegration = createMcpIntegration({ app, ipcMain, getMainWindow: () => mainWindow });

app.whenReady().then(async () => {
  mainWindow = createMainWindow({
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    rendererName: MAIN_WINDOW_VITE_NAME,
  });

  try {
    if (mainWindow.webContents.isLoading()) {
      await new Promise((resolve) => mainWindow.webContents.once('did-finish-load', resolve));
    }
    await mcpIntegration.start();
  } catch (error) {
    console.error('Failed to start the Pigmi MCP bridge:', error);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow({
        devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
        rendererName: MAIN_WINDOW_VITE_NAME,
      });
    }
  });
});

app.on('before-quit', () => {
  void mcpIntegration.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
