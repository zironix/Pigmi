import { computed, ref, watch } from 'vue';

export const layerSearchKey = Symbol('layerSearch');

// Search expansion is a view override: it must not change the saved tree.
export function useLayerSearch(getRoots) {
  const query = ref('');
  const normalizedQuery = computed(() => query.value.trim().toLowerCase());
  const collapsedOverrides = ref(new Map());
  const interactedIds = new Set();

  const results = computed(() => {
    const matches = new Set();
    const expanded = new Set();
    const needle = normalizedQuery.value;
    if (!needle) return { matches, expanded };

    function visit(nodes, parents = []) {
      for (const node of nodes) {
        if (
          String(node.name ?? '')
            .toLowerCase()
            .includes(needle)
        ) {
          matches.add(node.id);
          for (const parent of parents) expanded.add(parent.id);
        }
        if (Array.isArray(node.childs)) visit(node.childs, [...parents, node]);
      }
    }
    visit(getRoots());
    return { matches, expanded };
  });

  function rememberInteraction(node) {
    if (normalizedQuery.value) interactedIds.add(node.id);
  }

  function finishSearch() {
    // Resolve paths against the current tree, including any drag/paste changes.
    function visit(nodes, parents = []) {
      for (const node of nodes) {
        if (interactedIds.has(node.id)) {
          for (const parent of parents) parent.collapsed = false;
        }
        if (Array.isArray(node.childs)) visit(node.childs, [...parents, node]);
      }
    }
    if (interactedIds.size) visit(getRoots());
    interactedIds.clear();
    collapsedOverrides.value.clear();
  }

  watch(
    normalizedQuery,
    (next) => {
      if (!next) finishSearch();
      else collapsedOverrides.value.clear();
    },
    { flush: 'sync' },
  );

  function isCollapsed(node) {
    if (normalizedQuery.value) {
      if (collapsedOverrides.value.has(node.id)) return collapsedOverrides.value.get(node.id);
      if (results.value.expanded.has(node.id)) return false;
    }
    return !!node.collapsed;
  }

  function toggleFolder(node) {
    rememberInteraction(node);
    const collapsed = !isCollapsed(node);
    node.collapsed = collapsed;
    if (normalizedQuery.value) collapsedOverrides.value.set(node.id, collapsed);
  }

  return {
    query,
    normalizedQuery,
    results,
    isCollapsed,
    toggleFolder,
    rememberInteraction,
    finishSearch,
  };
}
