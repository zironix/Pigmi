import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileMethods } from '../src/app/methods/filesMethods';

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

describe('file loading', () => {
  it('waits for canvas dimensions to update before drawing a loaded document', async () => {
    const sourceTexture = {
      width: 512,
      height: 256,
      items: [{ id: 1, name: 'Body', size: 64 }],
    };
    globalThis.window = {
      electronAPI: {
        fileExists: vi.fn().mockResolvedValue(true),
        readTextFile: vi.fn().mockResolvedValue(JSON.stringify(sourceTexture)),
      },
    };
    const nextTick = vi.fn().mockResolvedValue(undefined);
    const draw = vi.fn();
    const addUndo = vi.fn();
    const context = {
      folder_path: '/project',
      selected_file: 'palette.json',
      slash: '/',
      overwrite_confirmation: 1,
      sync: false,
      undo_array: ['old-state'],
      texture: { items: [] },
      lastItem: null,
      fixTexture: vi.fn((texture) => texture),
      $nextTick: nextTick,
      draw,
      addUndo,
    };

    await fileMethods.loadAndSync.call(context, { throwOnError: true });

    expect(context.texture).toEqual(sourceTexture);
    expect(context.sync).toBe(true);
    expect(context.undo_array).toEqual([]);
    expect(nextTick).toHaveBeenCalledOnce();
    expect(nextTick.mock.invocationCallOrder[0]).toBeLessThan(draw.mock.invocationCallOrder[0]);
    expect(draw).toHaveBeenCalledOnce();
    expect(addUndo).toHaveBeenCalledOnce();
  });
});
