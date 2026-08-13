import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { applyLayerSelection, useLayersStore } from '../src/stores/layers';

describe('layers store selection state', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('clears stale click anchors with an empty selection', () => {
    const store = useLayersStore();
    store.last_clicked_id = 42;

    applyLayerSelection(store, []);

    expect(store.selected).toEqual([]);
    expect(store.active_id).toBeNull();
    expect(store.last_clicked_id).toBeNull();
  });

  it('tracks the layer currently being renamed', () => {
    const store = useLayersStore();

    expect(store.renaming_id).toBeNull();
    store.renaming_id = 42;
    expect(store.renaming_id).toBe(42);
  });
});
