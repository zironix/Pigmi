# Architecture

Pigmi is an Electron application with a Vue renderer and a standalone MCP server. Process
boundaries are intentional: renderer code never receives direct Node.js access, and an MCP client
never receives a generic Electron or filesystem API.

## Runtime flow

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

### Electron main process

`src/main.js` owns application lifecycle only. It creates the window, registers focused IPC
handler groups, and starts the local MCP bridge.

- `src/main/window/` configures the frameless application window.
- `src/main/ipc/` validates filesystem and native-window requests.
- `src/main/mcp/` owns MCP request correlation and the authenticated loopback endpoint.

`src/shared/ipcChannels.js` is the single source of truth for channel names.

### Preload

`src/preload.js` exposes a frozen, explicit API with `contextBridge`. New privileged behavior must
be implemented as a named IPC operation; never expose `ipcRenderer`, Node modules, or a generic
"invoke any channel" function. MCP request subscriptions and responses are narrow one-way APIs.

### Renderer

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

## MCP editor protocol

The MCP server uses progressive disclosure instead of returning the serialized texture:

```text
get_overview
  -> compact settings, selection, IDs, paths, types, and visibility
get_items
  -> only requested paths, regions, colors, gradients, materials, transforms, or visibility
get_folders / compare_folders
  -> complete bounded subtrees and role-aligned comparisons for repeated structures
create_items / duplicate_folder_variants / edit_folder_items
  -> typed high-level writes for common semantic workflows
get_operation_reference
  -> only documentation for operation types about to be used
apply_operations
  -> validate against a cloned document, then commit atomically
validate_document
  -> structural and value diagnostics after complex edits
```

An overview omits detailed item payloads and explicitly reports hierarchy validity. A selective
item-read workflow is limited to four requests, 100 items per request, and 200 returned items in
total. Folder snapshots are limited to eight folders and 300 items. Write requests are limited to
500 operations.

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
without mutating the editor.

Server-wide MCP instructions provide behavioral defaults independently of any particular model or
client. They require progressive reads, literal treatment of reference images, minimal changes,
compact semantic palettes, and explicit selection changes. The optional MCP prompt wraps the same
workflow for clients that expose prompt templates.

### Local bridge security

The main process listens only on `127.0.0.1` and chooses an ephemeral port. At startup it writes the
port and a 256-bit random bearer token to the application data directory with user-only file
permissions. Every request requires that token. Request bodies are size-limited, correlated with a
single renderer window, and time out after 30 seconds.

The standalone MCP server reads the discovery file and exposes only fixed Pigmi methods. It cannot
execute arbitrary IPC, shell commands, or filesystem paths. Project switching accepts only files
already listed by the open Pigmi project.

### Packaging

`npm run build:mcp` uses Vite to bundle the MCP SDK and schemas into one Node.js entry point. Electron
Forge copies that bundle next to the packaged application, so MCP clients need Node.js but do not
need Pigmi's development dependencies.

### State and saved files

Pinia owns transient layer selection state. Texture data remains serializable and is saved as JSON.
Persisted fields intentionally retain their historical `snake_case` names so existing projects
continue to load. New non-persisted JavaScript uses `camelCase`.

### Tests

Vitest covers framework-independent color, layout, tree, editor-operation, path-security, and MCP
bridge behavior. MCP stdio discovery is smoke-tested during release verification. UI changes still
require a manual smoke test on the affected operating system.

## Design rules

1. Keep privileged APIs narrow and validate inputs at every process boundary.
2. Prefer pure functions for parsing, normalization, layout, and color math.
3. Keep persisted data backward compatible or provide an explicit migration.
4. Comments document intent and constraints; names and structure document mechanics.
5. Avoid global state, dynamic code execution, and platform-specific path concatenation.
6. Read progressively and mutate atomically.
