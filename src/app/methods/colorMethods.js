export const colorMethods = {
  removeColor(index, redistributeOffsets = false) {
    if (
      (this.texture.items[this.selected].type === 'sg' &&
        this.texture.items[this.selected].color_mode !== 'black_to_white' &&
        this.texture.items[this.selected].colors.length === 1) ||
      (this.texture.items[this.selected].type === 'sg' &&
        this.texture.items[this.selected].color_mode === 'black_to_white' &&
        this.texture.items[this.selected].colors.length === 1) ||
      (this.texture.items[this.selected].type === 'g' &&
        this.texture.items[this.selected].colors.length === 1)
    ) {
      return;
    }
    this.texture.items[this.selected].colors.splice(index, 1);
    this.texture.items[this.selected].color_offsets.splice(index, 1);
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
    }
  },
  regenerateColorIds(colors) {
    for (let i = 0; i < colors.length; i++) {
      colors[i].id = new Date().getTime() + i;
    }
    return colors;
  },
  colorPicked(color, index) {
    this.$set(this.texture.items[this.selected].colors, index, color);
    /*return (evt.draggedContext.element.name!=='apple');*/
  },
};
