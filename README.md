# Pigmi

<p align="center">
  <img src="src/assets/icons/icon.png" width="128" alt="Pigmi logo">
</p>

<p align="center">
  A desktop editor for texture palettes, gradient atlases, and PBR material maps.
</p>

<p align="center">
  <a href="https://github.com/zironix/Pigmi/releases/latest">Download</a> ·
  <a href="docs/editor-guide.md">Editor guide</a> ·
  <a href="docs/mcp.md">Connect an AI client</a> ·
  <a href="https://github.com/zironix/Pigmi/issues">Report an issue</a>
</p>

Create gradients, arrange them on a snapping canvas, and export color and material maps for your
assets. Pigmi stores documents as readable JSON files in a folder you choose. It runs on macOS,
Windows, and Linux.

## Features

- **Gradients:** smooth linear, radial, and conic gradients; stepped rows and columns; RGB and HSL
  interpolation; editable color stops and opacity.
- **Layers:** nested folders, multi-selection, drag-and-drop ordering, visibility, isolation,
  copy/paste, and name search that reveals matching branches.
- **Materials:** albedo, roughness, metallic, emission, clearcoat, and clearcoat roughness.
- **Export:** PNG or WebP for each enabled map, plus packed MRC output. Synchronize the JSON
  document and exports automatically as you edit.
- **Palette generation:** generate colors through Huemint while preserving locked stops.
- **MCP:** let a compatible AI client inspect and edit the open document through local tools.

## Download

Get the application from [GitHub Releases](https://github.com/zironix/Pigmi/releases/latest).
Choose the file for your operating system and processor:

| Platform            | Release packages |
| ------------------- | ---------------- |
| macOS Apple Silicon | ARM64 ZIP        |
| macOS Intel         | x64 ZIP          |
| Windows x64         | EXE installer    |
| Linux x64           | AppImage or DEB  |

The current release configuration uses ad-hoc signing on macOS and no Windows Authenticode
signing. These builds are not notarized by Apple; the operating system may show a security prompt.

Node.js is needed for development and the MCP adapter, not for ordinary use of the packaged editor.

## Quick start

1. Open texture settings and choose a project folder.
2. Enter a texture name and click **Create**, then **Overwrite and sync** and confirm to save the
   current canvas there. To open an existing JSON document, select it and click **Load and sync**.
3. Click empty canvas space to create an item. Edit its gradient, colors, size, and material values
   in the sidebars.
4. Arrange items on the canvas or in the layer tree. Use **Search** in the title bar to find items
   and folders by name.
5. Choose the maps and PNG/WebP formats you need in texture settings. While synchronized, changes
   update the document and enabled exports automatically.

**Create** makes an empty JSON file; synchronization is what saves the editor content into it.
**Desynchronize** stops automatic writes without clearing the canvas.

See the [editor guide](docs/editor-guide.md) for shortcuts, color gestures, folder behavior,
palette generation, and mix textures.

## Material maps

Exports are written beside the document using its name, for example:

```text
palette.json
palette_albedo.png
palette_roughness.png
palette_metallic.png
palette_emission.png
palette_clearcoat.png
palette_clearcoat_roughness.png
palette_mrc.png
```

Only enabled maps are exported; maps set to WebP use `.webp` instead of `.png`.
The packed MRC map stores **metallic in R, roughness in G, clearcoat in B, and clearcoat roughness
in A**. See [export details](docs/editor-guide.md#pbr-materials-and-export) for values and mix textures.

## AI clients and MCP

Pigmi includes a local STDIO MCP adapter. The AI model and account come from your chosen client.

1. Keep Pigmi running with a document open.
2. Open the **MCP / Connect AI client** page using the plug icon in the left sidebar.
3. Copy the generated configuration for your client. It contains the correct server and connection
   paths for this installation.
4. Reload the client's MCP configuration and ask it to inspect the open Pigmi document.

The adapter requires Node.js. Pigmi generates a CLI command and TOML for Codex, JSON for Claude
Desktop, and connection fields for other STDIO clients.

[Connection guide and troubleshooting →](docs/mcp.md)

## Development

Use Node.js 22.12+ and npm 10+. The exact supported Node.js range is recorded in
[package.json](package.json).

```bash
git clone https://github.com/zironix/Pigmi.git
cd Pigmi
npm ci
npm start
```

| Command                | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `npm test`             | Run tests                                         |
| `npm run lint`         | Check code with ESLint                            |
| `npm run format:check` | Check formatting                                  |
| `npm run build:mcp`    | Bundle the MCP adapter                            |
| `npm run package`      | Package the app for the current platform          |
| `npm run make`         | Build distributable packages                      |
| `npm run check`        | Run formatting checks, lint, tests, and packaging |

- [Code guide](docs/code-guide.md) — where to find each part of the application.
- [Architecture](docs/architecture.md) — processes, file access, and the MCP protocol.
- [Building and releases](docs/building.md) — platform packages and release workflow.
- [Contributing](CONTRIBUTING.md) — development and pull request guidelines.

## Network access

Editing and exporting work locally. Palette generation sends palette constraints to Huemint;
update checks contact GitHub Releases. The MCP adapter connects to Pigmi over localhost, while the
AI client controls its own provider connections and the document data it sends to its model.

Report vulnerabilities through [SECURITY.md](SECURITY.md).

## License

Pigmi is source-available under the [PolyForm Perimeter License 1.0.1](LICENSE). You may inspect,
use, and modify the source, including for commercial work. You may not use Pigmi's source to
provide a product or service that competes with Pigmi—for example, a renamed, rebranded, ported,
hosted, or otherwise repackaged substitute—without a separate license from the author. This
restriction applies whether the competing product is sold or provided free of charge. Contact
`ziritix@gmail.com` for separate licensing.

The Pigmi software license does not claim rights over textures, palettes, material maps, images,
or other content that users create with Pigmi. Such output may be used commercially, subject to
the rights in the user's own inputs and any third-party assets they use.

Because distribution of competing products is restricted, Pigmi is source-available rather than
OSI-approved open-source software. Bundled dependencies, fonts, and icons retain their own
licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
