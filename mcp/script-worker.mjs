import { parentPort, workerData } from 'node:worker_threads';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { runPigmiScript } from './script-api.mjs';

try {
  const quickjs = await newQuickJSWASMModuleFromVariant(variant);
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(64 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + 2000;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const context = runtime.newContext();
  try {
    const { code, snapshot, readOnly } = workerData;
    const source = `(${runPigmiScript.toString()})(${JSON.stringify(snapshot)}, ${readOnly === true}, function(pigmi) {\n"use strict";\n${code}\n})`;
    const evaluated = context.evalCode(source, 'pigmi-script.js');
    if (evaluated.error) {
      const error = context.dump(evaluated.error);
      evaluated.error.dispose();
      throw new Error(error?.message || String(error));
    }
    try {
      parentPort.postMessage({ planJson: context.getString(evaluated.value) });
    } finally {
      evaluated.value.dispose();
    }
  } finally {
    context.dispose();
    runtime.dispose();
  }
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error) });
}
