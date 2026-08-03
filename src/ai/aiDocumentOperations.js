import { resolveTargetItems } from './aiPlanOperations';
import {
  clamp,
  computeItemBounds,
  ensureFolderPath,
  findFolderNodeByPath,
  findLayerNodeById,
  toNumber,
} from './aiPlanShared';

function setStoreSelection(store, ids) {
  if (!store) return;
  if (typeof store.setSelected === 'function') {
    store.setSelected(ids, ids.length ? 'item' : null);
    return;
  }
  store.selected = ids;
  store.active_id = ids.length ? ids[ids.length - 1] : null;
  store.active_type = ids.length ? 'item' : null;
}

function hasItemSelector(target) {
  return (
    target?.all === true ||
    target?.selected === true ||
    target?.id !== undefined ||
    (Array.isArray(target?.ids) && target.ids.length > 0) ||
    (typeof target?.name === 'string' && target.name.trim()) ||
    (typeof target?.query === 'string' && target.query.trim()) ||
    (typeof target?.folderPath === 'string' && target.folderPath.trim())
  );
}

export function applySelectionOperation({ op, texture, layers, layersStore, selectionIds }) {
  const mode = ['add', 'remove', 'clear'].includes(op.mode) ? op.mode : 'replace';
  if (mode === 'clear') {
    setStoreSelection(layersStore, []);
    return true;
  }

  const target = op.target && typeof op.target === 'object' ? op.target : {};
  if (!hasItemSelector(target)) return false;
  const matchedIds = resolveTargetItems(texture, selectionIds, target, layers).map(
    (item) => item.id,
  );
  if (!matchedIds.length) return false;

  const current = new Set(Array.isArray(layersStore?.selected) ? layersStore.selected : []);
  if (mode === 'replace') {
    setStoreSelection(layersStore, matchedIds);
  } else if (mode === 'add') {
    matchedIds.forEach((id) => current.add(id));
    setStoreSelection(layersStore, [...current]);
  } else {
    matchedIds.forEach((id) => current.delete(id));
    setStoreSelection(layersStore, [...current]);
  }
  return true;
}

function setNodeVisibility(node, visible, itemById) {
  if (!node || typeof node !== 'object') return;
  node.visible = visible;
  if (node.type === 'item') {
    const item = itemById.get(node.id);
    if (item) item.visible = visible;
  }
  if (Array.isArray(node.childs)) {
    node.childs.forEach((child) => setNodeVisibility(child, visible, itemById));
  }
}

export function applyVisibilityOperation({ op, texture, layers, selectionIds }) {
  const visible = op.visible !== false;
  const itemById = new Map(texture.items.map((item) => [item.id, item]));
  const folderPath =
    typeof op.folderPath === 'string'
      ? op.folderPath.trim()
      : typeof op.path === 'string'
        ? op.path.trim()
        : '';

  if (folderPath) {
    const folder = findFolderNodeByPath(layers, folderPath);
    if (!folder) return false;
    setNodeVisibility(folder, visible, itemById);
    return true;
  }

  const target = op.target && typeof op.target === 'object' ? op.target : {};
  if (!hasItemSelector(target)) return false;
  const items = resolveTargetItems(texture, selectionIds, target, layers);
  if (!items.length) return false;
  items.forEach((item) => {
    item.visible = visible;
    const nodeRef = findLayerNodeById(layers, item.id);
    if (nodeRef?.node) nodeRef.node.visible = visible;
  });
  return true;
}

export function applyFolderStateOperation({ op, texture, layers }) {
  const folderPath =
    typeof op.folderPath === 'string'
      ? op.folderPath.trim()
      : typeof op.path === 'string'
        ? op.path.trim()
        : '';
  const nodeRef = op.id !== undefined && op.id !== null ? findLayerNodeById(layers, op.id) : null;
  const folder =
    nodeRef?.node?.type === 'folder' ? nodeRef.node : findFolderNodeByPath(layers, folderPath);
  if (!folder) return false;

  let changed = false;
  if (op.collapsed !== undefined) {
    folder.collapsed = Boolean(op.collapsed);
    changed = true;
  }
  if (op.visible !== undefined) {
    const itemById = new Map(texture.items.map((item) => [item.id, item]));
    setNodeVisibility(folder, Boolean(op.visible), itemById);
    changed = true;
  }
  return changed;
}

function containsLayerId(node, targetId) {
  if (!node || typeof node !== 'object') return false;
  if (node.id === targetId) return true;
  return Array.isArray(node.childs)
    ? node.childs.some((child) => containsLayerId(child, targetId))
    : false;
}

export function applyMoveLayerOperation({ op, layers, nextLayerId }) {
  const layerId = op.id ?? op.layerId;
  if (layerId === null || layerId === undefined) return false;
  const sourceRef = findLayerNodeById(layers, layerId);
  if (!sourceRef?.node) return false;

  const targetFolderPath =
    typeof op.folderPath === 'string'
      ? op.folderPath.trim()
      : typeof op.targetFolderPath === 'string'
        ? op.targetFolderPath.trim()
        : '';
  let targetFolder = targetFolderPath ? findFolderNodeByPath(layers, targetFolderPath) : null;
  if (targetFolder && containsLayerId(sourceRef.node, targetFolder.id)) return false;

  const [node] = sourceRef.parentArray.splice(sourceRef.index, 1);
  if (targetFolderPath && !targetFolder) {
    targetFolder = ensureFolderPath({
      layers,
      path: targetFolderPath,
      nextLayerId,
    });
  }
  const targetArray =
    targetFolder && Array.isArray(targetFolder.childs) ? targetFolder.childs : layers;
  const requestedIndex = Math.trunc(toNumber(op.index, 0));
  targetArray.splice(clamp(requestedIndex, 0, targetArray.length), 0, node);
  return true;
}

function assignNumber(texture, source, publicName, persistedName, min, max) {
  if (source[publicName] === undefined && source[persistedName] === undefined) return false;
  texture[persistedName] = clamp(
    toNumber(source[publicName] ?? source[persistedName], texture[persistedName]),
    min,
    max,
  );
  return true;
}

function assignBoolean(texture, source, publicName, persistedName) {
  if (source[publicName] === undefined && source[persistedName] === undefined) return false;
  texture[persistedName] = Boolean(source[publicName] ?? source[persistedName]);
  return true;
}

function assignExportMap(texture, exportMaps, publicName, persistedName) {
  if (exportMaps[publicName] === undefined && exportMaps[persistedName] === undefined) return false;
  texture[persistedName] = clamp(
    Math.trunc(toNumber(exportMaps[publicName] ?? exportMaps[persistedName], 0)),
    0,
    2,
  );
  return true;
}

export function applyTextureOperation({ op, texture }) {
  const source = op.set && typeof op.set === 'object' ? op.set : op;
  let changed = false;
  changed = assignNumber(texture, source, 'width', 'width', 1, 16384) || changed;
  changed = assignNumber(texture, source, 'height', 'height', 1, 16384) || changed;
  changed = assignNumber(texture, source, 'step', 'step', 1, 16384) || changed;
  changed = assignNumber(texture, source, 'maxItemSize', 'max_item_size', 1, 16384) || changed;
  changed = assignNumber(texture, source, 'undoCount', 'undo_count', 1, 1000) || changed;
  changed = assignNumber(texture, source, 'zoom', 'zoom', -99, 1000) || changed;
  changed = assignNumber(texture, source, 'zoomSpeed', 'zoom_speed', 1, 500) || changed;
  changed =
    assignNumber(texture, source, 'updateInterval', 'update_interval', 16, 60000) || changed;
  changed = assignBoolean(texture, source, 'centerLocked', 'center_locked') || changed;
  changed = assignBoolean(texture, source, 'lockedLeft', 'locked_left') || changed;
  changed = assignBoolean(texture, source, 'lockedRight', 'locked_right') || changed;
  changed = assignBoolean(texture, source, 'mixPreview', 'mix_preview') || changed;

  const colorModel = source.defaultColorModel ?? source.default_color_model;
  if (['hsva', 'hsla', 'rgba', 'hex'].includes(colorModel)) {
    texture.default_color_model = colorModel;
    changed = true;
  }

  const exportMaps =
    source.exportMaps && typeof source.exportMaps === 'object' ? source.exportMaps : {};
  changed = assignExportMap(texture, exportMaps, 'albedo', 'save_albedo') || changed;
  changed = assignExportMap(texture, exportMaps, 'roughness', 'save_roughness') || changed;
  changed = assignExportMap(texture, exportMaps, 'metallic', 'save_metallic') || changed;
  changed = assignExportMap(texture, exportMaps, 'emission', 'save_emission') || changed;
  changed = assignExportMap(texture, exportMaps, 'clearcoat', 'save_clearcoat') || changed;
  changed =
    assignExportMap(texture, exportMaps, 'clearcoatRoughness', 'save_clearcoat_roughness') ||
    changed;
  changed = assignExportMap(texture, exportMaps, 'mrc', 'save_mrc') || changed;

  const generation =
    source.generation && typeof source.generation === 'object' ? source.generation : {};
  if (['transformer', 'diffusion', 'random'].includes(generation.mode)) {
    texture.generation = texture.generation || {};
    texture.generation.mode = generation.mode;
    changed = true;
  }
  if (
    [
      'balanced',
      'gradient',
      'brand',
      'noise',
      'website',
      'mondrian',
      'checkerboard',
      'clustered',
      'ring',
    ].includes(generation.adjacency)
  ) {
    texture.generation = texture.generation || {};
    texture.generation.adjacency = generation.adjacency;
    changed = true;
  }
  if (generation.temperature !== undefined) {
    texture.generation = texture.generation || {};
    texture.generation.temperature = clamp(
      toNumber(generation.temperature, texture.generation.temperature),
      0,
      2.4,
    );
    changed = true;
  }

  if (changed) {
    const width = Math.max(1, toNumber(texture.width, 1));
    const height = Math.max(1, toNumber(texture.height, 1));
    texture.items.forEach((item) => {
      const bounds = computeItemBounds(item) || { w: 1, h: 1 };
      item.x = clamp(toNumber(item.x, 0), 0, Math.max(0, width - bounds.w));
      item.y = clamp(toNumber(item.y, 0), 0, Math.max(0, height - bounds.h));
    });
  }

  return changed;
}
