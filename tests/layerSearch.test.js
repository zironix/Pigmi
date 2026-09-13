import { afterEach, describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { useLayerSearch } from '../src/utils/layerSearch';

const scopes = [];
afterEach(() => scopes.splice(0).forEach((scope) => scope.stop()));

function setup() {
  const roots = ref([
    {
      id: 1,
      name: 'Materials',
      type: 'folder',
      collapsed: true,
      childs: [
        {
          id: 2,
          name: 'Metals',
          type: 'folder',
          collapsed: true,
          childs: [{ id: 3, name: 'Золотой металл', type: 'item', visible: false }],
        },
      ],
    },
    {
      id: 4,
      name: 'Other',
      type: 'folder',
      collapsed: true,
      childs: [{ id: 5, name: 'Золотой цвет', type: 'item' }],
    },
    { id: 6, name: 'Empty', type: 'folder', collapsed: false, childs: [] },
  ]);
  const scope = effectScope();
  scopes.push(scope);
  const search = scope.run(() => useLayerSearch(() => roots.value));
  return {
    roots,
    search,
    outer: roots.value[0],
    inner: roots.value[0].childs[0],
    item: roots.value[0].childs[0].childs[0],
    other: roots.value[1],
  };
}

describe('layer search', () => {
  it('finds all case-insensitive substrings and reveals their complete ancestor paths', () => {
    const { search, roots, outer, inner, item, other } = setup();
    const snapshot = JSON.stringify(roots.value);
    search.query.value = '  ЗОЛОТ  ';
    expect([...search.results.value.matches]).toEqual([3, 5]);
    expect([outer, inner, other].map(search.isCollapsed)).toEqual([false, false, false]);
    expect(item.visible).toBe(false);
    expect(JSON.stringify(roots.value)).toBe(snapshot);
    search.query.value = '';
    expect([outer, inner, other].map(search.isCollapsed)).toEqual([true, true, true]);
    expect(JSON.stringify(roots.value)).toBe(snapshot);
  });

  it('matches folder names, including empty folders', () => {
    const { search, outer, inner } = setup();
    search.query.value = 'MET';
    expect([...search.results.value.matches]).toEqual([2]);
    expect(search.isCollapsed(outer)).toBe(false);
    expect(search.isCollapsed(inner)).toBe(true);
    search.query.value = 'empty';
    expect([...search.results.value.matches]).toEqual([6]);
    expect(search.isCollapsed(outer)).toBe(true);
  });

  it('retains only interacted paths across query changes and starts a fresh search session', () => {
    const { search, inner, outer, item, other } = setup();
    search.query.value = 'золот';
    search.rememberInteraction(item);
    search.query.value = 'no results';
    expect(search.results.value.matches.size).toBe(0);
    search.query.value = '   ';
    expect([outer, inner, other].map(search.isCollapsed)).toEqual([false, false, true]);
    outer.collapsed = true;
    inner.collapsed = true;
    search.query.value = 'золот';
    search.query.value = '';
    expect([outer, inner, other].map(search.isCollapsed)).toEqual([true, true, true]);
  });

  it('does not count selection from before the search as an interaction', () => {
    const { search, item, outer } = setup();
    search.rememberInteraction(item);
    search.query.value = 'золот';
    search.query.value = '';
    expect(search.isCollapsed(outer)).toBe(true);
  });

  it('allows manually toggling a folder that search has expanded', () => {
    const { search, outer, inner } = setup();
    search.query.value = 'золот';
    search.toggleFolder(inner);
    expect(search.isCollapsed(inner)).toBe(true);
    search.toggleFolder(inner);
    expect(search.isCollapsed(inner)).toBe(false);
    search.query.value = '';
    expect(search.isCollapsed(inner)).toBe(false);
    expect(search.isCollapsed(outer)).toBe(false);
  });

  it('updates matches when names or children change', () => {
    const { search, item, other } = setup();
    search.query.value = 'new';
    item.name = 'New metal';
    expect([...search.results.value.matches]).toEqual([3]);
    other.childs.push({ id: 7, type: 'item', name: 'New color' });
    expect([...search.results.value.matches]).toEqual([3, 7]);
  });

  it('preserves the current path of moved items and tolerates deleted items', () => {
    const { search, outer, inner, item, other } = setup();
    search.query.value = 'золот';
    search.rememberInteraction(item);
    search.rememberInteraction(other.childs[0]);
    inner.childs.splice(0, 1);
    other.childs.splice(0, 1, item);
    search.query.value = '';
    expect([outer, inner, other].map(search.isCollapsed)).toEqual([true, true, false]);
  });
});
