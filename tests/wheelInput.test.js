import { describe, expect, it } from 'vitest';

import { calculateAnchoredCanvasPosition, classifyWheelInput } from '../src/utils/wheelInput';

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
