import { afterEach, describe, expect, it, vi } from 'vitest';
import { itemMotionMethods } from '../src/app/methods/itemMotionMethods';
import { canvasInteractionMethods } from '../src/app/methods/canvasInteractionMethods';
import { makeItem, renderContext } from './helpers/canvas';

function editor(items = [makeItem()]) {
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    createElement: () => ({
      getContext: () => renderContext([]).ctx,
      toDataURL: () => 'data:image/png;base64,preview',
    }),
  });
  const state = {
    ...canvasInteractionMethods,
    ...itemMotionMethods,
    texture: { items },
    movingItemPreviews: [],
    isItemSelected: (item) => item.id === 1,
    draw: vi.fn(),
    addUndo: vi.fn(),
  };
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'function' && !vi.isMockFunction(value)) state[key] = value.bind(state);
  }
  return state;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('canvas drag lifecycle', () => {
  it('ends a drag released outside the texture so re-entry cannot move a layer', () => {
    const state = editor();
    state.is_pressed = true;
    state.is_moving = true;
    state.drag_moved = true;
    state.finishItemMotion = vi.fn();
    state.onCanvasDragEnd({ type: 'mouseup', button: 0 });
    expect(state.is_pressed).toBe(false);
    expect(state.is_moving).toBe(false);
    expect(state.drag_moved).toBe(false);
    expect(state.addUndo).toHaveBeenCalledOnce();
    expect(state.finishItemMotion).toHaveBeenCalledOnce();
  });

  it('does not elevate a moving layer above layers that should cover it', () => {
    const state = editor([makeItem(), makeItem({ id: 2 })]);
    state.beginItemMotion();
    expect(state.movingItemPreviews).toEqual([]);
    state.texture.items.reverse();
    state.beginItemMotion();
    expect(state.movingItemPreviews.map((item) => item.id)).toEqual([1]);
  });

  it('clears old previews if a second drag skips animation due to its size', () => {
    vi.useFakeTimers();
    const state = editor();
    state.beginItemMotion();
    expect(state.movingItemPreviews).toHaveLength(1);
    state.finishItemMotion();
    state.texture.items[0].size = 4000;
    state.beginItemMotion();
    expect(state.movingItemPreviews).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
