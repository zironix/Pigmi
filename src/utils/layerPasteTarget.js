export function findLayerNodeById(nodes, id, parent = null) {
  if (!Array.isArray(nodes)) return null;

  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.id === id) {
      return { node, parentArray: nodes, index, parent };
    }
    if (Array.isArray(node.childs)) {
      const result = findLayerNodeById(node.childs, id, node);
      if (result) return result;
    }
  }

  return null;
}

export function collectLayerNodesByIds(nodes, ids, result = []) {
  if (!Array.isArray(nodes)) return result;

  const selectedIds = ids instanceof Set ? ids : new Set(ids);
  for (const node of nodes) {
    if (selectedIds.has(node.id)) {
      result.push(node);
    }
    collectLayerNodesByIds(node.childs, selectedIds, result);
  }

  return result;
}

export function isLayerAncestor(ancestorNode, descendantId) {
  if (!ancestorNode || !Array.isArray(ancestorNode.childs)) return false;

  return ancestorNode.childs.some(
    (child) => child.id === descendantId || isLayerAncestor(child, descendantId),
  );
}

/**
 * Removes selected descendants when their ancestor is already in the list.
 * This prevents copy, cut, and drag operations from handling the same subtree twice.
 */
export function keepTopLevelLayerNodes(nodes) {
  return nodes.filter(
    (node) => !nodes.some((candidate) => candidate !== node && isLayerAncestor(candidate, node.id)),
  );
}

export function collectLayerItemIds(node, result = []) {
  if (!node) return result;

  if (node.type === 'item') {
    result.push(node.id);
  }
  if (Array.isArray(node.childs)) {
    for (const child of node.childs) {
      collectLayerItemIds(child, result);
    }
  }

  return result;
}

/**
 * Resolves a paste destination exclusively from the current selection.
 * Stale click/active anchors must never redirect a paste after deselection.
 */
export function resolveLayerPasteTarget(nodes, { selected, lastClickedId, activeId }) {
  const selection = Array.isArray(selected) ? selected : [];
  if (!selection.length) return null;

  const selectedIds = new Set(selection);
  const candidates = [];

  if (selectedIds.has(lastClickedId)) candidates.push(lastClickedId);
  if (selectedIds.has(activeId)) candidates.push(activeId);
  candidates.push(...selection.slice().reverse());

  for (const id of new Set(candidates)) {
    const info = findLayerNodeById(nodes, id);
    if (info) return info;
  }

  return null;
}
