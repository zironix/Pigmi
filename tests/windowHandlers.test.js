import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerWindowHandlers } from '../src/main/ipc/windowHandlers';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';

describe('window IPC handlers', () => {
  let handlers;
  let window;

  beforeEach(() => {
    handlers = new Map();
    window = {
      close: vi.fn(),
      isMaximized: vi.fn(() => false),
      maximize: vi.fn(),
      minimize: vi.fn(),
      unmaximize: vi.fn(),
    };

    registerWindowHandlers(
      {
        handle(channel, handler) {
          handlers.set(channel, handler);
        },
      },
      () => window,
    );
  });

  it('closes and minimizes the active window', () => {
    handlers.get(IPC_CHANNELS.closeWindow)();
    handlers.get(IPC_CHANNELS.minimizeWindow)();

    expect(window.close).toHaveBeenCalledOnce();
    expect(window.minimize).toHaveBeenCalledOnce();
  });

  it('toggles maximized state', () => {
    handlers.get(IPC_CHANNELS.maximizeWindow)();
    expect(window.maximize).toHaveBeenCalledOnce();

    window.isMaximized.mockReturnValue(true);
    handlers.get(IPC_CHANNELS.maximizeWindow)();
    expect(window.unmaximize).toHaveBeenCalledOnce();
  });
});
