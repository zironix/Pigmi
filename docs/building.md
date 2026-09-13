# Building and releasing Pigmi

[Back to README](../README.md) · [Source setup](../README.md#development)

## Building for macOS, Windows, and Linux

Build an unpacked application for the current operating system:

```bash
npm ci
npm run package
```

Build the distributable formats configured for the current operating system:

```bash
npm run make
```

| Platform | Configured output                                   |
| -------- | --------------------------------------------------- |
| macOS    | Application bundle and ZIP archive                  |
| Windows  | Application directory and Squirrel installer        |
| Linux    | Application directory, AppImage, and Debian package |

Electron applications should be built natively on their target operating system. The GitHub
Actions matrix runs `npm run package` on macOS, Windows, and Linux for every branch and pull
request, so platform-specific packaging regressions are caught independently.

Linux Debian packaging may require `fakeroot` and `dpkg` when they are not already installed:

```bash
sudo apt-get install fakeroot dpkg
```

macOS bundles receive a final ad-hoc signature so their metadata and sealed resources remain
internally consistent. Hardened Runtime is intentionally disabled for these unsigned builds:
ad-hoc signatures do not provide the common Apple Team ID required by Electron Framework during
App Translocation. Apple Developer ID signing, notarization, and Windows Authenticode signing are
separate release concerns and are not configured in the public repository.

## Publishing a GitHub release

The repository includes an automated release workflow that builds downloadable applications on
native GitHub-hosted runners and attaches them to a GitHub Release. It produces:

- a Windows x64 Squirrel installer (`.exe`);
- macOS ZIP archives for Apple Silicon and Intel;
- Linux x64 AppImage and Debian packages (`.AppImage` and `.deb`).

To publish a version:

1. Update `version` in both `package.json` and `package-lock.json`. Running
   `npm version patch --no-git-tag-version` updates both files together.
2. Commit and push the version change to `main`.
3. Open **Actions → Release** on GitHub, select **Run workflow**, choose `main`, and confirm.
4. Wait for all four platform builds. When they succeed, the workflow creates the matching tag,
   generates release notes, and publishes the binaries under **Releases**.

For a tag-driven release, push a tag that exactly matches the package version (`vX.Y.Z`).
The same workflow starts automatically. A mismatched tag fails before any packages are published.

macOS bundles are ad-hoc signed and verified before upload. CI also ensures that Hardened Runtime
is not accidentally enabled without a Developer ID, which would make Electron Framework fail to
load on a quarantined app. These builds are not Apple Developer ID signed or notarized, so
Gatekeeper may still require approval under **System Settings → Privacy & Security → Open Anyway**
after the first launch. Windows builds are not Authenticode-signed, so SmartScreen may also show a
warning.

## Development

```bash
npm run mcp           # run the development MCP server on stdio
npm run build:mcp     # build the standalone MCP bundle
npm run lint          # run ESLint
npm run lint:fix      # apply safe ESLint fixes
npm run format        # format supported files with Prettier
npm run format:check  # verify formatting
npm test              # run Vitest once
npm run package       # package for the current platform
npm run make          # create current-platform distributables
npm run check         # formatting, lint, tests, and packaging
```

### Project structure

```text
mcp/             Standalone MCP server, bridge client, and operation reference
src/
  ai/            Provider-neutral document reads, operations, and executor
  app/           Vue application controller and focused method modules
  components/    Color picker and layer-tree components
  main/          Electron lifecycle, local MCP bridge, native window, and IPC
  shared/        Contracts and path helpers shared by Electron processes
  stores/        Pinia layer-selection state
  styles/        Application styles
  utils/         Framework-independent input and arithmetic helpers
tests/           Unit and integration tests
docs/            Architecture documentation
```

Contributions are welcome. Read [CONTRIBUTING.md](../CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) before opening a pull request. Report vulnerabilities
according to [SECURITY.md](../SECURITY.md), not through a public issue.
