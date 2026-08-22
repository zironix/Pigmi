export const RELEASES_PAGE_URL = 'https://github.com/zironix/Pigmi/releases';

const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/zironix/Pigmi/releases/latest';
const GITHUB_API_VERSION = '2026-03-10';
const UPDATE_REQUEST_TIMEOUT_MS = 8_000;

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(value || '').trim(),
  );
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;

    const leftIsNumber = /^\d+$/.test(left[index]);
    const rightIsNumber = /^\d+$/.test(right[index]);
    if (leftIsNumber && rightIsNumber) return Number(left[index]) < Number(right[index]) ? -1 : 1;
    if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function normalizeVersion(value) {
  const parsed = parseVersion(value);
  if (!parsed) return null;
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease.length ? `${core}-${parsed.prerelease.join('.')}` : core;
}

/** Returns -1, 0, or 1 when both inputs are valid semantic versions. */
export function compareVersions(left, right) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) return null;

  for (const field of ['major', 'minor', 'patch']) {
    if (leftVersion[field] === rightVersion[field]) continue;
    return leftVersion[field] < rightVersion[field] ? -1 : 1;
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function emptyStatus(currentVersion) {
  return {
    checked: false,
    currentVersion: normalizeVersion(currentVersion) || String(currentVersion || ''),
    latestVersion: null,
    updateAvailable: false,
  };
}

export async function checkLatestRelease({ currentVersion, fetchImpl }) {
  const fallback = emptyStatus(currentVersion);
  if (typeof fetchImpl !== 'function') return fallback;

  try {
    const response = await fetchImpl(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Pigmi-update-check',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
      signal: AbortSignal.timeout(UPDATE_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return fallback;

    const release = await response.json();
    if (release?.draft === true || release?.prerelease === true) return fallback;

    const latestVersion = normalizeVersion(release?.tag_name);
    const comparison = compareVersions(fallback.currentVersion, latestVersion);
    if (!latestVersion || comparison === null) return fallback;

    return {
      checked: true,
      currentVersion: fallback.currentVersion,
      latestVersion,
      updateAvailable: comparison < 0,
    };
  } catch {
    // Update checks are optional and must never interfere with application startup.
    return fallback;
  }
}
