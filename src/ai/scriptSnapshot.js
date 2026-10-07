import { buildEditorOverview } from './editorContext';
import {
  collectItemFolderPaths,
  getMapValueById,
  itemColorStops,
  itemHexColors,
} from './aiPlanShared';

// Internal bridge payload: complete local data for scripts, never a model-facing index.
export function buildScriptSnapshot({ texture, selectionIds, lastItem }) {
  const overview = buildEditorOverview({ texture, selectionIds, lastItem, detail: 'summary' });
  const paths = new Map();
  collectItemFolderPaths(texture.layers, '', paths);
  const folders = [];
  const visit = (nodes, parentPath = '') => {
    for (const node of nodes || []) {
      if (node.type !== 'folder') continue;
      const path = [parentPath, node.name].filter(Boolean).join('/');
      folders.push({
        id: node.id,
        name: node.name,
        path,
        parentPath,
        visible: node.visible !== false,
      });
      visit(node.childs, path);
    }
  };
  visit(texture.layers);
  const items = (texture.items || []).map((item) => {
    const folderPath = getMapValueById(paths, item.id) || '';
    return {
      id: item.id,
      name: item.name,
      path: [folderPath, item.name].filter(Boolean).join('/'),
      folderPath,
      itemType: item.type,
      shape: item.shape,
      direction: item.direction,
      colorMode: item.color_mode,
      colors: itemHexColors(item),
      colorStops: itemColorStops(item),
      colorOffsets: item.color_offsets,
      size: item.size,
      steps: item.steps,
      x: item.x,
      y: item.y,
      visible: item.visible !== false,
      material: {
        albedo: item.albedo,
        roughness: item.roughness,
        metallic: item.metallic,
        emission: item.emission,
        emissionStrength: item.emission_strength,
        clearcoat: item.clearcoat,
        clearcoatRoughness: item.clearcoat_roughness,
      },
    };
  });
  return {
    document: overview.document,
    defaults: overview.defaults,
    selection: [...selectionIds],
    folders,
    items,
  };
}
