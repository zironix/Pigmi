import { canvasInteractionMethods } from '../src/app/methods/canvasInteractionMethods';
import { describe, expect, it, vi } from 'vitest';

import {
  calculateAnchoredCanvasPosition,
  classifyWheelInput,
  wheelZoomTarget,
  approachZoom,
} from '../src/utils/wheelInput';

describe('wheel input classification', () => {
  it('treats precise macOS trackpad scrolling as canvas panning', () => {
    expect(classifyWheelInput({ platform: 'darwin', deltaMode: 0, deltaY: 4.25 })).toBe('pan');
    expect(classifyWheelInput({ platform: 'darwin', deltaMode: 0, deltaX: 3, deltaY: 95 })).toBe(
      'pan',
    );
  });

  it('keeps a conventional mouse wheel as zoom', () => {
    expect(classifyWheelInput({ platform: 'darwin', deltaMode: 0, deltaY: 100 })).toBe('zoom');
    expect(classifyWheelInput({ platform: 'darwin', deltaMode: 0, deltaY: 4 })).toBe('zoom');
    expect(
      classifyWheelInput({
        platform: 'darwin',
        deltaMode: 0,
        deltaY: 4,
        wheelDeltaY: -120,
      }),
    ).toBe('zoom');
    expect(classifyWheelInput({ platform: 'darwin', deltaMode: 1, deltaY: 3 })).toBe('zoom');
    expect(classifyWheelInput({ platform: 'win32', deltaMode: 0, deltaY: 4 })).toBe('zoom');
  });

  it('uses pinch and modifier-assisted scrolling for zoom', () => {
    expect(classifyWheelInput({ platform: 'darwin', deltaMode: 0, deltaY: 2, ctrlKey: true })).toBe(
      'zoom',
    );
    expect(classifyWheelInput({ platform: 'darwin', deltaMode: 0, deltaY: 2, metaKey: true })).toBe(
      'zoom',
    );
  });
});

describe('cursor-anchored canvas zoom', () => {
  it('keeps the logical point below the cursor stationary', () => {
    const position = calculateAnchoredCanvasPosition({
      cursorX: 500,
      cursorY: 350,
      canvasLeft: 200,
      canvasTop: 100,
      containerLeft: 20,
      containerTop: 30,
      oldScale: 1,
      newScale: 2,
    });

    expect(position).toEqual({ left: -120, top: -180 });
  });

  it('accounts for the container offset and scroll position', () => {
    const position = calculateAnchoredCanvasPosition({
      cursorX: 300,
      cursorY: 250,
      canvasLeft: 150,
      canvasTop: 150,
      containerLeft: 50,
      containerTop: 40,
      containerScrollLeft: 25,
      containerScrollTop: 10,
      oldScale: 1,
      newScale: 0.5,
    });

    expect(position).toEqual({ left: 200, top: 170 });
  });
});

describe('smooth zoom', () => {
  it('uses proportional reversible steps and normalizes wheel units', () => {
    const event = { deltaY: -48, deltaMode: 0 };
    const target = wheelZoomTarget(1, event);
    expect(wheelZoomTarget(4, event) / 4).toBeCloseTo(target);
    expect(wheelZoomTarget(target, { ...event, deltaY: 48 })).toBeCloseTo(1);
    expect(wheelZoomTarget(1, { deltaY: -3, deltaMode: 1 })).toBeCloseTo(target);
    expect(wheelZoomTarget(1, { deltaY: 0 })).toBe(1);
    expect(wheelZoomTarget(101, event)).toBe(101);
    expect(wheelZoomTarget(0.01, { deltaY: 100 })).toBe(0.01);
  });
  it('eases without overshoot and gives the same result at different frame rates', () => {
    const halfway = approachZoom(1, 2, 16);
    expect(halfway).toBeGreaterThan(1);
    expect(halfway).toBeLessThan(2);
    expect(approachZoom(halfway, 2, 16)).toBeCloseTo(approachZoom(1, 2, 32));
    expect(approachZoom(1, 2, 1000)).toBe(2);
  });
});

it.each([true, false])('keeps the chosen zoom anchor (centered=%s)', (centered) => {
  let frame;
  vi.stubGlobal('requestAnimationFrame', (callback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const context = {
    ...canvasInteractionMethods,
    texture: { zoom: 0, zoom_speed: 50, center_locked: centered },
    get finalZoom() {
      return this.texture.zoom / 100 + 1;
    },
    canvasPos: { left: 100, top: 50 },
    $refs: {
      texture: {},
      canvasContainer: {
        scrollLeft: 0,
        scrollTop: 0,
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      },
    },
    getWheelGestureMode: () => 'zoom',
  };
  try {
    context.mousewheel({
      preventDefault() {},
      deltaY: -100,
      deltaMode: 0,
      clientX: 300,
      clientY: 200,
    });
    frame(performance.now() + 1000);
    expect(context.finalZoom).toBeGreaterThan(1);
    expect(context.texture.center_locked).toBe(centered);
    if (centered) expect(context.canvasPos).toEqual({ left: 100, top: 50 });
    else {
      expect((300 - context.canvasPos.left) / context.finalZoom).toBeCloseTo(200);
      expect((200 - context.canvasPos.top) / context.finalZoom).toBeCloseTo(150);
    }
  } finally {
    context.stopZoomAnimation();
    vi.unstubAllGlobals();
  }
});
