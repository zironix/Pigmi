import path from 'node:path';
import { app, BrowserWindow, Menu } from 'electron';
import { shouldShowEditContextMenu } from './contextMenu';

export function createMainWindow({ devServerUrl, rendererName }) {
  const window = new BrowserWindow({
    frame: false,
    height: 750,
    icon: path.join(__dirname, '..', '..', 'src', 'assets', 'icons', 'icon.png'),
    menuBar: false,
    webPreferences: {
      contextIsolation: true,
      devTools: !app.isPackaged,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
    width: 1200,
  });

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false);
  }

  const contextMenu = Menu.buildFromTemplate([
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'delete' },
    { role: 'selectAll' },
  ]);
  window.webContents.on('context-menu', (_event, params) => {
    if (!shouldShowEditContextMenu(params)) return;
    contextMenu.popup({ window });
  });

  if (devServerUrl) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(path.join(__dirname, `../renderer/${rendererName}/index.html`));
  }

  return window;
}
