import { applyLayerSelection } from '../../stores/layers';
import { isPlatformDeleteKey, isPlatformPrimaryModifier } from '../../utils/inputModifiers';

function isTextEditingTarget(target) {
  const tag = target?.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || target?.isContentEditable === true;
}

function historyKey(serialized) {
  const texture = JSON.parse(serialized);
  for (const item of texture.items || []) delete item.selected;
  return JSON.stringify(texture);
}

export const historyMethods = {
  pushUndoSnapshot() {
    const s_tex = JSON.stringify(this.texture);
    this.pushUndoSnapshotFromSerialized(s_tex, this.selected);
  },
  pushUndoSnapshotFromSerialized(textureJson, selected) {
    if (!textureJson) return;
    if (
      this.undo_array.length === 0 ||
      historyKey(this.undo_array[this.undo_array.length - 1].texture) !== historyKey(textureJson)
    ) {
      this.undo_array.push({ texture: textureJson, selected });
    }
    const limit = Math.max(1, Number(this.texture.undo_count) || 20) + 1;
    while (this.undo_array.length > limit) this.undo_array.shift();
  },
  addUndo(event) {
    const target = event && typeof event === 'object' ? event.target : null;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    if (
      event?.type === 'keyup' &&
      (event.ctrlKey ||
        event.metaKey ||
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable)
    )
      return;
    if (event === 'click' && !this.current_color_offset_first_change) {
      this.current_color_offset = -1;
      this.current_color_offset_first_change = false;
    } else if (this.current_color_offset_first_change) {
      this.current_color_offset_first_change = false;
    }
    if (event === 'before' || event === 'after') {
      this.pushUndoSnapshot();
      return;
    }
    this.$nextTick(() => {
      this.pushUndoSnapshot();
    });
  },
  undo() {
    this.pushUndoSnapshot();
    if (this.undo_array.length > 1) {
      const collapsedMap = new Map();
      const collectCollapsedState = (nodes) => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
          if (node && node.type === 'folder' && node.id !== undefined) {
            collapsedMap.set(node.id, node.collapsed === true);
          }
          if (node && Array.isArray(node.childs) && node.childs.length) {
            collectCollapsedState(node.childs);
          }
        }
      };
      const applyCollapsedState = (nodes) => {
        if (!Array.isArray(nodes)) return;
        for (const node of nodes) {
          if (
            node &&
            node.type === 'folder' &&
            node.id !== undefined &&
            collapsedMap.has(node.id)
          ) {
            node.collapsed = collapsedMap.get(node.id) === true;
          }
          if (node && Array.isArray(node.childs) && node.childs.length) {
            applyCollapsedState(node.childs);
          }
        }
      };
      collectCollapsedState(this.texture?.layers);
      this.undo_array.pop();
      this.texture = JSON.parse(this.undo_array[this.undo_array.length - 1].texture);
      applyCollapsedState(this.texture?.layers);
      const previousSelection = this.undo_array[this.undo_array.length - 1].selected;
      this.selected =
        Number.isInteger(previousSelection) && this.texture.items[previousSelection]
          ? previousSelection
          : false;
      if (this.ls) {
        const ids = this.texture.items.filter((item) => item.selected).map((item) => item.id);
        applyLayerSelection(this.ls, ids, 'item');
      }
      if (this.selected === false) {
        if (this.current_tab !== 'search') {
          this.current_tab = 'search';
        }
      }
      this.draw();
      this.colors_visible = false;
      this.$nextTick(() => {
        this.colors_visible = true;
      });
    }
  },
  offsetDrag(index) {
    this.current_color_offset = index;
    this.current_color_offset_first_change = true;
  },
  close() {
    window.electronAPI.closeWindow();
  },
  minimize() {
    window.electronAPI.minimizeWindow();
  },
  maximize() {
    window.electronAPI.maximizeWindow();
  },
  keydownHandler(event) {
    if (event.code === 'Escape' && this.boxSelection) {
      event.preventDefault();
      this.cancelBoxSelection();
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.code === 'KeyZ' &&
      !event.shiftKey &&
      !isTextEditingTarget(event.target)
    ) {
      event.preventDefault();
      this.undo();
      return;
    }
    if (event.code === 'Escape') {
      if (this.ls) {
        applyLayerSelection(this.ls, []);
      }
      this.selected = false;
      for (let i = this.texture.items.length - 1; i >= 0; i--) {
        this.texture.items[i].selected = false;
      }
      if (this.ctx && this.ctx.clearRect) {
        this.draw();
      }
      event.preventDefault();
      return;
    }
    if (isTextEditingTarget(event.target)) return;

    if (
      isPlatformDeleteKey({
        platform: window.electronAPI?.platform,
        code: event.code,
      })
    ) {
      if (this.$refs.layersPanel && this.$refs.layersPanel.removeSelected) {
        this.$refs.layersPanel.removeSelected();
        event.preventDefault();
      }
      return;
    }

    const isPrimaryModifier = isPlatformPrimaryModifier({
      platform: window.electronAPI?.platform,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (!isPrimaryModifier) return;

    if (!this.$refs.layersPanel) return;

    if (event.code === 'KeyC') {
      this.$refs.layersPanel.copySelection();
      event.preventDefault();
    } else if (event.code === 'KeyX') {
      this.$refs.layersPanel.cutSelection();
      event.preventDefault();
    } else if (event.code === 'KeyV') {
      this.$refs.layersPanel.pasteClipboard();
      event.preventDefault();
    }
  },
};
