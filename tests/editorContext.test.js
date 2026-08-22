import { describe, expect, it } from 'vitest';

import { buildEditorOverview, fulfillEditorDataRequests } from '../src/ai/editorContext';
import {
  buildEditorDiagnostics,
  buildFolderSnapshots,
  compareFolderSnapshots,
} from '../src/ai/editorInspection';

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

    expect(overview.protocol).toBe('pigmi-editor-tools/4');
    expect(overview.selection).toEqual({ activeId: 102, ids: [102] });
    expect(overview.hierarchy.folders).toEqual([
      {
        id: 1,
        path: 'Vehicle',
        parentId: null,
        index: 0,
        itemCount: 2,
        bounds: { x: 0, y: 32, width: 96, height: 32 },
      },
    ]);
    expect(overview.hierarchy.items).toEqual([
      {
        id: 101,
        path: 'Vehicle/Body',
        parentId: 1,
        index: 0,
        itemType: 'g',
      },
      {
        id: 102,
        path: 'Vehicle/Glass',
        parentId: 1,
        index: 1,
        itemType: 'g',
      },
    ]);
    expect(overview.hierarchy).toMatchObject({
      rootIds: [1],
      valid: true,
      issues: [],
      omitted: { folders: 0, items: 0 },
    });
    expect(overview).not.toHaveProperty('writeOperations');
    expect(overview.hierarchy.folders[0]).not.toHaveProperty('children');
    expect(overview.hierarchy.items[0]).not.toHaveProperty('colors');
    expect(overview.hierarchy.items[0]).not.toHaveProperty('material');
    expect(overview.hierarchy.items[0]).not.toHaveProperty('transform');
  });

  it('matches numeric item payloads to string layer ids without losing hierarchy', () => {
    const texture = makeTexture();
    texture.layers[0].id = '1';
    texture.layers[0].childs[0].id = '101';
    texture.layers[0].childs[1].id = '102';

    const overview = buildEditorOverview({
      texture,
      selectionIds: [],
      activeId: null,
      lastItem: null,
    });
    const context = fulfillEditorDataRequests({
      texture,
      selectionIds: [],
      requests: [{ type: 'get_items', folderPath: 'Vehicle', fields: ['colors'], limit: 10 }],
    });

    expect(overview.hierarchy.valid).toBe(true);
    expect(overview.hierarchy.items.map((item) => item.parentId)).toEqual(['1', '1']);
    expect(context.results[0].items.map((item) => item.path)).toEqual([
      'Vehicle/Body',
      'Vehicle/Glass',
    ]);
  });

  it('returns complete nested folders as reusable semantic templates', () => {
    const texture = makeTexture();
    texture.layers = [
      {
        id: 10,
        name: 'Garage',
        type: 'folder',
        childs: [
          {
            id: 1,
            name: 'Car 1',
            type: 'folder',
            childs: [
              { id: '101', name: 'Body', type: 'item', childs: [] },
              {
                id: 11,
                name: 'Windows',
                type: 'folder',
                childs: [{ id: '102', name: 'Glass', type: 'item', childs: [] }],
              },
            ],
          },
        ],
      },
    ];

    const result = buildFolderSnapshots({
      texture,
      paths: ['Garage/Car 1'],
      fields: ['colors', 'gradient', 'material'],
    });

    expect(result.missingPaths).toEqual([]);
    expect(result.folders[0]).toMatchObject({
      path: 'Garage/Car 1',
      bounds: { x: 0, y: 32, width: 96, height: 32 },
      complete: true,
      tree: {
        relativePath: '',
        children: [
          { kind: 'item', relativePath: 'Body' },
          {
            kind: 'folder',
            relativePath: 'Windows',
            children: [{ kind: 'item', relativePath: 'Windows/Glass' }],
          },
        ],
      },
    });
    expect(result.folders[0].items.map((item) => item.relativePath)).toEqual([
      'Body',
      'Windows/Glass',
    ]);
    expect(result.folders[0].items[1]).toMatchObject({
      colors: ['#0064c8'],
      colorStops: [{ opacity: 35 }],
      material: { roughness: 5 },
    });
  });

  it('returns only tree and bounds when no folder detail fields are requested', () => {
    const result = buildFolderSnapshots({
      texture: makeTexture(),
      paths: ['Vehicle'],
      fields: [],
    });

    expect(result.folders[0]).toMatchObject({
      path: 'Vehicle',
      bounds: { x: 0, y: 32, width: 96, height: 32 },
      items: [],
      tree: {
        children: [
          { kind: 'item', relativePath: 'Body' },
          { kind: 'item', relativePath: 'Glass' },
        ],
      },
    });
  });

  it('aligns repeated folders by relative semantic paths', () => {
    const texture = makeTexture();
    texture.items.push({
      ...structuredClone(texture.items[0]),
      id: 201,
      name: 'Body',
      colors: [color(180, 40, 30), color(220, 80, 60)],
    });
    texture.items.push({
      ...structuredClone(texture.items[1]),
      id: 202,
      name: 'Glass',
    });
    texture.layers = [
      { id: 1, name: 'Car 1', type: 'folder', childs: texture.layers[0].childs },
      {
        id: 2,
        name: 'Car 2',
        type: 'folder',
        childs: [
          { id: 201, name: 'Body', type: 'item', childs: [] },
          { id: 202, name: 'Glass', type: 'item', childs: [] },
        ],
      },
    ];

    const comparison = compareFolderSnapshots({
      texture,
      paths: ['Car 1', 'Car 2'],
      fields: ['colors', 'material'],
    });

    expect(comparison.structurallyEquivalent).toBe(true);
    expect(comparison.placements).toEqual([
      { path: 'Car 1', bounds: { x: 0, y: 32, width: 96, height: 32 } },
      { path: 'Car 2', bounds: { x: 0, y: 32, width: 96, height: 32 } },
    ]);
    expect(comparison.roles.map((role) => role.relativePath)).toEqual(['Body', 'Glass']);
    expect(comparison.roles.find((role) => role.relativePath === 'Body')).toMatchObject({
      missingIn: [],
      sameValues: false,
      values: [{ folderPath: 'Car 1' }, { folderPath: 'Car 2' }],
    });
    expect(comparison.roles.find((role) => role.relativePath === 'Glass').sameValues).toBe(true);
  });

  it('exposes names and geometry as raw evidence for a vertical local pattern', () => {
    const texture = makeTexture();
    texture.items.push(
      { ...structuredClone(texture.items[0]), id: 201, y: 160 },
      { ...structuredClone(texture.items[1]), id: 202, y: 160 },
    );
    texture.layers = [
      { id: 1, name: 'Вариант-01', type: 'folder', childs: texture.layers[0].childs },
      {
        id: 2,
        name: 'Вариант-02',
        type: 'folder',
        childs: [
          { id: 201, name: 'Body', type: 'item', childs: [] },
          { id: 202, name: 'Glass', type: 'item', childs: [] },
        ],
      },
    ];

    const overview = buildEditorOverview({
      texture,
      selectionIds: [],
      activeId: null,
      lastItem: null,
    });
    const comparison = compareFolderSnapshots({
      texture,
      paths: ['Вариант-01', 'Вариант-02'],
      fields: [],
    });

    expect(overview.hierarchy.folders.map((folder) => folder.path)).toEqual([
      'Вариант-01',
      'Вариант-02',
    ]);
    expect(comparison.placements).toEqual([
      { path: 'Вариант-01', bounds: { x: 0, y: 32, width: 96, height: 32 } },
      { path: 'Вариант-02', bounds: { x: 0, y: 160, width: 96, height: 32 } },
    ]);
    expect(comparison).not.toHaveProperty('flowDirection');
    expect(comparison).not.toHaveProperty('nextName');
  });

  it('detects folder-only structural differences between variants', () => {
    const texture = makeTexture();
    texture.layers = [
      { id: 1, name: 'Variant 1', type: 'folder', childs: [] },
      {
        id: 2,
        name: 'Variant 2',
        type: 'folder',
        childs: [{ id: 3, name: 'Empty details', type: 'folder', childs: [] }],
      },
    ];
    texture.items = [];

    const comparison = compareFolderSnapshots({
      texture,
      paths: ['Variant 1', 'Variant 2'],
      fields: [],
    });

    expect(comparison.structurallyEquivalent).toBe(false);
    expect(comparison.structure).toEqual([
      {
        relativePath: 'Empty details',
        kind: 'folder',
        presentIn: ['Variant 2'],
        missingIn: ['Variant 1'],
      },
    ]);
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
    expect(context.results[0]).not.toHaveProperty('request');
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

  it('finds items by exact semantic path or canvas region and scopes palette reads', () => {
    const texture = makeTexture();
    const context = fulfillEditorDataRequests({
      texture,
      selectionIds: [],
      requests: [
        { type: 'get_items', paths: ['Vehicle/Glass'], fields: ['transform'], limit: 10 },
        {
          type: 'get_items',
          rect: { x: 0, y: 0, width: 64, height: 128 },
          fields: [],
          limit: 10,
        },
        { type: 'get_palette', folderPath: 'Vehicle', query: 'Glass', limit: 10 },
      ],
    });

    expect(context.results[0].items.map((item) => item.path)).toEqual(['Vehicle/Glass']);
    expect(context.results[1].items.map((item) => item.path)).toEqual(['Vehicle/Body']);
    expect(context.results[2]).toMatchObject({
      matchedCount: 1,
      palette: [{ hex: '#0064c8', count: 1 }],
    });
  });

  it('reports malformed documents without exposing their full payload', () => {
    const texture = makeTexture();
    texture.layers[0].childs.pop();
    texture.items[0].x = 1000;
    texture.items[0].color_offsets = [0];
    texture.items[0].metallic = 140;

    const diagnostics = buildEditorDiagnostics({ texture });

    expect(diagnostics.valid).toBe(false);
    expect(diagnostics.errors.map((issue) => issue.type)).toEqual(
      expect.arrayContaining([
        'orphan_item_payload',
        'invalid_color_offsets',
        'item_out_of_bounds',
        'invalid_material_value',
      ]),
    );
    expect(diagnostics.summary).toMatchObject({ itemCount: 2, errorCount: 4 });
  });
});
