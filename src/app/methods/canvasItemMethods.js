import { applyLayerSelection, nextLayerId } from '../../stores/layers';
import { isPlatformPrimaryModifier } from '../../utils/inputModifiers';

export const canvasItemMethods = {
  create(event) {
    let new_item = {};
    new_item = {
      id: nextLayerId(this.ls),
      name: this.lastItem.name,
      type: this.lastItem.type,
      colors: this.regenerateColorIds([...this.lastItem.colors]),
      color_offsets: this.lastItem.color_offsets,
      x:
        Math.floor(event.offsetX / (this.texture.step * this.finalZoom)) *
        parseInt(this.texture.step),
      y:
        Math.floor(event.offsetY / (this.texture.step * this.finalZoom)) *
        parseInt(this.texture.step),
      size: this.lastItem.size,
      color_mode: this.lastItem.color_mode,
      direction: this.lastItem.direction,
      shape: this.lastItem.shape,
      albedo: this.lastItem.albedo,
      roughness: this.lastItem.roughness,
      metallic: this.lastItem.metallic,
      emission: this.lastItem.emission,
      emission_strength: this.lastItem.emission_strength,
      clearcoat: this.lastItem.clearcoat,
      clearcoat_roughness: this.lastItem.clearcoat_roughness,
      steps: this.lastItem.steps,
      visible: true,
      selected: true,
    };

    this.texture.items.push(new_item);
    for (let i = this.texture.items.length - 1; i >= 0; i--) {
      this.texture.items[i].selected = false;
    }
    new_item.selected = true;
    if (this.ls) {
      this.ls.pending_select_id = new_item.id;
      applyLayerSelection(this.ls, [new_item.id], 'item');
    }
    this.$nextTick(() => {
      const idx = this.texture.items.findIndex((item) => item.id === new_item.id);
      if (idx !== -1) {
        for (let i = this.texture.items.length - 1; i >= 0; i--) {
          this.texture.items[i].selected = false;
        }
        this.texture.items[idx].selected = true;
        this.is_syncing_layers = true;
        this.selected = idx;
      }
    });
    this.showItemPanelAfterSelection();
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
    const last_color =
      this.texture.items[this.selected].colors[this.texture.items[this.selected].colors.length - 1];

    this.texture.items[this.selected].colors.push({
      rgba: {
        r: last_color.rgba.r,
        g: last_color.rgba.g,
        b: last_color.rgba.b,
        a: last_color.rgba.a,
      },
      hsva: {
        h: last_color.hsva.h,
        s: last_color.hsva.s,
        v: last_color.hsva.v,
        a: last_color.hsva.a,
      },
      id: new Date().getTime(),
    });
    this.texture.items[this.selected].color_offsets.push(100);
    if (redistributeOffsets) {
      const o_count = this.texture.items[this.selected].color_offsets.length;
      let current_offset = 0;
      this.texture.items[this.selected].color_offsets.forEach((offset_item, offset_index) => {
        this.texture.items[this.selected].color_offsets[offset_index] = current_offset;
        current_offset += Math.round(100 / (o_count - 1));
        if (offset_index === o_count - 1) {
          this.texture.items[this.selected].color_offsets[offset_index] = 100;
        }
        if (o_count === 1) {
          this.texture.items[this.selected].color_offsets[0] = 0;
        }
      });
    } else {
      if (
        this.texture.items[this.selected].color_offsets[
          this.texture.items[this.selected].color_offsets.length - 2
        ] === 100
      ) {
        this.texture.items[this.selected].color_offsets[
          this.texture.items[this.selected].color_offsets.length - 2
        ] = 100 - 2;
      }
    }
  },
};
