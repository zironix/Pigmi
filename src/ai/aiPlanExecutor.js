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
  createDefaultItemTemplate,
  mergeOperationDefaults,
  resolveTargetItems,
} from './aiPlanOperations';
import {
  autoArrangeCreatedItems,
  buildPerItemRecolorPalette,
  clamp,
  collectItemIdsFromLayerNodes,
  computeItemBounds,
  deepClone,
  deriveFallbackRecolorColors,
  ensureFolderPath,
  findFolderInfoByPath,
  findFolderNodeByPath,
  findLayerNodeById,
  findNonOverlappingPosition,
  idKey,
  normalizeGeneratedItemName,
  normalizeHexColor,
  normalizePathLike,
  removeLayerNodesByIds,
  snap,
  toNumber,
} from './aiPlanShared';

function applyColorsPreservingMetadata(item, edit) {
  if (!Array.isArray(edit?.colors) || !edit.colors.length) return false;
  const previousOffsets = Array.isArray(item.color_offsets) ? item.color_offsets.slice() : [];
  const previousOpacities = Array.isArray(item.colors)
    ? item.colors.map((color) => clamp(toNumber(color?.rgba?.a, 1), 0, 1) * 100)
    : [];
  const changed = applyColorsToItem(item, edit.colors);
  if (!changed) return false;

  if (!Array.isArray(edit.colorOffsets) && previousOffsets.length === item.colors.length) {
    item.color_offsets = previousOffsets;
  }
  if (
    edit.opacity === undefined &&
    !Array.isArray(edit.opacities) &&
    previousOpacities.length === item.colors.length
  ) {
    const nextOpacities = edit.colors.map((color, index) =>
      /^#?[0-9a-f]{8}$/i.test(String(color || '').trim()) ? null : previousOpacities[index],
    );
    item.colors.forEach((color, index) => {
      const opacity = nextOpacities[index];
      if (opacity === null) return;
      const alpha = clamp(toNumber(opacity, 100), 0, 100) / 100;
      if (color?.rgba) color.rgba.a = alpha;
      if (color?.hsva) color.hsva.a = alpha;
    });
  }
  return true;
}

function applyStructuredItemEdit({ item, edit, texture, layers, folderPath }) {
  let changed = applyColorsPreservingMetadata(item, edit);
  if (typeof edit?.newName === 'string' || typeof edit?.name === 'string') {
    changed =
      applyItemRename({
        item,
        name: typeof edit.newName === 'string' ? edit.newName : edit.name,
        folderPath,
        layers,
      }) || changed;
  }
  changed = applyItemPosition({ item, op: edit, texture }) || changed;
  changed = applyItemUpdates({ item, op: edit, texture }) || changed;
  if (typeof edit?.visible === 'boolean') {
    item.visible = edit.visible;
    const layerNode = findLayerNodeById(layers, item.id)?.node;
    if (layerNode?.type === 'item') layerNode.visible = edit.visible;
    changed = true;
  }
  return changed;
}

function collectRelativeLayerItems(folderNode, currentFolder = '', entries = []) {
  if (!folderNode || !Array.isArray(folderNode.childs)) return entries;
  folderNode.childs.forEach((node) => {
    const name = String(node?.name || '').trim();
    if (!name) return;
    if (node.type === 'folder') {
      const nextFolder = currentFolder ? `${currentFolder}/${name}` : name;
      collectRelativeLayerItems(node, nextFolder, entries);
    } else if (node.type === 'item') {
      entries.push({
        node,
        folderPath: currentFolder,
        relativePath: currentFolder ? `${currentFolder}/${name}` : name,
      });
    }
  });
  return entries;
}

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
      if (findFolderNodeByPath(layers, newPath)) {
        warnings.push(`op#${index + 1}: duplicate_folder destination already exists`);
        return;
      }

      const sourceEntries = collectRelativeLayerItems(sourceFolder);
      if (!sourceEntries.length) {
        warnings.push(`op#${index + 1}: duplicate_folder source has no items`);
        return;
      }

      const itemById = new Map(texture.items.map((item) => [idKey(item.id), item]));
      const missingPayload = sourceEntries.find((entry) => !itemById.has(idKey(entry.node.id)));
      if (missingPayload) {
        warnings.push(
          `op#${index + 1}: duplicate_folder item payload not found: ${missingPayload.relativePath}`,
        );
        return;
      }

      const targetFolder = ensureFolderPath({ layers, path: newPath, nextLayerId });
      targetFolder.visible = sourceFolder.visible !== false;
      targetFolder.collapsed = sourceFolder.collapsed === true;
      targetFolder.childs = [];

      const step = toNumber(texture.step, 1) || 1;
      const width = Math.max(1, toNumber(texture.width, 2048));
      const height = Math.max(1, toNumber(texture.height, 2048));
      const offsetX = toNumber(op?.offset?.x, 0);
      const offsetY = toNumber(op?.offset?.y, step);
      const itemEdits = Array.isArray(op.itemEdits)
        ? op.itemEdits.filter((edit) => edit && typeof edit === 'object')
        : [];
      const editsByRelativePath = new Map();
      itemEdits.forEach((edit) => {
        const relativePath = normalizePathLike(edit.relativePath);
        if (!relativePath) return;
        if (editsByRelativePath.has(relativePath)) {
          warnings.push(
            `op#${index + 1}: duplicate_folder has duplicate itemEdits target: ${relativePath}`,
          );
        }
        editsByRelativePath.set(relativePath, edit);
      });
      const matchedEditPaths = new Set();

      const cloneNodes = (sourceNodes, targetNodes, relativeFolder = '') => {
        sourceNodes.forEach((sourceNode) => {
          if (sourceNode?.type === 'folder') {
            const name = String(sourceNode.name || '').trim();
            const clonedFolder = {
              ...deepClone(sourceNode),
              id: nextLayerId(),
              childs: [],
            };
            targetNodes.push(clonedFolder);
            cloneNodes(
              Array.isArray(sourceNode.childs) ? sourceNode.childs : [],
              clonedFolder.childs,
              relativeFolder ? `${relativeFolder}/${name}` : name,
            );
            return;
          }
          if (sourceNode?.type !== 'item') return;

          const sourceItem = itemById.get(idKey(sourceNode.id));
          const cloned = deepClone(sourceItem);
          cloned.id = nextLayerId();
          cloned.selected = false;
          const sourceBounds = computeItemBounds(cloned) || { w: 1, h: 1 };
          cloned.x = clamp(
            snap(toNumber(sourceItem.x, 0) + offsetX, step),
            0,
            Math.max(0, width - sourceBounds.w),
          );
          cloned.y = clamp(
            snap(toNumber(sourceItem.y, 0) + offsetY, step),
            0,
            Math.max(0, height - sourceBounds.h),
          );
          const relativeItemPath = relativeFolder
            ? `${relativeFolder}/${sourceNode.name}`
            : sourceNode.name;
          const normalizedRelativeItemPath = normalizePathLike(relativeItemPath);
          const itemEdit = editsByRelativePath.get(normalizedRelativeItemPath);
          if (itemEdit) {
            matchedEditPaths.add(normalizedRelativeItemPath);
            if (
              !applyStructuredItemEdit({
                item: cloned,
                edit: itemEdit,
                texture,
                layers,
                folderPath: relativeFolder ? `${newPath}/${relativeFolder}` : newPath,
              })
            ) {
              warnings.push(
                `op#${index + 1}: duplicate_folder itemEdits has no valid changes for ${relativeItemPath}`,
              );
            }
          }

          const bounds = computeItemBounds(cloned) || { w: 1, h: 1 };
          const maxX = Math.max(0, width - bounds.w);
          const maxY = Math.max(0, height - bounds.h);
          cloned.x = clamp(snap(toNumber(cloned.x, 0), step), 0, maxX);
          cloned.y = clamp(snap(toNumber(cloned.y, 0), step), 0, maxY);
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
          targetNodes.push({
            ...deepClone(sourceNode),
            id: cloned.id,
            name: cloned.name,
            visible: cloned.visible !== false,
            childs: [],
          });
          createdItemIds.push(cloned.id);
        });
      };

      cloneNodes(sourceFolder.childs, targetFolder.childs);

      editsByRelativePath.forEach((_, relativePath) => {
        if (!matchedEditPaths.has(relativePath)) {
          warnings.push(
            `op#${index + 1}: duplicate_folder itemEdits target not found: ${relativePath}`,
          );
        }
      });
      return;
    }

    if (op.type === 'edit_folder_items') {
      const folderPath = typeof op.folderPath === 'string' ? op.folderPath.trim() : '';
      const folder = findFolderNodeByPath(layers, folderPath);
      if (!folder) {
        warnings.push(`op#${index + 1}: edit_folder_items folder not found`);
        return;
      }
      const itemEdits = Array.isArray(op.itemEdits)
        ? op.itemEdits.filter((edit) => edit && typeof edit === 'object')
        : [];
      if (!itemEdits.length) {
        warnings.push(`op#${index + 1}: edit_folder_items has no itemEdits`);
        return;
      }

      const entriesByPath = new Map(
        collectRelativeLayerItems(folder).map((entry) => [
          normalizePathLike(entry.relativePath),
          entry,
        ]),
      );
      const itemById = new Map(texture.items.map((item) => [idKey(item.id), item]));
      const seenPaths = new Set();
      itemEdits.forEach((edit) => {
        const relativePath = normalizePathLike(edit.relativePath);
        if (!relativePath || seenPaths.has(relativePath)) {
          warnings.push(
            `op#${index + 1}: edit_folder_items has invalid or duplicate target: ${relativePath || '(empty)'}`,
          );
          return;
        }
        seenPaths.add(relativePath);
        const entry = entriesByPath.get(relativePath);
        if (!entry) {
          warnings.push(
            `op#${index + 1}: edit_folder_items target not found: ${edit.relativePath}`,
          );
          return;
        }
        const item = itemById.get(idKey(entry.node.id));
        if (!item) {
          warnings.push(
            `op#${index + 1}: edit_folder_items payload not found: ${edit.relativePath}`,
          );
          return;
        }
        const itemFolderPath = entry.folderPath ? `${folderPath}/${entry.folderPath}` : folderPath;
        if (!applyStructuredItemEdit({ item, edit, texture, layers, folderPath: itemFolderPath })) {
          warnings.push(
            `op#${index + 1}: edit_folder_items has no valid changes for ${edit.relativePath}`,
          );
        }
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
      const normalizedIds = new Set([...ids].map(idKey));
      texture.items = texture.items.filter((item) => !normalizedIds.has(idKey(item.id)));
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
