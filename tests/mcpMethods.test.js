import { afterEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive } from 'vue';

import { historyMethods } from '../src/app/methods/historyMethods';
import { buildMcpWriteResult, mcpMethods } from '../src/app/methods/mcpMethods';

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

describe('renderer MCP responses', () => {
  it('reports successful writes and their actual destinations explicitly', () => {
    const result = buildMcpWriteResult({
      applied: true,
      dryRun: false,
      revision: '20-cafebabe',
      result: { createdItemIds: [11, 12], warnings: [] },
      texture: {
        layers: [
          { type: 'item', id: 11 },
          {
            type: 'folder',
            name: 'Low-poly Car',
            childs: [{ type: 'item', id: 12 }],
          },
        ],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: 'success',
      applied: true,
      createdCount: 2,
      createdFolderPaths: ['(root)', 'Low-poly Car'],
    });
  });

  it('converts Vue proxies into Electron IPC-safe data', async () => {
    const respondToMcpRequest = vi.fn();
    globalThis.window = { electronAPI: { respondToMcpRequest } };
    const reactiveResult = reactive({
      hierarchy: { folders: [{ name: 'house1', children: [] }] },
      defaults: { size: [64, 64] },
    });
    const context = {
      handleMcpRequest: vi.fn().mockResolvedValue(reactiveResult),
    };

    await mcpMethods.receiveMcpRequest.call(context, {
      requestId: 'request-1',
      method: 'get_overview',
      params: {},
    });

    expect(respondToMcpRequest).toHaveBeenCalledOnce();
    const response = respondToMcpRequest.mock.calls[0][0];
    expect(response).toEqual({
      requestId: 'request-1',
      result: {
        hierarchy: { folders: [{ name: 'house1', children: [] }] },
        defaults: { size: [64, 64] },
      },
    });
    expect(isProxy(response.result)).toBe(false);
    expect(isProxy(response.result.defaults.size)).toBe(false);
  });

  it('reports an undo that reverts edits not yet recorded in history', async () => {
    const context = {
      ...historyMethods,
      ...mcpMethods,
      texture: { undo_count: 20, items: [{ id: 1, x: 0 }], layers: [] },
      undo_array: [],
      selected: false,
      current_tab: 'search',
      draw: vi.fn(),
      $nextTick: async (callback) => callback?.(),
    };
    context.pushUndoSnapshot();
    context.texture.items[0].x = 32;

    const result = await context.handleMcpRequest({ method: 'undo', params: {} });

    expect(result.undone).toBe(true);
    expect(context.texture.items[0].x).toBe(0);
    expect((await context.handleMcpRequest({ method: 'undo', params: {} })).undone).toBe(false);
  });

  it('returns item materials with the same field names that writes accept', () => {
    const context = {
      ...mcpMethods,
      texture: {
        items: [
          {
            id: 1,
            name: 'Lamp',
            type: 'g',
            colors: [{ rgba: { r: 255, g: 238, b: 170, a: 1 } }],
            emission_strength: 40,
            clearcoat_roughness: 15,
          },
        ],
        layers: [{ id: 1, name: 'Lamp', type: 'item', childs: [] }],
      },
      ls: { selected: [] },
    };

    return context
      .handleMcpRequest({
        method: 'get_items',
        params: { requests: [{ ids: [1], fields: ['material'] }] },
      })
      .then((result) => {
        expect(result.results[0].items[0].material).toMatchObject({
          emissionStrength: 40,
          clearcoatRoughness: 15,
        });
      });
  });
});
