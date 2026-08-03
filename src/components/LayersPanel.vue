<template>
  <div
    class="layers-panel"
    @dragenter.prevent="onPanelDragEnter"
    @dragover.prevent="onPanelDragOver"
    @drop.prevent="onPanelDrop"
  >
    <div class="layers-panel-heading">Layers</div>
    <div
      class="layers-panel-items"
      @dragenter.prevent="onPanelDragEnter"
      @dragover.prevent="onPanelDragOver"
      @drop.prevent="onPanelDrop"
    >
      <LayersItem
        v-for="item in layerTree.items"
        :item="item"
        :items="props.items"
        :rootItems="layerTree.items"
        :moveItem="moveItem"
        :toggleVisibility="toggleVisibility"
        :onStructureChanged="props.onStructureChanged"
        :key="item.id"
      />
    </div>
    <div class="layers-panel-controls">
      <div class="add-folder" @click="addFolder"><i class="las la-folder"></i></div>
      <div class="remove-layer" @click="removeSelected"><i class="las la-trash"></i></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import LayersItem from './LayersItem.vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useLayersStore, applyLayerSelection, nextLayerId } from '../stores/layers';
const ls: any = useLayersStore();

const props = defineProps<{
  items: Array<any>;
  layers?: Array<any>;
  step?: number | string;
  textureWidth?: number | string;
  textureHeight?: number | string;
  selected?: number | null;
  onStructureChanged?: (..._args: any[]) => void;
}>();

const layerTree = ref({
  items: [],
});

defineExpose({
  copySelection,
  cutSelection,
  pasteClipboard,
  removeSelected,
});

watch(
  () => props.layers,
  (nextLayers) => {
    if (Array.isArray(nextLayers)) {
      layerTree.value.items = nextLayers;
    }
  },
  { immediate: true },
);

watch(
  () => props.items.map((it) => it.id),
  () => {
    generateIDs(props.items);
    pruneMissingLayerItems(props.items);
  },
  { immediate: true },
);

watch(
  () => props.items.map((it) => ({ id: it.id, name: it.name })),
  () => {
    syncLayerNamesFromItems(props.items);
  },
  { immediate: true },
);

watch(
  () => props.items.map((it) => ({ id: it.id, visible: it.visible })),
  () => {
    syncVisibilityToTexture();
  },
  { immediate: true },
);

function addFolder() {
  layerTree.value.items.push({
    id: nextLayerId(ls),
    name: 'Folder',
    type: 'folder',
    visible: true,
    collapsed: true,
    childs: [],
  });
}

function copySelection() {
  buildClipboard(false);
}

function cutSelection() {
  buildClipboard(true);
}

function pasteClipboard() {
  if (!ls.clipboard || !Array.isArray(ls.clipboard.nodes) || !ls.clipboard.nodes.length) return;

  let targetInfo = null;
  const rootItems = layerTree.value.items;
  const lastClickedId = ls.last_clicked_id;
  if (lastClickedId !== null && lastClickedId !== undefined) {
    const info = findNodeById(rootItems, lastClickedId);
    if (info && info.node && info.node.type === 'folder') {
      targetInfo = info;
    }
  }
  if (!targetInfo) {
    const selection = Array.isArray(ls.selected) ? ls.selected : [];
    for (let i = selection.length - 1; i >= 0; i--) {
      const info = findNodeById(rootItems, selection[i]);
      if (info && info.node && info.node.type === 'folder') {
        targetInfo = info;
        break;
      }
    }
  }
  if (!targetInfo) {
    const targetId = ls.active_id;
    if (targetId !== null && targetId !== undefined) {
      targetInfo = findNodeById(rootItems, targetId);
    }
  }

  let insertionArray = layerTree.value.items;
  let insertIndex = 0;

  if (targetInfo && targetInfo.node) {
    if (targetInfo.node.type === 'folder') {
      if (!Array.isArray(targetInfo.node.childs)) {
        targetInfo.node.childs = [];
      }
      targetInfo.node.collapsed = false;
      insertionArray = targetInfo.node.childs;
      insertIndex = 0;
    } else {
      insertionArray = targetInfo.parentArray || layerTree.value.items;
      insertIndex = targetInfo.index;
    }
  }

  const { nodes, items, cut } = ls.clipboard;
  let nodesToInsert = [];
  let itemsToInsert = [];

  if (cut) {
    nodesToInsert = deepClone(nodes);
    itemsToInsert = deepClone(items);
  } else {
    const idMap = new Map();
    nodesToInsert = deepCloneWithNewIds(nodes, idMap);
    itemsToInsert = (items || []).map((it) => {
      const cloned = deepClone(it);
      const newId = idMap.get(it.id);
      if (newId !== undefined) {
        cloned.id = newId;
      } else {
        cloned.id = nextLayerId(ls);
      }
      return cloned;
    });
  }

  insertionArray.splice(insertIndex, 0, ...nodesToInsert);

  const targetPos = resolvePastePosition();
  if (targetPos && itemsToInsert.length) {
    if (!targetPos.fromCanvas) {
      const freePos = findFreeSpot(targetPos.x, targetPos.y, itemsToInsert, props.items || []);
      applyPastePosition(itemsToInsert, freePos.x, freePos.y, false);
    } else {
      applyPastePosition(itemsToInsert, targetPos.x, targetPos.y, true);
    }
  }

  if (Array.isArray(props.items)) {
    props.items.push(...itemsToInsert);
  }

  syncTextureItemsOrder();

  const newSelectedIds = nodesToInsert.map((n) => n.id);
  applyLayerSelection(ls, newSelectedIds);

  if (cut) {
    ls.clipboard = {
      nodes: deepClone(nodesToInsert),
      items: deepClone(itemsToInsert),
      cut: false,
    };
  }
}

function buildClipboard(cut) {
  const root = layerTree.value.items;
  const selection = Array.isArray(ls.selected) ? ls.selected : [];
  if (!selection.length) return;

  const idsToMoveSet = new Set(selection);
  const nodesToMove = [];

  function collectNodes(nodes) {
    for (const node of nodes) {
      if (idsToMoveSet.has(node.id)) {
        nodesToMove.push(node);
      }
      if (Array.isArray(node.childs)) {
        collectNodes(node.childs);
      }
    }
  }

  collectNodes(root);

  function isAncestor(ancestorNode, descendantId) {
    if (!ancestorNode || !Array.isArray(ancestorNode.childs)) return false;
    for (const child of ancestorNode.childs) {
      if (child.id === descendantId) return true;
      if (isAncestor(child, descendantId)) return true;
    }
    return false;
  }

  const topLevelNodes = nodesToMove.filter(
    (node) => !nodesToMove.some((other) => other !== node && isAncestor(other, node.id)),
  );

  if (!topLevelNodes.length) return;

  const itemIds = [];
  for (const node of topLevelNodes) {
    collectItemIds(node, itemIds);
  }

  const itemSet = new Set(itemIds);
  const itemsSnapshot = Array.isArray(props.items)
    ? props.items.filter((it) => itemSet.has(it.id)).map((it) => deepClone(it))
    : [];

  ls.clipboard = {
    nodes: deepClone(topLevelNodes),
    items: itemsSnapshot,
    cut: !!cut,
  };

  if (cut) {
    const removedItemIds = [];
    removeNodesByIds(
      layerTree.value.items,
      new Set(topLevelNodes.map((n) => n.id)),
      removedItemIds,
    );
    collapseEmptyFolders(layerTree.value.items);
    if (Array.isArray(props.items)) {
      const removeSet = new Set(removedItemIds);
      const next = props.items.filter((it) => !removeSet.has(it.id));
      props.items.splice(0, props.items.length, ...next);
    }
    applyLayerSelection(ls, []);
    syncTextureItemsOrder();
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepCloneWithNewIds(nodes, idMap) {
  return nodes.map((node) => {
    const cloned = deepClone(node);
    const newId = nextLayerId(ls);
    idMap.set(node.id, newId);
    cloned.id = newId;
    if (Array.isArray(cloned.childs) && cloned.childs.length) {
      cloned.childs = deepCloneWithNewIds(cloned.childs, idMap);
    }
    return cloned;
  });
}

function resolvePastePosition() {
  if (ls.last_canvas_in_bounds && ls.last_canvas_pos) {
    return {
      x: ls.last_canvas_pos.x,
      y: ls.last_canvas_pos.y,
      fromCanvas: true,
    };
  }
  if (ls.active_id !== null && ls.active_id !== undefined && Array.isArray(props.items)) {
    const activeItem = props.items.find((it) => it.id === ls.active_id);
    if (activeItem) {
      return { x: activeItem.x, y: activeItem.y, fromCanvas: false };
    }
  }
  return { x: 0, y: 0, fromCanvas: false };
}

function applyPastePosition(itemsToInsert, targetX, targetY, fromCanvas) {
  let minX = Infinity;
  let minY = Infinity;
  for (const it of itemsToInsert) {
    if (typeof it.x === 'number') {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
    }
  }
  if (!isFinite(minX) || !isFinite(minY)) return;

  const step = Number(props.step) || 0;
  let dx;
  let dy;
  if (fromCanvas) {
    const snappedX = step > 0 ? Math.floor(targetX / step) * step : targetX;
    const snappedY = step > 0 ? Math.floor(targetY / step) * step : targetY;
    dx = snappedX - minX;
    dy = snappedY - minY;
  } else {
    const offset = ls.paste_offset || { x: 0, y: 0 };
    dx = targetX - (minX + (offset.x || 0));
    dy = targetY - (minY + (offset.y || 0));
    if (step > 0) {
      dx = Math.round(dx / step) * step;
      dy = Math.round(dy / step) * step;
    }
  }

  if (!fromCanvas) {
    const bounds = getTextureBounds();
    if (bounds) {
      const group = getGroupBounds(itemsToInsert);
      if (group) {
        const minDx = bounds.minX - group.minX;
        const maxDx = bounds.maxX - (group.minX + group.width);
        const minDy = bounds.minY - group.minY;
        const maxDy = bounds.maxY - (group.minY + group.height);
        dx = Math.max(minDx, Math.min(dx, maxDx));
        dy = Math.max(minDy, Math.min(dy, maxDy));
      }
    }
  }

  for (const it of itemsToInsert) {
    if (typeof it.x === 'number') {
      it.x += dx;
      it.y += dy;
    }
  }
}

function getItemBounds(item) {
  if (!item || typeof item.x !== 'number' || typeof item.y !== 'number') {
    return null;
  }
  if (item.type === 'g' && Array.isArray(item.size)) {
    return { x: item.x, y: item.y, w: item.size[0], h: item.size[1] };
  }
  if (item.type === 'sg') {
    let x_steps = 1;
    let y_steps = 1;
    if (item.direction && item.steps && item.steps > 1) {
      let m = item.colors && item.colors.length ? item.colors.length - 1 : 1;
      let a_steps = 0;
      if (!m) m = 1;
      if (item.color_mode === 'black_to_white') {
        m = 1;
        a_steps = item.steps + 1;
      }
      if (item.direction === 'horizontal') {
        x_steps = item.steps * m + a_steps;
      } else {
        y_steps = item.steps * m + a_steps;
      }
    }
    const size = Number(item.size) || 0;
    return { x: item.x, y: item.y, w: size * x_steps, h: size * y_steps };
  }
  if (typeof item.size === 'number') {
    return { x: item.x, y: item.y, w: item.size, h: item.size };
  }
  return null;
}

function getGroupBounds(items) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const it of items) {
    const b = getItemBounds(it);
    if (!b) continue;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!isFinite(minX) || !isFinite(minY)) {
    return null;
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function findFreeSpot(anchorX, anchorY, itemsToInsert, existingItems) {
  const step = Number(props.step) || 1;
  const group = getGroupBounds(itemsToInsert);
  if (!group) {
    return { x: anchorX, y: anchorY };
  }
  const bounds = getTextureBounds();
  const existingBounds = [];
  for (const it of existingItems) {
    const b = getItemBounds(it);
    if (b) existingBounds.push(b);
  }
  const startX = bounds ? bounds.minX : 0;
  const startY = bounds ? bounds.minY : 0;
  const maxX = bounds ? bounds.maxX : startX + group.width;
  const maxY = bounds ? bounds.maxY : startY + group.height;

  const gridStartX = Math.round(startX / step) * step;
  const gridStartY = Math.round(startY / step) * step;

  for (let y = gridStartY; y + group.height <= maxY; y += step) {
    for (let x = gridStartX; x + group.width <= maxX; x += step) {
      const candidate = { x, y, w: group.width, h: group.height };
      let collides = false;
      for (const eb of existingBounds) {
        if (overlaps(candidate, eb)) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        return { x, y };
      }
    }
  }

  return { x: gridStartX, y: gridStartY };
}

function getTextureBounds() {
  const w = Number(props.textureWidth);
  const h = Number(props.textureHeight);
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
  return { minX: 0, minY: 0, maxX: w, maxY: h };
}

function removeSelected() {
  const ids = Array.isArray(ls.selected) ? ls.selected : [];
  if (!ids.length) return;

  const idsSet = new Set(ids);
  const removedItemIds = [];

  removeNodesByIds(layerTree.value.items, idsSet, removedItemIds);
  collapseEmptyFolders(layerTree.value.items);

  if (removedItemIds.length && Array.isArray(props.items)) {
    const removeSet = new Set(removedItemIds);
    const next = props.items.filter((it) => !removeSet.has(it.id));
    props.items.splice(0, props.items.length, ...next);
  }

  applyLayerSelection(ls, []);
}

function moveItem(fromId, toId, zone) {
  if (!layerTree.value.items) return false;

  const root = layerTree.value.items;
  const selection = Array.isArray(ls.selected) ? ls.selected : [];
  const selectedSet = new Set(selection);

  function hasSelectedAncestor(nodeId) {
    let info = findNodeById(root, nodeId);
    while (info && info.parent) {
      if (selectedSet.has(info.parent.id)) return true;
      info = findNodeById(root, info.parent.id);
    }
    return false;
  }

  // Определяем, что перемещаем: всё выделение или только один элемент
  const isMovingSelection = selection.includes(fromId) && !hasSelectedAncestor(fromId);
  const idsToMove = isMovingSelection ? selection : [fromId];
  const idsToMoveSet = new Set(idsToMove);

  const nodesToMove = [];

  // ===================================================================
  // 1. Собираем все узлы, которые нужно переместить
  // ===================================================================
  function collectNodesToMove(nodes) {
    for (const node of nodes) {
      if (idsToMoveSet.has(node.id)) {
        nodesToMove.push(node);
      }
      if (Array.isArray(node.childs)) {
        collectNodesToMove(node.childs);
      }
    }
  }

  collectNodesToMove(root);

  // Если перемещаем только один элемент и его не нашли в выделении — добавляем вручную
  if (!isMovingSelection && !nodesToMove.some((n) => n.id === fromId)) {
    const singleInfo = findNodeById(root, fromId);
    if (!singleInfo) return false;
    nodesToMove.push(singleInfo.node);
  }

  if (nodesToMove.length === 0) return false;

  // ===================================================================
  // 2. Оставляем только верхнеуровневые узлы (чтобы не переносить родителя и его детей отдельно)
  // ===================================================================
  function isAncestor(ancestorNode, descendantId) {
    if (!ancestorNode || !Array.isArray(ancestorNode.childs)) return false;

    for (const child of ancestorNode.childs) {
      if (child.id === descendantId) return true;
      if (isAncestor(child, descendantId)) return true;
    }
    return false;
  }

  const topLevelNodes = nodesToMove.filter(
    (node) => !nodesToMove.some((other) => other !== node && isAncestor(other, node.id)),
  );

  if (topLevelNodes.length === 0) return false;

  // ===================================================================
  // 3. Находим целевой узел
  // ===================================================================
  const targetInfo = findNodeById(root, toId);
  if (!targetInfo) return false;

  // Защита: нельзя перетащить элемент в самого себя или внутрь своего потомка
  for (const node of topLevelNodes) {
    if (node.id === toId || isAncestor(node, toId)) {
      return false;
    }
  }

  // ===================================================================
  // 4. Определяем, куда вставлять
  // ===================================================================
  let insertionArray;
  let insertIndex;

  if (zone === 'center') {
    // Внутрь целевого элемента — в конец дочерних
    if (!Array.isArray(targetInfo.node.childs)) {
      targetInfo.node.childs = [];
    }
    insertionArray = targetInfo.node.childs;
    insertIndex = insertionArray.length;
  } else {
    // Рядом с целевым — над или под
    const parentArray = targetInfo.parentArray || root;
    insertIndex = zone === 'top' ? targetInfo.index : targetInfo.index + 1;
    insertionArray = parentArray;
    // Защищаем от выхода за границы
    insertIndex = Math.max(0, Math.min(insertIndex, parentArray.length));
  }

  const targetParentArray = insertionArray;
  let adjustedInsertIndex = insertIndex;

  // ===================================================================
  // 5. Удаляем узлы из старых позиций
  // ===================================================================
  const nodesToInsert = [];

  for (const node of topLevelNodes) {
    const currentInfo = findNodeById(root, node.id);
    if (!currentInfo) continue;

    // Если удаляем из того же массива, куда вставляем, и индекс удаления меньше индекса вставки
    // — после удаления индекс вставки уменьшится
    if (currentInfo.parentArray === targetParentArray && currentInfo.index < adjustedInsertIndex) {
      adjustedInsertIndex = Math.max(0, adjustedInsertIndex - 1);
    }

    nodesToInsert.push(currentInfo.node);
    currentInfo.parentArray.splice(currentInfo.index, 1);
  }

  if (nodesToInsert.length === 0) return false;

  if (typeof props.onStructureChanged === 'function') {
    props.onStructureChanged('before');
  }

  // ===================================================================
  // 6. Финальное место вставки (особенно важно для 'center' после удалений)
  // ===================================================================
  if (zone === 'center') {
    const freshTarget = findNodeById(root, toId);
    if (!freshTarget) return false;

    if (!Array.isArray(freshTarget.node.childs)) {
      freshTarget.node.childs = [];
    }
    freshTarget.node.collapsed = false;
    insertionArray = freshTarget.node.childs;
    insertIndex = insertionArray.length;
  } else {
    insertionArray = targetParentArray;
    insertIndex = adjustedInsertIndex;
    insertIndex = Math.max(0, Math.min(insertIndex, insertionArray.length));
  }

  // ===================================================================
  // 7. Вставляем в новое место
  // ===================================================================
  insertionArray.splice(insertIndex, 0, ...nodesToInsert);
  collapseEmptyFolders(root);

  // ===================================================================
  // 8. Обновляем выделение, если перемещали всю группу
  // ===================================================================
  if (isMovingSelection) {
    applyLayerSelection(
      ls,
      nodesToInsert.map((node) => node.id),
    );
  }

  syncTextureItemsOrder();
  if (typeof props.onStructureChanged === 'function') {
    props.onStructureChanged('after');
  }
  return true;
}

// ===================================================================
// Вспомогательная функция: поиск узла по ID (возвращает полный контекст)
// ===================================================================
function findNodeById(array, id, parent = null) {
  for (let i = 0; i < array.length; i++) {
    const node = array[i];
    if (node.id === id) {
      return { node, parentArray: array, index: i, parent };
    }
    if (Array.isArray(node.childs)) {
      const result = findNodeById(node.childs, id, node);
      if (result) return result;
    }
  }
  return null;
}

function collectItemIds(node, acc) {
  if (!node) return;
  if (node.type === 'item') {
    acc.push(node.id);
  }
  if (Array.isArray(node.childs)) {
    for (const child of node.childs) {
      collectItemIds(child, acc);
    }
  }
}

function removeNodesByIds(nodes, idsSet, removedItemIds) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (idsSet.has(node.id)) {
      if (node.type === 'item') {
        removedItemIds.push(node.id);
      } else if (node.type === 'folder') {
        collectItemIds(node, removedItemIds);
      }
      nodes.splice(i, 1);
      continue;
    }
    if (Array.isArray(node.childs) && node.childs.length) {
      removeNodesByIds(node.childs, idsSet, removedItemIds);
    }
  }
}

function collapseEmptyFolders(nodes) {
  for (const node of nodes) {
    if (node.type === 'folder') {
      if (!Array.isArray(node.childs) || node.childs.length === 0) {
        node.collapsed = true;
      } else {
        collapseEmptyFolders(node.childs);
      }
    }
  }
}

function flattenLayerItems(nodes, acc = []) {
  for (const node of nodes) {
    if (node.type === 'item') {
      acc.push(node.id);
    }
    if (Array.isArray(node.childs) && node.childs.length) {
      flattenLayerItems(node.childs, acc);
    }
  }
  return acc;
}

function syncTextureItemsOrder() {
  const items = props.items;
  if (!Array.isArray(items) || items.length === 0) return;

  const orderedIds = flattenLayerItems(layerTree.value.items);
  if (!orderedIds.length) return;

  const orderedIdsForTexture = orderedIds.slice().reverse();

  const byId = new Map(items.map((it) => [it.id, it]));
  const next = [];

  for (const id of orderedIdsForTexture) {
    const item = byId.get(id);
    if (item) {
      next.push(item);
      byId.delete(id);
    }
  }

  if (byId.size) {
    for (const it of items) {
      if (byId.has(it.id)) {
        next.push(it);
      }
    }
  }

  items.splice(0, items.length, ...next);
}

function pruneMissingLayerItems(items) {
  const validIds = new Set((items || []).map((it) => it.id));
  function prune(nodes) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.type === 'item' && !validIds.has(node.id)) {
        nodes.splice(i, 1);
        continue;
      }
      if (Array.isArray(node.childs) && node.childs.length) {
        prune(node.childs);
      }
    }
  }
  prune(layerTree.value.items);
}

function syncLayerNamesFromItems(items) {
  if (!Array.isArray(items)) return;
  const byId = new Map(items.map((it) => [it.id, it]));
  function sync(nodes) {
    for (const node of nodes) {
      if (node.type === 'item') {
        const item = byId.get(node.id);
        if (item && typeof item.name === 'string' && node.name !== item.name) {
          node.name = item.name;
        }
      }
      if (Array.isArray(node.childs) && node.childs.length) {
        sync(node.childs);
      }
    }
  }
  sync(layerTree.value.items);
}

function syncVisibilityToTexture() {
  const items = props.items;
  if (!Array.isArray(items)) return;
  const byId = new Map(items.map((it) => [it.id, it]));
  function walk(nodes, parentVisible) {
    for (const node of nodes) {
      const nodeVisible = node.visible !== false;
      const effectiveVisible = parentVisible && nodeVisible;
      if (node.type === 'item') {
        const item = byId.get(node.id);
        if (item) item.visible = effectiveVisible;
      }
      if (Array.isArray(node.childs) && node.childs.length) {
        walk(node.childs, effectiveVisible);
      }
    }
  }
  walk(layerTree.value.items, true);
}

function collectSubtreeIds(node, acc) {
  if (!node) return;
  acc.add(node.id);
  if (Array.isArray(node.childs)) {
    for (const child of node.childs) {
      collectSubtreeIds(child, acc);
    }
  }
}

function collectAncestorIds(targetNode, nodes, acc, parents = []) {
  if (!Array.isArray(nodes)) return false;
  for (const node of nodes) {
    if (node === targetNode || node.id === targetNode.id) {
      for (const p of parents) {
        acc.add(p.id);
      }
      return true;
    }
    if (Array.isArray(node.childs) && node.childs.length) {
      const found = collectAncestorIds(targetNode, node.childs, acc, [...parents, node]);
      if (found) return true;
    }
  }
  return false;
}

function restoreAutoHiddenInSubtree(node) {
  if (!node || !Array.isArray(ls.auto_hidden_ids) || !ls.auto_hidden_ids.length) return;
  const autoHiddenSet = new Set(ls.auto_hidden_ids);
  const restored = [];
  function restore(n) {
    if (autoHiddenSet.has(n.id) && n.visible === false) {
      n.visible = true;
      restored.push(n.id);
    }
    if (Array.isArray(n.childs) && n.childs.length) {
      for (const child of n.childs) {
        restore(child);
      }
    }
  }
  restore(node);
  if (restored.length) {
    const restoredSet = new Set(restored);
    ls.auto_hidden_ids = ls.auto_hidden_ids.filter((id) => !restoredSet.has(id));
  }
}

function toggleVisibility(node, altKey) {
  if (!node) return;

  if (altKey) {
    const hasAutoHidden = Array.isArray(ls.auto_hidden_ids) && ls.auto_hidden_ids.length > 0;
    let wasVisible = node.visible !== false;
    if (hasAutoHidden && !wasVisible) {
      const restoreSet = new Set(ls.auto_hidden_ids);
      function isAutoHidden(n) {
        if (restoreSet.has(n.id)) return true;
        if (Array.isArray(n.childs)) {
          return n.childs.some((child) => isAutoHidden(child));
        }
        return false;
      }
      wasVisible = !isAutoHidden(node);
    }
    if (hasAutoHidden) {
      const restoreSet = new Set(ls.auto_hidden_ids);
      function restore(nodes) {
        for (const n of nodes) {
          if (restoreSet.has(n.id)) {
            n.visible = true;
          }
          if (Array.isArray(n.childs) && n.childs.length) {
            restore(n.childs);
          }
        }
      }
      restore(layerTree.value.items);
      ls.auto_hidden_ids = [];
    }
    if (hasAutoHidden && wasVisible) {
      syncVisibilityToTexture();
      return;
    }
    const subtreeIds = new Set();
    collectSubtreeIds(node, subtreeIds);
    collectAncestorIds(node, layerTree.value.items, subtreeIds);
    if (node.visible === false) {
      node.visible = true;
    }
    const autoHidden = [];
    function hideOthers(nodes) {
      for (const n of nodes) {
        if (!subtreeIds.has(n.id) && n.visible !== false) {
          n.visible = false;
          autoHidden.push(n.id);
        }
        if (Array.isArray(n.childs) && n.childs.length) {
          hideOthers(n.childs);
        }
      }
    }
    hideOthers(layerTree.value.items);
    ls.auto_hidden_ids = autoHidden;
  } else {
    if (node.visible === undefined) {
      node.visible = true;
    }
    const wasVisible = node.visible !== false;
    node.visible = !node.visible;
    if (!wasVisible && node.visible && node.type === 'folder') {
      restoreAutoHiddenInSubtree(node);
    }
  }

  syncVisibilityToTexture();
}

function onPanelDragOver(event) {
  if (event && event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onPanelDragEnter(event) {
  if (event && event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onPanelDrop() {
  ls.zone = null;
  ls.hovered_item = null;
  ls.is_dragging = false;
}

function onGlobalDragEnter(event) {
  if (!ls.is_dragging) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onGlobalDragOver(event) {
  if (!ls.is_dragging) return;
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
}

function onGlobalDrop(event) {
  if (!ls.is_dragging) return;
  event.preventDefault();
}

function generateIDs(items) {
  let needsOrderSync = false;
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === undefined) {
      items[i].id = nextLayerId(ls);
    }
    const exists = !!findNodeById(layerTree.value.items, items[i].id);
    if (!exists) {
      const newNode = {
        id: items[i].id,
        name: items[i].name,
        type: 'item',
        visible: true,
        collapsed: false,
        childs: [],
      };

      let inserted = false;
      if (
        ls.pending_insert &&
        ls.pending_insert.target_id !== undefined &&
        ls.pending_insert.target_id !== null
      ) {
        if (ls.pending_insert.mode === 'folder') {
          const parentInfo = findNodeById(layerTree.value.items, ls.pending_insert.target_id);
          if (parentInfo && parentInfo.node && parentInfo.node.type === 'folder') {
            if (!Array.isArray(parentInfo.node.childs)) {
              parentInfo.node.childs = [];
            }
            parentInfo.node.childs.unshift(newNode);
            parentInfo.node.collapsed = false;
            inserted = true;
            needsOrderSync = true;
          }
        } else if (ls.pending_insert.mode === 'sibling') {
          const targetInfo = findNodeById(layerTree.value.items, ls.pending_insert.target_id);
          if (targetInfo && targetInfo.parentArray) {
            const insertIndex = Math.max(0, targetInfo.index);
            targetInfo.parentArray.splice(insertIndex, 0, newNode);
            inserted = true;
            needsOrderSync = true;
          }
        }
        ls.pending_insert = null;
      }

      if (!inserted) {
        layerTree.value.items.unshift(newNode);
        needsOrderSync = true;
      }
    }
  }
  if (needsOrderSync) {
    syncTextureItemsOrder();
  }
  collapseEmptyFolders(layerTree.value.items);
  //console.log(layerTree.value)
}

onMounted(() => {
  window.addEventListener('dragenter', onGlobalDragEnter, true);
  window.addEventListener('dragover', onGlobalDragOver, true);
  window.addEventListener('drop', onGlobalDrop, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onGlobalDragEnter, true);
  window.removeEventListener('dragover', onGlobalDragOver, true);
  window.removeEventListener('drop', onGlobalDrop, true);
});
</script>
<style scoped>
.layers-panel {
  font-family: system-ui, sans-serif;
  position: absolute;
  top: 0;
  bottom: 5px;
  right: 0;
  left: 0;
  overflow: hidden;
  .layers-panel-heading {
    padding: 10px 15px;
    border-bottom: 1px solid #1a1b1e;
    background: #242629;
    position: absolute;
    z-index: 1;
    width: calc(100% - 30px);
    /*font-weight: bold;*/
    font-family: 'JetBrains Mono', serif;

    color: #929293;
    font-size: 12px;
  }
  .layers-panel-items {
    position: absolute;
    overflow: auto;
    width: 100%;
    bottom: 41px;
    top: 37px;
    padding: 0;
    .layer-item:first-child {
      border-top: none;
    }
  }
  .layers-panel-controls {
    position: absolute;
    bottom: 0;
    display: flex;
    background: #242629;
    width: 100%;
    div {
      cursor: pointer;
      touch-action: manipulation;
      border-top: 1px solid #1a1b1e;
      height: 40px;
      width: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      &:hover {
        background: #333539;
      }
      &:first-child {
        width: 100%;
        border-right: 1px solid #1a1b1e;
      }
      &:last-child {
        flex-shrink: 0;
      }
    }
  }
}
</style>
