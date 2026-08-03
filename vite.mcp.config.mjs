import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const directory = path.dirname(fileURLToPath(import.meta.url));
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: path.join(directory, 'mcp', 'server.mjs'),
      formats: ['es'],
      fileName: () => 'server.mjs',
    },
    outDir: path.join(directory, 'build', 'mcp'),
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
    },
    target: 'node20',
  },
});
