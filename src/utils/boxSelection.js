import { getCanvasItemBounds } from './canvasItemGeometry';

export function boxSelectionRect(start, end) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function selectItemsInBox(texture, rect, initialIds, mode) {
  const hits = texture.items
    .filter((item) => {
      if (item.visible === false) return false;
      const bounds = getCanvasItemBounds(item);
      if (!bounds) return false;
      const left = Math.max(0, bounds.x),
        top = Math.max(0, bounds.y);
      const right = Math.min(Number(texture.width), bounds.x + bounds.width);
      const bottom = Math.min(Number(texture.height), bounds.y + bounds.height);
      return (
        right > left &&
        bottom > top &&
        left < rect.x + rect.width &&
        right > rect.x &&
        top < rect.y + rect.height &&
        bottom > rect.y
      );
    })
    .map((item) => item.id);
  if (mode === 'subtract') {
    const hitSet = new Set(hits);
    return initialIds.filter((id) => !hitSet.has(id));
  }
  return mode === 'add' ? [...new Set([...initialIds, ...hits])] : hits;
}
