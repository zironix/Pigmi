import LinearColorInterpolator from '../plugins/linearColorInterpolator.js';

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function snap(value, step) {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return Math.round(value);
  return Math.round(value / s) * s;
}

export function normalizeHexColor(input) {
  if (typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  if (!value.startsWith('#')) value = `#${value}`;
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const a = value[1];
    const b = value[2];
    const c = value[3];
    return `#${a}${a}${b}${b}${c}${c}`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (/^#[0-9a-fA-F]{8}$/.test(value)) return value.toLowerCase();
  return null;
}

export function colorEntryFromHex(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const withAlpha = normalized.length === 7 ? `${normalized}ff` : normalized;
  const rgba = LinearColorInterpolator.hexAToRGBA(withAlpha);
  const hsva = LinearColorInterpolator.hexAToHSVA(withAlpha);
  if (!rgba || !hsva || typeof rgba !== 'object' || typeof hsva !== 'object') return null;
  return {
    rgba: {
      r: toNumber(rgba.r, 0),
      g: toNumber(rgba.g, 0),
      b: toNumber(rgba.b, 0),
      a: toNumber(rgba.a, 1),
    },
    hsva: {
      h: toNumber(hsva.h, 0),
      s: toNumber(hsva.s, 0),
      v: toNumber(hsva.v, 0),
      a: toNumber(hsva.a, 1),
    },
    id: Date.now() + Math.random(),
  };
}

export function rgbaToHex(rgba) {
  if (!rgba || typeof rgba !== 'object') return null;
  const toHex2 = (n) =>
    clamp(Math.round(toNumber(n, 0)), 0, 255)
      .toString(16)
      .padStart(2, '0');
  const r = toHex2(rgba.r);
  const g = toHex2(rgba.g);
  const b = toHex2(rgba.b);
  return `#${r}${g}${b}`;
}

export function mixHex(baseHex, tintHex, tintWeight = 0.28) {
  const base = colorEntryFromHex(baseHex);
  const tint = colorEntryFromHex(tintHex);
  if (!base || !tint) return normalizeHexColor(baseHex);
  const w = clamp(toNumber(tintWeight, 0.28), 0, 1);
  const bw = 1 - w;
  const rgba = {
    r: base.rgba.r * bw + tint.rgba.r * w,
    g: base.rgba.g * bw + tint.rgba.g * w,
    b: base.rgba.b * bw + tint.rgba.b * w,
  };
  return rgbaToHex(rgba);
}

export function shiftHexValue(hex, delta) {
  const c = colorEntryFromHex(hex);
  if (!c) return normalizeHexColor(hex);
  const d = clamp(toNumber(delta, 0), -100, 100);
  const f = 1 + d / 100;
  const rgba = {
    r: clamp(c.rgba.r * f, 0, 255),
    g: clamp(c.rgba.g * f, 0, 255),
    b: clamp(c.rgba.b * f, 0, 255),
  };
  return rgbaToHex(rgba);
}

export function itemPrimaryHex(item) {
  if (!item || !Array.isArray(item.colors) || !item.colors.length) return null;
  const first = item.colors[0];
  if (!first || typeof first !== 'object') return null;
  return rgbaToHex(first.rgba);
}

export function itemHexColors(item) {
  if (!item || !Array.isArray(item.colors)) return [];
  return item.colors.map((color) => rgbaToHex(color?.rgba)).filter(Boolean);
}

export function itemColorStops(item) {
  if (!item || !Array.isArray(item.colors)) return [];
  return item.colors
    .map((color, index) => {
      const hex = rgbaToHex(color?.rgba);
      if (!hex) return null;
      return {
        hex,
        opacity: Math.round(clamp(toNumber(color?.rgba?.a, 1), 0, 1) * 10_000) / 100,
        offset: Array.isArray(item.color_offsets) ? item.color_offsets[index] : undefined,
      };
    })
    .filter(Boolean);
}

export function itemMaterial(item) {
  return {
    albedo: item?.albedo,
    roughness: item?.roughness,
    metallic: item?.metallic,
    emission: item?.emission,
    emission_strength: item?.emission_strength,
    clearcoat: item?.clearcoat,
    clearcoat_roughness: item?.clearcoat_roughness,
  };
}

export function gradientDescriptor(item) {
  const type = item?.type === 'sg' ? 'stepped' : 'smooth';
  const shape =
    item?.type === 'g'
      ? item.shape === 'r'
        ? 'radial'
        : item.shape === 'c'
          ? 'conic'
          : 'linear'
      : 'cells';
  return {
    type,
    itemType: item?.type,
    shape,
    shapeCode: item?.shape,
    direction: item?.direction,
    colorMode: item?.color_mode,
    stepCells: item?.type === 'sg' ? item?.steps : null,
    cellSize: item?.type === 'sg' ? item?.size : null,
    pixelSize: item?.type === 'g' ? item?.size : null,
  };
}

export function hsvToHex(h, s, v) {
  const hh = ((toNumber(h, 0) % 360) + 360) % 360;
  const ss = clamp(toNumber(s, 100), 0, 100) / 100;
  const vv = clamp(toNumber(v, 100), 0, 100) / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (hh < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (hh < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (hh < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (hh < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return rgbaToHex({
    r: (r + m) * 255,
    g: (g + m) * 255,
    b: (b + m) * 255,
  });
}

export function deriveFallbackRecolorColors(item, itemIndex, totalCount) {
  const targetCount = Math.max(1, Array.isArray(item?.colors) ? item.colors.length : 2);
  const seed = Math.max(0, itemIndex);
  const groupSize = Math.max(1, totalCount);
  const baseHue = (seed * 53 + groupSize * 7 + 17) % 360;
  const colors = [];
  for (let i = 0; i < targetCount; i += 1) {
    const hue = (baseHue + i * 19) % 360;
    const sat = 50 + ((seed * 11 + i * 7) % 38);
    const val = 46 + ((seed * 13 + i * 9) % 44);
    colors.push(hsvToHex(hue, sat, val));
  }
  return colors.filter(Boolean);
}

export function buildPerItemRecolorPalette(item, sourceHexColors, itemIndex, totalCount) {
  const baseColors = Array.isArray(sourceHexColors)
    ? sourceHexColors.map(normalizeHexColor).filter(Boolean)
    : [];
  if (!baseColors.length) return [];

  const primary = itemPrimaryHex(item);
  const spread = Math.max(0, Math.min(20, Math.round((itemIndex - (totalCount - 1) / 2) * 4)));
  let mapped = baseColors;
  if (primary) {
    mapped = baseColors.map((hex) => mixHex(hex, primary, 0.3));
  }
  mapped = mapped.map((hex) => shiftHexValue(hex, spread));

  const targetCount = Math.max(1, Array.isArray(item?.colors) ? item.colors.length : 1);
  if (mapped.length === 1 && targetCount > 1) {
    const single = mapped[0];
    const generated = [];
    for (let i = 0; i < targetCount; i += 1) {
      const offset = targetCount === 1 ? 0 : (i / (targetCount - 1)) * 24 - 12;
      generated.push(shiftHexValue(single, offset));
    }
    return generated.filter(Boolean);
  }
  return mapped.filter(Boolean);
}

export function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function normalizeGeneratedItemName(name, folderPath) {
  let next = String(name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!next) return 'Item';

  const folderLeaf =
    String(folderPath || '')
      .split('/')
      .map((x) => x.trim())
      .filter(Boolean)
      .pop() || '';

  if (folderLeaf) {
    const esc = escapeRegExp(folderLeaf);
    const endRe = new RegExp(`(?:\\s|_|-)*${esc}$`, 'i');
    const startRe = new RegExp(`^${esc}(?:\\s|_|-)*`, 'i');
    next = next.replace(endRe, '').replace(startRe, '').trim();
  }

  if (!next) next = 'Item';
  return next
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      if (!part) return part;
      return part[0].toUpperCase() + part.slice(1);
    })
    .join(' ');
}

export function normalizePathLike(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
    .join('/')
    .toLowerCase();
}

export function normalizeSearchText(value) {
  return String(value || '')
    .replace(/[_/\\.-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function tokenList(value) {
  return normalizeSearchText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

export function collectItemFolderPaths(nodes, currentPath, map) {
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
      collectItemFolderPaths(node.childs, nextPath, map);
      return;
    }
    if (node.type === 'item') {
      map.set(node.id, currentPath);
    }
    if (Array.isArray(node.childs) && node.childs.length) {
      collectItemFolderPaths(node.childs, currentPath, map);
    }
  });
}

export function findLayerNodeById(nodes, id, parent = null) {
  if (!Array.isArray(nodes)) return null;
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (!node) continue;
    if (node.id === id) {
      return { node, parent, parentArray: nodes, index: i };
    }
    if (Array.isArray(node.childs) && node.childs.length) {
      const found = findLayerNodeById(node.childs, id, node);
      if (found) return found;
    }
  }
  return null;
}

export function findFolderNodeByPath(nodes, path) {
  if (!Array.isArray(nodes) || !path) return null;
  const parts = String(path)
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean);

  if (!parts.length) return null;
  let currentArray = nodes;
  let currentFolder = null;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i].toLowerCase();
    const found = currentArray.find(
      (node) =>
        node &&
        node.type === 'folder' &&
        String(node.name || '')
          .trim()
          .toLowerCase() === part,
    );
    if (!found) return null;
    currentFolder = found;
    if (!Array.isArray(currentFolder.childs)) currentFolder.childs = [];
    currentArray = currentFolder.childs;
  }

  return currentFolder;
}

export function findFolderInfoByPath(nodes, path, parent = null) {
  if (!Array.isArray(nodes) || !path) return null;
  const wanted = normalizePathLike(path);
  let result = null;

  const walk = (arr, currentPath, currentParent) => {
    if (result || !Array.isArray(arr)) return;
    for (let i = 0; i < arr.length; i += 1) {
      const node = arr[i];
      if (!node || typeof node !== 'object') continue;
      if (node.type === 'folder') {
        const name = String(node.name || '').trim();
        const nextPath = name ? (currentPath ? `${currentPath}/${name}` : name) : currentPath;
        if (normalizePathLike(nextPath) === wanted) {
          result = { node, parent: currentParent, parentArray: arr, index: i, path: nextPath };
          return;
        }
        walk(node.childs, nextPath, node);
      }
    }
  };

  walk(nodes, '', parent);
  return result;
}

export function collectItemIdsFromLayerNodes(nodes, ids = new Set()) {
  if (!Array.isArray(nodes)) return ids;
  nodes.forEach((node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'item') ids.add(node.id);
    if (Array.isArray(node.childs)) collectItemIdsFromLayerNodes(node.childs, ids);
  });
  return ids;
}

export function removeLayerNodesByIds(nodes, ids) {
  if (!Array.isArray(nodes) || !ids || !ids.size) return;
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (!node || typeof node !== 'object') continue;
    if (ids.has(node.id)) {
      nodes.splice(i, 1);
      continue;
    }
    if (Array.isArray(node.childs)) {
      removeLayerNodesByIds(node.childs, ids);
    }
  }
}

export function ensureFolderPath({ layers, path, nextLayerId }) {
  if (!path) return null;
  const parts = String(path)
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) return null;

  let currentArray = layers;
  let currentFolder = null;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    const existing = currentArray.find(
      (node) =>
        node &&
        node.type === 'folder' &&
        String(node.name || '')
          .trim()
          .toLowerCase() === part.toLowerCase(),
    );
    if (existing) {
      if (!Array.isArray(existing.childs)) existing.childs = [];
      currentFolder = existing;
      currentArray = existing.childs;
      continue;
    }
    const folder = {
      id: nextLayerId(),
      name: part,
      type: 'folder',
      visible: true,
      collapsed: false,
      childs: [],
    };
    currentArray.unshift(folder);
    currentFolder = folder;
    currentArray = folder.childs;
  }
  return currentFolder;
}

export function computeItemBounds(item) {
  if (!item || typeof item.x !== 'number' || typeof item.y !== 'number') return null;
  if (item.type === 'g') {
    const w = Array.isArray(item.size) ? toNumber(item.size[0], 0) : toNumber(item.size, 0);
    const h = Array.isArray(item.size) ? toNumber(item.size[1], 0) : toNumber(item.size, 0);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }
  const baseSize = Math.max(1, toNumber(item.size, 1));
  const steps = Math.max(1, toNumber(item.steps, 1));
  const colorsCount = Math.max(1, Array.isArray(item.colors) ? item.colors.length : 1);
  let xSteps = 1;
  let ySteps = 1;
  if (item.color_mode === 'black_to_white') {
    if (item.direction === 'horizontal') xSteps = steps * 2 + 1;
    else ySteps = steps * 2 + 1;
  } else if (item.direction === 'horizontal') {
    xSteps = Math.max(1, (colorsCount - 1) * steps);
  } else {
    ySteps = Math.max(1, (colorsCount - 1) * steps);
  }
  return { w: baseSize * xSteps, h: baseSize * ySteps };
}

export function rectanglesOverlap(a, b) {
  if (!a || !b) return false;
  if (a.x + a.w <= b.x) return false;
  if (b.x + b.w <= a.x) return false;
  if (a.y + a.h <= b.y) return false;
  if (b.y + b.h <= a.y) return false;
  return true;
}

export function intersectsAnyItem({ x, y, bounds, items, ignoreId }) {
  const nextRect = { x, y, w: bounds.w, h: bounds.h };
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (!item || item.id === ignoreId) continue;
    const itemBounds = computeItemBounds(item);
    if (!itemBounds) continue;
    const itemX = toNumber(item.x, 0);
    const itemY = toNumber(item.y, 0);
    if (rectanglesOverlap(nextRect, { x: itemX, y: itemY, w: itemBounds.w, h: itemBounds.h })) {
      return true;
    }
  }
  return false;
}

export function findNonOverlappingPosition({ item, desiredX, desiredY, texture, occupiedItems }) {
  const step = Math.max(1, toNumber(texture?.step, 1) || 1);
  const width = Math.max(1, toNumber(texture?.width, 2048));
  const height = Math.max(1, toNumber(texture?.height, 2048));
  const bounds = computeItemBounds(item) || { w: 1, h: 1 };
  const maxX = Math.max(0, width - bounds.w);
  const maxY = Math.max(0, height - bounds.h);

  const startX = clamp(snap(toNumber(desiredX, 0), step), 0, maxX);
  const startY = clamp(snap(toNumber(desiredY, 0), step), 0, maxY);

  // Deterministic flow layout: fill rows left->right, then top->bottom.
  // Start near desired cell, then continue in reading order.
  const scanPass = (yFrom, yTo, firstRowXFrom) => {
    for (let y = yFrom; y <= yTo; y += step) {
      const rowStartX = y === yFrom ? firstRowXFrom : 0;
      for (let x = rowStartX; x <= maxX; x += step) {
        if (!intersectsAnyItem({ x, y, bounds, items: occupiedItems, ignoreId: item?.id })) {
          return { x, y };
        }
      }
    }
    return null;
  };

  const firstPass = scanPass(startY, maxY, startX);
  if (firstPass) return firstPass;

  const secondPass = scanPass(0, startY, 0);
  if (secondPass) return secondPass;

  return { x: startX, y: startY };
}

export function autoArrangeCreatedItems({
  texture,
  createdItemIds,
  itemsPerRow = null,
  itemsPerColumn = null,
  flowDirection = 'horizontal',
  itemGapSteps = 0,
  startRow = 1,
  startColumn = 1,
  offsetCellsX = 0,
  offsetCellsY = 0,
}) {
  if (!Array.isArray(createdItemIds) || createdItemIds.length < 1) return;
  const allItems = Array.isArray(texture?.items) ? texture.items : [];
  const createdSet = new Set(createdItemIds);
  const createdItems = createdItemIds
    .map((id) => allItems.find((it) => it && it.id === id))
    .filter(Boolean);
  if (createdItems.length <= 1) return;

  const staticItems = allItems.filter((it) => it && !createdSet.has(it.id));
  const step = Math.max(1, toNumber(texture?.step, 1) || 1);
  const width = Math.max(1, toNumber(texture?.width, 2048));
  const height = Math.max(1, toNumber(texture?.height, 2048));
  const gapSteps = Math.max(0, Math.floor(toNumber(itemGapSteps, 0)));
  const gap = gapSteps * step;
  const rowIndex = Math.max(0, Math.floor(toNumber(startRow, 1)) - 1);
  const colIndex = Math.max(0, Math.floor(toNumber(startColumn, 1)) - 1);
  const cellOffsetX = Math.floor(toNumber(offsetCellsX, 0));
  const cellOffsetY = Math.floor(toNumber(offsetCellsY, 0));

  let cursorX = (colIndex + cellOffsetX) * step;
  let cursorY = (rowIndex + cellOffsetY) * step;
  let rowHeight = 0;
  let rowCount = 0;
  let colWidth = 0;
  let colCount = 0;
  const placed = [];
  const direction =
    String(flowDirection || 'horizontal').toLowerCase() === 'vertical' ? 'vertical' : 'horizontal';

  createdItems.forEach((item) => {
    const bounds = computeItemBounds(item) || { w: 1, h: 1 };
    const maxX = Math.max(0, width - bounds.w);
    const maxY = Math.max(0, height - bounds.h);
    const perRowLimited = Number.isFinite(Number(itemsPerRow)) && Number(itemsPerRow) > 0;
    const perColLimited = Number.isFinite(Number(itemsPerColumn)) && Number(itemsPerColumn) > 0;

    if (direction === 'vertical') {
      if (
        (perColLimited && colCount >= Number(itemsPerColumn)) ||
        (cursorY > 0 && cursorY > maxY)
      ) {
        cursorY = 0;
        cursorX += colWidth + gap;
        colWidth = 0;
        colCount = 0;
      }
    } else if (
      (perRowLimited && rowCount >= Number(itemsPerRow)) ||
      (cursorX > 0 && cursorX > maxX)
    ) {
      cursorX = 0;
      cursorY += rowHeight + gap;
      rowHeight = 0;
      rowCount = 0;
    }

    const pos = findNonOverlappingPosition({
      item,
      desiredX: cursorX,
      desiredY: cursorY,
      texture,
      occupiedItems: [...staticItems, ...placed],
    });

    item.x = pos.x;
    item.y = pos.y;
    placed.push(item);

    if (direction === 'vertical') {
      colWidth = Math.max(colWidth, bounds.w);
      cursorY = item.y + bounds.h + gap;
      colCount += 1;
    } else {
      rowHeight = Math.max(rowHeight, bounds.h);
      cursorX = item.x + bounds.w + gap;
      rowCount += 1;
    }
  });
}
