<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { scrollFade as vScrollFade } from '../directives/scrollFade';

const ADDON_STATES = {
  missing: 'Not installed',
  outdated: 'Update available',
  current: 'Up to date',
  newer: 'Newer than bundled',
};
const addon = ref(null);
const addonBusy = ref(false);
const addonMessage = ref('');
const formatVersion = (version) => (Array.isArray(version) ? version.join('.') : '—');

function errorMessage(error) {
  // Electron prefixes errors from the main process with the IPC method name.
  return String(error?.message || error).replace(/^Error invoking remote method '[^']+': /, '');
}

async function refreshAddon() {
  try {
    addon.value = await window.electronAPI?.getBlenderAddonStatus?.();
  } catch (error) {
    addonMessage.value = errorMessage(error);
  }
}

async function installAddon() {
  addonBusy.value = true;
  addonMessage.value = '';
  try {
    const result = await window.electronAPI.installBlenderAddon();
    addon.value = result;
    addonMessage.value = result.failed.length
      ? `Could not write to Blender ${result.failed.map((entry) => entry.blenderVersion).join(', ')}.`
      : result.updated.length
        ? `Installed in Blender ${result.updated.join(', ')}. Restart Blender to load it.`
        : 'Every Blender version already has the current add-on.';
  } catch (error) {
    addonMessage.value = errorMessage(error);
  } finally {
    addonBusy.value = false;
  }
}

async function setAutoUpdate(event) {
  const enabled = event.target.checked;
  try {
    await window.electronAPI.setBlenderAddonAutoUpdate(enabled);
    addon.value = { ...addon.value, autoUpdate: enabled };
  } catch (error) {
    event.target.checked = !enabled;
    addonMessage.value = errorMessage(error);
  }
}

const CARD_NUMBER = '2202205304263772';
const cardCopied = ref(false);
let cardCopiedTimer = null;

async function copyCardNumber() {
  try {
    await navigator.clipboard.writeText(CARD_NUMBER);
  } catch {
    return;
  }
  cardCopied.value = true;
  clearTimeout(cardCopiedTimer);
  cardCopiedTimer = setTimeout(() => {
    cardCopied.value = false;
  }, 2000);
}

onMounted(refreshAddon);
onBeforeUnmount(() => clearTimeout(cardCopiedTimer));
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
          <a href="#support">Support Pigmi</a>
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
            Pigmi installs the add-on into every Blender version on this computer and keeps it
            updated. After the first install, restart Blender and enable
            <strong>Pigmi: UV to Palette</strong> once in Preferences → Add-ons; updates keep it
            enabled. Its panel appears in the 3D View sidebar under <strong>Snap UV</strong>.
          </p>
          <div v-if="addon" class="addon-status">
            <ul v-if="addon.installations.length">
              <li v-for="entry in addon.installations" :key="entry.blenderVersion">
                <span>Blender {{ entry.blenderVersion }}</span>
                <span :class="['addon-state', entry.state]">
                  {{ ADDON_STATES[entry.state] }}
                  <template v-if="entry.installedVersion">
                    · {{ formatVersion(entry.installedVersion) }}</template
                  >
                </span>
              </li>
            </ul>
            <p v-else>
              No Blender settings were found in <code>{{ addon.configRoot }}</code
              >. Start Blender once, then install again.
            </p>
            <label class="addon-auto">
              <input type="checkbox" :checked="addon.autoUpdate" @change="setAutoUpdate" />
              Install and update automatically when Pigmi starts
            </label>
          </div>
          <p v-if="addonMessage" class="addon-message" role="status">{{ addonMessage }}</p>
        </div>
        <div class="addon-actions">
          <button
            type="button"
            class="addon-link"
            :disabled="addonBusy || !addon"
            @click="installAddon"
          >
            {{ addonBusy ? 'Installing…' : 'Install / update now' }}
            <small v-if="addon">v{{ formatVersion(addon.bundledVersion) }}</small>
          </button>
          <a
            class="addon-link"
            href="https://github.com/zironix/Pigmi/blob/main/Pigmi%20Helpers/pigmi_uv2palette.py"
            target="_blank"
            rel="noopener noreferrer"
            >Source on GitHub ↗</a
          >
        </div>
      </section>
      <section id="support" class="guide-card support-card">
        <div class="support-intro">
          <span class="page-eyebrow">AN INDEPENDENT PROJECT</span>
          <h2>Support Pigmi. Or just say hello.</h2>
          <p>
            Pigmi is completely free software. If you enjoy using it, you can support the project:
            donations help pay for hosting and development. You can also contact me with questions
            or bug reports.
          </p>
          <span class="support-thanks"
            ><span aria-hidden="true">♡</span> Thank you for helping the project grow.</span
          >
        </div>
        <div class="support-options">
          <div class="support-option">
            <strong>Сбер · Card transfer</strong>
            <span class="card-number">2202 2053 0426 3772</span>
            <button type="button" class="addon-link" @click="copyCardNumber">
              {{ cardCopied ? '✓ Number copied' : 'Copy number' }}
            </button>
          </div>
          <a
            class="support-option"
            href="https://www.donationalerts.com/r/zenoxus"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>DonationAlerts · Support development ↗</strong>
            <span>Every contribution helps Pigmi grow and stay free for everyone.</span>
          </a>
          <a
            class="support-option"
            href="https://t.me/godot3d"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>TG channel · @godot3d ↗</strong>
            <span>News, updates, and experiments</span>
          </a>
          <a
            class="support-option"
            href="https://t.me/zironix"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>Talk to the creator · @zironix ↗</strong>
            <span>Ideas, questions, and feedback</span>
          </a>
        </div>
      </section>
    </div>
  </main>
</template>
