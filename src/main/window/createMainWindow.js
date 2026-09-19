import path from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
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

  window.webContents.setWindowOpenHandler(({ url }) => {
    const addonUrl =
      'https://github.com/zironix/Pigmi/blob/main/Pigmi%20Helpers/pigmi_uv2palette.py';
    if (url === addonUrl) {
      void shell
        .openExternal(url)
        .catch((error) => console.error('Could not open add-on page', error));
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
