import { registerFileHandlers } from './fileHandlers';
import { registerUpdateHandlers } from './updateHandlers';
import { registerWindowHandlers } from './windowHandlers';

export function registerIpcHandlers({ app, fetchImpl, getMainWindow, ipcMain, shell }) {
  registerFileHandlers(ipcMain);
  registerUpdateHandlers(ipcMain, { app, fetchImpl, shell });
  registerWindowHandlers(ipcMain, getMainWindow);
}
