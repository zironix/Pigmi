import {
  MATERIAL_CHANNELS,
  fillMaterialRect,
  forEachSteppedRect,
  normalizeCanvasItem,
  setGradientStyles,
  setMaterialStyles,
} from '../../utils/canvasRendering';

export const canvasRenderMethods = {
  draw() {
    const { width, height, items } = this.texture;
    const zoom = this.finalZoom;
    const contexts = Object.fromEntries(
      [...MATERIAL_CHANNELS, 'emission_crop'].map((channel) => [channel, this[`ctx_${channel}`]]),
    );
    this.ctx.clearRect(0, 0, width * zoom, height * zoom);
    for (const context of Object.values(contexts)) context.clearRect(0, 0, width, height);

    const query = this.search.toLowerCase();
    for (const item of items) {
      if (item.visible === false) continue;
      normalizeCanvasItem(item);
      if (!item.colors.length) continue;
      setMaterialStyles(contexts, item);
      const showPreview = !query || item.name?.toLowerCase().includes(query);

      const drawRect = (rect, first) => {
        if (showPreview) {
          this.ctx.fillRect(...rect.map((value) => Math.ceil(value * zoom)));
          if (first && this.isItemSelected(item)) this.drawSelectionCircle(item);
        }
        fillMaterialRect(contexts, item, rect);
      };

      if (item.type === 'sg') {
        forEachSteppedRect(item, (rect, color, first) => {
          // Interpolation is shared by the preview, albedo, and emission maps.
          this.ctx.fillStyle = color;
          contexts.albedo.fillStyle = color;
          contexts.emission.fillStyle = color;
          drawRect(rect, first);
        });
      } else {
        setGradientStyles(this.ctx, contexts, item, zoom);
        drawRect([item.x, item.y, ...item.size], true);
      }
    }
    this.save();
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
      item.x * this.finalZoom + 8,
      item.y * this.finalZoom + 8,
      4,
      fill,
      stroke,
      1,
    );
  },
};
