# Pigmi code guide

This is the short, practical map of the main Pigmi application. For process boundaries and MCP
security details, see [architecture.md](architecture.md).

`landing/` and `Pigmi Helpers/` are separate projects and are not covered by this guide.

## Start here

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

## Where each responsibility lives

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

## The two representations of an item

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

## Naming that should not be "cleaned up"

Saved project data uses historical `snake_case` fields such as `center_locked`, `color_offsets`, and
`emission_strength`. Renaming them directly would break old project files. New local variables and
non-persisted helpers should use `camelCase`.

Some UI state uses `false` as the "nothing selected" value. This is a legacy convention; changing it
to `null` requires updating all selection watchers and handlers together.

## A safe way to make changes

1. Find the responsibility in the table above.
2. Put reusable calculations in `src/utils/` and add a focused test under `tests/`.
3. Keep Vue methods responsible for coordinating state, not repeating calculations.
4. Run `npm test` and `npm run lint` after each behavioral change.
5. Run `npm run package` before a release to verify the Electron bundle.

Comments should explain constraints or intent. Prefer descriptive function and variable names for
the mechanics of the code.
