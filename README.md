# Pigmi

<p align="center">
  <img src="src/assets/icons/icon.png" width="160" alt="Pigmi logo">
</p>

<p align="center">
  A focused desktop editor for building texture palettes, gradient atlases, and PBR material maps.
</p>

Pigmi combines a visual canvas, an ordered layer tree, a full color editor, procedural palette
generation, automatic map export, and optional AI automation through the open Model Context
Protocol (MCP). Projects stay as readable JSON files and can be exported to PNG or WebP for use in
games, rendering, UI work, and other visual pipelines.

Pigmi runs on macOS, Windows, and Linux.

## Contents

- [What Pigmi can do](#what-pigmi-can-do)
- [Editor workflow](#editor-workflow)
- [Items and gradients](#items-and-gradients)
- [Color editing](#color-editing)
- [Layers](#layers)
- [PBR materials and export](#pbr-materials-and-export)
- [Projects and automatic saving](#projects-and-automatic-saving)
- [Palette generation](#palette-generation)
- [Controls and shortcuts](#controls-and-shortcuts)
- [MCP automation](#mcp-automation)
- [Running from source](#running-from-source)
- [Building for macOS, Windows, and Linux](#building-for-macos-windows-and-linux)
- [Publishing a GitHub release](#publishing-a-github-release)
- [Development](#development)
- [Network and security](#network-and-security)
- [License](#license)

## What Pigmi can do

- Build compact color atlases directly on a snapping canvas.
- Create smooth linear, radial, and conic gradients.
- Create stepped horizontal or vertical gradients for stylized and low-poly workflows.
- Interpolate colors in RGB or HSL, including stepped black-to-color-to-white ramps.
- Edit stops in HSV, HSL, RGB, HEX, and alpha representations.
- Organize items into nested folders with multi-selection, visibility, isolation, renaming, and
  drag-and-drop ordering.
- Assign albedo, roughness, metallic, emission, clearcoat, clearcoat roughness, and opacity.
- Export separate material maps or a packed MRC map.
- Keep project JSON and exported images synchronized automatically.
- Generate palettes through Huemint while preserving selected locked colors.
- Let any compatible AI client inspect and edit the active document through the bundled MCP
  server.

## Editor workflow

1. Open the texture settings tab and choose a project folder.
2. Enter a texture name and create a JSON document, or select an existing document and choose
   **Load and sync**.
3. Left-click an empty point on the canvas to create the first item.
4. Configure the item type, size, gradient, colors, and material properties.
5. Duplicate, arrange, group, and edit items through the canvas and layer tree.
6. Enable the maps and formats you need. While synchronization is active, Pigmi automatically
   updates the JSON document and enabled exports after changes.

The left sidebar contains item settings, layers, texture/export settings, palette-generation
settings, and MCP connection information. The right sidebar contains the color stops for the
active item. Both sidebars can be locked, and the left sidebar can be resized. Item settings and
the layer tree can also be shown as a resizable split view.

## Items and gradients

Pigmi has two item types:

| Type            | Purpose                           | Size model                    | Available shapes      |
| --------------- | --------------------------------- | ----------------------------- | --------------------- |
| Smooth gradient | A continuous gradient rectangle   | Independent width and height  | Linear, radial, conic |
| Step gradient   | A row or column of discrete cells | Cell size and number of steps | Linear stepped layout |

Each item also has:

- a name and canvas position;
- horizontal or vertical direction;
- RGB or HSL interpolation;
- color stops and, for smooth RGB gradients, editable stop offsets;
- per-item albedo and PBR material values;
- visibility and layer-tree placement.

Step gradients can use **Black To White** mode. It builds a ramp from black through the selected
color to white, which is useful for value studies, stylized shading, and low-poly material sets.

Canvas positions snap to the configured grid step. The **Mass resize** control adds the entered
value to every item's dimensions and updates its grid-aligned position.

## Color editing

Every color stop includes:

- a saturation/value area;
- hue and alpha sliders;
- HSV, HSL, RGB, and HEX input modes;
- an eyedropper opened by clicking the color preview;
- a lock used by generated palettes;
- a drag handle for reordering;
- a remove button.

Click the mode label (`HSV`, `HSL`, `RGB`, or `HEX`) to cycle the input representation. Scrolling
over a numeric color field adjusts it in small increments. Numeric color fields also accept basic
arithmetic such as `255 / 2`, `(20 + 40) * 2`, or `100 - 15`; press `Enter` to evaluate it.

### Color power gestures

In this section, **Primary** means `⌘ Command` on macOS and `Ctrl` on Windows/Linux.

| Action                                         | Result                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| Primary-click an HSV, HSL, RGB, or alpha value | Apply that single component to every color stop in the active item |
| Click the plus button                          | Duplicate the last color stop                                      |
| Primary-click the plus button                  | Duplicate the last stop and evenly redistribute all stop offsets   |
| Click a color's remove button                  | Remove the stop                                                    |
| Primary-click a color's remove button          | Remove the stop and evenly redistribute the remaining offsets      |
| Drag the bars beside a color                   | Change the stop order                                              |
| Click a color lock                             | Preserve that color during Huemint generation                      |

For smooth RGB gradients, the horizontal stop editor above the canvas controls each stop's exact
position from 0 to 100 percent.

## Layers

The layer tree mirrors the order of items on the canvas and supports nested folders.

- Click an item to select it.
- Click a folder to select its contents.
- Primary-click items or folders to extend or reduce a multi-selection.
- Shift-click selects a range of sibling layers; when the target is outside the anchor's level, it
  is added to the current selection.
- Double-click an item or folder name to rename it. Press `Enter` to confirm or `Escape` to cancel.
- Drag layers above, below, or into folders to reorder the document.
- Dragging one member of a multi-selection moves the selected group together.
- Click an item preview or folder eye to toggle visibility.
- Alt-click a visibility control to isolate that item or folder branch; Alt-click again to restore
  the automatically hidden layers.
- Click a non-empty folder icon to collapse or expand it.
- Use the folder button to create a root folder and the trash button to delete the current
  selection.

Copy and paste preserve folders, child items, colors, materials, and relative positions. When the
pointer was last over the canvas, pasted items are anchored there and snapped to the grid.
Otherwise Pigmi places them near the active layer and searches for free canvas space.

## PBR materials and export

Material values are stored per item, so a single atlas can describe multiple surfaces.

| Property            | Meaning                                                  |
| ------------------- | -------------------------------------------------------- |
| Albedo              | Includes or excludes the item from the albedo map        |
| Roughness           | Grayscale roughness value from 0 to 100                  |
| Metallic            | Grayscale metallic value from 0 to 100                   |
| Emission            | Enables the item in the emission map                     |
| Emission strength   | Controls emissive intensity from 0 to 100                |
| Clearcoat           | Grayscale clearcoat amount from 0 to 100                 |
| Clearcoat roughness | Grayscale roughness of the clearcoat layer from 0 to 100 |
| Opacity             | Alpha stored on each individual color stop               |

Every map can be disabled or exported as PNG or WebP. Output files use the project document name:

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

The packed MRC texture uses these channels:

| Channel | Value               |
| ------- | ------------------- |
| Red     | Metallic            |
| Green   | Roughness           |
| Blue    | Clearcoat           |
| Alpha   | Clearcoat roughness |

### Mix textures

Pigmi can composite an existing PNG over a generated map before saving. Place the mix image beside
the project using the pattern `<document>_<map>_mix.png`, for example
`palette_albedo_mix.png` or `palette_roughness_mix.png`. Transparent regions keep Pigmi's generated
map visible. **Mix preview** controls whether the composite also appears on the editor canvas.

## Projects and automatic saving

A Pigmi project is a user-selected folder containing one or more JSON documents and their exported
maps. Pigmi never needs a proprietary project database.

- **Create** adds a new empty JSON document.
- **Load and sync** opens an existing document and enables automatic saving.
- **Overwrite and sync** writes the current editor state into the selected document.
- **Desynchronize** keeps the current document open but stops automatic writes.
- **Update interval** controls the save debounce; values below 100 ms are saved with a 100 ms
  minimum delay.

Texture settings include canvas width and height, maximum item size, snapping step, undo history
length, zoom, zoom speed, default color representation, output formats, mix preview, and panel
locks.

## Palette generation

Pigmi can send the active item's palette constraints to the Huemint API and replace unlocked color
stops with a generated palette. It does not upload the project file or canvas image.

Generation controls include:

- **Mode:** Transformer, Diffusion, or Random;
- **Temperature:** lower values are more conservative, higher values are more varied;
- **Adjacency:** Balanced, Gradient, Brand, Noise, Website, Mondrian, Checkerboard, Clustered, or
  Ring.

Lock the colors that must remain unchanged, then click the meteor button under the color list.
Generation requires an internet connection.

## Controls and shortcuts

### Keyboard

**Primary** is platform-aware throughout Pigmi:

- macOS: `⌘ Command`
- Windows and Linux: `Ctrl`

| macOS                   | Windows/Linux | Action                                                           |
| ----------------------- | ------------- | ---------------------------------------------------------------- |
| `⌘ Z`                   | `Ctrl+Z`      | Undo the latest editor change                                    |
| `⌘ C`                   | `Ctrl+C`      | Copy selected layers                                             |
| `⌘ X`                   | `Ctrl+X`      | Cut selected layers                                              |
| `⌘ V`                   | `Ctrl+V`      | Paste layers and items                                           |
| `Delete` or `Backspace` | `Delete`      | Delete selected layers and their items                           |
| `Escape`                | `Escape`      | Clear the canvas/layer selection; also cancel layer-name editing |
| `Enter`                 | `Enter`       | Confirm a layer name or evaluate a numeric expression            |

Copy, cut, paste, delete, and undo do not override normal text editing while an input field is
focused.

### Canvas: mouse

| Gesture                   | Action                                                      |
| ------------------------- | ----------------------------------------------------------- |
| Left-click empty space    | Create an item using the latest item settings               |
| Left-click an item        | Select it                                                   |
| Left-drag an item         | Move it with grid snapping                                  |
| Primary-click an item     | Add it to or remove it from the multi-selection             |
| Primary-drag across items | Paint items into or out of the multi-selection              |
| Right-click an item       | Delete it immediately                                       |
| Right-click empty space   | Clear the selection                                         |
| Middle-button drag        | Pan the canvas while preserving normal mouse-wheel behavior |
| Mouse wheel               | Zoom toward the pointer position                            |

### Canvas: MacBook trackpad

| Gesture                    | Action                                                                         |
| -------------------------- | ------------------------------------------------------------------------------ |
| Two-finger scroll          | Pan the canvas horizontally or vertically                                      |
| Pinch                      | Zoom toward the position under the pointer                                     |
| Two-finger secondary click | Perform the canvas right-click action                                          |
| Command-click              | Extend or reduce the selection without triggering the macOS Control-click menu |

Panning or pointer-anchored zoom automatically releases center locking while keeping the canvas in
its current visual position. The center control in the right-side tab rail restores automatic
centering.

## MCP automation

Pigmi does not bundle a model, AI account, or provider-specific client. Instead, it ships a
standard stdio MCP server. Keep Pigmi running while an MCP client works: the application owns the
active document, while the MCP process exposes focused read and edit tools to the client.

### Connect Pigmi to Codex

Pigmi works with the Codex desktop app, Codex CLI, and the Codex IDE extension. These clients share
the same MCP configuration. Node.js 20.19 or newer must be available on the system because Codex
starts Pigmi's bundled MCP server as a local Node.js process.

1. Start Pigmi and open the **plug** tab in the left sidebar.
2. Copy the displayed **Codex CLI command**.
3. Run the command in a terminal.
4. Restart Codex. Keep Pigmi open whenever you want Codex to control it.
5. In Codex, open `/mcp` to confirm that `pigmi` is enabled. Ask Codex to inspect the active Pigmi
   document; the status in Pigmi changes from **Waiting** after the first tool call.

The generated command uses the correct paths for the current installation and operating system:

```bash
codex mcp add pigmi -- node "<PIGMI_MCP_SERVER_PATH>" --connection-file "<PIGMI_CONNECTION_FILE>"
```

You can perform the same setup without a terminal. In Codex, open **Settings → MCP servers → Add
server**, choose **STDIO**, use `node` as the command, and copy the arguments shown in Pigmi. Save
the server and restart Codex.

For manual configuration, paste the block shown in Pigmi into `~/.codex/config.toml`. Its form is:

```toml
[mcp_servers.pigmi]
command = "node"
args = [
  "<PIGMI_MCP_SERVER_PATH>",
  "--connection-file",
  "<PIGMI_CONNECTION_FILE>"
]
startup_timeout_sec = 20
tool_timeout_sec = 60
```

The server and connection-file paths are intentionally not hardcoded in this README. They differ
between development checkouts, installed applications, users, and operating systems; the plug tab
always displays the correct values for the running Pigmi instance. The connection file contains a
short-lived local token, so do not publish or share its contents.

If Codex reports that Pigmi is not running, start Pigmi and retry the request. The MCP server reads
the current connection information for every operation, so Pigmi can be restarted without editing
the Codex configuration.

### Other MCP clients

For a client that expects the common JSON configuration shape, use the server and connection-file
paths displayed in Pigmi:

```json
{
  "mcpServers": {
    "pigmi": {
      "command": "node",
      "args": ["<PIGMI_MCP_SERVER_PATH>", "--connection-file", "<PIGMI_CONNECTION_FILE>"]
    }
  }
}
```

For a development checkout, the paths typically have this form:

```json
{
  "mcpServers": {
    "pigmi": {
      "command": "node",
      "args": [
        "/absolute/path/to/pigmi/mcp/server.mjs",
        "--connection-file",
        "/path/shown/in/Pigmi/mcp-connection.json"
      ]
    }
  }
}
```

The MCP server can:

- inspect compact document settings, hierarchy, selection, and project state;
- request only selected item colors, gradients, transforms, visibility, or PBR materials;
- create, duplicate, move, rename, recolor, hide, or delete items and folders;
- edit albedo, roughness, metallic, emission, clearcoat, clearcoat roughness, and opacity;
- update document and export settings;
- read a canvas preview;
- open and save project documents;
- undo changes.

The recommended workflow is:

```text
pigmi_get_overview
  → pigmi_get_items (only when more detail is needed)
  → pigmi_get_operation_reference
  → pigmi_apply_operations
```

Writes are validated on a cloned document and committed atomically. Revision checks prevent an AI
client from overwriting newer user changes, and dry runs can validate complex plans before they
modify the editor. Newly created items do not change the current selection unless the client asks
for that explicitly.

The desktop app and MCP process communicate through a loopback-only bridge protected by a random
bearer token. The discovery file is created with user-only permissions and removed when Pigmi exits
normally.

See [docs/architecture.md](docs/architecture.md) for protocol and process-boundary details.

## Running from source

Requirements:

- Node.js 22 LTS recommended; Node.js 20.19 or newer is supported
- npm 10 or newer

```bash
git clone <repository-url>
cd pigmi
npm ci
npm start
```

The first start may take longer while Electron Forge prepares the development environment.

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

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a pull request. Report vulnerabilities
according to [SECURITY.md](SECURITY.md), not through a public issue.

## Network and security

Pigmi works locally except for features that explicitly use a network service:

- Huemint receives palette constraints only when palette generation is requested.
- The MCP server itself does not contact an AI provider. The selected MCP client controls its own
  models, authentication, images, and network policy.

The renderer has no direct Node.js access. Native file and window operations pass through a frozen,
narrow preload API and named IPC handlers. Project file access is restricted to folders and files
explicitly selected by the user.

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
