import { promises as fs } from 'node:fs';
import path from 'node:path';

import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { ADDON_FILE_NAME, blenderConfigRoot, getAddonStatus, installAddon } from './addonInstaller';

const DEFAULT_SETTINGS = Object.freeze({ autoUpdate: true });

export function createBlenderAddonIntegration({ app, ipcMain, configRoot = blenderConfigRoot() }) {
  const getSourcePath = () =>
    app.isPackaged
      ? path.join(process.resourcesPath, ADDON_FILE_NAME)
      : path.join(app.getAppPath(), 'Pigmi Helpers', ADDON_FILE_NAME);
  const getSettingsFile = () => path.join(app.getPath('userData'), 'blender-addon.json');

  async function readSettings() {
    try {
      const settings = JSON.parse(await fs.readFile(getSettingsFile(), 'utf8'));
      return { ...DEFAULT_SETTINGS, autoUpdate: settings?.autoUpdate !== false };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async function withSettings(status) {
    return { ...status, ...(await readSettings()) };
  }

  const install = () => installAddon({ configRoot, sourcePath: getSourcePath() });

  ipcMain.handle(IPC_CHANNELS.blenderAddonStatus, async () =>
    withSettings(await getAddonStatus({ configRoot, sourcePath: getSourcePath() })),
  );
  ipcMain.handle(IPC_CHANNELS.blenderAddonInstall, async () => withSettings(await install()));
  ipcMain.handle(IPC_CHANNELS.blenderAddonSetAutoUpdate, async (_event, enabled) => {
    const settings = { ...(await readSettings()), autoUpdate: enabled === true };
    await fs.mkdir(path.dirname(getSettingsFile()), { recursive: true });
    await fs.writeFile(getSettingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
    return settings;
  });

  return {
    /** Keeps the add-on installed and current in every Blender version unless disabled. */
    async updateOnLaunch() {
      if (!(await readSettings()).autoUpdate) return null;
      return install();
    },
  };
}
