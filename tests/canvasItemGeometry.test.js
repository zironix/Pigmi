import { describe, expect, it } from 'vitest';

import {
  findTopmostCanvasItemIndex,
  getCanvasItemBounds,
  getCanvasItemCellOffset,
  isPointInsideCanvasItem,
} from '../src/utils/canvasItemGeometry';

describe('canvas item geometry', () => {
  it('returns the bounds of a regular gradient', () => {
    expect(getCanvasItemBounds({ type: 'g', x: 10, y: 20, size: [30, 40] })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });

  it('accounts for every cell in a stepped gradient', () => {
    expect(
      getCanvasItemBounds({
        type: 'sg',
        x: 10,
        y: 20,
        size: 8,
        steps: 3,
        direction: 'horizontal',
        color_mode: 'rgb',
        colors: [{}, {}, {}],
      }),
    ).toEqual({ x: 10, y: 20, width: 48, height: 8 });

    expect(
      getCanvasItemBounds({
        type: 'sg',
        x: 10,
        y: 20,
        size: 8,
        steps: 3,
        direction: 'vertical',
        color_mode: 'black_to_white',
        colors: [{}],
      }),
    ).toEqual({ x: 10, y: 20, width: 8, height: 56 });
  });

  it('finds the last visible item because it is drawn on top', () => {
    const items = [
      { type: 'g', x: 0, y: 0, size: [20, 20] },
      { type: 'g', x: 5, y: 5, size: [20, 20], visible: false },
      { type: 'g', x: 10, y: 10, size: [20, 20] },
    ];

    expect(findTopmostCanvasItemIndex(items, 15, 15)).toBe(2);
    expect(findTopmostCanvasItemIndex(items, 2, 2)).toBe(0);
    expect(findTopmostCanvasItemIndex(items, 50, 50)).toBeNull();
  });

  it('uses inclusive edges and returns the clicked stepped-gradient cell', () => {
    const item = {
      type: 'sg',
      x: 10,
      y: 20,
      size: 8,
      steps: 3,
      direction: 'horizontal',
      color_mode: 'rgb',
      colors: [{}, {}],
    };

    expect(isPointInsideCanvasItem(item, 34, 24)).toBe(true);
    expect(getCanvasItemCellOffset(item, 34, 24)).toEqual({ x: 2, y: 0 });
  });
});
