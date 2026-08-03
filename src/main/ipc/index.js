import { registerFileHandlers } from './fileHandlers';
import { registerWindowHandlers } from './windowHandlers';

export function registerIpcHandlers(ipcMain, getMainWindow) {
  registerFileHandlers(ipcMain);
  registerWindowHandlers(ipcMain, getMainWindow);
}
