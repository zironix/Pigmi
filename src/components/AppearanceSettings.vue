<script setup>
import { ref } from 'vue';
import {
  readAccentPreference,
  applyAccentPreference,
  readAccentTextPreference,
  applyAccentTextPreference,
} from '../utils/accentPreference';
const accent = ref(readAccentPreference());
const buttonText = ref(readAccentTextPreference());
const presets = [
  ['Pink', '#ea1f62'],
  ['Blue', '#548af7'],
  ['Purple', '#a377f5'],
  ['Teal', '#32b8a5'],
  ['Green', '#6bbd73'],
  ['Orange', '#ee9651'],
];
function choose(color) {
  accent.value = color;
  applyAccentPreference(color, true, buttonText.value);
}
</script>
<template>
  <section class="settings-category appearance-settings">
    <h3>Appearance</h3>
    <p class="category-description">
      Choose your accent color. This preference applies to all projects and is saved on this device,
      outside texture files.
    </p>
    <div class="accent-presets" role="group" aria-label="Accent color presets">
      <button
        v-for="[name, color] in presets"
        :key="color"
        type="button"
        :aria-label="name"
        :title="name"
        :aria-pressed="accent.toLowerCase() === color"
        :style="{ '--swatch': color }"
        @click="choose(color)"
      >
        <span v-if="accent.toLowerCase() === color">✓</span>
      </button>
    </div>
    <label class="custom-accent"
      ><span>Custom color</span
      ><input type="color" :value="accent" @input="choose($event.target.value)" /><code>{{
        accent
      }}</code></label
    >
    <fieldset class="accent-text-choice">
      <legend>Text on accent buttons</legend>
      <label
        v-for="[value, label] in [
          ['white', 'White'],
          ['dark', 'Dark'],
        ]"
        :key="value"
      >
        <input
          v-model="buttonText"
          type="radio"
          name="accent-button-text"
          :value="value"
          @change="applyAccentTextPreference(buttonText)"
        />
        <span>{{ label }}</span>
      </label>
    </fieldset>
  </section>
</template>
