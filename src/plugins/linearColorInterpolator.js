const BYTE_MAX = 255;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, precision = 0) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function normalizeHue(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function byteToHex(value) {
  return Math.round(clamp(Number(value), 0, BYTE_MAX))
    .toString(16)
    .padStart(2, '0');
}

function parseHexColor(input) {
  if (typeof input !== 'string') return null;

  const value = input.trim().replace(/^#/, '');
  if (![3, 4, 6, 8].includes(value.length) || !/^[\da-f]+$/i.test(value)) {
    return null;
  }

  const expanded =
    value.length <= 4
      ? [...value].map((character) => character.repeat(2)).join('')
      : value.toLowerCase();
  const hasAlpha = expanded.length === 8;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
    a: hasAlpha ? round(Number.parseInt(expanded.slice(6, 8), 16) / BYTE_MAX, 3) : 1,
  };
}

function parseFunctionalColor(input, expectedName) {
  if (typeof input !== 'string') return null;

  const match = input.trim().match(new RegExp(`^${expectedName}a?\\((.*)\\)$`, 'i'));
  if (!match) return null;

  const values = match[1]
    .replace('/', ',')
    .split(/[,\s]+/)
    .filter(Boolean);
  return values.length >= 3 ? values : null;
}

function rgbToHsl({ r, g, b, a = 1 }) {
  const red = clamp(Number(r), 0, BYTE_MAX) / BYTE_MAX;
  const green = clamp(Number(g), 0, BYTE_MAX) / BYTE_MAX;
  const blue = clamp(Number(b), 0, BYTE_MAX) / BYTE_MAX;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;

  let hue = 0;
  let saturation = 0;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    if (maximum === blue) hue = 60 * ((red - green) / delta + 4);
  }

  return {
    h: round(normalizeHue(hue)),
    s: round(saturation * 100, 1),
    l: round(lightness * 100, 1),
    a: clamp(Number(a), 0, 1),
  };
}

function rgbToHsv({ r, g, b, a = 1 }) {
  const red = clamp(Number(r), 0, BYTE_MAX) / BYTE_MAX;
  const green = clamp(Number(g), 0, BYTE_MAX) / BYTE_MAX;
  const blue = clamp(Number(b), 0, BYTE_MAX) / BYTE_MAX;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;

  let hue = 0;
  if (delta !== 0) {
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    if (maximum === blue) hue = 60 * ((red - green) / delta + 4);
  }

  return {
    h: round(normalizeHue(hue)),
    s: round((maximum === 0 ? 0 : delta / maximum) * 100, 1),
    v: round(maximum * 100, 1),
    a: clamp(Number(a), 0, 1),
  };
}

function hslToRgb({ h, s, l, a = 1 }) {
  const hue = normalizeHue(h);
  const saturation = clamp(Number(s), 0, 100) / 100;
  const lightness = clamp(Number(l), 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;

  let channels;
  if (hue < 60) channels = [chroma, secondary, 0];
  else if (hue < 120) channels = [secondary, chroma, 0];
  else if (hue < 180) channels = [0, chroma, secondary];
  else if (hue < 240) channels = [0, secondary, chroma];
  else if (hue < 300) channels = [secondary, 0, chroma];
  else channels = [chroma, 0, secondary];

  return {
    r: Math.round((channels[0] + match) * BYTE_MAX),
    g: Math.round((channels[1] + match) * BYTE_MAX),
    b: Math.round((channels[2] + match) * BYTE_MAX),
    a: clamp(Number(a), 0, 1),
  };
}

function parseRgba(input) {
  const values = parseFunctionalColor(input, 'rgb');
  if (!values) return null;

  const channel = (value) =>
    value.endsWith('%')
      ? (clamp(Number.parseFloat(value), 0, 100) / 100) * BYTE_MAX
      : clamp(Number(value), 0, BYTE_MAX);

  return {
    r: Math.round(channel(values[0])),
    g: Math.round(channel(values[1])),
    b: Math.round(channel(values[2])),
    a: values[3] === undefined ? 1 : clamp(Number(values[3]), 0, 1),
  };
}

function parseHsla(input) {
  const values = parseFunctionalColor(input, 'hsl');
  if (!values) return null;

  return {
    h: normalizeHue(values[0]),
    s: clamp(Number.parseFloat(values[1]), 0, 100),
    l: clamp(Number.parseFloat(values[2]), 0, 100),
    a: values[3] === undefined ? 1 : clamp(Number(values[3]), 0, 1),
  };
}

function interpolate(start, end, percentage) {
  return start + ((end - start) * percentage) / 100;
}

/**
 * Color conversion helpers used by the editor and its persisted palette format.
 *
 * The static API is intentionally kept compatible with older Pigmi releases so
 * existing texture files and UI components can be migrated independently.
 */
export default class LinearColorInterpolator {
  static findColorBetween(left, right, percentage, mode = 'rgb') {
    const progress = clamp(Number(percentage), 0, 100);
    const leftAlpha = Number(left?.a ?? 1);
    const rightAlpha = Number(right?.a ?? 1);

    if (mode === 'hsl') {
      const from = rgbToHsl(left);
      const to = rgbToHsl(right);
      const rgba = hslToRgb({
        h: interpolate(from.h, to.h, progress),
        s: interpolate(from.s, to.s, progress),
        l: interpolate(from.l, to.l, progress),
        a: interpolate(leftAlpha, rightAlpha, progress),
      });
      return `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${round(rgba.a, 2)})`;
    }

    const red = Math.round(interpolate(Number(left.r), Number(right.r), progress));
    const green = Math.round(interpolate(Number(left.g), Number(right.g), progress));
    const blue = Math.round(interpolate(Number(left.b), Number(right.b), progress));
    const alpha = round(interpolate(leftAlpha, rightAlpha, progress), 2);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  static hexAToRGBA(value) {
    return parseHexColor(value) ?? false;
  }

  static hexAToHSLA(value) {
    const rgba = parseHexColor(value);
    return rgba ? rgbToHsl(rgba) : false;
  }

  static hexAToHSVA(value) {
    const rgba = parseHexColor(value);
    return rgba ? rgbToHsv(rgba) : false;
  }

  static RGBAToHSLA(value) {
    const rgba = parseRgba(value);
    return rgba ? rgbToHsl(rgba) : false;
  }

  static HSLAToRGBA(value) {
    const hsla = parseHsla(value);
    return hsla ? hslToRgb(hsla) : false;
  }

  static HSLAToHexA(value) {
    const hsla = parseHsla(value);
    if (!hsla) return false;

    const rgba = hslToRgb(hsla);
    return `#${byteToHex(rgba.r)}${byteToHex(rgba.g)}${byteToHex(rgba.b)}${byteToHex(
      rgba.a * BYTE_MAX,
    )}`;
  }

  static RGBToHex(value) {
    const rgba = parseRgba(value);
    if (!rgba) return false;
    return `#${byteToHex(rgba.r)}${byteToHex(rgba.g)}${byteToHex(rgba.b)}`;
  }
}
