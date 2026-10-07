# Connect an AI client

[Back to README](../README.md)

Pigmi exposes the active editor document through a local STDIO MCP adapter. Keep the application
running while the client uses it. Pigmi does not include a model, provider account, or subscription.

## Setup

1. Make Node.js available to the AI client. Node.js 22.12+ is suitable for both the adapter and
   development; the exact supported range is in [package.json](../package.json).
2. Start Pigmi and open a document.
3. Click the plug icon in the bottom-left tab bar: **MCP / Connect AI client**.
4. Copy the generated configuration from the appropriate card:
   - **Codex:** CLI registration command or TOML configuration.
   - **Claude Desktop:** JSON configuration.
   - **Any STDIO MCP client:** JSON and individual connection fields.
5. Add it to your client's MCP configuration, preserving any existing servers. Reload the client's
   configuration or restart the client.
6. Leave Pigmi open and ask the client:

   ```text
   Use Pigmi MCP to tell me the canvas size and top-level folders. Do not change anything.
   ```

Use the generated values instead of guessing installation paths. For a client that asks for
individual fields, enter:

| Field      | Value                                   |
| ---------- | --------------------------------------- |
| Transport  | STDIO                                   |
| Command    | `node`                                  |
| Argument 1 | MCP server path displayed in Pigmi      |
| Argument 2 | `--connection-file`                     |
| Argument 3 | Connection file path displayed in Pigmi |

The server path ends in `mcp/server.mjs`; it is not the application executable. The connection
file ends in `mcp-connection.json` and identifies the running Pigmi instance. Preserve quotes in
copied shell commands; separate argument fields take the raw path as a single value.

## What the tools cover

- Read document settings, selection, layers, item properties, and project files.
- Find items by ID, path, name query, folder, selection, or canvas region.
- Inspect nested folders and compare corresponding items across variants.
- Create, duplicate, rename, recolor, move, hide, or delete items and folders.
- Edit gradient, opacity, material, canvas, and export settings.
- Request a canvas preview, validate a document, open/save documents, and undo changes.
- Run JavaScript loops and formulas on local document data, then apply one atomic batch.

## JavaScript scripts

Use `pigmi_execute_script` for repeated edits, procedural palettes, or local analysis. It reads
the complete current document internally, so the model does not need to fetch every item first.
Only the explicitly returned JSON and a compact write summary enter the model context.
Simple creation and duplication can still use the existing typed tools.

For example, a single call can adjust selected materials using their current values:

```js
const items = pigmi.items({ selected: true });
for (const item of items) {
  pigmi.update(item, {
    material: { roughness: Math.min(100, (item.material.roughness ?? 50) + 10) },
  });
}
return { changed: items.length };
```

The tool accepts `code`, optional `expectedRevision`, `dryRun`, and `readOnly`. Inspection tasks
should use `readOnly: true`; writes in that mode are rejected. `dryRun: true` checks the entire
generated batch without applying it. Writes automatically use the snapshot revision even if
the caller omits `expectedRevision`, rejecting intervening document changes.

The synchronous `pigmi` API provides:

| Member                                                         | Behavior                                                                                                                     |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `document`, `defaults`, `selection`                            | Frozen document settings, creation defaults, and selected IDs.                                                               |
| `items(filter?)`                                               | All items, a predicate, or a selector with `ids`, `paths`, `folderPath`, `query`, `selected`. No pagination inside a script. |
| `folders()`                                                    | Complete folder index with ID, name, path, parent path, visibility.                                                          |
| `update(itemOrId, patch)`                                      | Queue an `update_item`; arrays of items/IDs and operation selectors are also accepted.                                       |
| `recolor(itemOrId, colors)`                                    | Queue a color change, using hex color arrays.                                                                                |
| `create(items, { folderPath, defaults }?)`                     | Queue new gradients, inheriting unspecified editor defaults.                                                                 |
| `duplicateFolder(sourcePath, newPath, { offset, itemEdits }?)` | Queue complete folder duplication with optional edits.                                                                       |
| `operation(op)`                                                | Queue any supported operation; use the operation reference for unfamiliar forms.                                             |
| `layout(options)`                                              | Set batch placement, using the same options as `pigmi_create_items`.                                                         |

Item reads include `id`, `name`, `path`, `folderPath`, `itemType`, `shape`, `direction`, `colorMode`,
`colors`, `colorStops`, `colorOffsets`, `size`, `steps`, `x`, `y`, `visible`, and `material`.
Material names match writes, including `emissionStrength` and `clearcoatRoughness`.
All reads stay at the initial snapshot. Writes queue until the script succeeds; direct mutation
of read objects is rejected. New IDs become available only in the final write result.
Use `Backpack/Shade` as a path filter (`paths: [...]`), not as an ID passed to `update`.

Code runs in a separate worker with a QuickJS WebAssembly runtime, without host callbacks.
It has no Node, DOM, filesystem, network, timers, imports, or asynchronous execution.
Limits are 32 KiB of code, 8 MiB of snapshot JSON, 64 MiB interpreter memory, two seconds of
interpreter time with a four-second worker deadline, 500 queued operations, and 16 KiB of
returned JSON. Exceptions, timeouts, or rejected operations leave the document unchanged.
A successful edit uses the existing validation, rendering, and Undo path once for the batch.
After updating Pigmi, reload the MCP client's connection to discover the new tool.

Reads are selective. The overview defaults to a summary; detailed fields and larger indexes are
requested as needed. Clients can pass `knownState` to check whether a previous overview is still
current. Paginated reads explicitly report omitted results. Previously read data must still be
available in the client's context to reuse it.

Writes support `expectedRevision` to reject stale edits and `dryRun` to validate without applying.
By default, operation warnings reject the whole batch. Folder variants preserve the source tree
and unspecified properties. Creating items does not implicitly select them.

See [the protocol notes](architecture.md#mcp-editor-protocol) for developer details.

## Troubleshooting

| Symptom                                   | Check                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `node` cannot be found                    | Run `node --version`. Ensure the client's environment can find Node.js, then restart the client.           |
| Pigmi shows `Unavailable`                 | Restart Pigmi and check that the installation includes the MCP adapter.                                    |
| Connection file not found                 | Start Pigmi and copy the connection path from its setup page. Do not create the file yourself.             |
| Pigmi still shows `Waiting`               | Ask the client to call a Pigmi tool; discovering the tool list alone does not contact the editor.          |
| Connection breaks after an update or move | Replace the old configuration with the values generated by the current installation.                       |
| AppImage path changes                     | Refresh the configuration from the running AppImage. A DEB installation offers a stable installation path. |

The adapter uses a localhost bridge with a random authentication token. Treat `mcp-connection.json`
as a local credential: do not publish or commit its contents. Ask the client to edit through Pigmi
tools so document validation and undo remain available.
