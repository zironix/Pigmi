import LinearColorInterpolator from '../plugins/linearColorInterpolator';

export const MATERIAL_CHANNELS = [
  'albedo',
  'roughness',
  'metallic',
  'emission',
  'clearcoat',
  'clearcoat_roughness',
  'mrc',
];

const GRAYSCALE_CHANNELS = ['roughness', 'metallic', 'clearcoat', 'clearcoat_roughness'];

function colorCss({ r, g, b, a }) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// UI fields can contain numeric strings, and changing type changes the size model.
export function normalizeCanvasItem(item) {
  const parseSize = (value) => (/^\d+$/.test(value) ? Number.parseInt(value) : value);
  if (Array.isArray(item.size)) {
    item.size[0] = parseSize(item.size[0]);
    item.size[1] = parseSize(item.size[1]);
  } else {
    item.size = parseSize(item.size);
  }
  if (item.type === 'g') {
    if (item.color_mode === 'black_to_white') item.color_mode = 'rgb';
    if (!Array.isArray(item.size)) item.size = [item.size, item.size];
    if (!item.shape) item.shape = 'l';
  } else if (item.type === 'sg' && Array.isArray(item.size)) {
    item.size = item.size[0];
  }
}

export function setMaterialStyles(contexts, item) {
  const values = {};
  for (const channel of GRAYSCALE_CHANNELS) {
    const value = ((255 / 100) * item[channel]).toFixed(2);
    values[channel] = value;
    if (contexts[channel]) contexts[channel].fillStyle = `rgb(${value}, ${value}, ${value})`;
  }
  const alpha = Math.max(((1 / 100) * item.clearcoat_roughness).toFixed(2), 0.01);
  if (contexts.mrc)
    contexts.mrc.fillStyle = `rgba(${values.metallic}, ${values.roughness}, ${values.clearcoat}, ${alpha})`;
}

/** Draw the same geometry into each export, independently of preview zoom/search. */
export function fillMaterialRect(contexts, item, rect) {
  if (item.albedo) contexts.albedo?.fillRect(...rect);
  if (item.emission === 1) {
    if (contexts.emission_crop) contexts.emission_crop.fillStyle = 'rgba(255,255,255,1)';
    contexts.emission_crop?.fillRect(...rect);
    if (item.albedo) contexts.emission?.fillRect(...rect);
    if (contexts.emission)
      contexts.emission.fillStyle = `rgba(0,0,0,${(100 - item.emission_strength) / 100})`;
    contexts.emission?.fillRect(...rect);
  }
  for (const channel of GRAYSCALE_CHANNELS) contexts[channel]?.fillRect(...rect);
  contexts.mrc?.fillRect(...rect);
}

/**
 * Visits stepped cells in paint order. Adjacent color segments share an endpoint;
 * keep that overdraw because translucent gradients depend on it.
 */
export function forEachSteppedRect(item, drawRect) {
  const horizontal = item.direction === 'horizontal';
  const drawCell = (index, color, first) => {
    const x = item.x + (horizontal ? index * item.size : 0);
    const y = item.y + (horizontal ? 0 : index * item.size);
    drawRect([x, y, item.size, item.size], color, first);
  };

  if (item.color_mode === 'black_to_white') {
    const black = { r: 0, g: 0, b: 0, a: 1 };
    const white = { r: 255, g: 255, b: 255, a: 1 };
    const color = item.colors[0].rgba;
    for (let step = 1; step <= item.steps * 2 + 1; step++) {
      const towardsColor = step <= item.steps + 1;
      const progress = towardsColor ? step : step - item.steps - 1;
      const css = LinearColorInterpolator.findColorBetween(
        towardsColor ? black : color,
        towardsColor ? color : white,
        Math.floor((100 / (item.steps + 1)) * progress),
        'rgb',
      );
      drawCell(step - 1, css, step === 1);
    }
    return;
  }

  if (item.colors.length === 1) {
    const width = horizontal ? item.size * item.steps : item.size;
    const height = horizontal ? item.size : item.size * item.steps;
    drawRect([item.x, item.y, width, height], colorCss(item.colors[0].rgba), true);
    return;
  }

  for (let segment = 1; segment < item.colors.length; segment++) {
    for (let step = 0; step < item.steps; step++) {
      const color = LinearColorInterpolator.findColorBetween(
        item.colors[segment - 1].rgba,
        item.colors[segment].rgba,
        item.steps > 1 ? Math.floor((100 / (item.steps - 1)) * step) : 0,
        item.color_mode,
      );
      drawCell(step + (segment - 1) * (item.steps - 1), color, segment === 1 && step === 0);
    }
  }
}

function createGradient(context, item, zoom, preview) {
  const coordinate = (value) => (preview ? Math.ceil(value * zoom) : value);
  const [width, height] = item.size;
  const centerX = coordinate(item.x + Number.parseInt(width) / 2);
  const centerY = coordinate(item.y + Number.parseInt(height) / 2);

  if (item.shape === 'r') {
    return context.createRadialGradient(
      centerX,
      centerY,
      0,
      centerX,
      centerY,
      coordinate(Math.min(width, height) / 2),
    );
  }
  if (item.shape === 'c') {
    // Preserve the historical angle used by saved conic gradients.
    const angle = item.direction === 'horizontal' ? 0 : 1.5708;
    return context.createConicGradient(angle, centerX, centerY);
  }
  const horizontal = item.direction === 'horizontal';
  const endX = item.x + (horizontal ? (preview ? Number.parseInt(width) : width) : 0);
  const endY = item.y + (horizontal ? 0 : preview ? Number.parseInt(height) : height);
  return context.createLinearGradient(
    coordinate(item.x),
    coordinate(item.y),
    coordinate(endX),
    coordinate(endY),
  );
}

export function setGradientStyles(previewContext, contexts, item, zoom) {
  const preview = createGradient(previewContext, item, zoom, true);
  const albedo = contexts.albedo && createGradient(contexts.albedo, item, 1, false);
  const emission = contexts.emission && createGradient(contexts.emission, item, 1, false);
  const addStop = (offset, color) => {
    for (const gradient of [preview, albedo, emission]) gradient?.addColorStop(offset, color);
  };

  if (item.color_mode === 'rgb') {
    item.colors.forEach((color, index) =>
      addStop(item.color_offsets[index] / 100, colorCss(color.rgba)),
    );
  } else {
    // Include every stop and both endpoints, interpolating each HSL segment.
    if (item.colors.length === 1) {
      addStop(0, colorCss(item.colors[0].rgba));
      addStop(1, colorCss(item.colors[0].rgba));
    } else {
      const segments = item.colors.length - 1;
      for (let segment = 0; segment < segments; segment++) {
        for (let sample = segment === 0 ? 0 : 1; sample <= 10; sample++) {
          const progress = sample / 10;
          addStop(
            (segment + progress) / segments,
            sample === 0
              ? colorCss(item.colors[segment].rgba)
              : sample === 10
                ? colorCss(item.colors[segment + 1].rgba)
                : LinearColorInterpolator.findColorBetween(
                    item.colors[segment].rgba,
                    item.colors[segment + 1].rgba,
                    progress * 100,
                    'hsl',
                  ),
          );
        }
      }
    }
  }
  previewContext.fillStyle = preview;
  if (contexts.albedo) contexts.albedo.fillStyle = albedo;
  if (contexts.emission) contexts.emission.fillStyle = emission;
}

// Read only fields that affect map pixels; selection, names, and UI state do not.
export function canvasContentSignature(texture) {
  const fields = [
    'type',
    'shape',
    'size',
    'steps',
    'x',
    'y',
    'direction',
    'color_mode',
    'colors',
    'color_offsets',
    'albedo',
    'emission',
    'emission_strength',
    'roughness',
    'metallic',
    'clearcoat',
    'clearcoat_roughness',
    'visible',
  ];
  return JSON.stringify([
    texture.width,
    texture.height,
    texture.items.map((item) => fields.map((field) => item[field])),
    MATERIAL_CHANNELS.map((channel) => texture[`save_${channel}`]),
  ]);
}
