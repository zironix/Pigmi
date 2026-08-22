import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { checkLatestRelease, RELEASES_PAGE_URL } from '../updates/updateChecker';

export function registerUpdateHandlers(ipcMain, { app, fetchImpl, shell }) {
  let updateCheck = null;

  ipcMain.handle(IPC_CHANNELS.appInfo, () => ({ version: app.getVersion() }));
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, () => {
    updateCheck ??= checkLatestRelease({
      currentVersion: app.getVersion(),
      fetchImpl,
    });
    return updateCheck;
  });
  ipcMain.handle(IPC_CHANNELS.openReleasesPage, async () => {
    await shell.openExternal(RELEASES_PAGE_URL);
    return { opened: true };
  });
}
