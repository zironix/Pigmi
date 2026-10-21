import path from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import { shouldShowEditContextMenu } from './contextMenu';

// Only these fixed pages may leave the app; every other window.open is denied.
const EXTERNAL_LINKS = new Set([
  'https://github.com/zironix/Pigmi/blob/main/Pigmi%20Helpers/pigmi_uv2palette.py',
  'https://www.donationalerts.com/r/zenoxus',
  'https://t.me/godot3d',
  'https://t.me/zironix',
]);

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

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL_LINKS.has(url)) {
      void shell
        .openExternal(url)
        .catch((error) => console.error('Could not open external link', error));
    }
    return { action: 'deny' };
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
