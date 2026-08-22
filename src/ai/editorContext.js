import {
  collectItemFolderPaths,
  computeItemBounds,
  computeFolderBounds,
  getMapValueById,
  gradientDescriptor,
  idKey,
  itemColorStops,
  itemHexColors,
  itemMaterial,
  normalizePathLike,
  normalizeSearchText,
  toNumber,
  tokenList,
} from './aiPlanShared.js';

export const ITEM_DETAIL_FIELDS = new Set([
  'colors',
  'gradient',
  'material',
  'transform',
  'visibility',
]);
const MAX_OVERVIEW_FOLDERS = 300;
const MAX_OVERVIEW_ITEMS = 400;
const MAX_DATA_REQUESTS = 4;
const MAX_ITEMS_PER_REQUEST = 100;
const MAX_ITEMS_PER_WORKFLOW = 200;

export const EDITOR_DATA_REQUEST_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    requests: {
      type: 'array',
      maxItems: MAX_DATA_REQUESTS,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['get_items', 'get_palette'] },
          ids: { type: 'array', items: { type: ['number', 'string'] } },
          paths: { type: 'array', items: { type: 'string' } },
          query: { type: 'string' },
          folderPath: { type: 'string' },
          selected: { type: 'boolean' },
          rect: {
            type: ['object', 'null'],
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
            },
            required: ['x', 'y', 'width', 'height'],
            additionalProperties: false,
          },
          fields: {
            type: 'array',
            items: {
              type: 'string',
              enum: [...ITEM_DETAIL_FIELDS],
            },
          },
          limit: { type: 'number' },
        },
        required: ['type', 'ids', 'query', 'folderPath', 'selected', 'fields', 'limit'],
        additionalProperties: false,
      },
    },
    imageRequest: {
      type: ['object', 'null'],
      properties: {
        type: { type: 'string', enum: ['get_attached_image'] },
        reason: { type: 'string' },
      },
      required: ['type', 'reason'],
      additionalProperties: false,
    },
  },
  required: ['intent', 'requests', 'imageRequest'],
  additionalProperties: false,
};

export function buildItemPath(item, itemFolderMap) {
  return [folderPathForId(itemFolderMap, item.id), item.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('/');
}

function folderPathForId(itemFolderMap, id) {
  return getMapValueById(itemFolderMap, id) || '';
}

function compactDefaultItem(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    type: item.type,
    shape: item.shape,
    direction: item.direction,
    colorMode: item.color_mode,
    size: item.size,
    steps: item.steps,
    material: itemMaterial(item),
  };
}

function collectLayerIndex(nodes, currentPath = '', parentId = null, result = []) {
  if (!Array.isArray(nodes)) return result;
  nodes.forEach((node, index) => {
    if (!node || (node.type !== 'folder' && node.type !== 'item')) return;
    const name = String(node.name || '').trim();
    if (!name) return;
    const path = currentPath ? `${currentPath}/${name}` : name;
    result.push({
      id: node.id,
      node,
      name,
      path,
      parentPath: currentPath,
      parentId,
      index,
      type: node.type,
      visible: node.visible !== false,
      collapsed: node.collapsed === true,
    });
    if (node.type === 'folder') {
      collectLayerIndex(node.childs, path, node.id, result);
    }
  });
  return result;
}

export function buildEditorOverview({ texture, selectionIds, activeId, lastItem }) {
  const items = Array.isArray(texture?.items) ? texture.items : [];
  const layers = Array.isArray(texture?.layers) ? texture.layers : [];
  const selectedIds = Array.isArray(selectionIds) ? selectionIds : [];
  const itemFolderMap = new Map();
  collectItemFolderPaths(layers, '', itemFolderMap);

  const layerIndex = collectLayerIndex(layers);
  const folderIndex = layerIndex.filter((layer) => layer.type === 'folder');
  const layerItemIndex = layerIndex.filter((layer) => layer.type === 'item');
  const folderPaths = folderIndex.map((folder) => folder.path);
  const textureItemById = new Map(items.map((item) => [idKey(item.id), item]));
  const layerItemIds = new Set(layerItemIndex.map((item) => idKey(item.id)));
  const hierarchyIssues = [];
  const seenLayerIds = new Set();
  layerIndex.forEach((entry) => {
    const key = idKey(entry.id);
    if (seenLayerIds.has(key)) {
      hierarchyIssues.push({ type: 'duplicate_layer_id', id: entry.id, path: entry.path });
    }
    seenLayerIds.add(key);
  });
  layerItemIndex.forEach((entry) => {
    if (!textureItemById.has(idKey(entry.id))) {
      hierarchyIssues.push({ type: 'missing_item_payload', id: entry.id, path: entry.path });
    }
  });
  items.forEach((item) => {
    if (!layerItemIds.has(idKey(item.id))) {
      hierarchyIssues.push({
        type: 'orphan_item_payload',
        id: item.id,
        path: String(item.name || '').trim(),
      });
    }
  });
  const folderItemCounts = new Map();
  items.forEach((item) => {
    const pathParts = String(folderPathForId(itemFolderMap, item.id)).split('/').filter(Boolean);
    pathParts.forEach((_, index) => {
      const path = pathParts.slice(0, index + 1).join('/');
      folderItemCounts.set(path, (folderItemCounts.get(path) || 0) + 1);
    });
  });
  const folders = folderIndex.slice(0, MAX_OVERVIEW_FOLDERS).map((folder) => ({
    id: folder.id,
    path: folder.path,
    parentId: folder.parentId,
    index: folder.index,
    itemCount: folderItemCounts.get(folder.path) || 0,
    bounds: computeFolderBounds(folder.node, textureItemById),
    ...(folder.visible ? {} : { visible: false }),
    ...(folder.collapsed ? { collapsed: true } : {}),
  }));

  const serializedItems = layerItemIndex.slice(0, MAX_OVERVIEW_ITEMS).map((layerItem) => {
    const item = textureItemById.get(idKey(layerItem.id));
    return {
      id: layerItem.id,
      path: layerItem.path,
      parentId: layerItem.parentId,
      index: layerItem.index,
      itemType: item?.type || null,
      ...((item ? item.visible !== false : layerItem.visible) ? {} : { visible: false }),
    };
  });
  const remainingSlots = Math.max(0, MAX_OVERVIEW_ITEMS - serializedItems.length);
  const orphanItemPayloads = items.filter((item) => !layerItemIds.has(idKey(item.id)));
  const orphanItems = orphanItemPayloads.slice(0, remainingSlots).map((item) => ({
    id: item.id,
    path: String(item.name || '').trim(),
    parentId: null,
    index: null,
    itemType: item.type || null,
    ...(item.visible !== false ? {} : { visible: false }),
    orphaned: true,
  }));

  return {
    protocol: 'pigmi-editor-tools/4',
    document: {
      width: toNumber(texture?.width, 0),
      height: toNumber(texture?.height, 0),
      step: toNumber(texture?.step, 1),
      zoom: toNumber(texture?.zoom, 0),
      maxItemSize: toNumber(texture?.max_item_size, 200),
      defaultColorModel: texture?.default_color_model,
      mixPreview: texture?.mix_preview,
      centerLocked: texture?.center_locked === true,
      lockedLeft: texture?.locked_left === true,
      lockedRight: texture?.locked_right === true,
      exportMaps: {
        albedo: texture?.save_albedo,
        roughness: texture?.save_roughness,
        metallic: texture?.save_metallic,
        emission: texture?.save_emission,
        clearcoat: texture?.save_clearcoat,
        clearcoatRoughness: texture?.save_clearcoat_roughness,
        mrc: texture?.save_mrc,
      },
      generation: {
        mode: texture?.generation?.mode,
        adjacency: texture?.generation?.adjacency,
        temperature: texture?.generation?.temperature,
      },
      itemCount: items.length,
      folderCount: folderPaths.length,
    },
    selection: {
      activeId: activeId ?? null,
      ids: selectedIds,
    },
    defaults: compactDefaultItem(lastItem),
    hierarchy: {
      folders,
      items: [...serializedItems, ...orphanItems],
      rootIds: layerIndex.filter((entry) => entry.parentId === null).map((entry) => entry.id),
      valid: hierarchyIssues.length === 0,
      issues: hierarchyIssues,
      truncated:
        folderIndex.length > MAX_OVERVIEW_FOLDERS ||
        layerItemIndex.length + orphanItemPayloads.length > MAX_OVERVIEW_ITEMS,
      omitted: {
        folders: Math.max(0, folderIndex.length - folders.length),
        items: Math.max(
          0,
          layerItemIndex.length +
            orphanItemPayloads.length -
            serializedItems.length -
            orphanItems.length,
        ),
      },
    },
  };
}

export function normalizeEditorDataRequests(input) {
  const requests = Array.isArray(input?.requests) ? input.requests : [];
  return requests.slice(0, MAX_DATA_REQUESTS).map((request) => {
    const type = request?.type === 'get_palette' ? 'get_palette' : 'get_items';
    const fields = Array.isArray(request?.fields)
      ? [...new Set(request.fields.filter((field) => ITEM_DETAIL_FIELDS.has(field)))]
      : [];
    return {
      type,
      ids: Array.isArray(request?.ids) ? [...new Set(request.ids)].slice(0, 100) : [],
      paths: Array.isArray(request?.paths)
        ? [...new Set(request.paths.map(normalizePathLike).filter(Boolean))].slice(0, 100)
        : [],
      query: typeof request?.query === 'string' ? request.query.trim() : '',
      folderPath: typeof request?.folderPath === 'string' ? request.folderPath.trim() : '',
      selected: request?.selected === true,
      rect:
        request?.rect && typeof request.rect === 'object'
          ? {
              x: toNumber(request.rect.x, 0),
              y: toNumber(request.rect.y, 0),
              width: Math.max(0, toNumber(request.rect.width, 0)),
              height: Math.max(0, toNumber(request.rect.height, 0)),
            }
          : null,
      fields,
      limit: Math.max(1, Math.min(MAX_ITEMS_PER_REQUEST, toNumber(request?.limit, 30))),
    };
  });
}

function selectRequestedItems({ items, itemFolderMap, selectionIds, request, allowAll = false }) {
  const requestedIds = new Set(request.ids.map(idKey));
  const requestedPaths = new Set(request.paths.map(normalizePathLike));
  const selectedIds = new Set(selectionIds.map(idKey));
  const hasSelector =
    requestedIds.size > 0 ||
    requestedPaths.size > 0 ||
    request.selected ||
    request.folderPath ||
    request.query ||
    request.rect;
  if (!hasSelector && !allowAll) return [];

  let candidates = items.filter((item) => {
    if (requestedIds.size && !requestedIds.has(idKey(item.id))) return false;
    if (
      requestedPaths.size &&
      !requestedPaths.has(normalizePathLike(buildItemPath(item, itemFolderMap)))
    ) {
      return false;
    }
    if (request.selected && !selectedIds.has(idKey(item.id))) return false;
    if (request.folderPath) {
      const folderPath = normalizePathLike(folderPathForId(itemFolderMap, item.id));
      const requestedFolderPath = normalizePathLike(request.folderPath);
      if (folderPath !== requestedFolderPath && !folderPath.startsWith(`${requestedFolderPath}/`)) {
        return false;
      }
    }
    if (request.rect) {
      const bounds = computeItemBounds(item);
      if (!bounds) return false;
      const itemRect = {
        x: toNumber(item.x, 0),
        y: toNumber(item.y, 0),
        width: bounds.w,
        height: bounds.h,
      };
      const rect = request.rect;
      if (
        itemRect.x + itemRect.width <= rect.x ||
        rect.x + rect.width <= itemRect.x ||
        itemRect.y + itemRect.height <= rect.y ||
        rect.y + rect.height <= itemRect.y
      ) {
        return false;
      }
    }
    return true;
  });

  const queryTokens = tokenList(request.query);
  if (queryTokens.length) {
    candidates = candidates
      .map((item) => {
        const searchable = normalizeSearchText(
          `${buildItemPath(item, itemFolderMap)} ${item.type} ${itemHexColors(item).join(' ')}`,
        );
        return {
          item,
          score: queryTokens.reduce((sum, token) => sum + (searchable.includes(token) ? 1 : 0), 0),
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.item);
  }

  return candidates.slice(0, request.limit);
}

export function serializeItemDetails(item, itemFolderMap, requestedFields) {
  const result = {
    id: item.id,
    name: item.name,
    folderPath: folderPathForId(itemFolderMap, item.id),
    path: buildItemPath(item, itemFolderMap),
    type: item.type,
  };

  if (requestedFields.has('colors')) {
    result.colors = itemHexColors(item);
    result.colorOffsets = Array.isArray(item.color_offsets) ? item.color_offsets.slice() : [];
    result.colorStops = itemColorStops(item);
  }
  if (requestedFields.has('gradient')) {
    result.gradient = gradientDescriptor(item);
  }
  if (requestedFields.has('material')) {
    result.material = itemMaterial(item);
  }
  if (requestedFields.has('transform')) {
    result.transform = {
      x: item.x,
      y: item.y,
      bounds: computeItemBounds(item),
    };
  }
  if (requestedFields.has('visibility')) {
    result.visible = item.visible !== false;
  }

  return result;
}

function buildPaletteInventory(items, limit) {
  const counts = new Map();
  items.forEach((item) => {
    itemHexColors(item).forEach((hex) => counts.set(hex, (counts.get(hex) || 0) + 1));
  });
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([hex, count]) => ({ hex, count }));
}

export function fulfillEditorDataRequests({ texture, selectionIds, requests: rawRequests }) {
  const items = Array.isArray(texture?.items) ? texture.items : [];
  const layers = Array.isArray(texture?.layers) ? texture.layers : [];
  const selectedIds = Array.isArray(selectionIds) ? selectionIds : [];
  const itemFolderMap = new Map();
  collectItemFolderPaths(layers, '', itemFolderMap);

  const requests = normalizeEditorDataRequests({ requests: rawRequests });
  let remainingItemBudget = MAX_ITEMS_PER_WORKFLOW;
  const results = requests.map((request) => {
    if (request.type === 'get_palette') {
      const paletteItems = selectRequestedItems({
        items,
        itemFolderMap,
        selectionIds: selectedIds,
        request,
        allowAll: true,
      });
      return {
        matchedCount: paletteItems.length,
        palette: buildPaletteInventory(paletteItems, request.limit),
      };
    }

    const effectiveLimit = Math.min(request.limit, remainingItemBudget);
    const matchedItems = selectRequestedItems({
      items,
      itemFolderMap,
      selectionIds: selectedIds,
      request: { ...request, limit: effectiveLimit },
    });
    remainingItemBudget -= matchedItems.length;
    const requestedFields = new Set(request.fields);

    return {
      matchedCount: matchedItems.length,
      items: matchedItems.map((item) => serializeItemDetails(item, itemFolderMap, requestedFields)),
    };
  });

  return {
    results,
    limits: {
      maxRequests: MAX_DATA_REQUESTS,
      maxItemsPerRequest: MAX_ITEMS_PER_REQUEST,
      maxItemsPerWorkflow: MAX_ITEMS_PER_WORKFLOW,
    },
  };
}
