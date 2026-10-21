import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BLENDER_ADDONS } from '../src/main/blender/addons';
import { createBlenderAddonIntegration } from '../src/main/blender/integration';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';

const addonSource = (name, version) =>
  `bl_info = {\n    "name": "${name}",\n    "version": (${version.join(', ')}),\n}\n`;

let root;
let handlers;

function integration(fetchImpl) {
  handlers = {};
  return createBlenderAddonIntegration({
    app: {
      isPackaged: false,
      getAppPath: () => root,
      getPath: () => path.join(root, 'userData'),
    },
    ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
    fetchImpl,
    configRoot: path.join(root, 'Blender'),
  });
}

const installed = (blenderVersion, fileName) =>
  fs.readFile(path.join(root, 'Blender', blenderVersion, 'scripts', 'addons', fileName), 'utf8');

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pigmi-addons-'));
  await fs.mkdir(path.join(root, 'Pigmi Helpers'));
  await fs.mkdir(path.join(root, 'Blender', '5.2'), { recursive: true });
  for (const addon of BLENDER_ADDONS) {
    await fs.writeFile(
      path.join(root, 'Pigmi Helpers', addon.fileName),
      addonSource(addon.name, [1, 0, 0]),
    );
  }
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('Blender add-on integration', () => {
  it('lists the add-ons as UV to Palette, Highlighter, then Face to Face', () => {
    expect(BLENDER_ADDONS.map((addon) => addon.fileName)).toEqual([
      'pigmi_uv2palette.py',
      'pigmi_highlighter.py',
      'pigmi_face2face.py',
    ]);
  });

  it('installs every add-on from GitHub into each Blender version', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const addon = BLENDER_ADDONS.find((entry) => url.endsWith(entry.fileName));
      return { ok: true, status: 200, text: async () => addonSource(addon.name, [2, 0, 0]) };
    });
    const result = await integration(fetchImpl).updateOnLaunch();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.addons.map((addon) => [addon.id, addon.source, addon.updated])).toEqual([
      ['uv2palette', 'github', ['5.2']],
      ['highlighter', 'github', ['5.2']],
      ['face2face', 'github', ['5.2']],
    ]);
    expect(await installed('5.2', 'pigmi_face2face.py')).toBe(
      addonSource('Pigmi: Face to Face', [2, 0, 0]),
    );
  });

  it('falls back to bundled copies offline and keeps other add-ons working', async () => {
    await fs.rm(path.join(root, 'Pigmi Helpers', 'pigmi_highlighter.py'));
    integration(vi.fn().mockRejectedValue(new Error('offline')));

    const result = await handlers[IPC_CHANNELS.blenderAddonInstall]();

    expect(result.addons.map((addon) => [addon.id, addon.source ?? null])).toEqual([
      ['uv2palette', 'bundled'],
      ['highlighter', null],
      ['face2face', 'bundled'],
    ]);
    expect(result.addons[0].downloadError).toBe('offline');
    expect(result.addons[1].error).toMatch(/Highlighter/);
    expect(await installed('5.2', 'pigmi_uv2palette.py')).toBe(
      addonSource('Pigmi: UV to Palette', [1, 0, 0]),
    );
  });

  it('skips launch updates when automatic updates are off', async () => {
    const fetchImpl = vi.fn();
    integration(fetchImpl);
    await handlers[IPC_CHANNELS.blenderAddonSetAutoUpdate]({}, false);

    expect(await integration(fetchImpl).updateOnLaunch()).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
