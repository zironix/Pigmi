import { getCanvasItemBounds } from '../../utils/canvasItemGeometry';
import {
  forEachSteppedRect,
  normalizeCanvasItem,
  setGradientStyles,
} from '../../utils/canvasRendering';

const timers = new WeakMap();

export const itemMotionMethods = {
  beginItemMotion() {
    clearTimeout(timers.get(this));
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const previews = [];
    let pixels = 0;
    for (const source of this.texture.items) {
      if (!this.isItemSelected(source) || source.visible === false) continue;
      const bounds = getCanvasItemBounds(source);
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue;
      pixels += Math.ceil(bounds.width) * Math.ceil(bounds.height);
      // Keep large documents responsive; this effect never needs a full-scene buffer.
      if (pixels > 4_000_000) return;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(bounds.width);
      canvas.height = Math.ceil(bounds.height);
      const ctx = canvas.getContext('2d');
      const item = {
        ...source,
        x: 0,
        y: 0,
        size: Array.isArray(source.size) ? [...source.size] : source.size,
      };
      normalizeCanvasItem(item);
      if (item.type === 'sg') {
        forEachSteppedRect(item, (rect, color) => {
          ctx.fillStyle = color;
          ctx.fillRect(...rect);
        });
      } else {
        setGradientStyles(ctx, {}, item, 1);
        ctx.fillRect(0, 0, ...item.size);
      }
      previews.push({
        id: item.id,
        width: bounds.width,
        height: bounds.height,
        url: canvas.toDataURL(),
      });
    }
    this.movingItemPreviews = previews;
    window.addEventListener('pointerup', this.finishItemMotion, { once: true });
    this.draw();
  },
  finishItemMotion() {
    clearTimeout(timers.get(this));
    timers.set(
      this,
      setTimeout(() => {
        this.movingItemPreviews = [];
        this.draw();
        timers.delete(this);
      }, 150),
    );
  },
  disposeItemMotion() {
    clearTimeout(timers.get(this));
    timers.delete(this);
    window.removeEventListener('pointerup', this.finishItemMotion);
  },
};
