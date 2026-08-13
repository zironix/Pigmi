import { defineStore } from 'pinia';

export const useLayersStore = defineStore('layers', {
  state: () => {
    return {
      dragged_item: null,
      hovered_item: null,
      zone: null,
      is_dragging: null,
      selected: [],
      active_id: null,
      active_type: null,
      pending_insert: null,
      pending_select_id: null,
      auto_hidden_ids: [],
      id_seed: 0,
      clipboard: null,
      last_clicked_id: null,
      last_canvas_pos: null,
      last_canvas_in_bounds: false,
      paste_offset: { x: 0, y: 0 },
      renaming_id: null,
    };
  },
  //state: () => ({ count: 0 })
  actions: {
    setDraggedId(id) {
      this.dragged_id = id;
    },
    setSelected(ids, activeType) {
      if (Array.isArray(ids)) {
        this.selected = ids;
      } else if (ids === null || ids === undefined || ids === false) {
        this.selected = [];
      } else {
        this.selected = [ids];
      }
      this.active_id = this.selected.length ? this.selected[this.selected.length - 1] : null;
      if (!this.selected.length) {
        this.last_clicked_id = null;
      }
      if (activeType !== undefined) {
        this.active_type = activeType;
      } else if (!this.selected.length) {
        this.active_type = null;
      }
    },
    setActiveId(id) {
      if (id === null || id === undefined || id === false) {
        this.active_id = null;
        this.selected = [];
        this.active_type = null;
        this.last_clicked_id = null;
        return;
      }
      this.active_id = id;
      if (!this.selected.includes(id)) {
        this.selected = [...this.selected, id];
      }
    },
  },
});

export function applyLayerSelection(store, ids, activeType) {
  if (!store) return;
  if (typeof store.setSelected === 'function') {
    store.setSelected(ids, activeType);
    return;
  }
  if (Array.isArray(ids)) {
    store.selected = ids;
  } else if (ids === null || ids === undefined || ids === false) {
    store.selected = [];
  } else {
    store.selected = [ids];
  }
  store.active_id = store.selected.length ? store.selected[store.selected.length - 1] : null;
  if (!store.selected.length) {
    store.last_clicked_id = null;
  }
  if (activeType !== undefined) {
    store.active_type = activeType;
  } else if (!store.selected.length) {
    store.active_type = null;
  }
}

export function nextLayerId(store) {
  const seed = store && typeof store.id_seed === 'number' ? store.id_seed : 0;
  if (store && typeof store.id_seed === 'number') {
    store.id_seed = (store.id_seed + 1) % 1000;
  }
  return Date.now() * 1000 + seed;
}
