export function getSteppedGradientCellCount(item) {
  const steps = Math.max(1, Number(item.steps) || 1);
  if (item.color_mode === 'black_to_white') return steps * 2 + 1;
  const colors = Math.max(1, item.colors?.length || 1);
  // Adjacent transitions paint their shared endpoint into the same cell.
  return colors > 1 ? (colors - 1) * (steps - 1) + 1 : steps;
}

/**
 * Returns an item's unscaled canvas rectangle.
 *
 * A stepped gradient occupies several square cells, while a regular gradient
 * stores its width and height as a two-element size array.
 */
export function getCanvasItemBounds(item) {
  if (!item || !Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.y))) {
    return null;
  }

  const x = Number(item.x);
  const y = Number(item.y);

  if (item.type === 'sg') {
    const size = Number(item.size) || 0;
    const count = getSteppedGradientCellCount(item);
    const columns = item.direction === 'horizontal' ? count : 1;
    const rows = item.direction === 'horizontal' ? 1 : count;
    return { x, y, width: size * columns, height: size * rows };
  }

  if (Array.isArray(item.size)) {
    return {
      x,
      y,
      width: Number(item.size[0]) || 0,
      height: Number(item.size[1]) || 0,
    };
  }

  if (typeof item.size === 'number') {
    return { x, y, width: item.size, height: item.size };
  }

  return null;
}

export function isPointInsideCanvasItem(item, x, y) {
  const bounds = getCanvasItemBounds(item);
  if (!bounds) return false;

  return (
    x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  );
}

export function findTopmostCanvasItemIndex(items, x, y) {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item.visible !== false && isPointInsideCanvasItem(item, x, y)) {
      return index;
    }
  }

  return null;
}

/**
 * Identifies the repeated cell that was clicked. Regular gradients contain
 * one cell, so their offset is normally { x: 0, y: 0 }.
 */
export function getCanvasItemCellOffset(item, x, y) {
  const bounds = getCanvasItemBounds(item);
  if (!bounds) return { x: 0, y: 0 };

  if (item.type === 'sg') {
    const size = Number(item.size) || 0;
    if (size <= 0) return { x: 0, y: 0 };

    if (item.direction === 'horizontal') {
      return { x: Math.max(0, Math.ceil((x - bounds.x) / size) - 1), y: 0 };
    }
    return { x: 0, y: Math.max(0, Math.ceil((y - bounds.y) / size) - 1) };
  }

  if (bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: Math.max(0, Math.ceil((x - bounds.x) / bounds.width) - 1),
    y: Math.max(0, Math.ceil((y - bounds.y) / bounds.height) - 1),
  };
}
