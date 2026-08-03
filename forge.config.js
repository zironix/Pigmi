const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');
const path = require('path');

module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: [
      path.join(__dirname, 'build', 'mcp'),
      path.join(__dirname, 'LICENSE'),
      path.join(__dirname, 'THIRD_PARTY_NOTICES.md'),
    ],
    icon: path.join(__dirname, 'src', 'assets', 'icons', 'icon'),
    appCopyright: 'Copyright © 2026 Oleg Pavlov',
    executableName: 'Pigmi',
    appBundleId: 'com.zironix.pigmi',
    osxSign: {
      identity: '-',
      identityValidation: false,
      preAutoEntitlements: false,
      timestamp: 'none',
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'Pigmi',
        productName: 'Pigmi',
        shortcutName: 'Pigmi',
        setupIcon: path.join(__dirname, 'src', 'assets', 'icons', 'icon.ico'),
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
    },
    {
      name: '@reforged/maker-appimage',
      platforms: ['linux'],
      config: {
        options: {
          name: 'pigmi',
          productName: 'Pigmi',
          bin: 'Pigmi',
          genericName: 'Texture Palette Editor',
          categories: ['Graphics'],
          icon: path.join(__dirname, 'src', 'assets', 'icons', 'icon.png'),
        },
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'pigmi',
          productName: 'Pigmi',
          bin: 'Pigmi',
          genericName: 'Texture Palette Editor',
          description: 'Cross-platform texture palette and PBR material map editor',
          section: 'graphics',
          priority: 'optional',
          categories: ['Graphics'],
          maintainer: 'Oleg <ziritix@gmail.com>',
          homepage: 'https://github.com/zironix/Pigmi',
          icon: path.join(__dirname, 'src', 'assets', 'icons', 'icon.png'),
        },
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-vite',
      config: {
        build: [
          {
            entry: 'src/main.js',
            config: 'vite.main.config.mjs',
            target: 'main',
          },
          {
            entry: 'src/preload.js',
            config: 'vite.preload.config.mjs',
            target: 'preload',
          },
        ],
        renderer: [
          {
            name: 'main_window',
            config: 'vite.renderer.config.mjs',
          },
        ],
      },
    },
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
