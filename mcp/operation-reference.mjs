const TARGET = {
  id: 'one exact item id',
  ids: ['exact item ids'],
  name: 'exact item name when an id is unavailable',
  selected: 'true to target the current selection',
  folderPath: 'exact folder subtree',
  folderPathIncludes: ['folder path fragments to include'],
  query: 'words matched against item name and path',
  all: 'true only when every item is intentionally targeted',
  excludeIds: ['ids to exclude'],
  nameIncludes: ['required name fragments'],
  excludeNameIncludes: ['name fragments to exclude'],
};

const MATERIAL = {
  albedo: '0 or 1',
  roughness: '0..100',
  metallic: '0..100',
  emission: '0 or 1',
  emissionStrength: '0..100',
  clearcoat: '0..100',
  clearcoatRoughness: '0..100',
};

const COLORS = ['#RRGGBB or #RRGGBBAA; the optional AA suffix controls opacity'];

const GRADIENT_ITEM_FIELDS = {
  name: 'Item name',
  folderPath: 'Optional/Folder',
  itemType: 'g (smooth) or sg (stepped)',
  x: 0,
  y: 0,
  size: 'cell size for sg, or [width,height] for g',
  sizeW: 'optional smooth-gradient width',
  sizeH: 'optional smooth-gradient height',
  steps: 'number of stepped cells',
  direction: 'horizontal or vertical',
  shape: 'l (linear), r (radial), or c (conic)',
  colorMode: 'rgb, hsl, or black_to_white (sg only)',
  colors: COLORS,
  colorOffsets: [0, 100],
  opacity: 'optional 0..100 applied to every color stop',
  opacities: ['optional 0..100 value per color stop'],
  material: MATERIAL,
};

const GRADIENT_ITEM_NOTES = [
  'g is smooth and supports l/r/c shapes; sg is stepped and uses scalar cell size plus steps',
  'black_to_white is valid only for sg',
  'omit unspecified fields to inherit editor defaults',
  'all color examples are placeholders; supply real six- or eight-digit hex colors from the request, document, or image',
];

export const OPERATION_REFERENCE = Object.freeze({
  create_folder: { type: 'create_folder', path: 'Folder/Subfolder' },
  duplicate_folder: {
    type: 'duplicate_folder',
    sourcePath: 'Folder',
    newPath: 'Exact destination folder path following the local naming convention',
    offset: { x: 0, y: 64 },
    itemEdits: [
      {
        relativePath: 'exact item path relative to source folder, including item name',
        colors: COLORS,
        opacity: 'optional 0..100',
        opacities: ['optional 0..100 value per color stop'],
        colorOffsets: [0, 100],
        material: MATERIAL,
      },
    ],
    notes: [
      'Duplicates the complete source hierarchy and preserves every item name, type, gradient, transform, and material unless itemEdits overrides it',
      'Use itemEdits to make a self-contained variant without knowing the generated item ids',
      'relativePath is relative to sourcePath; nested relative paths use slash separators',
      'offset is relative to sourcePath for every operation; continue an observed series with successive multiples of its displacement',
    ],
  },
  edit_folder_items: {
    type: 'edit_folder_items',
    folderPath: 'Exact folder path',
    itemEdits: [
      {
        relativePath: 'exact item path relative to folderPath',
        newName: 'optional replacement item name',
        itemType: 'optional g or sg',
        shape: 'optional l, r, or c',
        direction: 'optional horizontal or vertical',
        colorMode: 'optional rgb, hsl, or black_to_white',
        colors: COLORS,
        colorOffsets: [0, 100],
        opacity: 'optional 0..100',
        opacities: ['optional 0..100 value per color stop'],
        size: 'optional number or [width,height]',
        steps: 'optional positive number',
        material: MATERIAL,
        visible: 'optional boolean',
      },
    ],
    notes: [
      'Every relativePath must identify one existing item exactly',
      'Use for role-aware edits across repeated folder structures without relying on ids',
    ],
  },
  rename_folder: { type: 'rename_folder', path: 'Folder/Subfolder', newName: 'New name' },
  delete_folder: { type: 'delete_folder', path: 'Folder/Subfolder' },
  create_gradient_item: {
    type: 'create_gradient_item',
    ...GRADIENT_ITEM_FIELDS,
    notes: GRADIENT_ITEM_NOTES,
  },
  create_gradient_items: {
    type: 'create_gradient_items',
    defaults: 'optional object containing shared itemSchema fields',
    itemSchema: GRADIENT_ITEM_FIELDS,
    items: ['itemSchema objects; each item overrides defaults'],
    notes: [
      'Use one create_gradient_items operation for a visible palette grid or other related batch',
      ...GRADIENT_ITEM_NOTES,
    ],
  },
  duplicate_item: {
    type: 'duplicate_item',
    target: TARGET,
    newName: 'required when duplicating inside the same folder',
    folderPath: 'optional destination folder',
    offset: { x: 0, y: 64 },
    colors: ['optional replacement #RRGGBB or #RRGGBBAA colors'],
    opacity: 'optional 0..100 applied to every color stop',
    opacities: ['optional 0..100 value per color stop'],
  },
  edit_items: {
    type: 'edit_items',
    target: TARGET,
    set: 'same editable fields as update_item',
    items: ['optional per-item edits containing id or target; each entry overrides set'],
    offsetCells: { x: 'relative grid cells', y: 'relative grid cells' },
  },
  recolor_item: {
    type: 'recolor_item',
    target: TARGET,
    colors: COLORS,
    opacity: 'optional 0..100 applied to every color stop',
    opacities: ['optional 0..100 value per color stop'],
  },
  update_item: {
    type: 'update_item',
    target: TARGET,
    itemType: 'optional g or sg',
    shape: 'optional l, r, or c',
    direction: 'optional horizontal or vertical',
    colorMode: 'optional rgb, hsl, or black_to_white',
    size: 'optional number or [width,height]',
    steps: 'optional positive number',
    colorOffsets: ['optional 0..100 offsets'],
    opacity: 'optional 0..100 applied to every existing color stop',
    opacities: ['optional 0..100 value per existing color stop; count must match'],
    material: MATERIAL,
  },
  move_item: {
    type: 'move_item',
    target: TARGET,
    x: 'absolute x, optional',
    y: 'absolute y, optional',
    offset: { x: 'relative x', y: 'relative y' },
    offsetCells: { x: 'relative grid cells', y: 'relative grid cells' },
  },
  rename_item: { type: 'rename_item', target: TARGET, newName: 'New name' },
  delete_item: { type: 'delete_item', target: TARGET },
  set_visibility: {
    type: 'set_visibility',
    target: TARGET,
    folderPath: 'use instead of target for a folder subtree',
    visible: true,
  },
  set_folder_state: {
    type: 'set_folder_state',
    folderPath: 'Folder path',
    collapsed: 'optional boolean',
    visible: 'optional boolean',
  },
  set_selection: {
    type: 'set_selection',
    target: TARGET,
    mode: 'replace, add, remove, or clear',
  },
  move_layer: {
    type: 'move_layer',
    id: 'item or folder id',
    folderPath: 'destination folder, empty for root',
    index: 'zero-based destination index',
  },
  update_texture: {
    type: 'update_texture',
    set: {
      width: '1..16384',
      height: '1..16384',
      step: '1..16384',
      maxItemSize: '1..16384',
      undoCount: '1..1000',
      zoom: '-99..1000',
      zoomSpeed: '1..500',
      updateInterval: '16..60000 milliseconds',
      centerLocked: 'boolean',
      lockedLeft: 'boolean',
      lockedRight: 'boolean',
      defaultColorModel: 'hsva, hsla, rgba, or hex',
      exportMaps: 'albedo/roughness/metallic/emission/clearcoat/clearcoatRoughness/mrc values',
      generation: 'mode, adjacency, and temperature',
    },
    notes: [
      'export map values: 0 disabled, 1 PNG, 2 WEBP',
      'generation temperature range: 0..2.4',
      'include only settings that must change',
    ],
  },
});

export function getOperationReference(names) {
  const requested = Array.isArray(names) ? names : [];
  return Object.fromEntries(
    requested
      .filter((name) => Object.hasOwn(OPERATION_REFERENCE, name))
      .map((name) => [name, OPERATION_REFERENCE[name]]),
  );
}
