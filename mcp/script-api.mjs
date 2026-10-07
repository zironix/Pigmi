// This function is serialized into QuickJS. It has no host closures or callbacks.
export function runPigmiScript(snapshot, readOnly, callback) {
  'use strict';
  const stringify = JSON.stringify.bind(JSON);
  const parse = JSON.parse.bind(JSON);
  const clone = (value) => parse(stringify(value));
  const freeze = (value) => {
    if (value && typeof value === 'object') {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  };
  freeze(snapshot);
  const operations = [];
  let layout = null;
  const queue = (operation) => {
    if (readOnly) throw new Error('readOnly scripts cannot queue changes');
    if (operations.length >= 500) throw new Error('At most 500 operations per script');
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new Error('An operation must be an object');
    }
    operations.push(clone(operation));
  };
  const target = (value) => {
    if (typeof value === 'string' || typeof value === 'number') return { id: value };
    if (Array.isArray(value)) return { ids: value.map((item) => item?.id ?? item) };
    if (value && typeof value === 'object') {
      if (value.id !== undefined) return { id: value.id };
      return clone(value);
    }
    throw new Error('Target must be an item, ID, ID array, or operation selector');
  };
  const selected = new Set(snapshot.selection.map(String));
  const api = Object.freeze({
    document: snapshot.document,
    defaults: snapshot.defaults,
    selection: snapshot.selection,
    folders: () => snapshot.folders.slice(),
    items: (filter = {}) => {
      if (typeof filter === 'function') return snapshot.items.filter(filter);
      if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
        throw new Error('items filter must be a selector object or predicate');
      }
      const allowed = ['ids', 'paths', 'folderPath', 'query', 'selected'];
      for (const key of Object.keys(filter)) {
        if (!allowed.includes(key)) throw new Error(`Unknown items filter: ${key}`);
      }
      const ids = filter.ids && new Set(filter.ids.map(String));
      const paths = filter.paths && new Set(filter.paths);
      const query = String(filter.query || '').toLowerCase();
      return snapshot.items.filter(
        (item) =>
          (!ids || ids.has(String(item.id))) &&
          (!paths || paths.has(item.path)) &&
          (!filter.selected || selected.has(String(item.id))) &&
          (!filter.folderPath ||
            item.folderPath === filter.folderPath ||
            item.folderPath.startsWith(`${filter.folderPath}/`)) &&
          (!query || item.path.toLowerCase().includes(query)),
      );
    },
    update: (value, patch) => queue({ ...patch, type: 'update_item', target: target(value) }),
    recolor: (value, colors) => queue({ type: 'recolor_item', target: target(value), colors }),
    create: (items, options = {}) => {
      if (!Array.isArray(items) || !items.length || items.length > 500) {
        throw new Error('create requires 1..500 items');
      }
      const defaults = options.folderPath
        ? { ...options.defaults, folderPath: options.folderPath }
        : options.defaults;
      return queue({ type: 'create_gradient_items', items, defaults });
    },
    duplicateFolder: (sourcePath, newPath, options = {}) =>
      queue({ ...options, type: 'duplicate_folder', sourcePath, newPath }),
    operation: queue,
    layout: (options) => {
      if (readOnly) throw new Error('readOnly scripts cannot set layout');
      layout = clone(options);
    },
  });
  const result = callback(api);
  if (result && typeof result.then === 'function') {
    throw new Error('Scripts must be synchronous; return JSON data, not a Promise');
  }
  const resultJson = stringify(result === undefined ? null : result);
  if (typeof resultJson !== 'string' || resultJson.length > 16_384) {
    throw new Error('Return a compact JSON result (at most 16 KiB)');
  }
  const planJson = stringify({ operations, layout, result: parse(resultJson) });
  if (planJson.length > 900_000) throw new Error('Generated changes exceed the batch size limit');
  return planJson;
}
