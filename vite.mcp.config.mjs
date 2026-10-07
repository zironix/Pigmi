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
      entry: {
        server: path.join(directory, 'mcp', 'server.mjs'),
        'script-worker': path.join(directory, 'mcp', 'script-worker.mjs'),
      },
      formats: ['es'],
      fileName: (_format, entryName) => `${entryName}.mjs`,
    },
    outDir: path.join(directory, 'build', 'mcp'),
    rollupOptions: {
      external: (id) => nodeBuiltins.has(id),
      output: {
        // The embedded Emscripten CJS module loads Node built-ins during startup.
        banner:
          "import { createRequire as pigmiCreateRequire } from 'node:module'; const require = pigmiCreateRequire(import.meta.url);",
      },
    },
    target: 'node20',
  },
});
