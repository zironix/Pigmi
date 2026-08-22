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
      localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    };
    const state = { appVersion: '', latestVersion: '', updateAvailable: false };

    await updateMethods.initializeUpdateStatus.call(state);

    expect(state).toEqual({
      appVersion: '2.1.4',
      latestVersion: '2.1.5',
      updateAvailable: true,
      updateCheckEnabled: 1,
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
      localStorage: { getItem: vi.fn(() => null), setItem: vi.fn() },
    };
    const state = { appVersion: '', latestVersion: 'old', updateAvailable: true };

    await updateMethods.initializeUpdateStatus.call(state);

    expect(state).toEqual({
      appVersion: '2.1.4',
      latestVersion: '',
      updateAvailable: false,
      updateCheckEnabled: 1,
    });
  });

  it('skips GitHub entirely when update checks are disabled', async () => {
    const checkForUpdates = vi.fn(async () => ({ updateAvailable: true }));
    globalThis.window = {
      electronAPI: {
        getAppInfo: vi.fn(async () => ({ version: '2.1.4' })),
        checkForUpdates,
      },
      localStorage: { getItem: vi.fn(() => '0'), setItem: vi.fn() },
    };
    const state = { appVersion: '', latestVersion: 'old', updateAvailable: true };

    await updateMethods.initializeUpdateStatus.call(state);

    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(state).toEqual({
      appVersion: '2.1.4',
      latestVersion: '',
      updateAvailable: false,
      updateCheckEnabled: 0,
    });
  });

  it('persists preference changes and checks only after being enabled', async () => {
    const checkForUpdates = vi.fn(async () => ({
      currentVersion: '2.1.4',
      latestVersion: '2.1.5',
      updateAvailable: true,
    }));
    const localStorage = { getItem: vi.fn(), setItem: vi.fn() };
    globalThis.window = { electronAPI: { checkForUpdates }, localStorage };
    const state = {
      appVersion: '2.1.4',
      latestVersion: '2.1.5',
      updateAvailable: true,
      updateCheckEnabled: 1,
    };

    updateMethods.setUpdateCheckEnabled.call(state, 0);

    expect(localStorage.setItem).toHaveBeenLastCalledWith('pigmi.update-check-enabled', '0');
    expect(checkForUpdates).not.toHaveBeenCalled();
    expect(state).toMatchObject({
      latestVersion: '',
      updateAvailable: false,
      updateCheckEnabled: 0,
    });

    updateMethods.setUpdateCheckEnabled.call(state, 1);
    await vi.waitFor(() => expect(checkForUpdates).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(state.updateAvailable).toBe(true));
    expect(localStorage.setItem).toHaveBeenLastCalledWith('pigmi.update-check-enabled', '1');
  });

  it('opens releases only while an update is available', async () => {
    const openReleasesPage = vi.fn(async () => {});
    globalThis.window = { electronAPI: { openReleasesPage } };

    await updateMethods.openUpdatePage.call({ updateAvailable: false });
    expect(openReleasesPage).not.toHaveBeenCalled();

    await updateMethods.openUpdatePage.call({ updateAvailable: true, updateCheckEnabled: 0 });
    expect(openReleasesPage).not.toHaveBeenCalled();

    await updateMethods.openUpdatePage.call({ updateAvailable: true, updateCheckEnabled: 1 });
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
