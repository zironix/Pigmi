import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ADDON_FILE_NAME = 'pigmi_uv2palette.py';
const BLENDER_VERSION_DIRECTORY = /^\d+\.\d+$/;

/**
 * Blender keeps one user configuration directory per installed version, e.g.
 * ~/Library/Application Support/Blender/4.2. Legacy single-file add-ons placed
 * in its scripts/addons folder load in every Blender version, including 4.2+.
 */
export function blenderConfigRoot({
  platform = process.platform,
  env = process.env,
  homedir = os.homedir(),
} = {}) {
  if (platform === 'darwin') {
    return path.join(homedir, 'Library', 'Application Support', 'Blender');
  }
  if (platform === 'win32') {
    return path.join(
      env.APPDATA || path.join(homedir, 'AppData', 'Roaming'),
      'Blender Foundation',
      'Blender',
    );
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(homedir, '.config'), 'blender');
}

export function parseAddonVersion(source) {
  const match = /["']version["']\s*:\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(
    String(source || ''),
  );
  return match ? match.slice(1, 4).map(Number) : null;
}

export function compareVersions(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export async function findBlenderVersions(configRoot) {
  let entries;
  try {
    entries = await fs.readdir(configRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && BLENDER_VERSION_DIRECTORY.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => compareVersions(left.split('.'), right.split('.')));
}

async function readInstalledVersion(filePath) {
  try {
    return parseAddonVersion(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function addonPath(configRoot, blenderVersion) {
  return path.join(configRoot, blenderVersion, 'scripts', 'addons', ADDON_FILE_NAME);
}

function addonState(installed, bundled) {
  if (!installed) return 'missing';
  const order = compareVersions(installed, bundled);
  return order < 0 ? 'outdated' : order > 0 ? 'newer' : 'current';
}

export async function getAddonStatus({ configRoot, sourcePath }) {
  const bundledVersion = parseAddonVersion(await fs.readFile(sourcePath, 'utf8'));
  if (!bundledVersion) throw new Error('The bundled UV to Palette add-on has no version');
  const blenderVersions = await findBlenderVersions(configRoot);
  const installations = await Promise.all(
    blenderVersions.map(async (blenderVersion) => {
      const installedVersion = await readInstalledVersion(addonPath(configRoot, blenderVersion));
      return {
        blenderVersion,
        installedVersion,
        state: addonState(installedVersion, bundledVersion),
      };
    }),
  );
  return { configRoot, bundledVersion, installations };
}

/**
 * Installs the bundled add-on into every detected Blender version that lacks it
 * or has an older copy. A newer copy (for example a development build) is kept.
 * Blender keeps an add-on enabled across updates because the module name stays.
 */
export async function installAddon({ configRoot, sourcePath }) {
  const source = await fs.readFile(sourcePath);
  const status = await getAddonStatus({ configRoot, sourcePath });
  const updated = [];
  const failed = [];
  for (const installation of status.installations) {
    if (installation.state !== 'missing' && installation.state !== 'outdated') continue;
    const target = addonPath(configRoot, installation.blenderVersion);
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      // Write beside the target and rename so Blender never reads a partial file.
      const temporary = `${target}.${process.pid}.tmp`;
      await fs.writeFile(temporary, source);
      await fs.rename(temporary, target);
      updated.push(installation.blenderVersion);
    } catch (error) {
      failed.push({ blenderVersion: installation.blenderVersion, message: error.message });
    }
  }
  return { ...(await getAddonStatus({ configRoot, sourcePath })), updated, failed };
}
