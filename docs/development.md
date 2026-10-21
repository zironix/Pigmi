# Developing Pigmi

[Back to README](../README.md)

- [Setup and commands](#setup-and-commands)
- [Project structure](#project-structure)
- [Code guide](#code-guide)
- [Architecture](#architecture)
- [Building and releases](#building-and-releases)
- [Contributing](#contributing)

## Setup and commands

Use Node.js 22.12+ (or 20.19+) and npm 10+; the supported range is recorded in
[package.json](../package.json).

```bash
git clone https://github.com/zironix/Pigmi.git
cd Pigmi
npm ci
npm start
```

Other commands:

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

## Project structure

```text
mcp/             Standalone MCP server, bridge client, and operation reference
Pigmi Helpers/   Blender add-ons (separate Python files)
landing/         Website (separate Nuxt project)
src/
  ai/            Provider-neutral document reads, operations, and executor
  app/           Vue application controller and focused method modules
  components/    Color picker and layer-tree components
  main/          Electron lifecycle, MCP bridge, Blender add-on installer, window, IPC
  shared/        Contracts and path helpers shared by Electron processes
  stores/        Pinia layer-selection state
  styles/        Application styles
  utils/         Framework-independent input and arithmetic helpers
tests/           Unit and integration tests
docs/            User and developer documentation
```

## Code guide

A short, practical map of the main Pigmi application. Process boundaries and MCP security are
described under [Architecture](#architecture).

### Start here

The renderer follows this path:

```text
src/main.js                     Electron lifecycle
  -> src/main/window/           creates the desktop window
  -> src/preload.js             exposes the safe window.electronAPI bridge
  -> src/App.vue                main application layout
       -> src/app/appOptions.js state, watchers, and method composition
            -> src/app/methods/ focused groups of editor actions
```

`App.vue` is mostly markup. The controller lives in `appOptions.js`, which combines smaller method
objects with JavaScript spread syntax. A template call such as `draw()` therefore comes from one of
the files under `src/app/methods/`, even though the function is not declared inside `App.vue`.

### Where each responsibility lives

| Area                | Main file                                              | What belongs there                                   |
| ------------------- | ------------------------------------------------------ | ---------------------------------------------------- |
| Application state   | `src/app/appOptions.js`                                | Vue data, computed values, watchers, lifecycle hooks |
| Canvas input        | `src/app/methods/canvasInteractionMethods.js`          | selection, dragging, panning, zooming, hit testing   |
| Canvas drawing      | `src/app/methods/canvasRenderMethods.js`               | preview and material-channel rendering               |
| Item creation       | `src/app/methods/canvasItemMethods.js`                 | create, duplicate, remove, resize                    |
| Layer panel         | `src/components/LayersPanel.vue`                       | folder tree, clipboard, ordering, visibility         |
| Layer state         | `src/stores/layers.js`                                 | selection and transient layer-panel state            |
| Files               | `src/app/methods/filesMethods.js`                      | open, save, export, project lists                    |
| Undo history        | `src/app/methods/historyMethods.js`                    | snapshots, undo, redo                                |
| Colors and palettes | `src/app/methods/colorMethods.js`, `paletteMethods.js` | color edits and generation                           |
| MCP requests        | `src/app/methods/mcpMethods.js`, `src/ai/`             | validated editor reads and atomic edits              |
| Release updates     | `src/main/updates/`, `src/main/ipc/updateHandlers.js`  | version comparison and fixed GitHub Releases link    |
| Native operations   | `src/main/ipc/`                                        | narrow filesystem and window requests                |
| Shared calculations | `src/utils/`                                           | pure functions that can be tested without Vue        |

### The two representations of an item

The editor keeps related information in two places:

- `texture.items` contains the data drawn on the canvas: position, size, colors, material values,
  and the persistent item ID.
- `texture.layers` contains the layer-panel tree: folders, ordering, visibility, and the same item
  IDs.

The ID connects both representations. `LayersPanel.vue` updates their order and visibility together;
`appOptions.js` watchers keep canvas selection and layer selection synchronized.

There are two canvas item types:

- `g` is a regular gradient with `size: [width, height]`.
- `sg` is a stepped gradient with one numeric cell size and a row or column of repeated cells.

Shared bounds and hit-testing rules live in `src/utils/canvasItemGeometry.js`. Use those helpers
instead of reproducing the stepped-gradient formula in UI code.

Rendering calculations and material-channel drawing live in `src/utils/canvasRendering.js`;
`canvasRenderMethods.js` coordinates them, coalesces redraws with requestAnimationFrame, and caches
map content independently of selection and zoom. Preview bitmap size stays at document resolution;
CSS provides zoom, and an unselected scene cache avoids rebuilding gradients for selection changes.
Rendering reads normalized copies; document normalization and autosave run from the editor watcher.
Color interpolation is shared across preview, albedo,
and emission. Adjacent stepped transitions share a cell, including its alpha overdraw.

Layer moves and clipboard cloning live in `src/utils/layerTreeOperations.js`. Moves validate their
destination before mutation, and the undo callback runs before removing source nodes. Search
expansion lives in `src/utils/layerSearch.js` and does not mutate saved folder state until an
interacted path needs to stay open after clearing the query.

Autosave serializes writes and skips superseded queued revisions. Each export uses private canvas
copies and captured document settings, so asynchronous mixing cannot combine different editor
states. Palette-generation responses are similarly tied to the original item and discarded after
newer requests, color edits, deletion, or document replacement.

### Naming that should not be "cleaned up"

Saved project data uses historical `snake_case` fields such as `center_locked`, `color_offsets`, and
`emission_strength`. Renaming them directly would break old project files. New local variables and
non-persisted helpers should use `camelCase`.

Some UI state uses `false` as the "nothing selected" value. This is a legacy convention; changing it
to `null` requires updating all selection watchers and handlers together.

### A safe way to make changes

1. Find the responsibility in the table above.
2. Put reusable calculations in `src/utils/` and add a focused test under `tests/`.
3. Keep Vue methods responsible for coordinating state, not repeating calculations.
4. Run `npm test` and `npm run lint` after each behavioral change.
5. Run `npm run package` before a release to verify the Electron bundle.

Comments should explain constraints or intent. Prefer descriptive function and variable names for
the mechanics of the code.

## Architecture

Pigmi is an Electron application with a Vue renderer and a standalone MCP server. Process
boundaries are intentional: renderer code never receives direct Node.js access, and an MCP client
never receives a generic Electron or filesystem API.

### Runtime flow

```text
MCP client
  -> bundled stdio MCP server
    -> authenticated loopback bridge
      -> named Electron IPC request
        -> Vue editor operation layer

Vue renderer
  -> frozen preload API
    -> named IPC channels
      -> Electron main handlers
        -> filesystem and native window
```

#### Electron main process

`src/main.js` owns application lifecycle only. It creates the window, registers focused IPC
handler groups, and starts the local MCP bridge.

- `src/main/window/` configures the frameless application window.
- `src/main/ipc/` validates filesystem and native-window requests.
- `src/main/mcp/` owns MCP request correlation and the authenticated loopback endpoint.

`src/shared/ipcChannels.js` is the single source of truth for channel names.

#### Preload

`src/preload.js` exposes a frozen, explicit API with `contextBridge`. New privileged behavior must
be implemented as a named IPC operation; never expose `ipcRenderer`, Node modules, or a generic
"invoke any channel" function. MCP request subscriptions and responses are narrow one-way APIs.

#### Renderer

`src/App.vue` contains the main layout. Its controller is composed in `src/app/appOptions.js` from
method modules grouped by responsibility:

- canvas interaction and rendering;
- canvas item creation;
- colors and palettes;
- files and history;
- MCP editor requests;
- UI layout.

Provider-neutral editing logic is split into context readers, operation helpers, and a
deterministic executor under `src/ai/`.

### MCP editor protocol

The MCP server uses progressive disclosure instead of returning the serialized texture:

```text
get_overview
  -> compact settings, selection, flat semantic paths, and folder canvas bounds
get_items
  -> only requested paths, regions, colors, gradients, materials, transforms, or visibility
get_folders / compare_folders
  -> bounded subtrees plus raw placement and role evidence for repeated structures
create_items / duplicate_folder_variants / edit_folder_items
  -> typed high-level writes for common semantic workflows
get_operation_reference
  -> only documentation for operation types about to be used
apply_operations
  -> validate against a cloned document, then commit atomically
execute_script
  -> internal complete snapshot -> isolated QuickJS worker -> one apply_operations commit
validate_document
  -> structural and value diagnostics after complex edits
```

Overview defaults to `detail:summary`: at most 40 folders and 40 items, prioritizing selected
layers and showing root layers. Omission counts distinguish hidden detail from absent data;
`detail:full` retains the larger index. Pass the returned `stateRevision` as `knownState` on
subsequent overviews for an `unchanged:true` response. This token covers document content,
selection, creation defaults, project, and detail mode; it is separate from the write `revision`.
Reactive document revisions are cached with synchronous invalidation on nested changes. Clients
must retain actual previously read data; after context loss, fetch required details again.

An overview omits detailed item payloads and explicitly reports hierarchy validity. A selective
item-read workflow is limited to four requests, 100 items per request, and 200 returned items in
total. Folder snapshots are limited to eight folders and 300 items. Write requests are limited to
500 operations. Item and palette reads expose total counts, `truncated`, and `nextOffset`;
continue with `offset` and the same selectors while the document revision remains unchanged.
Palette counts include every matching item, independently of page size. Compact folder
comparisons factor identical fields into `role.shared`; merge it into each `role.values` entry,
or request `compact:false`. PNG previews default to a 1024-pixel longest side (`maxSide` up to 4096).

Folder reads return structure and canvas bounds by default; color, gradient, material, transform,
and visibility details are opt-in. The MCP model is instructed to infer naming, language/script,
grouping, direction, and spacing from the nearest relevant examples. Pigmi reports the raw evidence
but does not hardcode domain vocabulary or classify a document pattern itself. Explicit placement
wins; when no local pattern is clear, new items use a compact left-to-right, then top-to-bottom
fallback.

Write operations cover item and folder creation, editing, duplication, deletion, hierarchy
movement, visibility, explicit selection, texture settings, export settings, and palette-generator
settings. Newly created items do not change the current selection unless the request includes
`set_selection`.

Folder snapshots expose exact relative paths and preserve the nested layer order. Folder
comparisons align corresponding roles without guessing from leaf names. Variant duplication clones
the complete folder tree, then applies optional child edits by relative path, so clients never need
to predict generated IDs. The same addressing is available for editing roles across existing
folders. A separate typed batch tool creates genuinely new palettes when no reusable template
exists.

Item material reads and writes cover albedo, roughness, metallic, emission and its strength,
clearcoat, and clearcoat roughness. Opacity belongs to individual color stops and is exposed
separately from the material object. Writes may set one opacity for every stop, provide one value
per stop, or encode alpha in an eight-digit hex color.

Clients should pass the revision returned by a read as `expectedRevision`. Pigmi rejects a stale
write instead of applying it to a document changed by the user in the meantime. By default, any
operation warning rejects the complete request. `dryRun` validates and previews generated IDs
without mutating the editor. Its `revision` remains the current document revision;
`proposedRevision` describes the trial result. Explicit saves share the autosave queue and export
from a private snapshot, preventing older writes and later edits from contaminating saved files.

Some MCP clients repeat server-wide instructions beside every tool, so Pigmi keeps that bootstrap
deliberately short. It defines the safe fast path and model-driven convention inference without
duplicating the complete workflow across the model context. Detailed reference-image, material,
variant, and layout guidance is available with prompt argument `detailed:"true"`; the default prompt is brief.
Straightforward palette creation should take two tool calls: one overview and one specialized write.

Procedural work may use `pigmi_execute_script` without preliminary model-facing reads. The
renderer builds an internal snapshot using the same semantic fields as the read tools. The STDIO
adapter executes code in a bounded worker using a self-contained QuickJS WebAssembly build;
scripts receive only snapshot data and queue-producing functions inside the interpreter.
No host functions or Electron objects are exposed. Returned JSON is bounded separately from
generated operations. The adapter submits the generated batch with the snapshot's revision,
`allowPartial:false`, and optional `dryRun`, through the existing editor commit/Undo path.
Scripts see snapshot values throughout execution; queued writes are not visible to subsequent
reads. Each worker is terminated after its result or deadline. The MCP build emits `server.mjs`
and `script-worker.mjs`; the WebAssembly binary is embedded, so no runtime download is needed.

#### Local bridge security

The main process listens only on `127.0.0.1` and chooses an ephemeral port. At startup it writes the
port and a 256-bit random bearer token to the application data directory with user-only file
permissions. Every request requires that token. Request bodies are size-limited, correlated with a
single renderer window, and time out after 30 seconds.

The standalone MCP server reads the discovery file and exposes only fixed Pigmi methods. It cannot
execute arbitrary IPC, shell commands, or filesystem paths. Project switching accepts only files
already listed by the open Pigmi project.

#### Packaging

`npm run build:mcp` uses Vite to bundle the MCP SDK and schemas into one Node.js entry point. Electron
Forge copies that bundle next to the packaged application, so MCP clients need Node.js but do not
need Pigmi's development dependencies.

#### Release update check

The renderer gets the installed version through a narrow IPC method and asks the main process to
check GitHub once per application session. The main process uses Electron's network stack, an
eight-second timeout, and GitHub's latest published stable-release endpoint. Network failures,
rate limits, missing releases, and malformed tags return a quiet "no result" state and never delay
or interrupt editor startup. The renderer can request only Pigmi's fixed Releases page; it cannot
pass arbitrary URLs to `shell.openExternal`. A renderer-local application preference can disable
the request entirely and hides the update badge without adding a project-specific texture field.

#### State and saved files

Pinia owns transient layer selection state. Texture data remains serializable and is saved as JSON.
Persisted fields intentionally retain their historical `snake_case` names so existing projects
continue to load. New non-persisted JavaScript uses `camelCase`.

#### Tests

Vitest covers framework-independent color, layout, tree, editor-operation, path-security, and MCP
bridge behavior. MCP stdio discovery is smoke-tested during release verification. UI changes still
require a manual smoke test on the affected operating system.

### Design rules

1. Keep privileged APIs narrow and validate inputs at every process boundary.
2. Prefer pure functions for parsing, normalization, layout, and color math.
3. Keep persisted data backward compatible or provide an explicit migration.
4. Comments document intent and constraints; names and structure document mechanics.
5. Avoid global state, dynamic code execution, and platform-specific path concatenation.
6. Read progressively and mutate atomically.

## Building and releases

### Building for macOS, Windows, and Linux

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

### Publishing a GitHub release

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

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](../CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) before opening a pull request. Report vulnerabilities
according to [SECURITY.md](../SECURITY.md), not through a public issue.
