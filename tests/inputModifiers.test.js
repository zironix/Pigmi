import { describe, expect, it } from 'vitest';

import { isPlatformDeleteKey, isPlatformPrimaryModifier } from '../src/utils/inputModifiers';

describe('platform selection modifier', () => {
  it('uses Command on macOS', () => {
    expect(isPlatformPrimaryModifier({ platform: 'darwin', metaKey: true })).toBe(true);
    expect(isPlatformPrimaryModifier({ platform: 'darwin', ctrlKey: true })).toBe(false);
  });

  it('uses Control on Windows and Linux', () => {
    expect(isPlatformPrimaryModifier({ platform: 'win32', ctrlKey: true })).toBe(true);
    expect(isPlatformPrimaryModifier({ platform: 'linux', ctrlKey: true })).toBe(true);
    expect(isPlatformPrimaryModifier({ platform: 'win32', metaKey: true })).toBe(false);
  });
});

describe('platform delete key', () => {
  it('accepts the forward Delete key on every platform', () => {
    expect(isPlatformDeleteKey({ platform: 'darwin', code: 'Delete' })).toBe(true);
    expect(isPlatformDeleteKey({ platform: 'win32', code: 'Delete' })).toBe(true);
  });

  it('accepts Backspace only as the macOS layer-delete shortcut', () => {
    expect(isPlatformDeleteKey({ platform: 'darwin', code: 'Backspace' })).toBe(true);
    expect(isPlatformDeleteKey({ platform: 'win32', code: 'Backspace' })).toBe(false);
  });
});
