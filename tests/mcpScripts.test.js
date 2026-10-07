import { describe, expect, it, vi } from 'vitest';
import { executeScript, runEditorScript } from '../mcp/script-runner.mjs';
import { mcpMethods } from '../src/app/methods/mcpMethods';

function editor() {
  const items = Array.from({ length: 240 }, (_, i) => ({
    id: i + 1,
    name: `Shade ${i}`,
    type: 'g',
    shape: 'l',
    size: [16, 16],
    x: (i % 32) * 16,
    y: Math.floor(i / 32) * 16,
    colors: [{ rgba: { r: 20, g: 40, b: 60, a: 1 } }],
    color_offsets: [0],
    roughness: 50,
    metallic: 0,
  }));
  const context = {
    ...mcpMethods,
    texture: {
      width: 1024,
      height: 512,
      step: 16,
      items,
      layers: [
        {
          id: 1000,
          type: 'folder',
          name: 'Palette',
          childs: items.map(({ id, name }) => ({ id, name, type: 'item' })),
        },
      ],
    },
    ls: { selected: [1, 240], active_id: null },
    lastItem: items[0],
    pushUndoSnapshot: vi.fn(),
    draw: vi.fn(),
    $nextTick: async () => {},
  };
  const bridge = { call: vi.fn((method, params) => context.handleMcpRequest({ method, params })) };
  return { context, bridge };
}

describe('MCP scripts', () => {
  it('reads the full local snapshot and commits computed edits once with compact output', async () => {
    const { context, bridge } = editor();
    const result = await runEditorScript(bridge, {
      code: `
      const items = pigmi.items({selected:true});
      for (const item of items) pigmi.update(item, {material:{roughness:item.material.roughness + 10}});
      return {changed:items.length, total:pigmi.items().length, folder:pigmi.folders()[0].path};
    `,
    });
    expect(result).toMatchObject({
      applied: true,
      operationCount: 2,
      result: { changed: 2, total: 240, folder: 'Palette' },
    });
    expect(context.texture.items[0].roughness).toBe(60);
    expect(context.texture.items[239].roughness).toBe(60);
    expect(context.texture.items[1].roughness).toBe(50);
    expect(context.ls.selected).toEqual([1, 240]);
    expect(context.draw).toHaveBeenCalledOnce();
    expect(context.pushUndoSnapshot).toHaveBeenCalledTimes(2);
    expect(bridge.call.mock.calls.map(([method]) => method)).toEqual([
      'get_script_snapshot',
      'apply_operations',
    ]);
    expect(JSON.stringify(result).length).toBeLessThan(1500);
  });

  it('supports procedural creation, read-only inspection, and dry-run without changing selection', async () => {
    const { context, bridge } = editor();
    const code = `
      pigmi.create(Array.from({length:12}, (_,i) => ({name:'New '+i, colors:['#123456','#abcdef'], size:[16,16]})), {folderPath:'New'});
      pigmi.layout({compactCreated:true});
      return {created:12};
    `;
    expect(await runEditorScript(bridge, { code, dryRun: true })).toMatchObject({
      applied: false,
      dryRun: true,
      createdCount: 12,
    });
    expect(context.texture.items).toHaveLength(240);
    expect(context.draw).not.toHaveBeenCalled();
    expect(await runEditorScript(bridge, { code })).toMatchObject({
      applied: true,
      createdCount: 12,
    });
    expect(context.texture.items).toHaveLength(252);
    expect(context.ls.selected).toEqual([1, 240]);
    expect(
      await runEditorScript(bridge, {
        code: 'return pigmi.items({folderPath:"New"}).length;',
        readOnly: true,
      }),
    ).toMatchObject({ applied: false, result: 12 });
    await expect(
      runEditorScript(bridge, {
        code: 'pigmi.recolor(pigmi.items()[0], ["#ffffff"]);',
        readOnly: true,
      }),
    ).rejects.toThrow('readOnly');
  });

  it('keeps errors and stale snapshots atomic', async () => {
    const { context, bridge } = editor();
    await expect(
      runEditorScript(bridge, {
        code: 'pigmi.update(1,{material:{roughness:80}}); throw new Error("stop");',
      }),
    ).rejects.toThrow('stop');
    await expect(
      runEditorScript(bridge, {
        code: 'pigmi.update(1,{material:{roughness:80}}); pigmi.operation({type:"delete_item",target:{id:-1}});',
      }),
    ).rejects.toThrow('No changes applied');
    expect(context.texture.items[0].roughness).toBe(50);
    expect(context.pushUndoSnapshot).not.toHaveBeenCalled();
    const initial = context.buildMcpOverview();
    await expect(
      runEditorScript(bridge, { code: 'return 1;', expectedRevision: 'stale' }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    bridge.call.mockImplementation(async (method, params) => {
      const result = await context.handleMcpRequest({ method, params });
      if (method === 'get_script_snapshot') context.texture.width = 2048;
      return result;
    });
    await expect(
      runEditorScript(bridge, {
        code: 'pigmi.update(1,{material:{roughness:80}});',
        expectedRevision: initial.revision,
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(context.texture.items[0].roughness).toBe(50);
    expect(context.pushUndoSnapshot).not.toHaveBeenCalled();
  });

  it('isolates host access and enforces execution/output limits without writes', async () => {
    const { bridge, context } = editor();
    const inspect = await runEditorScript(bridge, {
      readOnly: true,
      code: `
      return [typeof process,typeof require,typeof fetch,typeof window,typeof setTimeout,
        ({}).constructor.constructor('return typeof process')()];
    `,
    });
    expect(inspect.result).toEqual(Array(6).fill('undefined'));
    await expect(
      runEditorScript(bridge, { code: 'pigmi.items()[0].material.roughness=99;' }),
    ).rejects.toThrow();
    await expect(runEditorScript(bridge, { code: 'return Promise.resolve(1);' })).rejects.toThrow(
      'synchronous',
    );
    await expect(runEditorScript(bridge, { code: 'return "x".repeat(20000);' })).rejects.toThrow(
      'compact',
    );
    await expect(runEditorScript(bridge, { code: 'while(true) {}' })).rejects.toThrow(
      /interrupted|timed out/,
    );
    expect(context.pushUndoSnapshot).not.toHaveBeenCalled();
    expect(
      await runEditorScript(bridge, {
        readOnly: true,
        code: 'return pigmi.items({paths:["Palette/Shade 239"]})[0].id;',
      }),
    ).toMatchObject({ result: 240 });
  });

  it('rejects oversized code before starting a worker', async () => {
    await expect(executeScript({ code: 'x'.repeat(32769), snapshot: {} })).rejects.toThrow('32768');
  });
});
