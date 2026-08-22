import { describe, expect, it } from 'vitest';

import {
  collectLayerItemIds,
  collectLayerNodesByIds,
  findLayerNodeById,
  isLayerAncestor,
  keepTopLevelLayerNodes,
  resolveLayerPasteTarget,
} from '../src/utils/layerPasteTarget';

const tree = [
  {
    id: 1,
    name: 'Folder A',
    type: 'folder',
    childs: [{ id: 2, name: 'Layer A', type: 'item' }],
  },
  {
    id: 3,
    name: 'Folder B',
    type: 'folder',
    childs: [{ id: 4, name: 'Layer B', type: 'item' }],
  },
];

describe('layer paste target', () => {
  it('ignores stale folder anchors when nothing is selected', () => {
    expect(
      resolveLayerPasteTarget(tree, {
        selected: [],
        lastClickedId: 3,
        activeId: 4,
      }),
    ).toBeNull();
  });

  it('uses the currently selected folder as the destination', () => {
    const target = resolveLayerPasteTarget(tree, {
      selected: [3, 4],
      lastClickedId: 3,
      activeId: 4,
    });

    expect(target?.node.id).toBe(3);
  });

  it('uses the active selected layer instead of a stale folder', () => {
    const target = resolveLayerPasteTarget(tree, {
      selected: [4],
      lastClickedId: 1,
      activeId: 4,
    });

    expect(target?.node.id).toBe(4);
    expect(target?.parent?.id).toBe(3);
  });

  it('finds nested nodes with their insertion context', () => {
    const result = findLayerNodeById(tree, 2);

    expect(result).toMatchObject({ index: 0, parent: { id: 1 }, node: { id: 2 } });
    expect(result?.parentArray).toBe(tree[0].childs);
  });

  it('collects selected nodes in tree order', () => {
    expect(collectLayerNodesByIds(tree, new Set([4, 1])).map((node) => node.id)).toEqual([1, 4]);
  });

  it('recognizes ancestors and removes duplicate subtree selections', () => {
    const selectedNodes = collectLayerNodesByIds(tree, [1, 2, 4]);

    expect(isLayerAncestor(tree[0], 2)).toBe(true);
    expect(isLayerAncestor(tree[0], 4)).toBe(false);
    expect(keepTopLevelLayerNodes(selectedNodes).map((node) => node.id)).toEqual([1, 4]);
  });

  it('collects every item id below a folder', () => {
    expect(collectLayerItemIds(tree[0])).toEqual([2]);
  });
});
