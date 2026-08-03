import {
  collectItemFolderPaths,
  computeItemBounds,
  gradientDescriptor,
  itemColorStops,
  itemHexColors,
  itemMaterial,
  normalizeSearchText,
  toNumber,
  tokenList,
} from './aiPlanShared.js';

const ITEM_DETAIL_FIELDS = new Set(['colors', 'gradient', 'material', 'transform', 'visibility']);
const MAX_OVERVIEW_ITEMS = 1200;
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
          ids: { type: 'array', items: { type: 'number' } },
          query: { type: 'string' },
          folderPath: { type: 'string' },
          selected: { type: 'boolean' },
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

function buildItemPath(item, itemFolderMap) {
  return [itemFolderMap.get(item.id), item.name]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('/');
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

function collectLayerIndex(nodes, currentPath = '', result = []) {
  if (!Array.isArray(nodes)) return result;
  nodes.forEach((node, index) => {
    if (!node || (node.type !== 'folder' && node.type !== 'item')) return;
    const name = String(node.name || '').trim();
    if (!name) return;
    const path = currentPath ? `${currentPath}/${name}` : name;
    result.push({
      id: node.id,
      path,
      parentPath: currentPath,
      index,
      type: node.type,
      visible: node.visible !== false,
      collapsed: node.collapsed === true,
    });
    if (node.type === 'folder') {
      collectLayerIndex(node.childs, path, result);
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
  const layerById = new Map(layerIndex.map((layer) => [layer.id, layer]));
  const folderIndex = layerIndex.filter((layer) => layer.type === 'folder');
  const folderPaths = folderIndex.map((folder) => folder.path);
  const folderItemCounts = new Map();
  items.forEach((item) => {
    const pathParts = String(itemFolderMap.get(item.id) || '')
      .split('/')
      .filter(Boolean);
    pathParts.forEach((_, index) => {
      const path = pathParts.slice(0, index + 1).join('/');
      folderItemCounts.set(path, (folderItemCounts.get(path) || 0) + 1);
    });
  });
  const folders = folderIndex.map((folder) => ({
    ...folder,
    itemCount: folderItemCounts.get(folder.path) || 0,
  }));

  return {
    protocol: 'pigmi-editor-tools/2',
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
      items: items.slice(0, MAX_OVERVIEW_ITEMS).map((item) => ({
        id: item.id,
        path: buildItemPath(item, itemFolderMap),
        parentPath: layerById.get(item.id)?.parentPath || '',
        index: layerById.get(item.id)?.index ?? null,
        type: item.type,
        visible: item.visible !== false,
      })),
      truncated: items.length > MAX_OVERVIEW_ITEMS,
    },
    writeOperations: [
      'create_folder',
      'duplicate_folder',
      'rename_folder',
      'delete_folder',
      'create_gradient_item',
      'create_gradient_items',
      'duplicate_item',
      'edit_items',
      'recolor_item',
      'update_item',
      'move_item',
      'rename_item',
      'delete_item',
      'set_visibility',
      'set_folder_state',
      'set_selection',
      'move_layer',
      'update_texture',
    ],
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
      query: typeof request?.query === 'string' ? request.query.trim() : '',
      folderPath: typeof request?.folderPath === 'string' ? request.folderPath.trim() : '',
      selected: request?.selected === true,
      fields,
      limit: Math.max(1, Math.min(MAX_ITEMS_PER_REQUEST, toNumber(request?.limit, 30))),
    };
  });
}

function selectRequestedItems({ items, itemFolderMap, selectionIds, request }) {
  const requestedIds = new Set(request.ids);
  const selectedIds = new Set(selectionIds);
  const hasSelector =
    requestedIds.size > 0 || request.selected || request.folderPath || request.query;
  if (!hasSelector) return [];

  let candidates = items.filter((item) => {
    if (requestedIds.size && !requestedIds.has(item.id)) return false;
    if (request.selected && !selectedIds.has(item.id)) return false;
    if (request.folderPath) {
      const folderPath = String(itemFolderMap.get(item.id) || '');
      if (folderPath !== request.folderPath && !folderPath.startsWith(`${request.folderPath}/`)) {
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

function serializeItemDetails(item, itemFolderMap, requestedFields) {
  const result = {
    id: item.id,
    name: item.name,
    folderPath: itemFolderMap.get(item.id) || '',
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
      return {
        request,
        palette: buildPaletteInventory(items, request.limit),
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
      request,
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
