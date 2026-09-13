import { describe, expect, it, vi } from 'vitest';
import { canvasItemMethods } from '../src/app/methods/canvasItemMethods';
import { canvasInteractionMethods } from '../src/app/methods/canvasInteractionMethods';
import { colorMethods } from '../src/app/methods/colorMethods';
import { historyMethods } from '../src/app/methods/historyMethods';
import { redistributeColorOffsets } from '../src/utils/colorStops';

describe('editor actions', () => {
  it('creates independent item colors, offsets, and dimensions', () => {
    const template = {
      type: 'g',
      size: [32, 64],
      colors: [{ rgba: { r: 1 }, hsva: { h: 2 } }],
      color_offsets: [0],
    };
    const snapshot = structuredClone(template);
    const context = {
      ...canvasItemMethods,
      ...colorMethods,
      lastItem: template,
      texture: { items: [], step: 8 },
      finalZoom: 1,
      $nextTick: (callback) => callback(),
      showItemPanelAfterSelection: vi.fn(),
    };
    context.create({ offsetX: 16, offsetY: 24 });
    context.create({ offsetX: 24, offsetY: 32 });
    const [first, second] = context.texture.items;
    first.colors[0].rgba.r = 255;
    first.color_offsets[0] = 25;
    first.size[0] = 128;
    expect(template).toEqual(snapshot);
    expect(second.colors[0].rgba.r).toBe(1);
    expect(second.color_offsets).toEqual([0]);
    expect(second.size).toEqual([32, 64]);
  });

  it('does not remove the last color and uses Vue 3 array assignment', () => {
    const item = { colors: [{ id: 1 }], color_offsets: [0] };
    const context = { texture: { items: [item] }, selected: 0 };
    colorMethods.removeColor.call(context, 0);
    expect(item.colors).toEqual([{ id: 1 }]);
    colorMethods.colorPicked.call(context, { id: 2 }, 0);
    expect(item.colors).toEqual([{ id: 2 }]);
  });

  it.each([
    [1, [0]],
    [2, [0, 100]],
    [4, [0, 33, 66, 100]],
    [5, [0, 25, 50, 75, 100]],
  ])('redistributes %s offsets with exact endpoints', (count, expected) => {
    const offsets = Array(count).fill(100);
    redistributeColorOffsets(offsets);
    expect(offsets).toEqual(expected);
  });

  it('keeps the item tab after undo restores the first item at index zero', () => {
    const texture = { items: [{ id: 1 }], layers: [] };
    const context = {
      texture,
      current_tab: 'item',
      selected: false,
      undo_array: [
        { texture: JSON.stringify(texture), selected: 0 },
        { texture: '{}', selected: false },
      ],
      draw: vi.fn(),
      $nextTick: (callback) => callback(),
    };
    historyMethods.undo.call(context);
    expect(context.selected).toBe(0);
    expect(context.current_tab).toBe('item');
  });

  it('does not redraw a dragged item until its snapped position actually changes', () => {
    const item = { type: 'g', size: [16, 32], x: 16, y: 24 };
    const context = {
      selected: 0,
      is_pressed: true,
      finalZoom: 2,
      selected_offset: { x: 0.5, y: 0.5 },
      texture: { items: [item], step: 8 },
      isToggleSelectionPressed: () => false,
      draw: vi.fn(),
    };
    canvasInteractionMethods.mousemove.call(context, { offsetX: 48, offsetY: 80 });
    expect(context.draw).not.toHaveBeenCalled();
    canvasInteractionMethods.mousemove.call(context, { offsetX: 64, offsetY: 96 });
    expect(item).toMatchObject({ x: 24, y: 32 });
    expect(context.draw).toHaveBeenCalledOnce();
  });
});
