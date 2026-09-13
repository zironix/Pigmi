import { describe, expect, it, vi } from 'vitest';
import ColorPicker from '../src/components/Colorpicker2.vue';

function setup() {
  const context = {
    ...ColorPicker.data(),
    $emit: vi.fn(),
    $nextTick: (callback) => Promise.resolve().then(callback),
  };
  for (const [name, method] of Object.entries(ColorPicker.methods))
    context[name] = method.bind(context);
  return context;
}

describe('color picker synchronization', () => {
  it('releases the update guard after invalid HEX input', async () => {
    const picker = setup();
    picker.color.hex = '#zz';
    picker.makeColors('hex');
    await Promise.resolve();
    expect(picker.ignoreNextUpdate).toBe(false);
    expect(picker.$emit).not.toHaveBeenCalled();
    ColorPicker.watch.hsva.handler.call(picker, { h: 120, s: 100, v: 100, a: 0.5 });
    expect(picker.color.rgb).toEqual({ r: 0, g: 255, b: 0 });
    expect(picker.color.hex).toBe('#00ff0080');
    expect(picker.$emit).not.toHaveBeenCalled();
  });

  it.each(['hsv', 'hsl', 'rgb', 'hex'])(
    'publishes each color representation once for %s edits',
    async (space) => {
      const picker = setup();
      picker.color.hex = '#00ff00';
      picker.makeColors(space);
      expect(picker.$emit.mock.calls.map(([name]) => name)).toEqual(['update:rgba', 'update:hsva']);
      await Promise.resolve();
      expect(picker.ignoreNextUpdate).toBe(false);
    },
  );
});
