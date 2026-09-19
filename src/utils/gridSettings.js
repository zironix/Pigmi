export const defaultGridSettings = Object.freeze({
  enabled: true,
  vertical_every: 4,
  horizontal_every: 4,
  dots: true,
  background: '#202225',
  minor_color: '#2a2c30',
  major_color: '#36393d',
  dot_color: '#62676c',
  line_width: 0.6,
  dot_size: 1.2,
});

export function normalizeGridSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = { ...defaultGridSettings };
  for (const key of ['enabled', 'dots']) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  for (const key of ['background', 'minor_color', 'major_color', 'dot_color']) {
    if (/^#[\da-f]{6}$/i.test(source[key])) result[key] = source[key];
  }
  for (const [key, min, max] of [
    ['vertical_every', 1, 100],
    ['horizontal_every', 1, 100],
    ['line_width', 0.2, 2],
    ['dot_size', 0.5, 3],
  ]) {
    const number = Number(source[key]);
    if (source[key] !== '' && Number.isFinite(number)) {
      result[key] = Math.min(
        max,
        Math.max(min, key.endsWith('_every') ? Math.round(number) : number),
      );
    }
  }
  return result;
}

export function gridStyle(value) {
  const grid = normalizeGridSettings(value);
  return {
    '--grid-every-x': grid.vertical_every,
    '--grid-every-y': grid.horizontal_every,
    '--grid-background': grid.background,
    '--grid-minor-color': grid.enabled ? grid.minor_color : 'transparent',
    '--grid-major-color': grid.enabled ? grid.major_color : 'transparent',
    '--grid-dot-color': grid.enabled && grid.dots ? grid.dot_color : 'transparent',
    '--grid-line-width': `${grid.line_width}px`,
    '--grid-dot-size': `${grid.dot_size}px`,
  };
}
