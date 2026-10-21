import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  blenderConfigRoot,
  getAddonStatus,
  installAddon,
  parseAddonVersion,
} from '../src/main/blender/addonInstaller';

const ADDON_FILE_NAME = 'pigmi_uv2palette.py';
const addonSource = (version) =>
  `bl_info = {\n    "name": "Pigmi: UV to Palette",\n    "version": (${version.join(', ')}),\n}\n`;

let root;
let configRoot;
let sourcePath;

async function writeInstalled(blenderVersion, version) {
  const directory = path.join(configRoot, blenderVersion, 'scripts', 'addons');
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, ADDON_FILE_NAME), addonSource(version));
}

const readInstalled = (blenderVersion) =>
  fs.readFile(path.join(configRoot, blenderVersion, 'scripts', 'addons', ADDON_FILE_NAME), 'utf8');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pigmi-blender-'));
  configRoot = path.join(root, 'Blender');
  sourcePath = path.join(root, ADDON_FILE_NAME);
  await fs.writeFile(sourcePath, addonSource([1, 19, 2]));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('Blender add-on installer', () => {
  it('resolves the per-platform Blender configuration directory', () => {
    expect(blenderConfigRoot({ platform: 'darwin', env: {}, homedir: '/Users/a' })).toBe(
      '/Users/a/Library/Application Support/Blender',
    );
    expect(
      blenderConfigRoot({ platform: 'win32', env: { APPDATA: 'C:/Roaming' }, homedir: 'C:/a' }),
    ).toBe(path.join('C:/Roaming', 'Blender Foundation', 'Blender'));
    expect(blenderConfigRoot({ platform: 'linux', env: {}, homedir: '/home/a' })).toBe(
      '/home/a/.config/blender',
    );
  });

  it('reads the bl_info version', () => {
    expect(parseAddonVersion(addonSource([1, 19, 2]))).toEqual([1, 19, 2]);
    expect(parseAddonVersion('print("no info")')).toBeNull();
  });

  it('installs into missing and outdated versions and keeps newer copies', async () => {
    await fs.mkdir(path.join(configRoot, '3.6'), { recursive: true });
    await fs.mkdir(path.join(configRoot, 'config-backup'), { recursive: true });
    await writeInstalled('4.2', [1, 9, 0]);
    await writeInstalled('4.5', [1, 19, 2]);
    await writeInstalled('5.0', [2, 0, 0]);

    const before = await getAddonStatus({ configRoot, sourcePath, fileName: ADDON_FILE_NAME });
    expect(
      before.installations.map(({ blenderVersion, state }) => [blenderVersion, state]),
    ).toEqual([
      ['3.6', 'missing'],
      ['4.2', 'outdated'],
      ['4.5', 'current'],
      ['5.0', 'newer'],
    ]);

    const result = await installAddon({ configRoot, sourcePath, fileName: ADDON_FILE_NAME });

    expect(result.updated).toEqual(['3.6', '4.2']);
    expect(result.failed).toEqual([]);
    expect(result.installations.map(({ state }) => state)).toEqual([
      'current',
      'current',
      'current',
      'newer',
    ]);
    expect(await readInstalled('3.6')).toBe(addonSource([1, 19, 2]));
    expect(await readInstalled('5.0')).toBe(addonSource([2, 0, 0]));
    expect(await fs.readdir(path.join(configRoot, '4.2', 'scripts', 'addons'))).toEqual([
      ADDON_FILE_NAME,
    ]);
  });

  it('reports no installations when Blender has never run', async () => {
    const result = await installAddon({ configRoot, sourcePath, fileName: ADDON_FILE_NAME });
    expect(result.installations).toEqual([]);
    expect(result.updated).toEqual([]);
  });
});
