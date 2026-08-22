import { contextBridge, ipcRenderer } from 'electron';
import { pathToFileURL } from 'node:url';

import { IPC_CHANNELS } from './shared/ipcChannels';
import { createPathHelpers } from './shared/platformPath';

const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);

const pathHelpers = createPathHelpers(process.platform);

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const electronApi = Object.freeze({
  closeWindow: invoke(IPC_CHANNELS.closeWindow),
  fileExists: invoke(IPC_CHANNELS.fileExists),
  getMcpInfo: invoke(IPC_CHANNELS.mcpInfo),
  isWindowMaximized: invoke(IPC_CHANNELS.isWindowMaximized),
  joinPath: pathHelpers.joinPath,
  maximizeWindow: invoke(IPC_CHANNELS.maximizeWindow),
  minimizeWindow: invoke(IPC_CHANNELS.minimizeWindow),
  onMcpRequest: (callback) => subscribe(IPC_CHANNELS.mcpRequest, callback),
  onMcpStatus: (callback) => subscribe(IPC_CHANNELS.mcpStatus, callback),
  openFolder: invoke(IPC_CHANNELS.openFolder),
  platform: process.platform,
  readDir: invoke(IPC_CHANNELS.readDirectory),
  readBinaryFile: invoke(IPC_CHANNELS.readBinaryFile),
  readTextFile: invoke(IPC_CHANNELS.readTextFile),
  selectFolder: invoke(IPC_CHANNELS.selectFolder),
  selectImageFile: invoke(IPC_CHANNELS.selectImageFile),
  sep: pathHelpers.separator,
  toFileUrl: (filePath) => pathToFileURL(String(filePath)).href,
  respondToMcpRequest: (message) => ipcRenderer.send(IPC_CHANNELS.mcpResponse, message),
  writeBinaryFile: invoke(IPC_CHANNELS.writeBinaryFile),
  writeTextFile: invoke(IPC_CHANNELS.writeTextFile),
});

contextBridge.exposeInMainWorld('electronAPI', electronApi);
