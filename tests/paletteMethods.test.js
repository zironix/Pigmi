import { afterEach, describe, expect, it, vi } from 'vitest';
import { paletteMethods } from '../src/app/methods/paletteMethods';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const colors = [
    { id: 1, rgba: { r: 255, g: 0, b: 0, a: 0.3 }, hsva: { h: 0, s: 100, v: 100, a: 0.3 } },
    { id: 2, locked: true, rgba: { r: 0, g: 0, b: 0, a: 0.8 }, hsva: { h: 0, s: 0, v: 0, a: 0.8 } },
  ];
  const item = { id: 1, colors };
  const other = { id: 2, colors: structuredClone(colors) };
  const context = {
    ...paletteMethods,
    selected: 0,
    texture: {
      items: [item, other],
      generation: { mode: 'transformer', temperature: 1.2, adjacency: 'brand' },
    },
  };
  const replies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((resolve) =>
          replies.push((palette) =>
            resolve({
              ok: true,
              json: async () => ({ results: [{ palette }] }),
            }),
          ),
        ),
    ),
  );
  return { item, other, context, replies };
}

describe('palette generation', () => {
  it('updates the original item after selection/reordering and preserves locks and alpha', async () => {
    const { context, item, other, replies } = setup();
    const locked = item.colors[1];
    const originalOther = structuredClone(other);
    const pending = context.generateColors();
    context.selected = 1;
    context.texture.items.reverse();
    replies[0](['#00ff00', '#ffffff']);
    await pending;
    expect(item.colors[0].rgba).toEqual({ r: 0, g: 255, b: 0, a: 0.3 });
    expect(item.colors[0].hsva.a).toBe(0.3);
    expect(item.colors[1]).toBe(locked);
    expect(other).toEqual(originalOther);
  });

  it.each(['deleted', 'document changed', 'colors edited'])(
    'ignores stale results when %s',
    async (change) => {
      const { context, item, replies } = setup();
      const pending = context.generateColors();
      if (change === 'deleted') context.texture.items.shift();
      if (change === 'document changed') context.texture = { ...context.texture };
      if (change === 'colors edited') item.colors[0].rgba.r = 123;
      const expected = structuredClone(item.colors);
      replies[0](['#00ff00', '#ffffff']);
      await pending;
      expect(item.colors).toEqual(expected);
    },
  );

  it('ignores an older response when requests finish out of order', async () => {
    const { context, item, replies } = setup();
    const older = context.generateColors();
    const newer = context.generateColors();
    replies[1](['#0000ff', '#000000']);
    await newer;
    replies[0](['#00ff00', '#000000']);
    await older;
    expect(item.colors[0].rgba).toEqual({ r: 0, g: 0, b: 255, a: 0.3 });
  });
});
