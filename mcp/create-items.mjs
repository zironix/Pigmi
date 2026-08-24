export function buildCreateItemsOperation({ items, folderPath, defaults }) {
  const commonFolderPath = String(folderPath || '').trim();
  const sharedDefaults = commonFolderPath
    ? { ...(defaults || {}), folderPath: commonFolderPath }
    : defaults;

  return {
    type: 'create_gradient_items',
    defaults: sharedDefaults,
    items,
  };
}
