import { describe, expect, it } from 'vitest';

import { applyAiPlan } from '../src/ai/aiPlanExecutor';

const color = (r, g, b, a = 1) => ({
  rgba: { r, g, b, a },
  hsva: { h: 0, s: 0, v: 0, a },
});

function makeHouseDocument() {
  const roles = [
    { id: 101, name: 'Walls', rgba: [45, 105, 180, 1], roughness: 65 },
    { id: 102, name: 'Roof', rgba: [120, 45, 35, 1], roughness: 55 },
    { id: 103, name: 'Glass', rgba: [80, 170, 220, 0.35], roughness: 8 },
    { id: 104, name: 'Chimney', rgba: [45, 45, 45, 1], roughness: 70 },
  ];
  const items = roles.map((role, index) => ({
    id: role.id,
    name: role.name,
    type: 'g',
    shape: 'l',
    direction: 'vertical',
    color_mode: 'rgb',
    colors: [
      color(...role.rgba),
      color(role.rgba[0] + 20, role.rgba[1] + 20, role.rgba[2] + 20, role.rgba[3]),
    ],
    color_offsets: [10, 90],
    size: [32, 32],
    x: index * 32,
    y: 0,
    roughness: role.roughness,
    metallic: 0,
    emission: 0,
    emission_strength: 100,
    clearcoat: 0,
    clearcoat_roughness: 0,
    visible: true,
  }));
  return {
    texture: {
      width: 1024,
      height: 1024,
      step: 32,
      max_item_size: 200,
      items,
      layers: [
        {
          id: 1,
          name: 'House 1',
          type: 'folder',
          visible: true,
          collapsed: false,
          childs: [
            { id: 101, name: 'Walls', type: 'item', visible: true, childs: [] },
            { id: 102, name: 'Roof', type: 'item', visible: true, childs: [] },
            {
              id: 2,
              name: 'Details',
              type: 'folder',
              visible: true,
              collapsed: false,
              childs: [
                { id: '103', name: 'Glass', type: 'item', visible: true, childs: [] },
                { id: 104, name: 'Chimney', type: 'item', visible: true, childs: [] },
              ],
            },
          ],
        },
      ],
    },
    layersStore: { selected: [] },
  };
}

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

  it('preserves user-provided naming style and script exactly', () => {
    const document = makeDocument();
    let nextId = 999;
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => nextId++,
      plan: {
        operations: [
          {
            type: 'create_gradient_item',
            name: 'акцент_01',
            folderPath: 'набор_01',
            colors: ['#112233', '#445566'],
          },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    expect(document.texture.items.find((item) => item.id === 1000)?.name).toBe('акцент_01');
    expect(document.texture.layers[0]).toMatchObject({
      name: 'набор_01',
      childs: [{ name: 'акцент_01' }],
    });
  });

  it('duplicates an exact target into another folder without renaming it', () => {
    const document = makeDocument();
    let nextId = 1000;
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => nextId++,
      plan: {
        operations: [
          {
            type: 'duplicate_item',
            target: { id: 102 },
            folderPath: 'варианты/дополнительные',
          },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    const duplicate = document.texture.items.find((item) => item.id === result.createdItemIds[0]);
    expect(duplicate?.name).toBe('Glass');
    expect(document.texture.layers[0]).toMatchObject({
      name: 'варианты',
      childs: [{ name: 'дополнительные', childs: [{ name: 'Glass' }] }],
    });
  });

  it('rejects a same-folder duplicate when no safe name was supplied', () => {
    const document = makeDocument();
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => 999,
      plan: { operations: [{ type: 'duplicate_item', target: { id: 102 } }] },
    });

    expect(result.createdItemIds).toEqual([]);
    expect(result.warnings).toEqual([
      'op#1: duplicate_item newName is required in the same folder',
    ]);
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

  it('duplicates complete folder variants and edits children by semantic relative path', () => {
    const document = makeHouseDocument();
    let nextId = 1000;
    const variants = [
      {
        newPath: 'House 2',
        edits: [
          { relativePath: 'Walls', colors: ['#d6a84b', '#f0cf7a'] },
          {
            relativePath: 'Roof',
            colors: ['#31485f', '#536d87'],
            material: { metallic: 45, roughness: 28 },
          },
          { relativePath: 'Details/Glass', colors: ['#8ad8ef', '#d7f5ff'] },
        ],
      },
      {
        newPath: 'House 3',
        edits: [
          { relativePath: 'Walls', colors: ['#79945a', '#adc783'] },
          { relativePath: 'Roof', colors: ['#56344f', '#815b75'] },
          { relativePath: 'Details/Glass', colors: ['#7bc4dc', '#c6edf5'] },
        ],
      },
      {
        newPath: 'House 4',
        edits: [
          { relativePath: 'Walls', colors: ['#b8664c', '#df9675'] },
          { relativePath: 'Roof', colors: ['#34373d', '#5a6069'] },
          { relativePath: 'Details/Glass', colors: ['#91cde0', '#d8f2f7'] },
        ],
      },
    ];
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => nextId++,
      plan: {
        operations: variants.map((variant) => ({
          type: 'duplicate_folder',
          sourcePath: 'House 1',
          newPath: variant.newPath,
          itemEdits: variant.edits,
        })),
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.createdItemIds).toHaveLength(12);
    expect(document.texture.items).toHaveLength(16);
    ['House 2', 'House 3', 'House 4'].forEach((name) => {
      const folder = document.texture.layers.find((node) => node.name === name);
      expect(folder.childs.map((node) => node.name)).toEqual(['Walls', 'Roof', 'Details']);
      expect(folder.childs[2].childs.map((node) => node.name)).toEqual(['Glass', 'Chimney']);
    });

    const house2 = document.texture.layers.find((node) => node.name === 'House 2');
    const roof = document.texture.items.find((item) => item.id === house2.childs[1].id);
    const glass = document.texture.items.find((item) => item.id === house2.childs[2].childs[0].id);
    const chimney = document.texture.items.find(
      (item) => item.id === house2.childs[2].childs[1].id,
    );
    expect(roof).toMatchObject({ metallic: 45, roughness: 28, color_offsets: [10, 90] });
    expect(glass.colors.map((entry) => entry.rgba.a)).toEqual([0.35, 0.35]);
    expect(glass.color_offsets).toEqual([10, 90]);
    expect(chimney.colors.map((entry) => entry.rgba)).toEqual(
      document.texture.items[3].colors.map((entry) => entry.rgba),
    );
  });

  it('applies model-inferred source-relative offsets without changing group geometry', () => {
    const document = makeHouseDocument();
    document.texture.layers[0].name = 'вариант_01';
    let nextId = 1000;

    const result = applyAiPlan({
      ...document,
      nextLayerId: () => nextId++,
      plan: {
        operations: [
          {
            type: 'duplicate_folder',
            sourcePath: 'вариант_01',
            newPath: 'вариант_02',
            offset: { x: 0, y: 128 },
          },
          {
            type: 'duplicate_folder',
            sourcePath: 'вариант_01',
            newPath: 'вариант_03',
            offset: { x: 0, y: 256 },
          },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    const getFolderPositions = (folderName) => {
      const folder = document.texture.layers.find((node) => node.name === folderName);
      const itemIds = [folder.childs[0].id, folder.childs[1].id];
      return itemIds.map((id) => {
        const item = document.texture.items.find((candidate) => candidate.id === id);
        return { x: item.x, y: item.y };
      });
    };

    expect(getFolderPositions('вариант_01')).toEqual([
      { x: 0, y: 0 },
      { x: 32, y: 0 },
    ]);
    expect(getFolderPositions('вариант_02')).toEqual([
      { x: 0, y: 128 },
      { x: 32, y: 128 },
    ]);
    expect(getFolderPositions('вариант_03')).toEqual([
      { x: 0, y: 256 },
      { x: 32, y: 256 },
    ]);
  });

  it('edits exact roles inside existing folders without touching siblings', () => {
    const document = makeHouseDocument();
    const result = applyAiPlan({
      ...document,
      nextLayerId: () => 999,
      plan: {
        operations: [
          {
            type: 'edit_folder_items',
            folderPath: 'House 1',
            itemEdits: [
              {
                relativePath: 'Roof',
                colors: ['#8899aa', '#ccddee'],
                material: { metallic: 80, roughness: 20, clearcoat: 35 },
              },
              { relativePath: 'Details/Glass', opacity: 22 },
            ],
          },
        ],
      },
    });

    expect(result.warnings).toEqual([]);
    expect(document.texture.items.find((item) => item.id === 102)).toMatchObject({
      metallic: 80,
      roughness: 20,
      clearcoat: 35,
    });
    expect(
      document.texture.items.find((item) => item.id === 103).colors.map((entry) => entry.rgba.a),
    ).toEqual([0.22, 0.22]);
    expect(document.texture.items.find((item) => item.id === 101).colors[0].rgba).toMatchObject({
      r: 45,
      g: 105,
      b: 180,
    });
  });
});
