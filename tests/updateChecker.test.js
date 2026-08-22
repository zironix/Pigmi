import { describe, expect, it, vi } from 'vitest';

import {
  checkLatestRelease,
  compareVersions,
  normalizeVersion,
} from '../src/main/updates/updateChecker';

describe('semantic version comparison', () => {
  it('normalizes GitHub tags and compares every numeric component', () => {
    expect(normalizeVersion('v2.1.4')).toBe('2.1.4');
    expect(compareVersions('2.1.4', '2.1.5')).toBe(-1);
    expect(compareVersions('2.9.9', '2.10.0')).toBe(-1);
    expect(compareVersions('3.0.0', '2.99.99')).toBe(1);
    expect(compareVersions('v2.1.4', '2.1.4')).toBe(0);
  });

  it('orders prereleases below their final release', () => {
    expect(compareVersions('2.1.4-beta.2', '2.1.4-beta.10')).toBe(-1);
    expect(compareVersions('2.1.4-beta.10', '2.1.4')).toBe(-1);
    expect(compareVersions('2.1.4', '2.1.4-beta.10')).toBe(1);
  });

  it('rejects tags that are not semantic versions', () => {
    expect(normalizeVersion('release-current')).toBeNull();
    expect(compareVersions('2.1.4', 'release-current')).toBeNull();
  });
});

describe('GitHub release checks', () => {
  it('reports a newer stable release and sends GitHub API headers', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ tag_name: 'v2.2.0', draft: false, prerelease: false }),
    );

    await expect(checkLatestRelease({ currentVersion: '2.1.4', fetchImpl })).resolves.toEqual({
      checked: true,
      currentVersion: '2.1.4',
      latestVersion: '2.2.0',
      updateAvailable: true,
    });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/zironix/Pigmi/releases/latest');
    expect(options.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Pigmi-update-check',
      'X-GitHub-Api-Version': '2026-03-10',
    });
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not show an icon for the same or an older release', async () => {
    const sameRelease = vi.fn(async () => Response.json({ tag_name: 'v2.1.4' }));
    const olderRelease = vi.fn(async () => Response.json({ tag_name: 'v2.0.9' }));

    await expect(
      checkLatestRelease({ currentVersion: '2.1.4', fetchImpl: sameRelease }),
    ).resolves.toMatchObject({ checked: true, updateAvailable: false });
    await expect(
      checkLatestRelease({ currentVersion: '2.1.4', fetchImpl: olderRelease }),
    ).resolves.toMatchObject({ checked: true, updateAvailable: false });
  });

  it('fails silently when GitHub is unavailable or returns invalid data', async () => {
    const offline = vi.fn(async () => {
      throw new Error('offline');
    });
    const missingRelease = vi.fn(async () => new Response('', { status: 404 }));
    const invalidRelease = vi.fn(async () => Response.json({ tag_name: 'latest' }));
    const expected = {
      checked: false,
      currentVersion: '2.1.4',
      latestVersion: null,
      updateAvailable: false,
    };

    await expect(
      checkLatestRelease({ currentVersion: '2.1.4', fetchImpl: offline }),
    ).resolves.toEqual(expected);
    await expect(
      checkLatestRelease({ currentVersion: '2.1.4', fetchImpl: missingRelease }),
    ).resolves.toEqual(expected);
    await expect(
      checkLatestRelease({ currentVersion: '2.1.4', fetchImpl: invalidRelease }),
    ).resolves.toEqual(expected);
  });
});
