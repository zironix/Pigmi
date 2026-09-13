import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { buildEditorOverview, fulfillEditorDataRequests } from '../src/ai/editorContext';
import { compareFolderSnapshots } from '../src/ai/editorInspection';
import { documentRevision } from '../src/ai/editorRevision';
import { mcpMethods } from '../src/app/methods/mcpMethods';

function makeTexture() {
  const items = Array.from({ length: 240 }, (_, index) => ({
    id: index + 1,
    name: `Role ${index % 40}`,
    type: 'g',
    size: [16, 16],
    x: (index % 40) * 16,
    y: Math.floor(index / 40) * 16,
    colors: [{ rgba: { r: 20, g: 40, b: 60, a: 1 } }],
    color_offsets: [0],
    roughness: 50,
    metallic: 0,
  }));
  const layers = Array.from({ length: 6 }, (_, index) => ({
    id: 1000 + index,
    name: `Variant ${index}`,
    type: 'folder',
    childs: items
      .slice(index * 40, (index + 1) * 40)
      .map(({ id, name }) => ({ id, name, type: 'item' })),
  }));
  return { width: 1024, height: 512, step: 16, items, layers };
}
function editor() {
  return {
    ...mcpMethods,
    texture: reactive(makeTexture()),
    ls: { selected: [], active_id: null },
    lastItem: null,
    $nextTick: async () => {},
    draw: vi.fn(),
    pushUndoSnapshot: vi.fn(),
  };
}

describe('MCP context economy and revisions', () => {
  it('bounds the summary, preserves selected details, and shares repeated comparison values losslessly', () => {
    const texture = makeTexture();
    const full = buildEditorOverview({ texture });
    const summary = buildEditorOverview({ texture, detail: 'summary', selectionIds: [240] });
    expect(summary.hierarchy.items.map((item) => item.id)).toEqual([240]);
    expect(summary.hierarchy.omitted.items).toBe(239);
    expect(summary.hierarchy.folders).toEqual(full.hierarchy.folders);
    expect(JSON.stringify(summary).length).toBeLessThan(JSON.stringify(full).length / 4);
    texture.items[40].metallic = 80;
    const params = {
      texture,
      paths: texture.layers.map((layer) => layer.name),
      fields: ['colors', 'material'],
    };
    const expanded = compareFolderSnapshots(params);
    const compact = compareFolderSnapshots({ ...params, compact: true });
    expect(
      compact.roles.map(({ shared, ...role }) => ({
        ...role,
        values: role.values.map((entry) => ({ ...shared, ...entry })),
      })),
    ).toEqual(expanded.roles);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(expanded).length * 0.7);
    console.info(
      'MCP response characters:',
      JSON.stringify({
        overviewFull: JSON.stringify(full).length,
        overviewSummary: JSON.stringify(summary).length,
        comparisonExpanded: JSON.stringify(expanded).length,
        comparisonCompact: JSON.stringify(compact).length,
      }),
    );
  });

  it('invalidates state for selection, defaults, project, detail mode, and nested document edits', () => {
    const context = editor();
    const initial = context.buildMcpOverview({ detail: 'summary' });
    expect(
      context.buildMcpOverview({ detail: 'summary', knownState: initial.stateRevision }),
    ).toEqual({
      revision: initial.revision,
      stateRevision: initial.stateRevision,
      unchanged: true,
    });
    for (const change of [
      () => context.ls.selected.push(1),
      () => {
        context.lastItem = context.texture.items[0];
      },
      () => {
        context.selected_file = 'next.json';
      },
      () => {
        context.texture.items[0].name = 'Changed';
      },
    ]) {
      const before = context.buildMcpOverview({ detail: 'summary' });
      change();
      const after = context.buildMcpOverview({
        detail: 'summary',
        knownState: before.stateRevision,
      });
      expect(after.unchanged).toBeUndefined();
      expect(after.stateRevision).not.toBe(before.stateRevision);
    }
    expect(
      context.buildMcpOverview({ detail: 'full', knownState: initial.stateRevision }).unchanged,
    ).toBeUndefined();
  });

  it('caches reactive serialization and invalidates synchronously, including plain object mutations', () => {
    const serialize = vi.fn(function () {
      return { items: this.items };
    });
    const texture = reactive({ items: [{ name: 'A' }], toJSON: serialize });
    const first = documentRevision(texture);
    expect(documentRevision(texture)).toBe(first);
    expect(serialize).toHaveBeenCalledTimes(1);
    texture.items[0].name = 'B';
    const second = documentRevision(texture);
    expect(second).not.toBe(first);
    texture.items.push({ name: 'C' });
    expect(documentRevision(texture)).not.toBe(second);
    const plain = { value: 1 };
    const plainFirst = documentRevision(plain);
    plain.value++;
    expect(documentRevision(plain)).not.toBe(plainFirst);
  });

  it('keeps dry-run revisions usable for writes and reports the final rendered revision', async () => {
    const context = editor();
    const revision = documentRevision(context.texture);
    const operations = [{ type: 'update_texture', width: 2048 }];
    const trial = await context.applyMcpOperations({
      operations,
      expectedRevision: revision,
      dryRun: true,
    });
    expect(trial.revision).toBe(revision);
    expect(trial.proposedRevision).not.toBe(revision);
    expect(context.texture.width).toBe(1024);
    context.draw = () => {
      context.texture.zoom = 2;
    };
    const written = await context.applyMcpOperations({
      operations,
      expectedRevision: trial.revision,
    });
    expect(written.revision).toBe(documentRevision(context.texture));
    await expect(
      context.applyMcpOperations({ operations, expectedRevision: revision }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('paginates all matches and counts palette colors across every matching item', () => {
    const texture = makeTexture();
    const read = (requests) => fulfillEditorDataRequests({ texture, requests }).results;
    const [first, second, exhausted, palette] = read([
      { query: 'Role', limit: 100 },
      { query: 'Role', limit: 100, offset: 100 },
      { query: 'Role', limit: 100, offset: 200 },
      { type: 'get_palette', limit: 1 },
    ]);
    expect(first).toMatchObject({ matchedCount: 240, truncated: true, nextOffset: 100 });
    expect(second.items[0].id).toBe(101);
    expect(exhausted).toMatchObject({
      matchedCount: 240,
      items: [],
      truncated: true,
      nextOffset: 200,
    });
    const [last] = read([{ query: 'Role', limit: 100, offset: exhausted.nextOffset }]);
    expect(last.items).toHaveLength(40);
    expect(last.nextOffset).toBeNull();
    expect(palette).toMatchObject({
      matchedCount: 240,
      colorCount: 1,
      truncated: false,
      palette: [{ hex: '#14283c', count: 240 }],
    });
  });
});
