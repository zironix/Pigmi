import {
  collectItemFolderPaths,
  computeFolderBounds,
  computeItemBounds,
  idKey,
  normalizePathLike,
  toNumber,
} from './aiPlanShared.js';
import {
  buildEditorOverview,
  buildItemPath,
  ITEM_DETAIL_FIELDS,
  serializeItemDetails,
} from './editorContext.js';

const MAX_FOLDER_SNAPSHOTS = 8;
const MAX_FOLDER_SNAPSHOT_ITEMS = 300;

function findFolderByPath(nodes, wantedPath, currentPath = '') {
  if (!Array.isArray(nodes)) return null;
  const normalizedWanted = normalizePathLike(wantedPath);
  for (const node of nodes) {
    if (!node || node.type !== 'folder') continue;
    const name = String(node.name || '').trim();
    const path = currentPath ? `${currentPath}/${name}` : name;
    if (normalizePathLike(path) === normalizedWanted) return { node, path };
    const nested = findFolderByPath(node.childs, wantedPath, path);
    if (nested) return nested;
  }
  return null;
}

export function buildFolderSnapshots({ texture, paths, fields = [], includeItemIndex = false }) {
  const items = Array.isArray(texture?.items) ? texture.items : [];
  const layers = Array.isArray(texture?.layers) ? texture.layers : [];
  const allRequestedPaths = [
    ...new Set((Array.isArray(paths) ? paths : []).map(normalizePathLike)),
  ].filter(Boolean);
  const requestedPaths = allRequestedPaths.slice(0, MAX_FOLDER_SNAPSHOTS);
  const ignoredPaths = allRequestedPaths.slice(MAX_FOLDER_SNAPSHOTS);
  const requestedFields = new Set(
    (Array.isArray(fields) ? fields : []).filter((field) => ITEM_DETAIL_FIELDS.has(field)),
  );
  const itemById = new Map(items.map((item) => [idKey(item.id), item]));
  const itemFolderMap = new Map();
  collectItemFolderPaths(layers, '', itemFolderMap);
  const missingPaths = [];
  const state = { remaining: MAX_FOLDER_SNAPSHOT_ITEMS, truncated: false };

  const folders = requestedPaths.flatMap((requestedPath) => {
    const found = findFolderByPath(layers, requestedPath);
    if (!found) {
      missingPaths.push(requestedPath);
      return [];
    }

    const folderItems = [];
    const issues = [];
    let folderTruncated = false;
    const rootPath = found.path;
    const rootParentPath = rootPath.split('/').slice(0, -1).join('/');

    const visit = (node, parentPath) => {
      const name = String(node?.name || '').trim();
      const path = parentPath ? `${parentPath}/${name}` : name;
      const relativePath = path === rootPath ? '' : path.slice(rootPath.length + 1);

      if (node?.type === 'folder') {
        return {
          id: node.id,
          name,
          kind: 'folder',
          relativePath,
          children: (Array.isArray(node.childs) ? node.childs : [])
            .map((child) => visit(child, path))
            .filter(Boolean),
        };
      }

      if (node?.type !== 'item') return null;
      if (state.remaining <= 0) {
        state.truncated = true;
        folderTruncated = true;
        return null;
      }
      state.remaining -= 1;

      const item = itemById.get(idKey(node.id));
      const treeEntry = {
        id: node.id,
        name,
        kind: 'item',
        itemType: item?.type || null,
        relativePath,
      };
      if (!item) {
        issues.push({ type: 'missing_item_payload', id: node.id, relativePath });
        return treeEntry;
      }

      const details = serializeItemDetails(item, itemFolderMap, requestedFields);
      delete details.name;
      delete details.path;
      delete details.folderPath;
      if (requestedFields.size > 0 || includeItemIndex) {
        folderItems.push({ ...details, id: node.id, relativePath });
      }
      return treeEntry;
    };

    const tree = visit(found.node, rootParentPath);
    return [
      {
        id: found.node.id,
        name: String(found.node.name || '').trim(),
        path: found.path,
        bounds: computeFolderBounds(found.node, itemById),
        complete: issues.length === 0 && !folderTruncated,
        issues,
        tree,
        items: folderItems,
      },
    ];
  });

  return {
    folders,
    missingPaths,
    ignoredPaths,
    truncated: state.truncated,
    limits: {
      maxFolders: MAX_FOLDER_SNAPSHOTS,
      maxItems: MAX_FOLDER_SNAPSHOT_ITEMS,
    },
  };
}

function comparableItem(item) {
  const details = { ...item };
  delete details.id;
  delete details.name;
  delete details.path;
  delete details.folderPath;
  delete details.relativePath;
  return details;
}

function flattenFolderTree(node, entries = []) {
  if (!node || typeof node !== 'object') return entries;
  if (node.relativePath) {
    entries.push({ relativePath: node.relativePath, kind: node.kind });
  }
  if (Array.isArray(node.children)) {
    node.children.forEach((child) => flattenFolderTree(child, entries));
  }
  return entries;
}

export function compareFolderSnapshots({ texture, paths, fields = [] }) {
  const snapshot = buildFolderSnapshots({ texture, paths, fields, includeItemIndex: true });
  const roles = new Map();
  const structureRoles = new Map();

  snapshot.folders.forEach((folder) => {
    flattenFolderTree(folder.tree).forEach((entry) => {
      const key = `${entry.kind}:${normalizePathLike(entry.relativePath)}`;
      if (!structureRoles.has(key)) {
        structureRoles.set(key, { ...entry, presentIn: [] });
      }
      structureRoles.get(key).presentIn.push(folder.path);
    });
    folder.items.forEach((item) => {
      const key = normalizePathLike(item.relativePath);
      if (!roles.has(key)) {
        roles.set(key, { relativePath: item.relativePath, entries: [] });
      }
      roles.get(key).entries.push({ folderPath: folder.path, item });
    });
  });

  const folderPaths = snapshot.folders.map((folder) => folder.path);
  const structure = [...structureRoles.values()]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((entry) => ({
      ...entry,
      missingIn: folderPaths.filter((path) => !entry.presentIn.includes(path)),
    }));
  const comparisons = [...roles.values()]
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
    .map((role) => {
      const presentIn = role.entries.map((entry) => entry.folderPath);
      const signatures = role.entries.map((entry) => JSON.stringify(comparableItem(entry.item)));
      return {
        relativePath: role.relativePath,
        presentIn,
        missingIn: folderPaths.filter((path) => !presentIn.includes(path)),
        sameValues: signatures.length > 0 && signatures.every((value) => value === signatures[0]),
        values: role.entries.map(({ folderPath, item }) => ({
          folderPath,
          id: item.id,
          ...comparableItem(item),
        })),
      };
    });

  return {
    requestedPaths: (Array.isArray(paths) ? paths : []).map(normalizePathLike).filter(Boolean),
    comparedPaths: folderPaths,
    structurallyEquivalent:
      snapshot.folders.length > 0 &&
      snapshot.missingPaths.length === 0 &&
      snapshot.folders.every((folder) => folder.complete) &&
      structure.every((entry) => entry.missingIn.length === 0),
    placements: snapshot.folders.map((folder) => ({ path: folder.path, bounds: folder.bounds })),
    structure,
    roles: comparisons,
    missingPaths: snapshot.missingPaths,
    ignoredPaths: snapshot.ignoredPaths,
    truncated: snapshot.truncated,
  };
}

function materialIssues(item) {
  const ranges = [
    ['roughness', 0, 100],
    ['metallic', 0, 100],
    ['emission_strength', 0, 100],
    ['clearcoat', 0, 100],
    ['clearcoat_roughness', 0, 100],
  ];
  return ranges
    .filter(([field, min, max]) => {
      const value = Number(item?.[field]);
      return Number.isFinite(value) && (value < min || value > max);
    })
    .map(([field, min, max]) => ({ field, value: item[field], expected: `${min}..${max}` }));
}

export function buildEditorDiagnostics({ texture }) {
  const overview = buildEditorOverview({
    texture,
    selectionIds: [],
    activeId: null,
    lastItem: null,
  });
  const items = Array.isArray(texture?.items) ? texture.items : [];
  const layers = Array.isArray(texture?.layers) ? texture.layers : [];
  const itemFolderMap = new Map();
  collectItemFolderPaths(layers, '', itemFolderMap);
  const errors = overview.hierarchy.issues.map((issue) => ({ ...issue, scope: 'hierarchy' }));
  const warnings = [];
  const seenIds = new Set();
  const seenPaths = new Map();
  const width = Math.max(1, toNumber(texture?.width, 1));
  const height = Math.max(1, toNumber(texture?.height, 1));

  items.forEach((item) => {
    const key = idKey(item?.id);
    const path = buildItemPath(item, itemFolderMap);
    const normalizedPath = normalizePathLike(path);
    if (seenIds.has(key)) errors.push({ type: 'duplicate_item_id', id: item?.id, path });
    seenIds.add(key);
    if (seenPaths.has(normalizedPath)) {
      errors.push({
        type: 'duplicate_item_path',
        path,
        ids: [seenPaths.get(normalizedPath), item?.id],
      });
    } else if (normalizedPath) {
      seenPaths.set(normalizedPath, item?.id);
    }
    if (!String(item?.name || '').trim()) errors.push({ type: 'empty_item_name', id: item?.id });
    if (item?.type !== 'g' && item?.type !== 'sg') {
      errors.push({ type: 'invalid_item_type', id: item?.id, path, value: item?.type });
    }
    if (!Array.isArray(item?.colors) || item.colors.length === 0) {
      errors.push({ type: 'missing_color_stops', id: item?.id, path });
    }
    if (
      item?.type === 'g' &&
      Array.isArray(item?.colors) &&
      (!Array.isArray(item?.color_offsets) || item.color_offsets.length !== item.colors.length)
    ) {
      errors.push({ type: 'invalid_color_offsets', id: item?.id, path });
    }
    const bounds = computeItemBounds(item);
    if (!bounds) {
      errors.push({ type: 'invalid_transform', id: item?.id, path });
    } else if (
      toNumber(item.x, 0) < 0 ||
      toNumber(item.y, 0) < 0 ||
      toNumber(item.x, 0) + bounds.w > width ||
      toNumber(item.y, 0) + bounds.h > height
    ) {
      errors.push({ type: 'item_out_of_bounds', id: item?.id, path, bounds });
    }
    materialIssues(item).forEach((issue) => {
      errors.push({ type: 'invalid_material_value', id: item?.id, path, ...issue });
    });
    if (item?.visible === false && !path) {
      warnings.push({ type: 'hidden_orphan_item', id: item?.id });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      itemCount: items.length,
      folderCount: overview.document.folderCount,
      errorCount: errors.length,
      warningCount: warnings.length,
    },
  };
}
