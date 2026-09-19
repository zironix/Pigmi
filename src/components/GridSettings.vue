<script setup>
import { computed } from 'vue';
import { defaultGridSettings, normalizeGridSettings, gridStyle } from '../utils/gridSettings';

const props = defineProps({
  modelValue: { type: Object, default: undefined },
  step: { type: [Number, String], default: 64 },
});
const emit = defineEmits(['update:modelValue']);
const settings = computed(() => normalizeGridSettings(props.modelValue));
const previewStyle = computed(() => ({
  ...gridStyle(props.modelValue),
  '--checker-size': '400px',
}));
const colors = [
  ['background', 'Background'],
  ['minor_color', 'Minor lines'],
  ['major_color', 'Major lines'],
  ['dot_color', 'Intersection dots'],
];
function update(key, value) {
  emit('update:modelValue', normalizeGridSettings({ ...settings.value, [key]: value }));
}
</script>

<template>
  <div class="grid-settings-block">
    <figure class="grid-preview-figure">
      <div
        class="grid-preview"
        :style="previewStyle"
        role="img"
        :aria-label="
          settings.enabled ? 'Live grid appearance preview' : 'Grid disabled; background only'
        "
      ></div>
      <figcaption>
        {{ settings.enabled ? 'Live preview' : 'Grid hidden' }} · one cell =
        {{ Math.max(1, Number(step) || 1) }} texture px
      </figcaption>
    </figure>
    <details class="grid-settings">
      <summary>Grid settings</summary>
      <label class="grid-setting-row">
        <span>Show grid</span>
        <input
          type="checkbox"
          :checked="settings.enabled"
          @change="update('enabled', $event.target.checked)"
        />
      </label>
      <p class="grid-settings-hint">Cells follow Snapping step. Emphasize every Nth line.</p>
      <label
        v-for="[key, label] in [
          ['vertical_every', 'Vertical lines'],
          ['horizontal_every', 'Horizontal lines'],
        ]"
        :key="key"
        class="grid-setting-row"
      >
        <span>{{ label }}</span>
        <input
          type="number"
          min="1"
          max="100"
          step="1"
          :value="settings[key]"
          @change="update(key, $event.target.value)"
        />
      </label>
      <label class="grid-setting-row">
        <span>Intersection dots</span>
        <input
          type="checkbox"
          :checked="settings.dots"
          @change="update('dots', $event.target.checked)"
        />
      </label>
      <label class="grid-setting-row">
        <span>Line width</span>
        <input
          type="number"
          min="0.2"
          max="2"
          step="0.1"
          :value="settings.line_width"
          @change="update('line_width', $event.target.value)"
        />
      </label>
      <label class="grid-setting-row">
        <span>Dot radius</span>
        <input
          type="number"
          min="0.5"
          max="3"
          step="0.1"
          :value="settings.dot_size"
          @change="update('dot_size', $event.target.value)"
        />
      </label>
      <label v-for="[key, label] in colors" :key="key" class="grid-setting-row">
        <span>{{ label }}</span>
        <input type="color" :value="settings[key]" @input="update(key, $event.target.value)" />
      </label>
      <button type="button" @click="emit('update:modelValue', { ...defaultGridSettings })">
        Reset grid
      </button>
    </details>
  </div>
</template>
