import { describe, expect, it, vi } from 'vitest';
import { boxSelectionRect, selectItemsInBox } from '../src/utils/boxSelection';
import { boxSelectionMethods } from '../src/app/methods/boxSelectionMethods';

const texture = {
  width: 100,
  height: 100,
  items: [
    { id: 1, type: 'g', x: 10, y: 10, size: [10, 10] },
    { id: 2, type: 'sg', x: 30, y: 10, size: 10, steps: 3, direction: 'horizontal', colors: [{}] },
    { id: 3, type: 'g', x: 10, y: 10, size: [10, 10], visible: false },
    { id: 4, type: 'g', x: 150, y: 0, size: [20, 20] },
  ],
};
describe('box selection', () => {
  it('works in either drag direction and includes intersecting stepped gradients', () => {
    const box = boxSelectionRect({ x: 55, y: 25 }, { x: 15, y: 15 });
    expect(selectItemsInBox(texture, box, [], 'replace')).toEqual([1, 2]);
  });
  it('adds without duplicates and subtracts from the original selection', () => {
    const box = { x: 35, y: 10, width: 10, height: 10 };
    expect(selectItemsInBox(texture, box, [1, 2], 'add')).toEqual([1, 2]);
    expect(selectItemsInBox(texture, box, [1, 2], 'subtract')).toEqual([1]);
    expect(selectItemsInBox(texture, box, [1], 'replace')).toEqual([2]);
  });
  it('excludes hidden and off-texture elements even when the box starts outside', () => {
    expect(
      selectItemsInBox(texture, { x: -20, y: -20, width: 300, height: 300 }, [], 'replace'),
    ).toEqual([1, 2]);
  });
  it('converts pointer positions using the panned and zoomed canvas rectangle', () => {
    const context = {
      finalZoom: 2,
      $refs: { texture: { getBoundingClientRect: () => ({ left: -50, top: 40 }) } },
    };
    expect(
      boxSelectionMethods.canvasPointerPosition.call(context, { clientX: 151, clientY: 81 }),
    ).toEqual({ x: 100, y: 20 });
  });
  it('restores the initial selection and active item on cancel', () => {
    const context = {
      boxSelection: { initialIds: [1, 2], initialActive: 1, initialActiveType: 'folder' },
      ls: { selected: [2], active_id: 2 },
      finishBoxSelection: vi.fn(),
    };
    boxSelectionMethods.cancelBoxSelection.call(context);
    expect(context.ls.selected).toEqual([1, 2]);
    expect(context.ls.active_id).toBe(1);
    expect(context.ls.active_type).toBe('folder');
    expect(context.finishBoxSelection).toHaveBeenCalledOnce();
  });
});
