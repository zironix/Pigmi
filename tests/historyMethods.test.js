import { describe, expect, it, vi } from 'vitest';
import { historyMethods } from '../src/app/methods/historyMethods';

function editor() {
  const state = {
    texture: { undo_count: '2', items: [{ id: 1, x: 0, selected: true }], layers: [] },
    selected: 0,
    undo_array: [],
    current_tab: 'item',
    draw: vi.fn(),
    $nextTick: (callback) => callback(),
  };
  for (const [key, fn] of Object.entries(historyMethods)) state[key] = fn.bind(state);
  return state;
}

describe('document undo', () => {
  it('undoes the first edit and then a change not yet committed by pointerup', () => {
    const state = editor();
    state.pushUndoSnapshot();
    state.texture.items[0].x = 20;
    state.undo();
    expect(state.texture.items[0].x).toBe(0);
    state.texture.items[0].x = 40;
    state.pushUndoSnapshot();
    state.texture.items[0].x = 60;
    state.undo();
    expect(state.texture.items[0].x).toBe(40);
    state.undo();
    expect(state.texture.items[0].x).toBe(0);
  });
  it('does not consume undo steps for selection and keeps the configured edit count', () => {
    const state = editor();
    state.pushUndoSnapshot();
    state.texture.items[0].selected = false;
    state.pushUndoSnapshot();
    expect(state.undo_array).toHaveLength(1);
    for (const x of [1, 2, 3]) {
      state.texture.items[0].x = x;
      state.pushUndoSnapshot();
    }
    expect(state.undo_array).toHaveLength(3);
    state.undo();
    state.undo();
    expect(state.texture.items[0].x).toBe(1);
  });
  it('handles Ctrl+Z on keydown without relying on modifier state at keyup', () => {
    const state = editor();
    state.undo = vi.fn();
    const preventDefault = vi.fn();
    state.keydownHandler({
      code: 'KeyZ',
      ctrlKey: true,
      preventDefault,
      target: { tagName: 'DIV' },
    });
    expect(state.undo).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
  });
  it('keeps undo progressing after a folder is expanded or collapsed', () => {
    const state = editor();
    state.texture.layers = [{ id: 10, type: 'folder', collapsed: false, childs: [] }];
    state.pushUndoSnapshot();
    state.texture.items[0].x = 10;
    state.pushUndoSnapshot();
    state.texture.items[0].x = 20;
    state.pushUndoSnapshot();
    state.texture.layers[0].collapsed = true;
    state.undo();
    expect(state.texture.items[0].x).toBe(10);
    expect(state.texture.layers[0].collapsed).toBe(true);
    state.undo();
    expect(state.texture.items[0].x).toBe(0);
    expect(state.texture.layers[0].collapsed).toBe(true);
  });
});
