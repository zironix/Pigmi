import { describe, expect, it, vi } from 'vitest';
import { cloneLayerNodesWithNewIds, moveLayerNodes } from '../src/utils/layerTreeOperations';

function tree() {
  return [
    {
      id: 1,
      type: 'folder',
      collapsed: true,
      childs: [
        { id: 2, type: 'item' },
        { id: 3, type: 'item' },
        { id: 4, type: 'item' },
      ],
    },
    { id: 5, type: 'folder', collapsed: true, childs: [] },
  ];
}

describe('layer tree operations', () => {
  it('captures the intact tree before moving a multi-selection', () => {
    const roots = tree();
    const before = vi.fn(() => expect(roots[0].childs.map((node) => node.id)).toEqual([2, 3, 4]));
    const result = moveLayerNodes(roots, 2, 5, 'center', [2, 3], before);
    expect(before).toHaveBeenCalledOnce();
    expect(result.movingSelection).toBe(true);
    expect(roots[0].childs.map((node) => node.id)).toEqual([4]);
    expect(roots[1].childs.map((node) => node.id)).toEqual([2, 3]);
    expect(roots[1].collapsed).toBe(false);
  });

  it.each(['top', 'bottom'])(
    'moves several siblings %s of a sibling without index drift',
    (zone) => {
      const roots = tree();
      moveLayerNodes(roots, 2, 4, zone, [2, 3]);
      expect(roots[0].childs.map((node) => node.id)).toEqual(
        zone === 'top' ? [2, 3, 4] : [4, 2, 3],
      );
    },
  );

  it('moves just a dragged child when its parent is also selected', () => {
    const roots = tree();
    const result = moveLayerNodes(roots, 2, 5, 'center', [1, 2, 3]);
    expect(result.movingSelection).toBe(false);
    expect(roots[1].childs.map((node) => node.id)).toEqual([2]);
  });

  it('moves a selected folder only once when its descendants are selected', () => {
    const roots = tree();
    moveLayerNodes(roots, 1, 5, 'center', [1, 2, 3]);
    expect(roots).toHaveLength(1);
    expect(roots[0].childs[0].childs.map((node) => node.id)).toEqual([2, 3, 4]);
  });

  it.each([
    [1, 2, 'center'],
    [1, 1, 'bottom'],
    [2, 3, 'center'],
    [99, 5, 'center'],
  ])('rejects invalid moves without mutation (%s → %s, %s)', (from, to, zone) => {
    const roots = tree();
    const before = vi.fn();
    expect(moveLayerNodes(roots, from, to, zone, [], before)).toBeNull();
    expect(roots).toEqual(tree());
    expect(before).not.toHaveBeenCalled();
  });

  it('clones nested nodes once and assigns fresh IDs without touching the source', () => {
    const source = tree();
    const ids = new Map();
    let nextId = 10;
    const copy = cloneLayerNodesWithNewIds(source, ids, () => nextId++);
    expect([...ids.entries()]).toEqual([
      [1, 10],
      [2, 11],
      [3, 12],
      [4, 13],
      [5, 14],
    ]);
    copy[0].childs[0].name = 'Edited';
    expect(source).toEqual(tree());
  });
});
