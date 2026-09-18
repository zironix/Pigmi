# Dark Studio appearance

The visual redesign is isolated on `codex/dark-studio-redesign`, based on `709e153` (2.1.10).
It changes the presentation in `src/styles/studio.css` and a few labels/status elements in
`src/App.vue`. The original styles remain in `src/styles/app.css`; document data, rendering,
exports, MCP tools, and mouse/keyboard editing behavior are unchanged by the redesign.

The theme uses graphite surfaces, a restrained pink accent, rounded controls, system UI fonts,
and monospace numeric values. Hover states and panel reveals use short transitions; the system's
reduced-motion preference disables them. The darker transparency checker follows the same
snapping step and zoom and does not affect exports.

## Try or undo

Run `npm start` on the redesign branch to try it in Electron. A packaged installation will keep
its previous appearance until a new build is installed.

To return to the pre-redesign interface, switch back to `main` in your Git client (save or commit
any later work before switching). The redesign branch stays available if you want to revisit it.
If the redesign is later merged, revert its dedicated commit to remove just the redesign.

For a quick code-level comparison, remove the `studio.css` style import at the bottom of
`src/App.vue`. This restores the original styles while retaining the new status text and tooltips.
