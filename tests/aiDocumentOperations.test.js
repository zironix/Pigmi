import { describe, expect, it } from 'vitest';

import { applyAiPlan } from '../src/ai/aiPlanExecutor';

function makeDocument() {
  const items = [
    {
      id: 101,
      name: 'Body',
      type: 'g',
      size: [64, 64],
      x: 960,
      y: 960,
      visible: true,
      colors: [],
    },
    {
      id: 102,
      name: 'Glass',
      type: 'g',
      size: [32, 32],
      x: 64,
      y: 64,
      visible: true,
      colors: [],
    },
  ];
  return {
    texture: {
      width: 1024,
      height: 1024,
      step: 64,
      max_item_size: 200,
      default_color_model: 'hsva',
      items,
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
    },
    layersStore: {
      selected: [],
      setSelected(ids, activeType) {
        this.selected = ids;
        this.active_id = ids.at(-1) ?? null;
        this.active_type = activeType;
      },
    },
  };
}

describe('AI document operations', () => {
  it('updates document settings, visibility, selection, and hierarchy', () => {
    const document = makeDocument();
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => 999,
      plan: {
        operations: [
          {
            type: 'update_texture',
            set: {
              width: 512,
              height: 512,
              step: 32,
              defaultColorModel: 'hex',
              generation: { mode: 'diffusion', adjacency: 'ring', temperature: 1.5 },
              exportMaps: { albedo: 2, mrc: 1 },
            },
          },
          { type: 'set_visibility', folderPath: 'Vehicle', visible: false },
          { type: 'set_folder_state', path: 'Vehicle', collapsed: true },
          { type: 'set_selection', target: { ids: [102] }, mode: 'replace' },
          { type: 'move_layer', id: 102, folderPath: '', index: 0 },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    expect(document.texture).toMatchObject({
      width: 512,
      height: 512,
      step: 32,
      default_color_model: 'hex',
      save_albedo: 2,
      save_mrc: 1,
      generation: { mode: 'diffusion', adjacency: 'ring', temperature: 1.5 },
    });
    expect(document.texture.items[0]).toMatchObject({ x: 448, y: 448, visible: false });
    expect(document.texture.items[1].visible).toBe(false);
    expect(document.layersStore.selected).toEqual([102]);
    expect(document.texture.layers[0]).toMatchObject({ id: 102, type: 'item' });
    expect(document.texture.layers[1]).toMatchObject({
      id: 1,
      type: 'folder',
      collapsed: true,
    });
  });

  it('rejects a selection operation without an explicit target', () => {
    const document = makeDocument();
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => 999,
      plan: {
        operations: [{ type: 'set_selection', mode: 'replace' }],
      },
    });

    expect(document.layersStore.selected).toEqual([]);
    expect(result.warnings).toEqual(['op#1: set_selection target not found']);
  });

  it('rejects a batch edit without a target instead of throwing', () => {
    const document = makeDocument();
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => 999,
      plan: {
        operations: [{ type: 'edit_items', set: { newName: 'Untargeted' } }],
      },
    });

    expect(document.texture.items.map((item) => item.name)).toEqual(['Body', 'Glass']);
    expect(result.warnings).toEqual([
      'op#1.1: edit_items target not found',
      'op#1: edit_items had no valid changes',
    ]);
  });

  it('does not select newly created palette items implicitly', () => {
    const document = makeDocument();
    document.layersStore.setSelected([102], 'item');

    const result = applyAiPlan({
      ...document,
      nextLayerId: () => 999,
      plan: {
        operations: [
          {
            type: 'create_gradient_item',
            name: 'Generated palette',
            colors: ['#112233', '#445566'],
          },
        ],
      },
    });

    expect(result.createdItemIds).toEqual([999]);
    expect(document.layersStore.selected).toEqual([102]);
    expect(document.layersStore.active_id).toBe(102);
  });

  it('creates and updates PBR materials with per-stop opacity', () => {
    const document = makeDocument();
    applyAiPlan({
      ...document,
      nextLayerId: () => 999,
      plan: {
        operations: [
          {
            type: 'create_gradient_item',
            name: 'Coated metal',
            colors: ['#336699', '#99ccff'],
            opacities: [25, 80],
            material: {
              albedo: 1,
              roughness: 18,
              metallic: 92,
              emission: 1,
              emissionStrength: 65,
              clearcoat: 40,
              clearcoatRoughness: 12,
            },
          },
        ],
      },
    });

    const item = document.texture.items.find((candidate) => candidate.id === 999);
    expect(item).toMatchObject({
      albedo: 1,
      roughness: 18,
      metallic: 92,
      emission: 1,
      emission_strength: 65,
      clearcoat: 40,
      clearcoat_roughness: 12,
    });
    expect(item.colors.map((entry) => entry.rgba.a)).toEqual([0.25, 0.8]);

    applyAiPlan({
      ...document,
      nextLayerId: () => 1000,
      plan: {
        operations: [
          {
            type: 'update_item',
            target: { id: 999 },
            opacity: 55,
            material: { roughness: 30 },
          },
        ],
      },
    });

    expect(item.roughness).toBe(30);
    expect(item.metallic).toBe(92);
    expect(item.colors.map((entry) => entry.rgba.a)).toEqual([0.55, 0.55]);
  });

  it('creates a finished palette grid in one batch operation', () => {
    const document = makeDocument();
    let nextId = 1000;
    const paletteItems = Array.from({ length: 16 }, (_, index) => ({
      name: `Swatch ${index + 1}`,
      colors: ['#f0f0f0', `#${(index + 1).toString(16).padStart(2, '0')}2244`],
      direction: 'vertical',
    }));

    const result = applyAiPlan({
      ...document,
      nextLayerId: () => nextId++,
      plan: {
        operations: [
          {
            type: 'create_gradient_items',
            defaults: { itemType: 'g', size: [64, 64] },
            items: paletteItems,
          },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.createdItemIds).toHaveLength(16);
    expect(document.texture.items).toHaveLength(18);
  });
});
