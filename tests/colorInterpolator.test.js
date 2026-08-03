import { describe, expect, it } from 'vitest';

import LinearColorInterpolator from '../src/plugins/linearColorInterpolator';

describe('LinearColorInterpolator', () => {
  it('parses short and alpha hex colors', () => {
    expect(LinearColorInterpolator.hexAToRGBA('#0f08')).toEqual({
      r: 0,
      g: 255,
      b: 0,
      a: 0.533,
    });
    expect(LinearColorInterpolator.hexAToRGBA('#336699')).toEqual({
      r: 51,
      g: 102,
      b: 153,
      a: 1,
    });
  });

  it('round-trips HSLA through RGBA and hex', () => {
    expect(LinearColorInterpolator.HSLAToRGBA('hsla(120, 100%, 25%, 0.5)')).toEqual({
      r: 0,
      g: 128,
      b: 0,
      a: 0.5,
    });
    expect(LinearColorInterpolator.HSLAToHexA('hsla(120, 100%, 25%, 0.5)')).toBe('#00800080');
  });

  it('interpolates RGB channels and alpha', () => {
    expect(
      LinearColorInterpolator.findColorBetween(
        { r: 0, g: 10, b: 20, a: 0 },
        { r: 100, g: 110, b: 120, a: 1 },
        50,
        'rgb',
      ),
    ).toBe('rgba(50, 60, 70, 0.5)');
  });

  it('rejects malformed colors without throwing', () => {
    expect(LinearColorInterpolator.hexAToRGBA('#nope')).toBe(false);
    expect(LinearColorInterpolator.RGBToHex('not-a-color')).toBe(false);
  });
});
