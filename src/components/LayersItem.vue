<template>
  <div
    class="layer-item"
    :draggable="ls.renaming_id === null"
    @dragstart.stop="onDragStart"
    @dragend.stop="onDragEnd"
    @dragenter.stop.prevent="onDragEnter"
    @dragover.stop.prevent="onDragOver"
    @dragleave.stop.prevent="onDragLeave"
    @drop.prevent.stop="onDrop($event)"
    :class="itemClasses"
    @click.stop.prevent="onClick($event)"
    @contextmenu.stop.prevent
    @dblclick.stop.prevent="onDblClick"
  >
    <div class="main-info">
      <i
        v-if="props.item.type === 'folder'"
        :class="[
          props.item.collapsed ? 'las la-folder' : 'las la-folder-open',
          { 'folder-empty': isFolderEmpty },
        ]"
        @click.stop.prevent="toggleCollapse"
      ></i>
      <input
        v-if="isEditing"
        ref="editInput"
        class="layer-edit"
        :draggable="false"
        v-model="editName"
        @pointerdown.stop
        @mousedown.stop
        @click.stop
        @dblclick.stop
        @dragstart.stop.prevent
        @keydown.enter.prevent="commitEdit"
        @keydown.esc.prevent="cancelEdit"
        @blur="commitEdit"
      />
      <span v-else>{{ props.item.name }}</span>
      <div
        v-if="props.item.type === 'item'"
        class="preview"
        :class="{ 'is-hidden': isHidden, 'is-active': isActive }"
        :style="`background: ${previewCss}`"
        @click.stop.prevent="onPreviewClick"
        @dblclick.stop.prevent
      ></div>
      <div
        v-if="props.item.type === 'folder'"
        class="visibility-toggle"
        :class="{ 'is-hidden': isHidden, 'is-active': isActive }"
        :style="`background: ${previewCss}`"
        @click.stop.prevent="onPreviewClick"
        @dblclick.stop.prevent
      >
        <i class="las la-eye-slash" v-if="isHidden"></i>
        <i class="las la-eye" v-else></i>
      </div>
    </div>

    <div class="childs" v-if="!(props.item.type === 'folder' && props.item.collapsed)">
      <LayersItem
        v-for="child in props.item.childs"
        :item="child"
        :items="props.items"
        :rootItems="props.rootItems"
        :moveItem="props.moveItem"
        :toggleVisibility="props.toggleVisibility"
        :key="child.id"
      />
      <div
        v-if="
          props.item.type === 'folder' &&
          Array.isArray(props.item.childs) &&
          props.item.childs.length > 0
        "
        class="folder-drop-after"
        @dragover.stop.prevent="onDropAfterDragOver"
        @drop.prevent.stop="onDropAfter"
      ></div>
    </div>
  </div>
</template>
<script setup lang="ts">
import LayersItem from './LayersItem.vue';
import { useLayersStore, applyLayerSelection } from '../stores/layers';
import { previewCssFromItem } from '../buildTree';
import { isPlatformPrimaryModifier } from '../utils/inputModifiers';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
  item: any;
  items: any;
  rootItems: any;
  moveItem: any;
  toggleVisibility: any;
  onStructureChanged?: (..._args: any[]) => void;
}>();

const ls: any = useLayersStore();
const previewCss = ref('background:transparent;');

const isSelected = ref(false);
const isEditing = ref(false);
const editName = ref('');
const editInput = ref<HTMLInputElement | null>(null);
const isHidden = computed(() => props.item.visible === false);
const isActive = computed(() => ls.active_id === props.item.id);
const isFolderEmpty = computed(() => {
  if (props.item.type !== 'folder') return false;
  return !Array.isArray(props.item.childs) || props.item.childs.length === 0;
});

watch(
  () => props.items.find((item) => item.id === props.item.id),
  (resultItem) => {
    if (props.item.type === 'item' && resultItem) {
      previewCss.value = previewCssFromItem(resultItem);
    }
  },
  { immediate: true, deep: true },
);

watch(
  () => ls.selected,
  () => {
    isSelected.value = ls.selected.includes(props.item.id);
  },
  { immediate: true, deep: true },
);

const itemClasses = computed(() => {
  const isHoveredItem =
    ls.dragged_item &&
    ls.hovered_item &&
    ls.dragged_item.id !== ls.hovered_item.id &&
    props.item.id === ls.hovered_item.id;

  return {
    'zone-top': isHoveredItem && ls.zone === 'top',
    'zone-center': isHoveredItem && ls.zone === 'center',
    'zone-bottom': isHoveredItem && ls.zone === 'bottom',
    'is-dragging': isHoveredItem && ls.is_dragging,
    'is-selected': isSelected.value,
    'contains-active-item': isFolderInActivePath.value,
  };
});

const isFolderInActivePath = computed(() => {
  if (props.item.type !== 'folder') return false;
  if (ls.active_type !== 'item') return false;
  if (ls.active_id === null || ls.active_id === undefined) return false;
  return hasItemInSubtree(props.item, ls.active_id);
});

function hasItemInSubtree(node, targetId) {
  if (!node) return false;
  if (node.type === 'item') {
    return node.id === targetId;
  }
  if (!Array.isArray(node.childs) || !node.childs.length) {
    return false;
  }
  for (const child of node.childs) {
    if (hasItemInSubtree(child, targetId)) {
      return true;
    }
  }
  return false;
}

function onDragStart($event) {
  if (ls.renaming_id !== null) {
    $event?.preventDefault();
    return;
  }
  ls.dragged_item = props.item;
  ls.is_dragging = true;
  if ($event && $event.dataTransfer) {
    $event.dataTransfer.effectAllowed = 'move';
    try {
      $event.dataTransfer.setData('text/plain', String(props.item?.id ?? ''));
    } catch (_) {}
  }
}
function onDragEnd() {
  ls.zone = null;
  ls.hovered_item = null;
  ls.is_dragging = false;
  ls.dragged_item = null;
}
function onDragEnter($event: DragEvent) {
  $event.preventDefault();
  if ($event.dataTransfer) {
    $event.dataTransfer.dropEffect = 'move';
  }
}
function onDragOver($event: DragEvent) {
  $event.preventDefault();
  if ($event.dataTransfer) {
    $event.dataTransfer.dropEffect = 'move';
  }
  if (isInvalidDropTarget(props.item, ls.dragged_item)) {
    ls.zone = null;
    ls.hovered_item = null;
    return;
  }
  updateZone($event, false);
  ls.hovered_item = props.item;
}

function onDragLeave(event: DragEvent) {
  const related = event.relatedTarget as Node | null;
  const cur = event.currentTarget as HTMLElement | null;
  if (!cur || !related || !cur.contains(related)) {
    ls.zone = null;
  }
}
function onDrop($event) {
  //console.log(ls.dragged_item, ls.hovered_item, ls.zone)
  const dropZone = resolveDropZoneForDrop($event);
  props.moveItem(ls.dragged_item.id, ls.hovered_item.id, dropZone);
  ls.zone = null;
  ls.is_dragging = false;
}
function onDropAfterDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }
  ls.hovered_item = props.item;
  ls.zone = 'bottom';
}
function onDropAfter($event: DragEvent) {
  $event.preventDefault();
  if (!ls.dragged_item || !props.item) return;
  props.moveItem(ls.dragged_item.id, props.item.id, 'bottom');
  ls.zone = null;
  ls.is_dragging = false;
}
function updateZone(event: DragEvent, is_self) {
  const el = event.currentTarget as HTMLElement;
  if (!el) return;

  const row = el.querySelector(':scope > .main-info') as HTMLElement | null;
  const rect = row ? row.getBoundingClientRect() : el.getBoundingClientRect();
  const fullRect = el.getBoundingClientRect();
  const y = event.clientY; // mouse pointer y
  const isExpandedFolder =
    props.item &&
    props.item.type === 'folder' &&
    props.item.collapsed !== true &&
    Array.isArray(props.item.childs) &&
    props.item.childs.length > 0;

  // For expanded folders: inside children area means "into folder" by default.
  // "Below folder" should trigger only near the very bottom edge of the whole block.
  if (row && y > rect.bottom) {
    if (isExpandedFolder) {
      const bottomEdgePx = 8;
      const distanceToBottom = fullRect.bottom - y;
      ls.zone = distanceToBottom <= bottomEdgePx ? 'bottom' : 'center';
    } else {
      ls.zone = 'bottom';
    }
    return;
  }
  if (y < rect.top) {
    ls.zone = 'top';
    return;
  }

  const relative = y - rect.top;
  const ratio = relative / rect.height;

  if (ratio < 0.33) {
    ls.zone = 'top';
  } else if (ratio > 0.66) {
    ls.zone = isExpandedFolder ? 'center' : 'bottom';
  } else {
    if (!is_self) {
      if (props.item && props.item.type === 'folder') {
        ls.zone = 'center';
      }
    }
  }
}

function resolveDropZoneForDrop(event: DragEvent) {
  if (ls.zone === 'top' || ls.zone === 'center' || ls.zone === 'bottom') {
    return ls.zone;
  }
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return 'bottom';
  const row = el.querySelector(':scope > .main-info') as HTMLElement | null;
  const rect = row ? row.getBoundingClientRect() : el.getBoundingClientRect();
  const y = event.clientY;
  const ratio = rect.height > 0 ? (y - rect.top) / rect.height : 1;
  if (ratio <= 0.5) return 'top';
  return 'bottom';
}

function isInvalidDropTarget(targetNode, draggedNode) {
  if (!targetNode || !draggedNode) return false;
  if (targetNode.id === draggedNode.id) return true;
  return isDescendant(draggedNode, targetNode.id);
}

function isDescendant(rootNode, candidateId) {
  if (!rootNode || !Array.isArray(rootNode.childs)) return false;
  for (const child of rootNode.childs) {
    if (child.id === candidateId) return true;
    if (isDescendant(child, candidateId)) return true;
  }
  return false;
}

function onClick(e: MouseEvent) {
  applyClickSelection(e);
}

function isToggleModifierPressed(e: MouseEvent) {
  return isPlatformPrimaryModifier({
    platform: window.electronAPI?.platform,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
  });
}

function applyClickSelection(e: MouseEvent) {
  if (isEditing.value) return;
  const isToggleSelection = isToggleModifierPressed(e);

  if (!isToggleSelection && !e.shiftKey && props.item.type === 'folder') {
    const ids = [];
    collectItemIdsInOrder(props.item, ids);
    if (!ids.length) {
      applyLayerSelection(ls, [props.item.id], 'folder');
      ls.last_clicked_id = props.item.id;
      return;
    }
    const set = new Set(ids);
    const activeId = set.has(ls.active_id) ? ls.active_id : ids[0];
    applyLayerSelection(ls, ids, 'item');
    if (activeId !== null && activeId !== undefined) {
      ls.active_id = activeId;
      ls.active_type = 'item';
    }
    ls.selected = Array.from(new Set([props.item.id, ...ids]));
    ls.last_clicked_id = props.item.id;
    return;
  }
  if (e.shiftKey) {
    const anchorId =
      ls.last_clicked_id ??
      ls.active_id ??
      (Array.isArray(ls.selected) && ls.selected.length
        ? ls.selected[ls.selected.length - 1]
        : null);
    if (anchorId === null) {
      applyLayerSelection(ls, [props.item.id], props.item.type);
      return;
    }
    const rootList = props.rootItems || [];
    const anchorInfo = findNodeInTree(rootList, anchorId);
    const targetInfo = findNodeInTree(rootList, props.item.id);
    if (anchorInfo && targetInfo && anchorInfo.parentArray === targetInfo.parentArray) {
      const start = Math.min(anchorInfo.index, targetInfo.index);
      const end = Math.max(anchorInfo.index, targetInfo.index);
      const rangeNodes = anchorInfo.parentArray.slice(start, end + 1);
      const rangeIds = [];
      for (const n of rangeNodes) {
        rangeIds.push(n.id);
        if (n.type === 'folder') {
          collectItemIdsInOrder(n, rangeIds);
        }
      }
      const prev = Array.isArray(ls.selected) ? ls.selected : [];
      const merged = Array.from(new Set([...prev, ...rangeIds]));
      applyLayerSelection(ls, merged, 'item');
      ls.last_clicked_id = props.item.id;
      return;
    }
    const prev = Array.isArray(ls.selected) ? ls.selected : [];
    const merged = Array.from(new Set([...prev, props.item.id]));
    applyLayerSelection(ls, merged, 'item');
    ls.last_clicked_id = props.item.id;
    return;
  }
  if (!isToggleSelection) {
    applyLayerSelection(ls, [props.item.id], props.item.type);
  } else {
    if (!isSelected.value) {
      if (props.item.type === 'folder') {
        const ids = [props.item.id];
        collectItemIdsInOrder(props.item, ids);
        applyLayerSelection(ls, Array.from(new Set([...ls.selected, ...ids])), 'item');
      } else {
        applyLayerSelection(ls, [...ls.selected, props.item.id], props.item.type);
      }
    } else {
      if (ls.selected.length > 1) {
        applyLayerSelection(
          ls,
          ls.selected.filter((id) => id !== props.item.id),
          props.item.type,
        );
      }
    }
  }
  ls.last_clicked_id = props.item.id;
}

function collectItemIdsInOrder(node, acc) {
  if (!node) return;
  if (node.type === 'item') {
    acc.push(node.id);
    return;
  }
  if (Array.isArray(node.childs)) {
    for (const child of node.childs) {
      collectItemIdsInOrder(child, acc);
    }
  }
}

function onPreviewClick(e) {
  if (props.toggleVisibility) {
    props.toggleVisibility(props.item, e.altKey === true);
  }
}

function findNodeInTree(nodes, id) {
  if (!Array.isArray(nodes)) return null;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.id === id) {
      return { node, parentArray: nodes, index: i };
    }
    if (Array.isArray(node.childs)) {
      const res = findNodeInTree(node.childs, id);
      if (res) return res;
    }
  }
  return null;
}

function toggleCollapse() {
  if (props.item.type !== 'folder') return;
  if (isFolderEmpty.value) return;
  if (props.item.collapsed === undefined) {
    props.item.collapsed = false;
  }
  props.item.collapsed = !props.item.collapsed;
}

function onDblClick() {
  editName.value = props.item.name || '';
  isEditing.value = true;
  ls.renaming_id = props.item.id;
  nextTick(() => {
    if (editInput.value) {
      editInput.value.focus();
      editInput.value.select();
    }
  });
}

function commitEdit() {
  if (!isEditing.value) return;
  const nextName = String(editName.value || '').trim();
  isEditing.value = false;
  finishEditing();
  if (!nextName || nextName === props.item.name) return;
  props.item.name = nextName;
  if (props.item.type === 'item' && Array.isArray(props.items)) {
    const item = props.items.find((it) => it.id === props.item.id);
    if (item) item.name = nextName;
  }
}

function cancelEdit() {
  isEditing.value = false;
  finishEditing();
}

function finishEditing() {
  if (ls.renaming_id === props.item.id) {
    ls.renaming_id = null;
  }
}

onMounted(() => {
  nextTick(() => {});
});

onBeforeUnmount(finishEditing);
</script>
<style scoped>
.layer-item {
  display: flex;
  flex-direction: column;
  user-select: none;
  padding: 0;
  margin: 0;
  background: transparent;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  transition:
    box-shadow 120ms ease,
    transform 120ms ease;
  position: relative;
  overflow: hidden;
  border-top: 1px solid #1a1b1e;
  font-family: 'JetBrains Mono', serif;
  &:last-child {
    border-bottom: none;
  }
  .main-info {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 15px;
    i {
      cursor: pointer;
    }
    i.folder-empty {
      opacity: 0.35;
      cursor: default;
    }
    .layer-edit {
      background: transparent;
      border: none;
      border-bottom: 1px solid #1a1b1e;
      color: #ced0d6;
      font-family: 'JetBrains Mono', serif;
      font-size: 13px;
      user-select: text;
      -webkit-user-select: text;
      width: 100%;
    }
    .preview {
      width: 20px;
      height: 20px;
      background: transparent;
      margin-left: auto;
      border-radius: 2px;
      flex-shrink: 0;
      /*border: 1px solid transparent;*/
      position: relative;
      &.is-active {
        &:before {
          content: '';
          position: absolute;
          background: #ef0a62;
          border-radius: 100%;
          width: 5px;
          height: 5px;
          right: -11px;
          top: 7px;
        }
      }
      &.is-hidden {
        opacity: 0.35;
        /*border-color: #444444;*/
      }
    }
    .visibility-toggle {
      width: 18px;
      height: 20px;
      margin-left: auto;
      border-radius: 2px;
      border: 1px solid transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      &.is-active {
        /*border-color: #ef0a62;*/
      }
      &.is-hidden {
        opacity: 0.35;
        /*border-color: #444444;*/
      }
    }
    .visibility-toggle {
      width: 18px;
      height: 20px;
      background: transparent;
      margin-left: auto;
      border-radius: 2px;
      &.is-hidden {
        opacity: 0.35;
      }
    }
  }
  .childs {
    margin-left: 25px;
    .folder-drop-after {
      height: 10px;
    }
  }
}

/* default small inset when dragging over (soft) */
.layer-item.is-dragging {
  /* subtle */
}

/* top — inner shadow from top */
.layer-item.zone-top {
  box-shadow: inset 0 4px 0 0 rgb(239 10 98);
}

/* center — inner shadow both sides / glow in middle */
.layer-item.zone-center {
  background: rgb(239 10 98);
}

/* bottom — inner shadow from bottom */
.layer-item.zone-bottom {
  box-shadow: inset 0 -4px 0 0 rgb(239 10 98);
}
.layer-item.is-selected {
  background: #1f1f1f;
}
.layer-item.contains-active-item > .main-info {
  position: relative;
  &:before {
    content: '';
    position: absolute;
    background: #ccced4;
    border-radius: 100%;
    width: 5px;
    height: 5px;
    right: 4px;
    top: 13px;
    opacity: 1;
  }
}
.layer-item.is-selected.contains-active-item > .main-info {
  &:before {
    display: none;
  }
}
/* content so text doesn't get affected by inset visuals */
.content {
  position: relative;
  z-index: 2;
  pointer-events: none; /* allow draggable events pass through */
}

/* optional: a subtle overlay gradient to emphasize the area (if you prefer) */
/*.layer-item.zone-top::after,
.layer-item.zone-center::after,
.layer-item.zone-bottom::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  height: 33%;
  pointer-events: none;
  transition: opacity 120ms;
  opacity: 0;
}*/

/*.layer-item.zone-top::after {
  top: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,0.06), transparent);
  opacity: 1;
}

.layer-item.zone-center::after {
  top: 33%;
  height: 34%;
  background: linear-gradient(to bottom, transparent, rgba(0,0,0,0.04));
  opacity: 1;
}

.layer-item.zone-bottom::after {
  bottom: 0;
  top: auto;
  background: linear-gradient(to top, rgba(0,0,0,0.06), transparent);
  opacity: 1;
}*/
</style>
