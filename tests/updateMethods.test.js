import { afterEach, describe, expect, it, vi } from 'vitest';

import { updateMethods } from '../src/app/methods/updateMethods';

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

describe('renderer update state', () => {
  it('shows an available release beside the actual application version', async () => {
    globalThis.window = {
      electronAPI: {
        getAppInfo: vi.fn(async () => ({ version: '2.1.4' })),
        checkForUpdates: vi.fn(async () => ({
          currentVersion: '2.1.4',
          latestVersion: '2.1.5',
          updateAvailable: true,
        })),
      },
    };
    const state = { appVersion: '', latestVersion: '', updateAvailable: false };

    await updateMethods.initializeUpdateStatus.call(state);

    expect(state).toEqual({
      appVersion: '2.1.4',
      latestVersion: '2.1.5',
      updateAvailable: true,
    });
  });

  it('keeps the editor quiet when the release check fails', async () => {
    globalThis.window = {
      electronAPI: {
        getAppInfo: vi.fn(async () => ({ version: '2.1.4' })),
        checkForUpdates: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
    };
    const state = { appVersion: '', latestVersion: 'old', updateAvailable: true };

    await updateMethods.initializeUpdateStatus.call(state);

    expect(state).toEqual({
      appVersion: '2.1.4',
      latestVersion: '',
      updateAvailable: false,
    });
  });

  it('opens releases only while an update is available', async () => {
    const openReleasesPage = vi.fn(async () => {});
    globalThis.window = { electronAPI: { openReleasesPage } };

    await updateMethods.openUpdatePage.call({ updateAvailable: false });
    expect(openReleasesPage).not.toHaveBeenCalled();

    await updateMethods.openUpdatePage.call({ updateAvailable: true });
    expect(openReleasesPage).toHaveBeenCalledOnce();
  });

  it('ignores a browser-open failure after connectivity is lost', async () => {
    globalThis.window = {
      electronAPI: {
        openReleasesPage: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
    };

    await expect(
      updateMethods.openUpdatePage.call({ updateAvailable: true }),
    ).resolves.toBeUndefined();
  });
});
