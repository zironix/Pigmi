import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileMethods } from '../src/app/methods/filesMethods';

const originalWindow = globalThis.window;
const originalImage = globalThis.Image;
const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:pigmi-mix');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.Image = originalImage;
  globalThis.createImageBitmap = originalCreateImageBitmap;
  URL.createObjectURL = originalCreateObjectUrl;
  URL.revokeObjectURL = originalRevokeObjectUrl;
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

  it('loads an albedo mix through the authorized binary-file bridge', async () => {
    const readBinaryFile = vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const writeBinaryFile = vi.fn().mockResolvedValue(true);
    globalThis.window = {
      electronAPI: {
        fileExists: vi.fn().mockResolvedValue(true),
        readBinaryFile,
        writeBinaryFile,
      },
    };
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({ bitmap: true });
    globalThis.Image = class MockImage {
      set src(value) {
        this.source = value;
        queueMicrotask(() => this.onload());
      }
    };
    const ctx = { drawImage: vi.fn() };
    const ctxAlbedo = { drawImage: vi.fn() };
    const ctxEmission = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ pixels: true })) };
    const ctxEmissionCrop = { getImageData: vi.fn(() => ({ mask: true })) };
    const context = {
      folder_path: '/project',
      selected_file: 'main.json',
      slash: '/',
      texture: { width: 2048, height: 2048, mix_preview: 1, save_albedo: 1 },
      finalZoom: 0.5,
      canvas_albedo: {
        toBlob(callback) {
          callback(new Blob(['composited-map'], { type: 'image/png' }));
        },
      },
      ctx,
      ctx_albedo: ctxAlbedo,
      ctx_emission: ctxEmission,
      ctx_emission_crop: ctxEmissionCrop,
    };

    await fileMethods.mixTexture.call(context, 'albedo');

    expect(readBinaryFile).toHaveBeenCalledWith('/project/main_albedo_mix.png');
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(ctxAlbedo.drawImage).toHaveBeenCalledOnce();
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1024, 1024);
    expect(writeBinaryFile).toHaveBeenCalledWith(
      '/project/main_albedo.png',
      expect.any(ArrayBuffer),
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pigmi-mix');
  });
});
