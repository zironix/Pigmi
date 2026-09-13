import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  test: {
    coverage: {
      include: ['src/**/*.js'],
    },
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
