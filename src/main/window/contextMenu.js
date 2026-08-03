export function shouldShowEditContextMenu(params = {}) {
  return params.isEditable === true || String(params.selectionText || '').length > 0;
}
