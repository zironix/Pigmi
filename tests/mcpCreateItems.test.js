import { describe, expect, it } from 'vitest';

import { buildCreateItemsOperation } from '../mcp/create-items.mjs';

describe('MCP create-items operation', () => {
  const items = [{ name: 'Body', colors: ['#112233', '#445566'] }];

  it('keeps items at the document root when no folder is requested', () => {
    expect(buildCreateItemsOperation({ items })).toEqual({
      type: 'create_gradient_items',
      defaults: undefined,
      items,
    });
  });

  it('applies a common folder without discarding shared defaults', () => {
    expect(
      buildCreateItemsOperation({
        items,
        folderPath: 'Low-poly Car',
        defaults: { direction: 'vertical' },
      }),
    ).toEqual({
      type: 'create_gradient_items',
      defaults: { direction: 'vertical', folderPath: 'Low-poly Car' },
      items,
    });
  });

  it('preserves the older defaults folderPath form for compatibility', () => {
    expect(
      buildCreateItemsOperation({
        items,
        defaults: { folderPath: 'Existing workflow' },
      }),
    ).toEqual({
      type: 'create_gradient_items',
      defaults: { folderPath: 'Existing workflow' },
      items,
    });
  });
});
