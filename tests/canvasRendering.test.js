import { describe, expect, it, vi } from 'vitest';
import { reactive, watch } from 'vue';
import LinearColorInterpolator from '../src/plugins/linearColorInterpolator';
import { canvasRenderMethods } from '../src/app/methods/canvasRenderMethods';
import { normalizeCanvasItem } from '../src/utils/canvasRendering';
import { getCanvasItemBounds } from '../src/utils/canvasItemGeometry';
import { computeItemBounds } from '../src/ai/aiPlanShared';
import { makeItem, renderContext } from './helpers/canvas';

describe('canvas rendering', () => {
  it('uses the actual painted extent for hit testing and MCP placement', () => {
    for (const colorCount of [1, 2, 3, 4]) {
      for (const steps of [1, 2, 3]) {
        for (const direction of ['horizontal', 'vertical']) {
          for (const color_mode of ['rgb', 'black_to_white']) {
            const item = makeItem({ steps, direction, color_mode });
            item.colors = Array.from({ length: colorCount }, () => item.colors[0]);
            const context = renderContext([item]);
            context.draw();
            const rects = context.ctx_albedo.commands
              .filter((command) => command.rect)
              .map((command) => command.rect);
            const width = Math.max(...rects.map(([x, , w]) => x + w)) - item.x;
            const height = Math.max(...rects.map(([, y, , h]) => y + h)) - item.y;
            expect(getCanvasItemBounds(item)).toMatchObject({ width, height });
            expect(computeItemBounds(item)).toEqual({ w: width, h: height });
          }
        }
      }
    }
  });

  it.each(['horizontal', 'vertical'])(
    'shares stepped geometry across material maps (%s)',
    (direction) => {
      const context = renderContext([makeItem({ direction })]);
      context.draw();
      const rects = context.ctx_albedo.commands
        .filter((command) => command.rect)
        .map((command) => command.rect);
      expect(rects).toEqual(
        direction === 'horizontal'
          ? [
              [16, 24, 8, 8],
              [24, 24, 8, 8],
              [32, 24, 8, 8],
            ]
          : [
              [16, 24, 8, 8],
              [16, 32, 8, 8],
              [16, 40, 8, 8],
            ],
      );
      expect(
        context.ctx_metallic.commands
          .filter((command) => command.rect)
          .map((command) => command.rect),
      ).toEqual(rects);
      expect(context.ctx.commands[1].rect).toEqual([16, 24, 8, 8]);
      expect(context.drawSelectionCircle).toHaveBeenCalledOnce();
      expect(context.save).not.toHaveBeenCalled();
    },
  );

  it('interpolates each step once for all three color canvases', () => {
    const interpolate = vi.spyOn(LinearColorInterpolator, 'findColorBetween');
    try {
      renderContext([makeItem()]).draw();
      expect(interpolate).toHaveBeenCalledTimes(3);
    } finally {
      interpolate.mockRestore();
    }
  });

  it('retains shared endpoint overdraw for translucent multi-segment gradients', () => {
    const item = makeItem();
    item.colors.push({ rgba: { r: 0, g: 255, b: 0, a: 0.5 } });
    const context = renderContext([item]);
    context.draw();
    const fills = context.ctx_albedo.commands.filter((command) => command.rect);
    expect(fills).toHaveLength(6);
    expect(fills[2]).toEqual(fills[3]);
  });

  it('search only filters the preview, while hidden items are absent from every map', () => {
    const context = renderContext([makeItem(), makeItem({ id: 2, visible: false })], {
      search: 'missing',
    });
    context.draw();
    expect(context.ctx.commands).toHaveLength(1);
    expect(context.ctx_albedo.commands).toHaveLength(4);
  });

  it('keeps albedo and emission switches independent from material channels', () => {
    const context = renderContext([makeItem({ albedo: 0, emission: 0 })]);
    context.draw();
    expect(context.ctx_albedo.commands).toHaveLength(1);
    expect(context.ctx_emission.commands).toHaveLength(1);
    expect(context.ctx_roughness.commands).toHaveLength(4);
    expect(context.ctx_mrc.commands[1].style).toBe('rgba(63.75, 127.50, 25.50, 0.01)');
  });

  it('centers rectangular radial gradients consistently in preview and exports', () => {
    const context = renderContext([makeItem({ type: 'g', shape: 'r', size: [40, 20] })]);
    context.draw();
    expect(context.ctx_albedo.commands[1].style.coordinates).toEqual([36, 34, 0, 36, 34, 10]);
    expect(context.ctx.commands[1].style.coordinates).toEqual([36, 34, 0, 36, 34, 10]);
  });

  it('handles a single stepped cell and a single HSL color without invalid colors or crashes', () => {
    const stepped = renderContext([makeItem({ steps: 1 })]);
    stepped.draw();
    expect(stepped.ctx_albedo.commands[1].style).toBe('rgba(255, 0, 0, 0.5)');
    const item = makeItem({ type: 'g', size: [8, 16], color_mode: 'hsl' });
    item.colors.pop();
    const smooth = renderContext([item]);
    expect(() => smooth.draw()).not.toThrow();
    expect(smooth.ctx_albedo.commands[1].style.stops).toHaveLength(2);
  });

  it('includes every HSL stop and reaches the final endpoint', () => {
    const item = makeItem({ type: 'g', size: [32, 32], color_mode: 'hsl' });
    item.colors.push({ rgba: { r: 0, g: 255, b: 0, a: 1 } });
    const context = renderContext([item]);
    context.draw();
    const stops = context.ctx_albedo.commands[1].style.stops;
    expect(stops[0]).toEqual([0, 'rgba(255, 0, 0, 0.5)']);
    expect(stops[10]).toEqual([0.5, 'rgba(0, 0, 255, 1)']);
    expect(stops.at(-1)).toEqual([1, 'rgba(0, 255, 0, 1)']);
  });

  it('skips disabled maps and reuses maps across selection and zoom changes', () => {
    const context = renderContext([makeItem()]);
    context.texture.save_mrc = 0;
    context.draw();
    expect(context.ctx_mrc.commands).toEqual([]);
    const count = context.ctx_albedo.commands.length;
    context.ls.selected = [];
    context.finalZoom = 4;
    context.draw();
    expect(context.ctx_albedo.commands).toHaveLength(count);
    context.texture.items[0].x++;
    context.draw();
    expect(context.ctx_albedo.commands.length).toBeGreaterThan(count);
  });

  it('does not normalize persisted values during drawing', () => {
    const item = makeItem({ type: 'g', size: ['40', '20'], color_mode: 'black_to_white' });
    const before = structuredClone(item);
    renderContext([item]).draw();
    expect(item).toEqual(before);
  });

  it('reuses the scene bitmap without recomputing gradients for selection', () => {
    const context = renderContext([makeItem()]);
    context.canvas = {};
    context.ctx.drawImage = vi.fn();
    const cacheContext = { drawImage: vi.fn() };
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => cacheContext }) });
    const interpolate = vi.spyOn(LinearColorInterpolator, 'findColorBetween');
    try {
      context.draw();
      interpolate.mockClear();
      context.ls.selected = [];
      context.draw();
      expect(interpolate).not.toHaveBeenCalled();
      expect(context.ctx.drawImage).toHaveBeenCalledOnce();
      context.texture.items[0].x++;
      context.draw();
      expect(interpolate).toHaveBeenCalled();
    } finally {
      interpolate.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('coalesces redraw requests and cancels pending work when disposed', () => {
    const request = vi.fn(() => 7);
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    try {
      const context = { ...canvasRenderMethods, drawNow: vi.fn() };
      context.draw();
      context.draw();
      expect(request).toHaveBeenCalledOnce();
      request.mock.calls[0][0]();
      expect(context.drawNow).toHaveBeenCalledOnce();
      context.draw();
      context.disposeCanvasRendering();
      expect(cancel).toHaveBeenCalledWith(7);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('normalizes size idempotently without retriggering deep Vue watchers', () => {
    const item = reactive(
      makeItem({ type: 'g', size: ['40', '20'], color_mode: 'black_to_white' }),
    );
    normalizeCanvasItem(item);
    expect(item.size).toEqual([40, 20]);
    expect(item.color_mode).toBe('rgb');
    const change = vi.fn();
    const stop = watch(item, change, { deep: true, flush: 'sync' });
    normalizeCanvasItem(item);
    expect(change).not.toHaveBeenCalled();
    stop();
  });
});
