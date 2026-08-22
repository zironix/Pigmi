// buildTree.js

export function rgbaToCss(rgba) {
  if (!rgba) return 'rgba(0,0,0,1)';
  return `rgba(${Math.round(rgba.r)}, ${Math.round(rgba.g)}, ${Math.round(rgba.b)}, ${Number(rgba.a)})`;
}

export function previewCssFromItem(item) {
  const colors = Array.isArray(item.colors) ? item.colors : [];
  const offsets = Array.isArray(item.color_offsets) ? item.color_offsets : [];

  if (colors.length === 0) return '';

  const stops = colors.map((c, i) => {
    const col = c && c.rgba ? rgbaToCss(c.rgba) : 'rgba(0,0,0,1)';
    const off = offsets[i] != null ? Number(offsets[i]) : i === 0 ? 0 : 100;
    return { col, off: Math.max(0, Math.min(100, off)) };
  });

  if (stops.length === 1) return stops[0].col;

  const ok = stops.every((s, i, a) => i === 0 || s.off >= a[i - 1].off);
  let cssStops;
  if (ok) {
    if (item.type === 'sg') {
      cssStops = stops.map((s) => `${s.col}`).join(', ');
    } else {
      cssStops = stops.map((s) => `${s.col} ${s.off}%`).join(', ');
    }
  } else {
    cssStops = stops
      .map((s, i, a) => {
        const p = Math.round((i / (a.length - 1)) * 100);
        if (item.type === 'sg') {
          return `${s.col}`;
        } else {
          return `${s.col} ${p}%`;
        }
      })
      .join(', ');
  }
  if (item.type === 'g') {
    if (item.shape === 'l') {
      if (item.direction === 'vertical') {
        return `linear-gradient(180deg, ${cssStops})`;
      }
      return `linear-gradient(90deg, ${cssStops})`;
    }
    if (item.shape === 'r') {
      return `radial-gradient(${cssStops})`;
    }
    if (item.shape === 'c') {
      return `conic-gradient(from 180deg, ${cssStops})`;
    }
  }
  if (item.type === 'sg') {
    if (item.color_mode === 'black_to_white') {
      return rgbaToCss(item.colors[0].rgba);
    }
    if (item.direction === 'vertical') {
      return `linear-gradient(180deg, ${cssStops})`;
    }
    return `linear-gradient(90deg, ${cssStops})`;
  }
}

/**
 * Converts slash-separated item names into the tree used by the search panel.
 * Duplicate items remain separate leaves, and only path segments become groups.
 */
export function buildTree(items = []) {
  const roots = [];
  const rootGroups = new Map();

  function createGroupNode(label, key, path) {
    return {
      label,
      _key: key,
      path,
      children: [],
      _childrenMap: new Map(),
      _id: path,
    };
  }

  items.forEach((item, itemIndex) => {
    if (!item || typeof item.name !== 'string') return;

    const pathParts = item.name
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    if (pathParts.length === 0) return;

    const previewCss = previewCssFromItem(item);

    if (pathParts.length === 1) {
      roots.push({
        label: pathParts[0],
        path: pathParts[0],
        isItem: true,
        itemIndex,
        previewCss,
        _id: `item-${itemIndex}`,
      });
      return;
    }

    let siblingNodes = roots;
    let siblingGroups = rootGroups;
    const currentPath = [];

    for (const part of pathParts.slice(0, -1)) {
      const key = part.toLowerCase();
      currentPath.push(part);
      const path = currentPath.join('/');

      let node = siblingGroups.get(key);
      if (!node) {
        node = createGroupNode(part, key, path);
        siblingNodes.push(node);
        siblingGroups.set(key, node);
      }

      siblingNodes = node.children;
      siblingGroups = node._childrenMap;
    }

    siblingNodes.push({
      label: pathParts[pathParts.length - 1],
      path: pathParts.join('/'),
      isItem: true,
      itemIndex,
      previewCss,
      _id: `item-${itemIndex}`,
    });
  });

  function removeLookupMaps(nodes) {
    for (const node of nodes) {
      delete node._childrenMap;
      if (node.children?.length) {
        removeLookupMaps(node.children);
      }
    }
  }

  removeLookupMaps(roots);
  return roots;
}
