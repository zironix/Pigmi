# Editor guide

[Back to README](../README.md)

## Editor workflow

1. Open the texture settings tab and choose a project folder.
2. For a new document, enter a texture name, click **Create**, then **Overwrite and sync**
   and confirm. For an existing document, select it and click **Load and sync**.
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

Use **Search** in the title bar to find name matches in items and folders. Matching branches
expand automatically. Clearing the query restores folder states, except that ancestor folders
of layers you interacted with stay open. Clearing search does not reset the scroll position
back to where the search began.

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

The current renderer clamps MRC alpha to a minimum of 0.01, so zero clearcoat roughness
is not encoded as fully transparent.

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
