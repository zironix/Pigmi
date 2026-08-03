import { describe, expect, it } from 'vitest';

import { buildEditorOverview, fulfillEditorDataRequests } from '../src/ai/editorContext';

const color = (r, g, b, a = 1) => ({ rgba: { r, g, b, a } });

function makeTexture() {
  return {
    width: 1024,
    height: 512,
    step: 32,
    max_item_size: 200,
    default_color_model: 'hsva',
    items: [
      {
        id: 101,
        name: 'Body',
        type: 'g',
        shape: 'l',
        direction: 'horizontal',
        color_mode: 'rgb',
        colors: [color(10, 20, 30), color(40, 50, 60)],
        color_offsets: [0, 100],
        size: [64, 32],
        x: 0,
        y: 32,
        roughness: 25,
        visible: true,
      },
      {
        id: 102,
        name: 'Glass',
        type: 'g',
        shape: 'l',
        direction: 'vertical',
        color_mode: 'rgb',
        colors: [color(0, 100, 200, 0.35)],
        color_offsets: [0],
        size: [32, 32],
        x: 64,
        y: 32,
        roughness: 5,
        visible: true,
      },
    ],
    layers: [
      {
        id: 1,
        name: 'Vehicle',
        type: 'folder',
        visible: true,
        childs: [
          { id: 101, name: 'Body', type: 'item', visible: true, childs: [] },
          { id: 102, name: 'Glass', type: 'item', visible: true, childs: [] },
        ],
      },
    ],
  };
}

describe('selective editor context', () => {
  it('builds a hierarchy index without item payloads', () => {
    const overview = buildEditorOverview({
      texture: makeTexture(),
      selectionIds: [102],
      activeId: 102,
      lastItem: null,
    });

    expect(overview.selection).toEqual({ activeId: 102, ids: [102] });
    expect(overview.hierarchy.folders).toEqual([
      {
        id: 1,
        path: 'Vehicle',
        parentPath: '',
        index: 0,
        type: 'folder',
        visible: true,
        collapsed: false,
        itemCount: 2,
      },
    ]);
    expect(overview.hierarchy.items).toEqual([
      {
        id: 101,
        path: 'Vehicle/Body',
        parentPath: 'Vehicle',
        index: 0,
        type: 'g',
        visible: true,
      },
      {
        id: 102,
        path: 'Vehicle/Glass',
        parentPath: 'Vehicle',
        index: 1,
        type: 'g',
        visible: true,
      },
    ]);
    expect(overview.hierarchy.items[0]).not.toHaveProperty('colors');
    expect(overview.hierarchy.items[0]).not.toHaveProperty('material');
    expect(overview.hierarchy.items[0]).not.toHaveProperty('transform');
  });

  it('returns only requested items and fields', () => {
    const context = fulfillEditorDataRequests({
      texture: makeTexture(),
      selectionIds: [102],
      requests: [
        {
          type: 'get_items',
          ids: [102],
          fields: ['colors'],
          limit: 10,
        },
      ],
    });

    expect(context.results[0].matchedCount).toBe(1);
    expect(context.results[0].items[0]).toMatchObject({
      id: 102,
      path: 'Vehicle/Glass',
      colors: ['#0064c8'],
      colorOffsets: [0],
      colorStops: [{ hex: '#0064c8', opacity: 35, offset: 0 }],
    });
    expect(context.results[0].items[0]).not.toHaveProperty('material');
    expect(context.results[0].items[0]).not.toHaveProperty('transform');
  });

  it('does not expose all items for an empty get_items request', () => {
    const context = fulfillEditorDataRequests({
      texture: makeTexture(),
      selectionIds: [],
      requests: [{ type: 'get_items', fields: ['colors'], limit: 100 }],
    });

    expect(context.results[0].items).toEqual([]);
  });
});
