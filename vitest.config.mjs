import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.js'],
    },
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
