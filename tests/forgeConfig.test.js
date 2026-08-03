import { describe, expect, it } from 'vitest';

import forgeConfig from '../forge.config';

function maker(name) {
  return forgeConfig.makers.find((entry) => entry.name === name);
}

describe('Electron Forge configuration', () => {
  it('ad-hoc signs every macOS component without Hardened Runtime', () => {
    const signing = forgeConfig.packagerConfig.osxSign;

    expect(signing).toMatchObject({
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      timestamp: 'none',
    });
    expect(signing.optionsForFile('/Applications/Pigmi.app')).toEqual({
      hardenedRuntime: false,
    });
  });

  it('uses the packaged executable name in Linux distributables', () => {
    const executableName = forgeConfig.packagerConfig.executableName;

    expect(maker('@reforged/maker-appimage').config.options.bin).toBe(executableName);
    expect(maker('@electron-forge/maker-deb').config.options.bin).toBe(executableName);
  });

  it('keeps Linux package metadata and icons inside maker options', () => {
    const appImageOptions = maker('@reforged/maker-appimage').config.options;
    const debOptions = maker('@electron-forge/maker-deb').config.options;

    expect(appImageOptions).toMatchObject({
      categories: ['Graphics'],
      name: 'pigmi',
      productName: 'Pigmi',
    });
    expect(debOptions).toMatchObject({
      categories: ['Graphics'],
      name: 'pigmi',
      productName: 'Pigmi',
      section: 'graphics',
    });
    expect(appImageOptions.icon).toMatch(/icon\.png$/);
    expect(debOptions.icon).toMatch(/icon\.png$/);
  });
});
