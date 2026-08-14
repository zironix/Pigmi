import { afterEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive } from 'vue';

import { mcpMethods } from '../src/app/methods/mcpMethods';

const originalWindow = globalThis.window;

afterEach(() => {
  globalThis.window = originalWindow;
});

describe('renderer MCP responses', () => {
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
