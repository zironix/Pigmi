import { applyLayerSelection } from '../../stores/layers';
import { isPlatformDeleteKey, isPlatformPrimaryModifier } from '../../utils/inputModifiers';

function isTextEditingTarget(target) {
  const tag = target?.tagName ? target.tagName.toLowerCase() : '';
  return tag === 'input' || tag === 'textarea' || target?.isContentEditable === true;
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
      this.undo_array[this.undo_array.length - 1].texture !== textureJson
    ) {
      this.undo_array.push({ texture: textureJson, selected });
    }
    if (this.undo_array.length >= this.texture.undo_count + 1 && this.undo_array.length !== 0) {
      this.undo_array.shift();
    }
  },
  addUndo(event) {
    //console.log(this.undo_array)
    const target = event && typeof event === 'object' ? event.target : null;
    const tag = target && target.tagName ? target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) {
      return;
    }
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
    //console.log(this.undo_array)
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
      this.selected = this.undo_array[this.undo_array.length - 1].selected;
      if (!this.selected) {
        if (this.current_tab !== 'search') {
          this.current_tab = 'texture';
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
  keyupHandler(event) {
    if (isTextEditingTarget(event.target)) return;

    const isPrimaryModifier = isPlatformPrimaryModifier({
      platform: window.electronAPI?.platform,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    if (isPrimaryModifier && event.code === 'KeyZ') {
      this.undo();
    }
  },
  keydownHandler(event) {
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
