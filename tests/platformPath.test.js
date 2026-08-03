import { describe, expect, it } from 'vitest';

import { createPathHelpers } from '../src/shared/platformPath';

describe('sandbox-safe path helpers', () => {
  it('joins POSIX paths', () => {
    const path = createPathHelpers('darwin');

    expect(path.separator).toBe('/');
    expect(path.joinPath('/Users/oleg/', '/textures', 'palette.json')).toBe(
      '/Users/oleg/textures/palette.json',
    );
  });

  it('joins Windows paths and normalizes separators', () => {
    const path = createPathHelpers('win32');

    expect(path.separator).toBe('\\');
    expect(path.joinPath('C:\\Textures\\', '/Pigmi', 'palette.json')).toBe(
      'C:\\Textures\\Pigmi\\palette.json',
    );
  });

  it('preserves a single root path', () => {
    expect(createPathHelpers('linux').joinPath('/')).toBe('/');
    expect(createPathHelpers('win32').joinPath('C:\\')).toBe('C:\\');
  });
});
