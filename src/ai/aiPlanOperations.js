import {
  clamp,
  collectItemFolderPaths,
  colorEntryFromHex,
  computeItemBounds,
  ensureFolderPath,
  findFolderNodeByPath,
  findLayerNodeById,
  itemHexColors,
  normalizeGeneratedItemName,
  normalizePathLike,
  normalizeSearchText,
  snap,
  toNumber,
  tokenList,
} from './aiPlanShared';

export function resolveTargetItems(texture, selectionIds, target, layers) {
  const items = Array.isArray(texture?.items) ? texture.items : [];
  const itemFolderMap = new Map();
  collectItemFolderPaths(layers, '', itemFolderMap);

  if (!target || typeof target !== 'object') {
    const idSet = new Set(Array.isArray(selectionIds) ? selectionIds : []);
    if (idSet.size) {
      return items.filter((it) => idSet.has(it.id));
    }
    return [];
  }

  let filtered = items.slice();

  const targetFolderPathRaw =
    typeof target.folderPath === 'string'
      ? target.folderPath
      : typeof target.path === 'string'
        ? target.path
        : '';
  const targetFolderPath = normalizePathLike(targetFolderPathRaw);
  if (targetFolderPath) {
    filtered = filtered.filter((it) => {
      const itemPath = normalizePathLike(itemFolderMap.get(it.id) || '');
      return itemPath === targetFolderPath || itemPath.startsWith(`${targetFolderPath}/`);
    });
  }

  if (Array.isArray(target.excludeIds) && target.excludeIds.length) {
    const excludeIds = new Set(target.excludeIds);
    filtered = filtered.filter((it) => !excludeIds.has(it.id));
  }

  if (Array.isArray(target.excludeNameIncludes) && target.excludeNameIncludes.length) {
    const excludeTokens = target.excludeNameIncludes
      .map((v) =>
        String(v || '')
          .trim()
          .toLowerCase(),
      )
      .filter(Boolean);
    if (excludeTokens.length) {
      filtered = filtered.filter((it) => {
        const name = String(it.name || '').toLowerCase();
        return !excludeTokens.some((token) => name.includes(token));
      });
    }
  }

  if (Array.isArray(target.nameIncludes) && target.nameIncludes.length) {
    const includeTokens = target.nameIncludes.map((v) => normalizeSearchText(v)).filter(Boolean);
    if (includeTokens.length) {
      filtered = filtered.filter((it) => {
        const name = normalizeSearchText(it.name);
        return includeTokens.some((token) => name.includes(token));
      });
    }
  }

  if (Array.isArray(target.folderPathIncludes) && target.folderPathIncludes.length) {
    const includeTokens = target.folderPathIncludes
      .map((v) => normalizeSearchText(v))
      .filter(Boolean);
    if (includeTokens.length) {
      filtered = filtered.filter((it) => {
        const itemPath = normalizeSearchText(itemFolderMap.get(it.id) || '');
        return includeTokens.some((token) => itemPath.includes(token));
      });
    }
  }

  if (typeof target.query === 'string' && target.query.trim()) {
    const queryTokens = tokenList(target.query);
    if (queryTokens.length) {
      const scored = filtered
        .map((it) => {
          const searchable = normalizeSearchText(
            [it.name, itemFolderMap.get(it.id) || '', it.type, itemHexColors(it).join(' ')].join(
              ' ',
            ),
          );
          const score = queryTokens.reduce(
            (sum, token) => (searchable.includes(token) ? sum + 1 : sum),
            0,
          );
          return { item: it, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      if (scored.length) {
        filtered = scored.map((entry) => entry.item);
      }
    }
  }

  if (target.selected === true) {
    const idSet = new Set(Array.isArray(selectionIds) ? selectionIds : []);
    if (!idSet.size) return filtered;
    filtered = filtered.filter((it) => idSet.has(it.id));
    return filtered;
  }
  if (Array.isArray(target.ids) && target.ids.length) {
    const set = new Set(target.ids);
    filtered = filtered.filter((it) => set.has(it.id));
    return filtered;
  }
  if (target.id !== undefined && target.id !== null) {
    const found = filtered.find((it) => it.id === target.id);
    return found ? [found] : [];
  }
  if (typeof target.name === 'string' && target.name.trim()) {
    const normalized = target.name.trim().toLowerCase();
    const exact = filtered.filter(
      (it) =>
        String(it.name || '')
          .trim()
          .toLowerCase() === normalized,
    );
    if (exact.length) return exact;
    return filtered.filter((it) =>
      String(it.name || '')
        .toLowerCase()
        .includes(normalized),
    );
  }
  return filtered;
}

export function applyColorsToItem(item, hexColors) {
  if (!item || !Array.isArray(hexColors) || !hexColors.length) return false;
  const nextColors = hexColors.map(colorEntryFromHex).filter(Boolean);
  if (!nextColors.length) return false;
  item.colors = nextColors;
  if (item.type === 'g') {
    if (nextColors.length === 1) {
      item.color_offsets = [0];
    } else {
      const step = 100 / (nextColors.length - 1);
      item.color_offsets = nextColors.map((_, idx) => Math.round(idx * step));
      item.color_offsets[0] = 0;
      item.color_offsets[item.color_offsets.length - 1] = 100;
    }
  }
  return true;
}

export function applyItemOpacity(item, op) {
  if (!item || !Array.isArray(item.colors) || !item.colors.length) return false;

  let values;
  if (Array.isArray(op?.opacities)) {
    if (op.opacities.length !== item.colors.length) return false;
    values = op.opacities;
  } else if (op?.opacity !== undefined) {
    values = item.colors.map(() => op.opacity);
  } else {
    return false;
  }

  let changed = false;
  item.colors.forEach((color, index) => {
    const alpha = clamp(toNumber(values[index], 100), 0, 100) / 100;
    if (color?.rgba && color.rgba.a !== alpha) {
      color.rgba.a = alpha;
      changed = true;
    }
    if (color?.hsva && color.hsva.a !== alpha) {
      color.hsva.a = alpha;
      changed = true;
    }
  });
  return changed;
}

export function applyItemUpdates({ item, op, texture }) {
  if (!item || !op || typeof op !== 'object') return false;
  const maxItemSize = Math.max(1, toNumber(texture?.max_item_size, 200));
  let changed = false;

  const requestedType =
    op.itemType === 'sg' || op.typeValue === 'sg'
      ? 'sg'
      : op.itemType === 'g' || op.typeValue === 'g'
        ? 'g'
        : null;
  if (requestedType && item.type !== requestedType) {
    item.type = requestedType;
    changed = true;
  }

  if (item.type === 'g') {
    if (op.shape === 'l' || op.shape === 'r' || op.shape === 'c') {
      item.shape = op.shape;
      changed = true;
    } else if (!item.shape) {
      item.shape = 'l';
      changed = true;
    }
    const nextW = op.sizeW !== undefined ? op.sizeW : Array.isArray(op.size) ? op.size[0] : op.size;
    const nextH = op.sizeH !== undefined ? op.sizeH : Array.isArray(op.size) ? op.size[1] : op.size;
    if (nextW !== undefined || nextH !== undefined || !Array.isArray(item.size)) {
      const currentW = Array.isArray(item.size) ? item.size[0] : item.size;
      const currentH = Array.isArray(item.size) ? item.size[1] : item.size;
      item.size = [
        clamp(Math.max(1, toNumber(nextW, currentW || 1)), 1, maxItemSize),
        clamp(Math.max(1, toNumber(nextH, currentH || currentW || 1)), 1, maxItemSize),
      ];
      changed = true;
    }
    if (item.color_mode === 'black_to_white') {
      item.color_mode = 'rgb';
      changed = true;
    }
  }

  if (item.type === 'sg') {
    if (Array.isArray(item.size)) {
      item.size = Math.max(1, toNumber(item.size[0], 1));
      changed = true;
    }
    if (op.size !== undefined || op.sizeW !== undefined) {
      item.size = clamp(Math.max(1, toNumber(op.size ?? op.sizeW, item.size || 1)), 1, maxItemSize);
      changed = true;
    }
    if (op.steps !== undefined) {
      item.steps = clamp(Math.max(1, toNumber(op.steps, item.steps || 1)), 1, maxItemSize);
      changed = true;
    }
  } else if (op.steps !== undefined) {
    item.steps = clamp(Math.max(1, toNumber(op.steps, item.steps || 1)), 1, maxItemSize);
    changed = true;
  }

  if (op.direction === 'horizontal' || op.direction === 'vertical') {
    item.direction = op.direction;
    changed = true;
  }

  const nextColorMode = op.colorMode || op.color_mode;
  if (nextColorMode === 'rgb' || nextColorMode === 'hsl' || nextColorMode === 'black_to_white') {
    item.color_mode =
      item.type === 'g' && nextColorMode === 'black_to_white' ? 'rgb' : nextColorMode;
    changed = true;
  }

  if (
    Array.isArray(op.colorOffsets) &&
    Array.isArray(item.colors) &&
    op.colorOffsets.length === item.colors.length
  ) {
    item.color_offsets = op.colorOffsets.map((value) => clamp(toNumber(value, 0), 0, 100));
    changed = true;
  }

  const material = op.material && typeof op.material === 'object' ? op.material : {};
  if (material.albedo !== undefined) {
    item.albedo = toNumber(material.albedo, item.albedo) ? 1 : 0;
    changed = true;
  }
  if (material.roughness !== undefined) {
    item.roughness = clamp(toNumber(material.roughness, item.roughness), 0, 100);
    changed = true;
  }
  if (material.metallic !== undefined) {
    item.metallic = clamp(toNumber(material.metallic, item.metallic), 0, 100);
    changed = true;
  }
  if (material.emission !== undefined) {
    item.emission = toNumber(material.emission, item.emission) ? 1 : 0;
    changed = true;
  }
  if (material.emissionStrength !== undefined || material.emission_strength !== undefined) {
    item.emission_strength = clamp(
      toNumber(material.emissionStrength ?? material.emission_strength, item.emission_strength),
      0,
      100,
    );
    changed = true;
  }
  if (material.clearcoat !== undefined) {
    item.clearcoat = clamp(toNumber(material.clearcoat, item.clearcoat), 0, 100);
    changed = true;
  }
  if (material.clearcoatRoughness !== undefined || material.clearcoat_roughness !== undefined) {
    item.clearcoat_roughness = clamp(
      toNumber(
        material.clearcoatRoughness ?? material.clearcoat_roughness,
        item.clearcoat_roughness,
      ),
      0,
      100,
    );
    changed = true;
  }

  changed = applyItemOpacity(item, op) || changed;

  return changed;
}

export function createDefaultItemTemplate({
  texture,
  nextLayerId,
  op,
  forceGradientType,
  lastItem = null,
}) {
  const step = toNumber(texture.step, 1) || 1;
  const width = Math.max(1, toNumber(texture.width, 2048));
  const height = Math.max(1, toNumber(texture.height, 2048));
  const maxItemSize = Math.max(1, toNumber(texture.max_item_size, 200));
  const inheritedItemType = lastItem?.type === 'sg' ? 'sg' : 'g';
  let itemType = op.itemType === 'sg' ? 'sg' : op.itemType === 'g' ? 'g' : inheritedItemType;
  if (forceGradientType === 'g' || forceGradientType === 'sg') {
    itemType = forceGradientType;
  }
  const fallbackDirection =
    lastItem?.direction === 'horizontal' || lastItem?.direction === 'vertical'
      ? lastItem.direction
      : 'vertical';
  const direction =
    op.direction === 'horizontal' || op.direction === 'vertical' ? op.direction : fallbackDirection;
  const colorMode =
    itemType === 'sg'
      ? op.colorMode === 'black_to_white'
        ? 'black_to_white'
        : op.colorMode === 'hsl'
          ? 'hsl'
          : 'rgb'
      : op.colorMode === 'hsl'
        ? 'hsl'
        : 'rgb';

  const colors = Array.isArray(op.colors) && op.colors.length ? op.colors : ['#000000', '#ffffff'];

  const material = op.material && typeof op.material === 'object' ? op.material : {};

  const item = {
    id: nextLayerId(),
    name: normalizeGeneratedItemName(
      typeof op.name === 'string' && op.name.trim() ? op.name.trim() : 'Item',
      op.folderPath,
    ),
    type: itemType,
    color_mode: colorMode,
    direction,
    shape:
      op.shape === 'r' || op.shape === 'c' || op.shape === 'l'
        ? op.shape
        : lastItem?.shape === 'r' || lastItem?.shape === 'c' || lastItem?.shape === 'l'
          ? lastItem.shape
          : 'l',
    colors: [],
    color_offsets: [0, 100],
    x: 0,
    y: 0,
    size:
      itemType === 'g'
        ? [
            clamp(
              Math.max(
                1,
                toNumber(
                  op.sizeW,
                  toNumber(op.size, Array.isArray(lastItem?.size) ? lastItem.size[0] : step),
                ),
              ),
              1,
              maxItemSize,
            ),
            clamp(
              Math.max(
                1,
                toNumber(
                  op.sizeH,
                  toNumber(op.size, Array.isArray(lastItem?.size) ? lastItem.size[1] : step),
                ),
              ),
              1,
              maxItemSize,
            ),
          ]
        : clamp(
            Math.max(
              1,
              toNumber(
                op.size,
                Array.isArray(lastItem?.size) ? lastItem.size[0] : lastItem?.size || step,
              ),
            ),
            1,
            maxItemSize,
          ),
    steps: clamp(Math.max(1, toNumber(op.steps, lastItem?.steps || 4)), 1, maxItemSize),
    albedo: toNumber(material.albedo, 1),
    roughness: clamp(toNumber(material.roughness, 50), 0, 100),
    metallic: clamp(toNumber(material.metallic, 0), 0, 100),
    emission: toNumber(material.emission, 0) ? 1 : 0,
    emission_strength: clamp(toNumber(material.emissionStrength, 100), 0, 100),
    clearcoat: clamp(toNumber(material.clearcoat, 0), 0, 100),
    clearcoat_roughness: clamp(toNumber(material.clearcoatRoughness, 0), 0, 100),
    visible: true,
    selected: false,
  };

  applyColorsToItem(item, colors);
  applyItemOpacity(item, op);

  const bounds = computeItemBounds(item) || { w: 1, h: 1 };
  const maxX = Math.max(0, width - bounds.w);
  const maxY = Math.max(0, height - bounds.h);

  item.x = clamp(snap(toNumber(op.x, 0), step), 0, maxX);
  item.y = clamp(snap(toNumber(op.y, 0), step), 0, maxY);

  if (Array.isArray(op.colorOffsets) && op.colorOffsets.length === item.colors.length) {
    item.color_offsets = op.colorOffsets.map((value) => clamp(toNumber(value, 0), 0, 100));
  }

  return item;
}

export function mergeOperationDefaults(defaults, itemConfig) {
  const base = defaults && typeof defaults === 'object' ? defaults : {};
  const item = itemConfig && typeof itemConfig === 'object' ? itemConfig : {};
  return {
    ...base,
    ...item,
    material: {
      ...(base.material && typeof base.material === 'object' ? base.material : {}),
      ...(item.material && typeof item.material === 'object' ? item.material : {}),
    },
  };
}

export function applyItemRename({ item, name, folderPath, layers }) {
  const nextName = typeof name === 'string' ? name.trim() : '';
  if (!nextName) return false;
  item.name = normalizeGeneratedItemName(nextName, folderPath);
  const nodeRef = findLayerNodeById(layers, item.id);
  if (nodeRef?.node && nodeRef.node.type === 'item') {
    nodeRef.node.name = item.name;
  }
  return true;
}

export function applyItemPosition({ item, op, texture }) {
  const step = toNumber(texture.step, 1) || 1;
  const width = Math.max(1, toNumber(texture.width, 2048));
  const height = Math.max(1, toNumber(texture.height, 2048));
  const offsetCellsX = toNumber(op?.offsetCells?.x, 0);
  const offsetCellsY = toNumber(op?.offsetCells?.y, 0);
  const hasPosition =
    op.x !== undefined ||
    op.y !== undefined ||
    op?.offset?.x !== undefined ||
    op?.offset?.y !== undefined ||
    op?.offsetCells?.x !== undefined ||
    op?.offsetCells?.y !== undefined;
  if (!hasPosition) return false;

  const bounds = computeItemBounds(item) || { w: 1, h: 1 };
  const maxX = Math.max(0, width - bounds.w);
  const maxY = Math.max(0, height - bounds.h);
  const x =
    op.x !== undefined
      ? toNumber(op.x, item.x)
      : toNumber(item.x, 0) + toNumber(op?.offset?.x, 0) + offsetCellsX * step;
  const y =
    op.y !== undefined
      ? toNumber(op.y, item.y)
      : toNumber(item.y, 0) + toNumber(op?.offset?.y, 0) + offsetCellsY * step;
  item.x = clamp(snap(x, step), 0, maxX);
  item.y = clamp(snap(y, step), 0, maxY);
  return true;
}

export function targetForItemEdit(baseTarget, itemEdit) {
  const target = baseTarget && typeof baseTarget === 'object' ? { ...baseTarget } : {};
  if (itemEdit?.target && typeof itemEdit.target === 'object') {
    return { ...target, ...itemEdit.target };
  }
  if (itemEdit?.id !== undefined && itemEdit.id !== null) {
    target.ids = [itemEdit.id];
  }
  return Object.keys(target).length ? target : null;
}

export function applyEditToItems({
  op,
  texture,
  layers,
  selectionIds,
  nextLayerId,
  warnings,
  index,
}) {
  const shared = op.set && typeof op.set === 'object' ? op.set : {};
  const itemEdits = Array.isArray(op.items) ? op.items : [];
  const entries = itemEdits.length ? itemEdits : [null];
  let changedCount = 0;

  entries.forEach((itemEdit, itemEditIndex) => {
    const edit =
      itemEdit && typeof itemEdit === 'object' ? { ...shared, ...itemEdit } : { ...shared };
    const target = targetForItemEdit(op.target, itemEdit);
    if (!target) {
      warnings.push(`op#${index + 1}.${itemEditIndex + 1}: edit_items target not found`);
      return;
    }
    if (!target.folderPath && typeof op.folderPath === 'string') {
      target.folderPath = op.folderPath;
    }
    const targetItems = resolveTargetItems(texture, selectionIds, target, layers);
    if (!targetItems.length) {
      warnings.push(`op#${index + 1}.${itemEditIndex + 1}: edit_items target not found`);
      return;
    }

    targetItems.forEach((item, targetIndex) => {
      let itemChanged = false;
      if (typeof edit.newName === 'string' || typeof edit.name === 'string') {
        const baseName = typeof edit.newName === 'string' ? edit.newName : edit.name;
        const nextName =
          targetItems.length > 1 && !itemEdits.length
            ? `${baseName.trim()} ${targetIndex + 1}`
            : baseName;
        itemChanged =
          applyItemRename({
            item,
            name: nextName,
            folderPath: edit.folderPath || target.folderPath,
            layers,
          }) || itemChanged;
      }

      itemChanged = applyItemPosition({ item, op: edit, texture }) || itemChanged;

      if (Array.isArray(edit.colors) && edit.colors.length) {
        itemChanged = applyColorsToItem(item, edit.colors) || itemChanged;
      }

      itemChanged = applyItemUpdates({ item, op: edit, texture }) || itemChanged;

      if (typeof edit.folderPath === 'string') {
        itemChanged =
          moveLayerItemNodeToFolder({
            layers,
            itemId: item.id,
            folderPath: edit.folderPath,
            nextLayerId,
          }) || itemChanged;
      }

      if (itemChanged) changedCount += 1;
    });
  });

  if (!changedCount) {
    warnings.push(`op#${index + 1}: edit_items had no valid changes`);
  }
}

export function attachLayerItemNode({ layers, folderPath, item }) {
  const node = {
    id: item.id,
    name: item.name,
    type: 'item',
    visible: true,
    collapsed: false,
    childs: [],
  };
  const folder = findFolderNodeByPath(layers, folderPath);
  if (folder && Array.isArray(folder.childs)) {
    folder.childs.unshift(node);
  } else {
    layers.unshift(node);
  }
}

export function moveLayerItemNodeToFolder({ layers, itemId, folderPath, nextLayerId }) {
  const nodeRef = findLayerNodeById(layers, itemId);
  if (!nodeRef?.node || nodeRef.node.type !== 'item') return false;

  const [node] = nodeRef.parentArray.splice(nodeRef.index, 1);
  const targetPath = typeof folderPath === 'string' ? folderPath.trim() : '';
  if (!targetPath) {
    layers.unshift(node);
    return true;
  }

  const folder = ensureFolderPath({
    layers,
    path: targetPath,
    nextLayerId,
  });
  if (!folder || !Array.isArray(folder.childs)) {
    layers.unshift(node);
    return false;
  }
  folder.childs.unshift(node);
  return true;
}

export function collectFolderPaths(nodes, currentPath, acc) {
  if (!Array.isArray(nodes)) return;
  nodes.forEach((node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'folder') {
      const folderName = String(node.name || '').trim();
      const nextPath = folderName
        ? currentPath
          ? `${currentPath}/${folderName}`
          : folderName
        : currentPath;
      if (nextPath) acc.push(nextPath);
      collectFolderPaths(node.childs, nextPath, acc);
      return;
    }
    if (Array.isArray(node.childs) && node.childs.length) {
      collectFolderPaths(node.childs, currentPath, acc);
    }
  });
}

export function collectRelativeSubfolderPaths(folderNode, currentRelPath, acc) {
  if (!folderNode || !Array.isArray(folderNode.childs)) return;
  folderNode.childs.forEach((child) => {
    if (!child || child.type !== 'folder') return;
    const name = String(child.name || '').trim();
    if (!name) return;
    const rel = currentRelPath ? `${currentRelPath}/${name}` : name;
    acc.push(rel);
    collectRelativeSubfolderPaths(child, rel, acc);
  });
}
