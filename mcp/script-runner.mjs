import { Worker as NodeWorker } from 'node:worker_threads';

function scriptError(message, code = 'SCRIPT_ERROR') {
  return Object.assign(new Error(message), { code });
}

export async function executeScript({ code, snapshot, readOnly = false }) {
  if (typeof code !== 'string' || !code.trim() || code.length > 32_768) {
    throw scriptError('code must contain 1..32768 characters');
  }
  if (JSON.stringify(snapshot).length > 8 * 1024 * 1024) {
    throw scriptError('Document exceeds the script snapshot limit; use selective MCP tools');
  }
  return new Promise((resolve, reject) => {
    const worker = new NodeWorker(
      new URL(/* @vite-ignore */ './script-worker.mjs', import.meta.url),
      {
        workerData: { code, snapshot, readOnly },
        execArgv: [],
        resourceLimits: { maxOldGenerationSizeMb: 96 },
      },
    );
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(
      () => finish(scriptError('Script execution timed out', 'SCRIPT_TIMEOUT')),
      4000,
    );
    worker.once('error', (error) => finish(scriptError(error.message)));
    worker.once('exit', (code) =>
      finish(scriptError(`Script worker exited without a result (${code})`)),
    );
    worker.once('message', (message) => {
      if (message.error) return finish(scriptError(message.error));
      try {
        if (typeof message.planJson !== 'string' || Buffer.byteLength(message.planJson) > 950_000) {
          throw scriptError('Generated changes exceed the batch size limit');
        }
        const plan = JSON.parse(message.planJson);
        if (!Array.isArray(plan.operations) || plan.operations.length > 500) {
          throw scriptError('Invalid script operation batch');
        }
        if (readOnly && plan.operations.length) throw scriptError('readOnly scripts cannot write');
        if (Buffer.byteLength(JSON.stringify(plan.result)) > 16_384) {
          throw scriptError('Return a compact JSON result (at most 16 KiB)');
        }
        finish(null, plan);
      } catch (error) {
        finish(error);
      }
    });
  });
}

export async function runEditorScript(
  bridge,
  { code, expectedRevision, dryRun = false, readOnly = false },
) {
  const snapshot = await bridge.call('get_script_snapshot', { expectedRevision });
  const { operations, layout, result } = await executeScript({ code, snapshot, readOnly });
  if (!operations.length) {
    return { ok: true, status: 'read_only', applied: false, revision: snapshot.revision, result };
  }
  const written = await bridge.call('apply_operations', {
    operations,
    layout,
    expectedRevision: snapshot.revision,
    dryRun,
    allowPartial: false,
  });
  return { ...written, operationCount: operations.length, result };
}
