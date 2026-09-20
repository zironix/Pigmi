# Pigmi 3.0 appearance and workspace

The redesign was developed on `codex/dark-studio-redesign`, based on `709e153` (2.1.10).
The previous interface remains available at the `v2.1.10` tag.

Pigmi 3.0 uses floating graphite panels over a full-window canvas, with shared colors, spacing,
subtle glass effects, and keyboard focus states. The default accent is pink (`#ea1f62`).
Appearance settings offer presets, a custom color, and white or dark button text. These choices
are saved locally for all projects, outside texture files.

The procedural grid follows snapping and zoom. Major horizontal and vertical lines default to
every four cells; existing saved grid settings are preserved. Grid settings include a live preview.
Texture settings and the workflow guide have their own page. See the [editor guide](editor-guide.md)
for box selection, navigation, and editing shortcuts.

Selection markers use a vector overlay, and movement animates only the preview. Exported maps
retain exact document coordinates and do not include the grid or selection markers. The system's
reduced-motion preference disables animations.

## Try or undo

Run `npm start` from the 3.0 source to try it in Electron. A packaged installation keeps its
previous appearance until a new build is installed.

To inspect the pre-redesign source, check out the `v2.1.10` tag in your Git client. Save or commit
any later work before switching. Return to your 3.0 branch to resume development.
