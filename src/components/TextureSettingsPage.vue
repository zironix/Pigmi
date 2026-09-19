<script setup>
import { scrollFade as vScrollFade } from '../directives/scrollFade';
const shortcuts = [
  [
    'Shift + left-button drag',
    'Select visible items touched by the selection box. Start on the canvas or the empty workspace.',
  ],
  ['Shift + Ctrl / ⌘ + left-button drag', 'Add items inside the box to the existing selection.'],
  [
    'Shift + Alt / Option + left-button drag',
    'Subtract items inside the box from the selection. Escape cancels the box gesture.',
  ],
  ['Ctrl / ⌘ + Z', 'Undo the last document change.'],
  [
    'Ctrl / ⌘ + C · X · V',
    'Copy, cut and paste selected layers. These shortcuts edit text normally while typing in an input.',
  ],
  ['Delete · Backspace on macOS', 'Delete selected layers while focus is outside a text field.'],
  [
    'Esc',
    'Cancel an active selection box and restore the previous selection; otherwise clear selection.',
  ],
  ['Ctrl / ⌘ + click', 'Toggle an item in the selection on the canvas or in Layers.'],
  ['Shift + click in Layers', 'Select a range of layers.'],
  [
    'Middle mouse drag',
    'Pan the canvas and release center lock. Use the center button below the canvas to center it again.',
  ],
  [
    'Ctrl / ⌘ + wheel',
    'Zoom. While centered, zoom stays centered; after panning, zoom follows the cursor.',
  ],
];
</script>

<template>
  <main v-scroll-fade class="texture-workspace" aria-label="Document settings and guide">
    <div class="texture-page">
      <header class="texture-page-header">
        <span class="page-eyebrow">DOCUMENT & WORKFLOW</span>
        <h1>Make Pigmi work for you</h1>
        <p>
          Set up your texture, exports and workspace. Changes apply immediately; document settings
          are saved with the project when synchronization is enabled.
        </p>
        <nav aria-label="Settings sections">
          <a href="#document-controls">Document settings</a>
          <a href="#workflow-guide">Shortcuts & tips</a>
          <a href="#uv-addon">Blender add-on</a>
        </nav>
      </header>
      <div id="document-controls">
        <slot name="project" />
        <div class="texture-settings-grid"><slot /></div>
      </div>
      <section id="workflow-guide" class="workflow-guide">
        <span class="page-eyebrow">QUICK REFERENCE</span>
        <h2>Shortcuts & useful details</h2>
        <p>
          Ctrl on Windows and Linux, ⌘ on macOS. The shortcuts below describe the current editor
          behavior.
        </p>
        <div class="guide-grid">
          <article class="guide-card">
            <h3>Keyboard & canvas</h3>
            <p>
              The canvas fills the workspace behind the floating panels, without scrollbars. Pan
              with the middle mouse button, including from the surrounding workspace. The center
              button centers the canvas in the window.
            </p>
            <p>
              Selection boxes include visible items they touch. A normal left click on empty texture
              space still creates an item. Snapped movement animates only the preview; document
              coordinates and exports remain exact.
            </p>
            <dl>
              <template v-for="[keys, description] in shortcuts" :key="keys"
                ><dt>
                  <kbd>{{ keys }}</kbd>
                </dt>
                <dd>{{ description }}</dd></template
              >
            </dl>
          </article>
          <article class="guide-card">
            <h3>Calculate directly in inputs</h3>
            <p>
              Expression-enabled fields such as texture dimensions, snapping step, item sizes and
              numeric color channels accept +, −, * and /, parentheses and decimals. Press Enter to
              evaluate.
            </p>
            <div class="expression-examples">
              <code>2048 / 2 → 1024</code><code>(64 + 16) * 2 → 160</code>
            </div>
            <p>
              Most values round to whole numbers; color alpha can keep decimals. Invalid expressions
              are left unchanged. Plain numeric controls such as Grid settings use regular numbers.
            </p>
            <h3>Color picker shortcuts</h3>
            <p>
              <kbd>Ctrl / ⌘ + click a numeric channel</kbd> applies that channel value to the other
              color pickers in the current palette. For example, click saturation to give every
              color the same saturation. This is not Shift.
            </p>
            <p>
              Scroll over a numeric color channel to adjust it. Click HSV / HSL / RGB / HEX to cycle
              color models. Click the small color preview to open the screen eyedropper where
              supported.
            </p>
            <h3>Palette & stops</h3>
            <p>
              Drag the handle below a color to reorder it. Lock a color to keep it during palette
              generation. Drag gradient stops to change their positions.
            </p>
            <p>
              <kbd>Ctrl / ⌘ + click the color’s ×</kbd> removes it and evenly redistributes the
              remaining stops. A normal click preserves their positions.
            </p>
          </article>
        </div>
      </section>
      <section id="uv-addon" class="guide-card addon-card">
        <div>
          <span class="page-eyebrow">BLENDER · PIGMI HELPERS</span>
          <h2>UV to Palette</h2>
          <p>
            Map selected UVs onto Pigmi palette cells, or distribute them along gradients with drawn
            paths, radial mapping and distance. Includes cell margins and cavity / fake AO controls.
          </p>
          <p>
            Install the Python add-on in Blender’s preferences. Its panel appears in the 3D View
            sidebar under <strong>Snap UV</strong>. The bundled add-on declares Blender 5.0 support.
          </p>
        </div>
        <a
          class="addon-link"
          href="https://github.com/zironix/Pigmi/blob/main/Pigmi%20Helpers/pigmi_uv2palette.py"
          target="_blank"
          rel="noopener noreferrer"
          >Open UV to Palette ↗</a
        >
      </section>
    </div>
  </main>
</template>
