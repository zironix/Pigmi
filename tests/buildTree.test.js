import { describe, expect, it } from 'vitest';

import { buildTree, previewCssFromItem, rgbaToCss } from '../src/buildTree';

const red = { rgba: { r: 255, g: 0, b: 0, a: 1 } };
const blue = { rgba: { r: 0, g: 0, b: 255, a: 0.5 } };

describe('palette tree helpers', () => {
  it('formats RGBA values for CSS', () => {
    expect(rgbaToCss({ r: 10.4, g: 20.6, b: 30.2, a: 0.75 })).toBe('rgba(10, 21, 30, 0.75)');
  });

  it('creates a directional gradient preview', () => {
    expect(
      previewCssFromItem({
        type: 'g',
        shape: 'l',
        direction: 'vertical',
        colors: [red, blue],
        color_offsets: [0, 100],
      }),
    ).toBe('linear-gradient(180deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 0.5) 100%)');
  });

  it('builds case-insensitive groups without merging leaf items', () => {
    const tree = buildTree([
      { name: 'Vehicle/Body', colors: [red] },
      { name: 'vehicle/Glass', colors: [blue] },
      { name: 'Loose', colors: [red] },
    ]);

    expect(tree).toHaveLength(2);
    expect(tree[0]).toMatchObject({
      label: 'Vehicle',
      path: 'Vehicle',
      children: [
        { label: 'Body', itemIndex: 0, isItem: true },
        { label: 'Glass', itemIndex: 1, isItem: true },
      ],
    });
    expect(tree[1]).toMatchObject({ label: 'Loose', itemIndex: 2, isItem: true });
  });
});
