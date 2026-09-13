import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileMethods } from '../src/app/methods/filesMethods';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  vi.useFakeTimers();
  const writeTextFile = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('window', { electronAPI: { writeTextFile } });
  const copiedCanvases = [];
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = { getContext: () => ({ drawImage: (source) => copiedCanvases.push(source) }) };
      return canvas;
    },
  });
  const context = {
    ...fileMethods,
    sync: true,
    folder_path: '/project',
    selected_file: 'first.json',
    slash: '/',
    texture: { items: [{ id: 1 }], update_interval: 100, save_roughness: 1 },
    canvas_roughness: { width: 32, height: 32 },
    mixTexture: vi.fn().mockResolvedValue(undefined),
  };
  return { context, writeTextFile, copiedCanvases };
}

describe('autosave', () => {
  it('finishes an in-flight export using its own document settings and canvases', async () => {
    const { context, writeTextFile, copiedCanvases } = setup();
    let finishWrite;
    writeTextFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWrite = resolve;
        }),
    );
    context.save();
    await vi.advanceTimersByTimeAsync(100);
    const originalCanvas = context.canvas_roughness;
    expect(copiedCanvases).toEqual([originalCanvas]);
    context.selected_file = 'second.json';
    context.texture = { save_roughness: 0 };
    finishWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(context.mixTexture).toHaveBeenCalledWith('roughness');
    const exportContext = context.mixTexture.mock.contexts[0];
    expect(exportContext.selected_file).toBe('first.json');
    expect(exportContext.canvas_roughness).not.toBe(originalCanvas);
    expect(exportContext.canPreview()).toBe(false);
  });

  it('serializes saves and coalesces superseded queued revisions', async () => {
    const { context, writeTextFile } = setup();
    let finishWrite;
    writeTextFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWrite = resolve;
        }),
    );
    context.save();
    await vi.advanceTimersByTimeAsync(100);
    context.texture.items[0].name = 'intermediate';
    context.save();
    await vi.advanceTimersByTimeAsync(100);
    context.texture.items[0].name = 'latest';
    context.save();
    await vi.advanceTimersByTimeAsync(100);
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    finishWrite();
    await vi.advanceTimersByTimeAsync(0);
    expect(writeTextFile).toHaveBeenCalledTimes(2);
    expect(JSON.parse(writeTextFile.mock.calls[1][1]).items[0].name).toBe('latest');
  });

  it('does not start a stale debounce after switching documents or desynchronizing', async () => {
    const { context, writeTextFile } = setup();
    context.save();
    context.selected_file = 'second.json';
    await vi.advanceTimersByTimeAsync(100);
    expect(writeTextFile).not.toHaveBeenCalled();
    context.save();
    context.sync = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
