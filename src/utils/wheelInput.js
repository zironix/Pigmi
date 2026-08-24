export const WHEEL_GESTURE_IDLE_MS = 180;

export function calculateAnchoredCanvasPosition({
  cursorX,
  cursorY,
  canvasLeft,
  canvasTop,
  containerLeft,
  containerTop,
  containerScrollLeft = 0,
  containerScrollTop = 0,
  oldScale,
  newScale,
}) {
  const logicalX = (cursorX - canvasLeft) / oldScale;
  const logicalY = (cursorY - canvasTop) / oldScale;

  return {
    left: cursorX - logicalX * newScale - containerLeft + containerScrollLeft,
    top: cursorY - logicalY * newScale - containerTop + containerScrollTop,
  };
}

/**
 * Browsers expose mouse wheels and trackpads through the same WheelEvent API.
 * macOS trackpads normally emit small pixel deltas (often on both axes), while
 * notched wheels emit line deltas or much larger integral pixel steps.
 */
export function classifyWheelInput({
  platform,
  deltaMode = 0,
  deltaX = 0,
  deltaY = 0,
  wheelDeltaY = 0,
  ctrlKey = false,
  metaKey = false,
}) {
  // Chromium reports a trackpad pinch as a ctrl-modified wheel event. Keeping
  // command/control as an explicit override also gives users reliable zoom.
  if (ctrlKey || metaKey) return 'zoom';
  if (platform !== 'darwin' || deltaMode !== 0) return 'zoom';

  const horizontalDelta = Math.abs(Number(deltaX) || 0);
  const legacyVerticalDelta = Math.abs(Number(wheelDeltaY) || 0);

  // Chromium keeps the legacy ±120 step for a conventional notched wheel even
  // when deltaY is reported as a small pixel value. This distinguishes a mouse
  // from a vertical two-finger gesture without sacrificing trackpad panning.
  if (horizontalDelta === 0 && legacyVerticalDelta >= 120) return 'zoom';

  const hasSubpixelDelta = !Number.isInteger(Number(deltaX)) || !Number.isInteger(Number(deltaY));

  // Some mouse drivers omit wheelDeltaY and expose a small integer pixel delta.
  // Treat a purely vertical integer event as a wheel; trackpad panning needs
  // stronger evidence such as horizontal movement or subpixel precision.
  const looksLikePreciseScrolling = horizontalDelta > 0 || hasSubpixelDelta;

  return looksLikePreciseScrolling ? 'pan' : 'zoom';
}
