import {
  applyFolderStateOperation,
  applyMoveLayerOperation,
  applySelectionOperation,
  applyTextureOperation,
  applyVisibilityOperation,
} from './aiDocumentOperations';
import {
  applyColorsToItem,
  applyEditToItems,
  applyItemPosition,
  applyItemOpacity,
  applyItemRename,
  applyItemUpdates,
  attachLayerItemNode,
  collectRelativeSubfolderPaths,
  createDefaultItemTemplate,
  mergeOperationDefaults,
  resolveTargetItems,
} from './aiPlanOperations';
import {
  autoArrangeCreatedItems,
  buildPerItemRecolorPalette,
  clamp,
  collectItemFolderPaths,
  collectItemIdsFromLayerNodes,
  computeItemBounds,
  deepClone,
  deriveFallbackRecolorColors,
  ensureFolderPath,
  findFolderInfoByPath,
  findFolderNodeByPath,
  findLayerNodeById,
  findNonOverlappingPosition,
  normalizeGeneratedItemName,
  normalizeHexColor,
  removeLayerNodesByIds,
  snap,
  toNumber,
} from './aiPlanShared';

export function applyAiPlan({
  plan,
  texture,
  layersStore,
  nextLayerId,
  forceGradientType = null,
  layoutHints = null,
  lastItem = null,
}) {
  const layers = Array.isArray(texture.layers) ? texture.layers : [];
  texture.layers = layers;
  if (!Array.isArray(texture.items)) texture.items = [];

  let selectionIds = Array.isArray(layersStore?.selected) ? [...layersStore.selected] : [];

  const createdItemIds = [];
  const warnings = [];
  const rawOperations = Array.isArray(plan?.operations) ? plan.operations : [];
  const isRenameOnlyPlan =
    rawOperations.length > 0 &&
    rawOperations.every((op) => op && (op.type === 'rename_folder' || op.type === 'rename_item'));
  const operations = isRenameOnlyPlan
    ? [
        ...rawOperations
          .filter((op) => op && op.type === 'rename_folder')
          .sort((a, b) => {
            const aPath =
              typeof a.path === 'string'
                ? a.path
                : typeof a.folderPath === 'string'
                  ? a.folderPath
                  : '';
            const bPath =
              typeof b.path === 'string'
                ? b.path
                : typeof b.folderPath === 'string'
                  ? b.folderPath
                  : '';
            return (
              bPath.split('/').filter(Boolean).length - aPath.split('/').filter(Boolean).length
            );
          }),
        ...rawOperations.filter((op) => op && op.type === 'rename_item'),
      ]
    : rawOperations;

  operations.forEach((op, index) => {
    if (!op || typeof op !== 'object') return;
    if (op.type === 'update_texture') {
      if (!applyTextureOperation({ op, texture })) {
        warnings.push(`op#${index + 1}: update_texture had no valid changes`);
      }
      return;
    }

    if (op.type === 'set_selection') {
      if (
        !applySelectionOperation({
          op,
          texture,
          layers,
          layersStore,
          selectionIds,
        })
      ) {
        warnings.push(`op#${index + 1}: set_selection target not found`);
      }
      selectionIds = Array.isArray(layersStore?.selected) ? [...layersStore.selected] : [];
      return;
    }

    if (op.type === 'set_visibility') {
      if (!applyVisibilityOperation({ op, texture, layers, selectionIds })) {
        warnings.push(`op#${index + 1}: set_visibility target not found`);
      }
      return;
    }

    if (op.type === 'set_folder_state') {
      if (!applyFolderStateOperation({ op, texture, layers })) {
        warnings.push(`op#${index + 1}: set_folder_state target not found`);
      }
      return;
    }

    if (op.type === 'move_layer') {
      if (!applyMoveLayerOperation({ op, layers, nextLayerId })) {
        warnings.push(`op#${index + 1}: move_layer target or destination not found`);
      }
      return;
    }

    if (op.type === 'create_folder') {
      const folderPath = typeof op.path === 'string' ? op.path : '';
      if (!folderPath.trim()) {
        warnings.push(`op#${index + 1}: create_folder without path`);
        return;
      }
      ensureFolderPath({
        layers,
        path: folderPath,
        nextLayerId,
      });
      return;
    }

    if (op.type === 'duplicate_folder') {
      const sourcePath =
        typeof op.sourcePath === 'string'
          ? op.sourcePath.trim()
          : typeof op.path === 'string'
            ? op.path.trim()
            : typeof op.folderPath === 'string'
              ? op.folderPath.trim()
              : '';
      if (!sourcePath) {
        warnings.push(`op#${index + 1}: duplicate_folder sourcePath is empty`);
        return;
      }
      const newPath = typeof op.newPath === 'string' && op.newPath.trim() ? op.newPath.trim() : '';
      if (!newPath) {
        warnings.push(`op#${index + 1}: duplicate_folder newPath is empty`);
        return;
      }
      const sourceFolder = findFolderNodeByPath(layers, sourcePath);
      if (!sourceFolder) {
        warnings.push(`op#${index + 1}: duplicate_folder source not found`);
        return;
      }

      ensureFolderPath({
        layers,
        path: newPath,
        nextLayerId,
      });

      const relSubfolders = [];
      collectRelativeSubfolderPaths(sourceFolder, '', relSubfolders);
      relSubfolders.forEach((rel) => {
        ensureFolderPath({
          layers,
          path: `${newPath}/${rel}`,
          nextLayerId,
        });
      });

      const itemFolderMap = new Map();
      collectItemFolderPaths(layers, '', itemFolderMap);
      const sourceItems = texture.items
        .filter((item) => {
          const itemPath = String(itemFolderMap.get(item.id) || '');
          return itemPath === sourcePath || itemPath.startsWith(`${sourcePath}/`);
        })
        .sort((a, b) => {
          const ay = toNumber(a.y, 0);
          const by = toNumber(b.y, 0);
          if (ay !== by) return ay - by;
          return toNumber(a.x, 0) - toNumber(b.x, 0);
        });

      if (!sourceItems.length) {
        warnings.push(`op#${index + 1}: duplicate_folder source has no items`);
        return;
      }

      const step = toNumber(texture.step, 1) || 1;
      const width = Math.max(1, toNumber(texture.width, 2048));
      const height = Math.max(1, toNumber(texture.height, 2048));
      const offsetX = toNumber(op?.offset?.x, 0);
      const offsetY = toNumber(op?.offset?.y, step);

      sourceItems.forEach((sourceItem) => {
        const cloned = deepClone(sourceItem);
        cloned.id = nextLayerId();
        cloned.selected = false;
        const sourceItemPath = String(itemFolderMap.get(sourceItem.id) || sourcePath);
        const relative =
          sourceItemPath === sourcePath ? '' : sourceItemPath.slice(sourcePath.length + 1);
        const targetItemPath = relative ? `${newPath}/${relative}` : newPath;

        const bounds = computeItemBounds(cloned) || { w: 1, h: 1 };
        const maxX = Math.max(0, width - bounds.w);
        const maxY = Math.max(0, height - bounds.h);
        cloned.x = clamp(snap(toNumber(sourceItem.x, 0) + offsetX, step), 0, maxX);
        cloned.y = clamp(snap(toNumber(sourceItem.y, 0) + offsetY, step), 0, maxY);
        const freePos = findNonOverlappingPosition({
          item: cloned,
          desiredX: cloned.x,
          desiredY: cloned.y,
          texture,
          occupiedItems: texture.items,
        });
        cloned.x = freePos.x;
        cloned.y = freePos.y;

        texture.items.push(cloned);
        attachLayerItemNode({
          layers,
          folderPath: targetItemPath,
          item: cloned,
        });
        createdItemIds.push(cloned.id);
      });
      return;
    }

    if (op.type === 'create_gradient_item') {
      if (op.folderPath) {
        ensureFolderPath({
          layers,
          path: op.folderPath,
          nextLayerId,
        });
      }
      const item = createDefaultItemTemplate({
        texture,
        nextLayerId,
        op,
        forceGradientType,
        lastItem,
      });
      const freePos = findNonOverlappingPosition({
        item,
        desiredX: item.x,
        desiredY: item.y,
        texture,
        occupiedItems: texture.items,
      });
      item.x = freePos.x;
      item.y = freePos.y;
      texture.items.push(item);
      attachLayerItemNode({
        layers,
        folderPath: op.folderPath,
        item,
      });
      createdItemIds.push(item.id);
      return;
    }

    if (op.type === 'create_gradient_items') {
      const defaults = op.defaults && typeof op.defaults === 'object' ? op.defaults : {};
      const itemConfigs = Array.isArray(op.items) ? op.items : [];
      if (!itemConfigs.length) {
        warnings.push(`op#${index + 1}: create_gradient_items without items`);
        return;
      }
      itemConfigs.forEach((itemConfig, itemIndex) => {
        if (!itemConfig || typeof itemConfig !== 'object') {
          warnings.push(`op#${index + 1}.${itemIndex + 1}: create_gradient_items item is invalid`);
          return;
        }
        const mergedOp = mergeOperationDefaults(defaults, itemConfig);
        if (mergedOp.folderPath) {
          ensureFolderPath({
            layers,
            path: mergedOp.folderPath,
            nextLayerId,
          });
        }
        const item = createDefaultItemTemplate({
          texture,
          nextLayerId,
          op: mergedOp,
          forceGradientType,
          lastItem,
        });
        const freePos = findNonOverlappingPosition({
          item,
          desiredX: item.x,
          desiredY: item.y,
          texture,
          occupiedItems: texture.items,
        });
        item.x = freePos.x;
        item.y = freePos.y;
        texture.items.push(item);
        attachLayerItemNode({
          layers,
          folderPath: mergedOp.folderPath,
          item,
        });
        createdItemIds.push(item.id);
      });
      return;
    }

    if (op.type === 'duplicate_item') {
      const targetConfig = op.target && typeof op.target === 'object' ? { ...op.target } : {};
      if (!targetConfig.folderPath && typeof op.folderPath === 'string') {
        targetConfig.folderPath = op.folderPath;
      }
      const targetItems = resolveTargetItems(texture, selectionIds, targetConfig, layers);
      if (!targetItems.length) {
        warnings.push(`op#${index + 1}: duplicate target not found`);
        return;
      }
      const step = toNumber(texture.step, 1) || 1;
      const width = Math.max(1, toNumber(texture.width, 2048));
      const height = Math.max(1, toNumber(texture.height, 2048));

      targetItems.forEach((source, sourceIndex) => {
        const cloned = deepClone(source);
        cloned.id = nextLayerId();
        cloned.selected = false;
        if (typeof op.newName === 'string' && op.newName.trim()) {
          cloned.name =
            targetItems.length > 1 ? `${op.newName.trim()} ${sourceIndex + 1}` : op.newName.trim();
        } else {
          cloned.name = `${source.name || 'Item'} copy`;
        }
        cloned.name = normalizeGeneratedItemName(cloned.name, op.folderPath);
        const offsetX = toNumber(op?.offset?.x, 0);
        const offsetY = toNumber(op?.offset?.y, step);
        const bounds = computeItemBounds(cloned) || { w: 1, h: 1 };
        const maxX = Math.max(0, width - bounds.w);
        const maxY = Math.max(0, height - bounds.h);
        cloned.x = clamp(snap(toNumber(source.x, 0) + offsetX, step), 0, maxX);
        cloned.y = clamp(snap(toNumber(source.y, 0) + offsetY, step), 0, maxY);
        const freePos = findNonOverlappingPosition({
          item: cloned,
          desiredX: cloned.x,
          desiredY: cloned.y,
          texture,
          occupiedItems: texture.items,
        });
        cloned.x = freePos.x;
        cloned.y = freePos.y;

        if (Array.isArray(op.colors) && op.colors.length) {
          applyColorsToItem(cloned, op.colors);
        }
        applyItemOpacity(cloned, op);

        texture.items.push(cloned);

        let folderPath = typeof op.folderPath === 'string' ? op.folderPath : '';
        if (!folderPath) {
          const sourceNode = findLayerNodeById(layers, source.id);
          if (sourceNode?.parent?.type === 'folder') {
            folderPath = sourceNode.parent.name;
          }
        } else {
          ensureFolderPath({
            layers,
            path: folderPath,
            nextLayerId,
          });
        }
        attachLayerItemNode({
          layers,
          folderPath,
          item: cloned,
        });
        createdItemIds.push(cloned.id);
      });
      return;
    }

    if (op.type === 'edit_items') {
      applyEditToItems({
        op,
        texture,
        layers,
        selectionIds,
        nextLayerId,
        warnings,
        index,
      });
      return;
    }

    if (op.type === 'recolor_item') {
      const targetConfig = op.target && typeof op.target === 'object' ? { ...op.target } : {};
      if (!targetConfig.folderPath && typeof op.folderPath === 'string') {
        targetConfig.folderPath = op.folderPath;
      }
      const targetItems = resolveTargetItems(texture, selectionIds, targetConfig, layers);
      if (!targetItems.length) {
        warnings.push(`op#${index + 1}: recolor target not found`);
        return;
      }
      const normalizedSourceColors = Array.isArray(op.colors)
        ? op.colors.map(normalizeHexColor).filter(Boolean)
        : [];
      targetItems.forEach((item, itemIndex) => {
        const perItemColors = normalizedSourceColors.length
          ? targetItems.length > 1
            ? buildPerItemRecolorPalette(
                item,
                normalizedSourceColors,
                itemIndex,
                targetItems.length,
              )
            : normalizedSourceColors
          : deriveFallbackRecolorColors(item, itemIndex, targetItems.length);
        if (!applyColorsToItem(item, perItemColors)) {
          warnings.push(`op#${index + 1}: recolor failed for ${item.name || item.id}`);
        }
        applyItemOpacity(item, op);
      });
      return;
    }

    if (op.type === 'update_item') {
      const targetConfig = op.target && typeof op.target === 'object' ? { ...op.target } : {};
      if (!targetConfig.folderPath && typeof op.folderPath === 'string') {
        targetConfig.folderPath = op.folderPath;
      }
      const targetItems = resolveTargetItems(texture, selectionIds, targetConfig, layers);
      if (!targetItems.length) {
        warnings.push(`op#${index + 1}: update_item target not found`);
        return;
      }
      targetItems.forEach((item) => {
        if (!applyItemUpdates({ item, op, texture })) {
          warnings.push(
            `op#${index + 1}: update_item had no valid changes for ${item.name || item.id}`,
          );
        }
      });
      return;
    }

    if (op.type === 'delete_item') {
      const targetConfig = op.target && typeof op.target === 'object' ? { ...op.target } : {};
      if (!targetConfig.folderPath && typeof op.folderPath === 'string') {
        targetConfig.folderPath = op.folderPath;
      }
      const targetItems = resolveTargetItems(texture, selectionIds, targetConfig, layers);
      if (!targetItems.length) {
        warnings.push(`op#${index + 1}: delete_item target not found`);
        return;
      }
      const ids = new Set(targetItems.map((item) => item.id));
      texture.items = texture.items.filter((item) => !ids.has(item.id));
      removeLayerNodesByIds(layers, ids);
      return;
    }

    if (op.type === 'delete_folder') {
      const folderPath =
        typeof op.path === 'string'
          ? op.path
          : typeof op.folderPath === 'string'
            ? op.folderPath
            : '';
      if (!folderPath.trim()) {
        warnings.push(`op#${index + 1}: delete_folder path is empty`);
        return;
      }
      const folderInfo = findFolderInfoByPath(layers, folderPath);
      if (!folderInfo) {
        warnings.push(`op#${index + 1}: delete_folder target not found`);
        return;
      }
      const ids = collectItemIdsFromLayerNodes([folderInfo.node]);
      texture.items = texture.items.filter((item) => !ids.has(item.id));
      folderInfo.parentArray.splice(folderInfo.index, 1);
      return;
    }

    if (op.type === 'move_item') {
      const targetConfig = op.target && typeof op.target === 'object' ? { ...op.target } : {};
      if (!targetConfig.folderPath && typeof op.folderPath === 'string') {
        targetConfig.folderPath = op.folderPath;
      }
      const targetItems = resolveTargetItems(texture, selectionIds, targetConfig, layers);
      if (!targetItems.length) {
        warnings.push(`op#${index + 1}: move target not found`);
        return;
      }
      targetItems.forEach((item) => {
        applyItemPosition({ item, op, texture });
      });
      return;
    }

    if (op.type === 'rename_item') {
      const targetConfig = op.target && typeof op.target === 'object' ? { ...op.target } : {};
      if (!targetConfig.folderPath && typeof op.folderPath === 'string') {
        targetConfig.folderPath = op.folderPath;
      }
      const targetItems = resolveTargetItems(texture, selectionIds, targetConfig, layers);
      if (!targetItems.length) {
        warnings.push(`op#${index + 1}: rename_item target not found`);
        return;
      }
      const baseName = typeof op.newName === 'string' ? op.newName.trim() : '';
      if (!baseName) {
        warnings.push(`op#${index + 1}: rename_item newName is empty`);
        return;
      }
      targetItems.forEach((item, itemIndex) => {
        const nextName = targetItems.length > 1 ? `${baseName} ${itemIndex + 1}` : baseName;
        applyItemRename({
          item,
          name: nextName,
          folderPath: targetConfig.folderPath || op.folderPath,
          layers,
        });
      });
      return;
    }

    if (op.type === 'rename_folder') {
      const folderPath =
        typeof op.path === 'string'
          ? op.path
          : typeof op.folderPath === 'string'
            ? op.folderPath
            : '';
      if (!folderPath.trim()) {
        warnings.push(`op#${index + 1}: rename_folder path is empty`);
        return;
      }
      const nextName = typeof op.newName === 'string' ? op.newName.trim() : '';
      if (!nextName) {
        warnings.push(`op#${index + 1}: rename_folder newName is empty`);
        return;
      }
      const folder = findFolderNodeByPath(layers, folderPath);
      if (!folder) {
        warnings.push(`op#${index + 1}: rename_folder target not found`);
        return;
      }
      folder.name = nextName;
      return;
    }
  });

  const effectiveLayoutHints = layoutHints || plan?.layout || null;
  if (
    createdItemIds.length &&
    effectiveLayoutHints &&
    effectiveLayoutHints.compactCreated === true
  ) {
    autoArrangeCreatedItems({
      texture,
      createdItemIds,
      itemsPerRow: effectiveLayoutHints.itemsPerRow,
      itemsPerColumn: effectiveLayoutHints.itemsPerColumn,
      flowDirection: effectiveLayoutHints.flowDirection,
      itemGapSteps: effectiveLayoutHints.itemGapSteps,
      startRow: effectiveLayoutHints.startRow,
      startColumn: effectiveLayoutHints.startColumn,
      offsetCellsX: effectiveLayoutHints.offsetCellsX,
      offsetCellsY: effectiveLayoutHints.offsetCellsY,
    });
  }

  return {
    createdItemIds,
    warnings,
  };
}
