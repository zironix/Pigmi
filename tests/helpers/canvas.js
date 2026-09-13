import { vi } from 'vitest';
import { canvasRenderMethods } from '../../src/app/methods/canvasRenderMethods';
import { MATERIAL_CHANNELS } from '../../src/utils/canvasRendering';

function recordingContext() {
  const commands = [];
  const gradient = (type, args) => {
    const result = { type, coordinates: args.map(Number), stops: [] };
    return { ...result, addColorStop: (offset, color) => result.stops.push([offset, color]) };
  };
  return {
    commands,
    fillStyle: '#000',
    clearRect(...args) {
      commands.push({ clear: args.map(Number) });
    },
    fillRect(...args) {
      // Canvas accepts both numbers and numeric strings.
      commands.push({ rect: args.map(Number), style: JSON.parse(JSON.stringify(this.fillStyle)) });
    },
    createLinearGradient(...args) {
      return gradient('linear', args);
    },
    createRadialGradient(...args) {
      return gradient('radial', args);
    },
    createConicGradient(...args) {
      return gradient('conic', args);
    },
  };
}

export function makeItem(overrides = {}) {
  return {
    id: 1,
    name: 'Test',
    type: 'sg',
    shape: 'l',
    size: 8,
    steps: 3,
    x: 16,
    y: 24,
    direction: 'horizontal',
    color_mode: 'rgb',
    colors: [{ rgba: { r: 255, g: 0, b: 0, a: 0.5 } }, { rgba: { r: 0, g: 0, b: 255, a: 1 } }],
    color_offsets: [0, 100],
    albedo: 1,
    emission: 1,
    emission_strength: 80,
    roughness: 50,
    metallic: 25,
    clearcoat: 10,
    clearcoat_roughness: 0,
    ...overrides,
  };
}

export function renderContext(items, options = {}) {
  const context = {
    ...canvasRenderMethods,
    texture: { width: 256, height: 128, items },
    finalZoom: 1.5,
    search: '',
    ctx: recordingContext(),
    ls: { selected: [1], active_id: 1 },
    drawSelectionCircle: vi.fn(),
    save: vi.fn(),
    ...options,
  };
  for (const channel of [...MATERIAL_CHANNELS, 'emission_crop']) {
    context[`ctx_${channel}`] = recordingContext();
  }
  return context;
}

export function renderCommands(context) {
  return Object.fromEntries(
    Object.entries(context)
      .filter(([key]) => key === 'ctx' || key.startsWith('ctx_'))
      .map(([key, value]) => [key, value.commands]),
  );
}
