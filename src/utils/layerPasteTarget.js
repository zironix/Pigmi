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
