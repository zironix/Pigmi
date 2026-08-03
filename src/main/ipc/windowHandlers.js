import { IPC_CHANNELS } from '../../shared/ipcChannels';

export function registerWindowHandlers(ipcMain, getMainWindow) {
  ipcMain.handle(IPC_CHANNELS.closeWindow, () => {
    getMainWindow()?.close();
  });

  ipcMain.handle(IPC_CHANNELS.minimizeWindow, () => {
    getMainWindow()?.minimize();
  });

  ipcMain.handle(IPC_CHANNELS.maximizeWindow, () => {
    const window = getMainWindow();
    if (!window) return;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.handle(IPC_CHANNELS.isWindowMaximized, () => getMainWindow()?.isMaximized() ?? false);
}
