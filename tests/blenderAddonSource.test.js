import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { addonDownloadUrl } from '../src/main/blender/addons';
import {
  downloadAddon,
  resolveAddonSource,
  validateAddonSource,
} from '../src/main/blender/addonSource';

const addonSource = (version, name = 'Pigmi: UV to Palette') =>
  `bl_info = {\n    "name": "${name}",\n    "version": (${version.join(', ')}),\n}\n`;
const NAME = 'Pigmi: UV to Palette';
const URL = addonDownloadUrl('pigmi_uv2palette.py');
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
});

let root;
let cacheFile;
let bundledPath;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'pigmi-addon-source-'));
  cacheFile = path.join(root, 'cache', 'pigmi_uv2palette.py');
  bundledPath = path.join(root, 'bundled.py');
  await fs.writeFile(bundledPath, addonSource([1, 19, 2]));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('Blender add-on source', () => {
  it('accepts only the UV to Palette add-on', () => {
    expect(validateAddonSource(addonSource([1, 20, 0]), NAME)).toEqual([1, 20, 0]);
    expect(() => validateAddonSource('<html>404</html>', NAME)).toThrow();
    expect(() => validateAddonSource(addonSource([1, 0, 0], 'Something else'), NAME)).toThrow();
    expect(() => validateAddonSource('bl_info = {"name": "Pigmi: UV to Palette"}', NAME)).toThrow();
  });

  it('downloads the add-on from the main branch into the cache', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(addonSource([1, 20, 0])));

    expect(await downloadAddon({ fetchImpl, cacheFile, url: URL, addonName: NAME })).toEqual([
      1, 20, 0,
    ]);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/zironix/Pigmi/main/Pigmi%20Helpers/pigmi_uv2palette.py',
    );
    expect(await fs.readFile(cacheFile, 'utf8')).toBe(addonSource([1, 20, 0]));
    expect(await resolveAddonSource({ cacheFile, bundledPath, addonName: NAME })).toMatchObject({
      origin: 'github',
      version: [1, 20, 0],
    });
  });

  it('keeps the previous cache when a download fails or is not the add-on', async () => {
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, addonSource([1, 20, 0]));

    await expect(
      downloadAddon({
        fetchImpl: vi.fn().mockResolvedValue(response('Not found', 404)),
        cacheFile,
      }),
    ).rejects.toThrow('HTTP 404');
    await expect(
      downloadAddon({
        fetchImpl: vi.fn().mockResolvedValue(response('<html></html>')),
        cacheFile,
        url: URL,
        addonName: NAME,
      }),
    ).rejects.toThrow();
    expect(await fs.readFile(cacheFile, 'utf8')).toBe(addonSource([1, 20, 0]));
  });

  it('falls back to the bundled copy offline or when it is newer than the cache', async () => {
    expect(await resolveAddonSource({ cacheFile, bundledPath, addonName: NAME })).toMatchObject({
      origin: 'bundled',
      path: bundledPath,
    });
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, addonSource([1, 18, 0]));
    expect((await resolveAddonSource({ cacheFile, bundledPath, addonName: NAME })).origin).toBe(
      'bundled',
    );
  });
});
