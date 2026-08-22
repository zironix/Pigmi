import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerUpdateHandlers } from '../src/main/ipc/updateHandlers';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';

describe('update IPC handlers', () => {
  let handlers;
  let fetchImpl;
  let shell;

  beforeEach(() => {
    handlers = new Map();
    fetchImpl = vi.fn(async () => Response.json({ tag_name: 'v2.1.5' }));
    shell = { openExternal: vi.fn(async () => {}) };

    registerUpdateHandlers(
      {
        handle(channel, handler) {
          handlers.set(channel, handler);
        },
      },
      {
        app: { getVersion: () => '2.1.4' },
        fetchImpl,
        shell,
      },
    );
  });

  it('returns the packaged application version', () => {
    expect(handlers.get(IPC_CHANNELS.appInfo)()).toEqual({ version: '2.1.4' });
  });

  it('checks GitHub only once per application session', async () => {
    const check = handlers.get(IPC_CHANNELS.checkForUpdates);

    await expect(check()).resolves.toMatchObject({
      latestVersion: '2.1.5',
      updateAvailable: true,
    });
    await check();

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('opens only the fixed releases page', async () => {
    await expect(handlers.get(IPC_CHANNELS.openReleasesPage)()).resolves.toEqual({ opened: true });
    expect(shell.openExternal).toHaveBeenCalledWith('https://github.com/zironix/Pigmi/releases');
  });
});
