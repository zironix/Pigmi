import { promises as fs } from 'node:fs';
import path from 'node:path';

import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { blenderConfigRoot, getAddonStatus, installAddon } from './addonInstaller';
import { addonDownloadUrl, BLENDER_ADDONS } from './addons';
import { downloadAddon, resolveAddonSource } from './addonSource';

const DEFAULT_SETTINGS = Object.freeze({ autoUpdate: true });

export function createBlenderAddonIntegration({
  app,
  ipcMain,
  fetchImpl,
  configRoot = blenderConfigRoot(),
  addons = BLENDER_ADDONS,
}) {
  const getBundledPath = (addon) =>
    app.isPackaged
      ? path.join(process.resourcesPath, addon.fileName)
      : path.join(app.getAppPath(), 'Pigmi Helpers', addon.fileName);
  const getCacheFile = (addon) =>
    path.join(app.getPath('userData'), 'blender-addon', addon.fileName);
  const getSettingsFile = () => path.join(app.getPath('userData'), 'blender-addon.json');
  const downloadErrors = new Map();

  async function readSettings() {
    try {
      const settings = JSON.parse(await fs.readFile(getSettingsFile(), 'utf8'));
      return { ...DEFAULT_SETTINGS, autoUpdate: settings?.autoUpdate !== false };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  // A failed download is reported but never blocks installing the best local copy.
  async function downloadLatest(addon) {
    try {
      await downloadAddon({
        fetchImpl,
        cacheFile: getCacheFile(addon),
        url: addonDownloadUrl(addon.fileName),
        addonName: addon.name,
      });
      downloadErrors.delete(addon.id);
    } catch (error) {
      downloadErrors.set(addon.id, error instanceof Error ? error.message : String(error));
    }
  }

  async function runFor(addon, action) {
    const base = { id: addon.id, name: addon.name, fileName: addon.fileName };
    try {
      const source = await resolveAddonSource({
        cacheFile: getCacheFile(addon),
        bundledPath: getBundledPath(addon),
        addonName: addon.name,
      });
      const status = await action({
        configRoot,
        sourcePath: source.path,
        fileName: addon.fileName,
      });
      return {
        ...base,
        ...status,
        source: source.origin,
        downloadError: downloadErrors.get(addon.id) || null,
      };
    } catch (error) {
      // One unavailable add-on must not hide the status of the others.
      return { ...base, installations: [], error: error.message };
    }
  }

  async function run(action) {
    const results = [];
    for (const addon of addons) results.push(await runFor(addon, action));
    return { configRoot, addons: results, ...(await readSettings()) };
  }

  async function downloadAndInstall() {
    await Promise.all(addons.map(downloadLatest));
    return run(installAddon);
  }

  ipcMain.handle(IPC_CHANNELS.blenderAddonStatus, () => run(getAddonStatus));
  ipcMain.handle(IPC_CHANNELS.blenderAddonInstall, downloadAndInstall);
  ipcMain.handle(IPC_CHANNELS.blenderAddonSetAutoUpdate, async (_event, enabled) => {
    const settings = { ...(await readSettings()), autoUpdate: enabled === true };
    await fs.mkdir(path.dirname(getSettingsFile()), { recursive: true });
    await fs.writeFile(getSettingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
    return settings;
  });

  return {
    /** Fetches the latest add-ons from GitHub and installs them in every Blender version. */
    async updateOnLaunch() {
      if (!(await readSettings()).autoUpdate) return null;
      return downloadAndInstall();
    },
  };
}
