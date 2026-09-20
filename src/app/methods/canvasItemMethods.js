import { redistributeColorOffsets } from '../../utils/colorStops';
import { applyLayerSelection, nextLayerId } from '../../stores/layers';
import { isPlatformPrimaryModifier } from '../../utils/inputModifiers';

export const canvasItemMethods = {
  create(event) {
    const template = JSON.parse(JSON.stringify(this.lastItem));
    const newItem = {
      id: nextLayerId(this.ls),
      name: template.name,
      type: template.type,
      colors: this.regenerateColorIds([...template.colors]),
      color_offsets: template.color_offsets,
      x:
        Math.floor(event.offsetX / (this.texture.step * this.finalZoom)) *
        parseInt(this.texture.step),
      y:
        Math.floor(event.offsetY / (this.texture.step * this.finalZoom)) *
        parseInt(this.texture.step),
      size: template.size,
      color_mode: template.color_mode,
      direction: template.direction,
      shape: template.shape,
      albedo: template.albedo,
      roughness: template.roughness,
      metallic: template.metallic,
      emission: template.emission,
      emission_strength: template.emission_strength,
      clearcoat: template.clearcoat,
      clearcoat_roughness: template.clearcoat_roughness,
      steps: template.steps,
      visible: true,
      selected: true,
    };

    this.texture.items.push(newItem);
    for (let i = this.texture.items.length - 1; i >= 0; i--) {
      this.texture.items[i].selected = false;
    }
    newItem.selected = true;
    if (this.ls) {
      this.ls.pending_select_id = newItem.id;
      applyLayerSelection(this.ls, [newItem.id], 'item');
    }
    this.$nextTick(() => {
      const idx = this.texture.items.findIndex((item) => item.id === newItem.id);
      if (idx !== -1) {
        for (let i = this.texture.items.length - 1; i >= 0; i--) {
          this.texture.items[i].selected = false;
        }
        this.texture.items[idx].selected = true;
        this.is_syncing_layers = true;
        this.selected = idx;
        this.showItemPanelAfterSelection();
      }
    });
    return this.texture.items.length - 1;
  },
  remove(index) {
    this.texture.items.splice(index, 1);
    this.selected = false;
    if (this.current_tab !== 'search') {
      this.current_tab = 'texture';
    }
    this.addUndo();
  },
  resizeItems() {
    this.texture.items.forEach((item) => {
      if (item.type === 'sg') {
        const new_size = parseInt(item.size) + parseInt(this.resize_value);
        let pos_x = 0;
        let pos_y = 0;

        pos_x = Math.ceil(item.x / item.size);
        pos_y = Math.ceil(item.y / item.size);

        item.size = new_size;
        item.x = pos_x * new_size;
        item.y = pos_y * new_size;
      } else if (item.type === 'g') {
        const new_size_x = parseInt(item.size[0]) + parseInt(this.resize_value);
        const new_size_y = parseInt(item.size[1]) + parseInt(this.resize_value);
        let pos_x = 0;
        let pos_y = 0;

        pos_x = Math.ceil(item.x / item.size[0]);
        pos_y = Math.ceil(item.y / item.size[1]);

        item.size[0] = new_size_x;
        item.size[1] = new_size_y;
        item.x = pos_x * new_size_x;
        item.y = pos_y * new_size_y;
      }
    });
  },
  addColorFromClick(event) {
    const redistributeOffsets = isPlatformPrimaryModifier({
      platform: window.electronAPI?.platform,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    this.addColor(redistributeOffsets);
  },
  addColor(redistributeOffsets = false) {
    const item = this.texture.items[this.selected];
    if (!item) return;
    const lastColor = item.colors.at(-1) || this.lastItem.colors[0];
    if (!lastColor) return;
    item.colors.push({
      rgba: { ...lastColor.rgba },
      hsva: { ...lastColor.hsva },
      id: Date.now(),
    });
    item.color_offsets.push(100);
    if (redistributeOffsets) {
      redistributeColorOffsets(item.color_offsets);
    } else {
      const previousIndex = item.color_offsets.length - 2;
      if (item.color_offsets[previousIndex] === 100) item.color_offsets[previousIndex] = 98;
    }
  },
};
