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
  //console.log(item)
  if (item.type === 'g') {
    if (item.shape === 'l') {
      if (item.direction === 'vertical') {
        return `linear-gradient(180deg, ${cssStops})`;
      } else {
        return `linear-gradient(90deg, ${cssStops})`;
      }
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
    } else {
      if (item.direction === 'vertical') {
        return `linear-gradient(180deg, ${cssStops})`;
      } else {
        return `linear-gradient(90deg, ${cssStops})`;
      }
    }
  }
}

/**
 * buildTree(items)
 * - не сливает одинаковые items (каждый лист — отдельный объект с itemIndex)
 * - создает group-узлы только для сегментов до последнего
 * - последний сегмент всегда лист (isItem: true)
 */
export function buildTree(items = []) {
  const roots = [];
  const rootMap = new Map(); // для быстрого поиска групп на корне

  function createGroupNode(label, key, path) {
    return {
      label, // отображаемое имя
      _key: key, // нормализованный ключ для поиска
      path, // полный путь до этого group-узла
      children: [], // сюда попадут либо дальнейшие group-узлы, либо листы (isItem)
      _childrenMap: new Map(),
      _id: path, // ключ для v-for (уникален для групп)
    };
  }

  items.forEach((it, idx) => {
    if (!it || typeof it.name !== 'string') return;

    const parts = it.name
      .split('/')
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parts.length === 0) return;

    // PREVIEW CSS заранее
    const previewCss = previewCssFromItem(it);

    // если только один сегмент -> лист на корне
    if (parts.length === 1) {
      const leaf = {
        label: parts[0],
        path: parts[0],
        isItem: true,
        itemIndex: idx,
        previewCss,
        _id: `item-${idx}`,
      };
      roots.push(leaf);
      return;
    }

    // иначе: создаём (или находим) group-узлы для всех сегментов, кроме последнего
    let parentList = roots;
    let parentMap = rootMap;
    const acc = [];

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const key = part.toLowerCase();
      acc.push(part);
      const path = acc.join('/');

      let node = parentMap.get(key);
      if (!node) {
        node = createGroupNode(part, key, path);
        parentList.push(node);
        parentMap.set(key, node);
      } else {
        if (!node.path) node.path = path;
        if (!node._id) node._id = path;
      }

      // descend
      parentList = node.children;
      parentMap = node._childrenMap;
    }

    // parentList сейчас — children у последнего group-узла (или roots если не было)
    const lastPart = parts[parts.length - 1];
    const fullPath = parts.join('/');

    const leaf = {
      label: lastPart,
      path: fullPath,
      isItem: true,
      itemIndex: idx,
      previewCss,
      _id: `item-${idx}`,
    };

    parentList.push(leaf);
  });

  // удаляем вспомогательные карты перед возвратом
  (function stripMaps(nodes) {
    for (const n of nodes) {
      if (n._childrenMap) delete n._childrenMap;
      if (n.children && n.children.length) stripMaps(n.children);
    }
  })(roots);

  return roots;
}
