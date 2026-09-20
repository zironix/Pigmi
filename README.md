# Pigmi

<p align="center">
  <img src="src/assets/icons/icon.png" width="128" alt="Pigmi logo">
</p>

<p align="center">
  A desktop editor for texture palettes, gradient atlases, and PBR material maps.
</p>

<p align="center">
  <a href="https://pigmi.ru">Website</a> ·
  <a href="https://github.com/zironix/Pigmi/releases/latest">Download</a> ·
  <a href="docs/editor-guide.md">Editor guide</a> ·
  <a href="#blender-add-ons">Blender add-ons</a> ·
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
2. To open an existing JSON document, select it and click **Load and sync**. To save the current
   canvas as a new document, enter a name and click **Create texture**. Both enable automatic saving.
3. Click empty canvas space to create an item. Edit its gradient, colors, size, and material values
   in the sidebars.
4. Arrange items on the canvas or in the layer tree. Use **Search** in the title bar to find items
   and folders by name.
5. Choose the maps and PNG/WebP formats you need in texture settings. While synchronized, changes
   update the document and enabled exports automatically.

**Create texture** saves the current canvas under a new name; existing files are never replaced by
this action. Use **Overwrite and sync** and confirm only when you want to replace a selected
document with the current canvas. **Desynchronize** stops automatic writes without clearing it.

See the [editor guide](docs/editor-guide.md) for shortcuts, color gestures, folder behavior,
palette generation, and mix textures.

## Canvas navigation and box selection

The canvas fills the workspace behind the floating panels and has no scrollbars. Drag with the
middle mouse button to pan, including from the empty workspace. The center button returns the
canvas to the center of the window. Zoom stays centered while center lock is on and follows the
cursor after panning.

| Gesture                                          | Action                                                |
| ------------------------------------------------ | ----------------------------------------------------- |
| Shift + left-button drag                         | Replace selection with items touched by the box       |
| Shift + Ctrl + left-button drag (⌘ on macOS)     | Add items to the selection                            |
| Shift + Alt + left-button drag (Option on macOS) | Subtract items from the selection                     |
| Esc during box selection                         | Cancel the gesture and restore the previous selection |
| Ctrl / ⌘ + wheel                                 | Zoom                                                  |

Start a selection box on the texture or the surrounding workspace. Hidden items are excluded.
A plain left click on empty texture space still creates an item. Selected items move with a short
visual animation between snapped positions; saved coordinates and exported maps remain exact.

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

## Blender add-ons

[Pigmi Helpers](Pigmi%20Helpers) contains three optional Blender add-ons for working with palette
textures, vertex colors, and mesh parts. Each is a separate Python file.

### UV to Palette

[Download / source](Pigmi%20Helpers/pigmi_uv2palette.py)

Move selected UVs into palette cells and map gradients onto a mesh using drawn paths, radial
mapping, or distance. Includes texture and cell dimensions, margins, and cavity / fake AO controls
for mapping surface detail into a palette gradient. The panel is in the 3D View sidebar under
**Snap UV**.

### Highlighter

[Download / source](Pigmi%20Helpers/pigmi_highlighter.py)

Apply vertex colors using a reusable color palette, with quick white, black, and transparent fills.
Preview changes, then use **Save** to commit or **Restore** to discard the preview. The
**Pigmi: Highlighter** panel is in the 3D View sidebar under **Tool**.

### Face to Face

[Download / source](Pigmi%20Helpers/pigmi_face2face.py)

Save a selected mesh part relative to a base face or edge, then attach it to another face or edge.
Adjust rotation, flip, scale, and edge mirroring, or create copies on multiple selected targets.
The **Pigmi: Face to Face** panel is in the 3D View sidebar under **Tool**.

Download the desired `.py` file using GitHub's **Download raw file** action and install it through
Blender's add-on preferences, then enable it. The files declare Blender **5.0** for UV to Palette
and Highlighter, and **4.3** for Face to Face; these are their declared minimum versions, not a
claim that every later Blender release has been tested.

## AI clients and MCP

Pigmi includes a local STDIO MCP adapter. The AI model and account come from your chosen client.

1. Keep Pigmi running with a document open.
2. Open the **MCP / Connect AI client** page using the plug icon in the bottom-left tab bar.
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
