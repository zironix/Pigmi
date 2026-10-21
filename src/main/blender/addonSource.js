import { promises as fs } from 'node:fs';
import path from 'node:path';

import { compareVersions, parseAddonVersion } from './addonInstaller';

const DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_ADDON_BYTES = 2 * 1024 * 1024;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Accepts only a file that is recognizably the named add-on, never an error page or another script. */
export function validateAddonSource(source, addonName) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('The add-on file is empty');
  if (Buffer.byteLength(source) > MAX_ADDON_BYTES) throw new Error('The add-on file is too large');
  const name = new RegExp(`["']name["']\\s*:\\s*["']${escapeRegExp(addonName)}["']`);
  if (!/^\s*bl_info\s*=/m.test(source) || !name.test(source)) {
    throw new Error(`The downloaded file is not the ${addonName} add-on`);
  }
  const version = parseAddonVersion(source);
  if (!version) throw new Error('The add-on file has no version');
  return version;
}

/** Downloads the latest add-on into cacheFile and returns its version. */
export async function downloadAddon({ fetchImpl, cacheFile, url, addonName }) {
  if (typeof fetchImpl !== 'function') throw new Error('Downloads are unavailable');
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': 'Pigmi-addon-update' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
  const source = await response.text();
  const version = validateAddonSource(source, addonName);
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  const temporary = `${cacheFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, source);
  await fs.rename(temporary, cacheFile);
  return version;
}

async function readCandidate(filePath, origin, addonName) {
  try {
    return {
      path: filePath,
      origin,
      version: validateAddonSource(await fs.readFile(filePath, 'utf8'), addonName),
    };
  } catch {
    return null;
  }
}

/**
 * Picks the newest usable copy: the last GitHub download, or the copy bundled
 * with Pigmi so a first install also works offline.
 */
export async function resolveAddonSource({ cacheFile, bundledPath, addonName }) {
  const candidates = (
    await Promise.all([
      readCandidate(cacheFile, 'github', addonName),
      readCandidate(bundledPath, 'bundled', addonName),
    ])
  ).filter(Boolean);
  if (!candidates.length) throw new Error(`No copy of the ${addonName} add-on is available`);
  return candidates.reduce((best, candidate) =>
    compareVersions(candidate.version, best.version) > 0 ? candidate : best,
  );
}
