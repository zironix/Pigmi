import { afterEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive } from 'vue';

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
});
