import {
  collectLayerNodesByIds,
  findLayerNodeById,
  isLayerAncestor,
  keepTopLevelLayerNodes,
} from './layerPasteTarget';

export function cloneLayerNodesWithNewIds(nodes, idMap, nextId) {
  const cloned = JSON.parse(JSON.stringify(nodes));
  function assignIds(children) {
    for (const node of children) {
      const id = nextId();
      idMap.set(node.id, id);
      node.id = id;
      if (Array.isArray(node.childs)) assignIds(node.childs);
    }
  }
  assignIds(cloned);
  return cloned;
}

/** Validate first, then move whole subtrees without losing sibling order. */
export function moveLayerNodes(root, fromId, toId, zone, selected = [], beforeMove) {
  if (!['top', 'center', 'bottom'].includes(zone)) return null;
  const source = findLayerNodeById(root, fromId);
  const target = findLayerNodeById(root, toId);
  if (!source || !target) return null;
  if (zone === 'center' && target.node.type !== 'folder') return null;

  const selectedNodes = collectLayerNodesByIds(root, selected);
  const hasSelectedAncestor = selectedNodes.some((node) => isLayerAncestor(node, fromId));
  const movingSelection = selected.includes(fromId) && !hasSelectedAncestor;
  const nodes = movingSelection ? keepTopLevelLayerNodes(selectedNodes) : [source.node];
  if (nodes.some((node) => node.id === toId || isLayerAncestor(node, toId))) return null;

  beforeMove?.();
  for (const node of nodes) {
    const current = findLayerNodeById(root, node.id);
    current.parentArray.splice(current.index, 1);
  }

  if (zone === 'center') {
    target.node.childs ??= [];
    target.node.childs.push(...nodes);
    target.node.collapsed = false;
  } else {
    const siblings = target.parentArray;
    const targetIndex = siblings.indexOf(target.node);
    siblings.splice(targetIndex + (zone === 'bottom' ? 1 : 0), 0, ...nodes);
  }
  return { nodes, movingSelection };
}
