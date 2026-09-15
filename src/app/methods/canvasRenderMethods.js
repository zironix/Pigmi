import {
  MATERIAL_CHANNELS,
  fillMaterialRect,
  forEachSteppedRect,
  normalizeCanvasItem,
  canvasContentSignature,
  setGradientStyles,
  setMaterialStyles,
} from '../../utils/canvasRendering';

const renderStates = new WeakMap();
function renderState(editor) {
  let state = renderStates.get(editor);
  if (!state) {
    state = { frame: null, signature: null };
    renderStates.set(editor, state);
  }
  return state;
}

export const canvasRenderMethods = {
  draw() {
    const state = renderState(this);
    if (state.frame !== null) return;
    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      this.drawNow();
    });
  },
  disposeCanvasRendering() {
    const state = renderState(this);
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    renderStates.delete(this);
  },
  drawNow() {
    const state = renderState(this);
    if (state.frame !== null) cancelAnimationFrame(state.frame);
    state.frame = null;
    const { width, height, items } = this.texture;
    // Preview uses document pixels; CSS zoom does not allocate a larger bitmap.
    const zoom = 1;
    const signature = this.canvasContentSignature ?? canvasContentSignature(this.texture);
    const mapsChanged = state.signature !== signature;
    const channels = new Set(
      MATERIAL_CHANNELS.filter((channel) => this.texture[`save_${channel}`]),
    );
    if (channels.has('albedo')) {
      channels.add('emission');
      channels.add('emission_crop');
    }
    if (channels.has('emission')) channels.add('emission_crop');
    const contexts = Object.fromEntries(
      (mapsChanged ? [...channels] : []).map((channel) => [channel, this[`ctx_${channel}`]]),
    );
    this.ctx.clearRect(0, 0, width * zoom, height * zoom);
    for (const context of Object.values(contexts)) context.clearRect(0, 0, width, height);

    const query = this.search.toLowerCase();
    const previewKey =
      signature + query + (query ? JSON.stringify(items.map((item) => item.name)) : '');
    // Cache the scene without selection markers. Selection/zoom changes only
    // composite that bitmap and redraw markers, without rebuilding gradients.
    const reusePreview = state.preview && state.previewKey === previewKey;
    if (reusePreview) this.ctx.drawImage(state.preview, 0, 0);
    for (const source of reusePreview ? [] : items) {
      // Normalization is local to this render, never a mutation of the document.
      const item = { ...source, size: Array.isArray(source.size) ? [...source.size] : source.size };
      if (item.visible === false) continue;
      normalizeCanvasItem(item);
      if (!item.colors.length) continue;
      setMaterialStyles(contexts, item);
      const showPreview = !query || item.name?.toLowerCase().includes(query);

      const drawRect = (rect) => {
        if (showPreview) {
          this.ctx.fillRect(...rect.map((value) => Math.ceil(value * zoom)));
        }
        fillMaterialRect(contexts, item, rect);
      };

      if (item.type === 'sg') {
        forEachSteppedRect(item, (rect, color) => {
          // Interpolation is shared by the preview, albedo, and emission maps.
          this.ctx.fillStyle = color;
          if (contexts.albedo) contexts.albedo.fillStyle = color;
          if (contexts.emission) contexts.emission.fillStyle = color;
          drawRect(rect);
        });
      } else {
        setGradientStyles(this.ctx, contexts, item, zoom);
        drawRect([item.x, item.y, ...item.size]);
      }
    }
    if (!reusePreview && this.canvas) {
      state.preview ??= document.createElement('canvas');
      state.preview.width = width;
      state.preview.height = height;
      state.preview.getContext('2d').drawImage(this.canvas, 0, 0);
      state.previewKey = previewKey;
    }
    // Selection is UI: draw it last so later cells/items cannot paint over it.
    for (const item of items) {
      if (
        item.visible !== false &&
        (!query || item.name?.toLowerCase().includes(query)) &&
        this.isItemSelected(item)
      ) {
        this.drawSelectionCircle(item);
      }
    }
    state.signature = signature;
  },
  drawCircle(ctx, x, y, radius, fill, stroke, strokeWidth) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  },
  isItemSelected(item) {
    return this.ls && Array.isArray(this.ls.selected) && this.ls.selected.includes(item.id);
  },
  isItemActive(item) {
    return (
      this.ls &&
      this.ls.active_id !== null &&
      this.ls.active_id !== undefined &&
      this.ls.active_id === item.id
    );
  },
  drawSelectionCircle(item) {
    if (!this.isItemSelected(item)) return;
    const isActive = this.isItemActive(item);
    const fill = isActive ? '#e91e63' : '#858585';
    const stroke = isActive ? '#FFFFFF' : '#ffffff';
    this.drawCircle(
      this.ctx,
      item.x + 8 / this.finalZoom,
      item.y + 8 / this.finalZoom,
      4 / this.finalZoom,
      fill,
      stroke,
      1 / this.finalZoom,
    );
  },
};
