import { redistributeColorOffsets } from '../../utils/colorStops';

export const colorMethods = {
  removeColor(index, redistributeOffsets = false) {
    const item = this.texture.items[this.selected];
    if (!item || item.colors.length <= 1) return;
    item.colors.splice(index, 1);
    item.color_offsets.splice(index, 1);
    if (redistributeOffsets) redistributeColorOffsets(item.color_offsets);
  },
  regenerateColorIds(colors) {
    const timestamp = Date.now();
    colors.forEach((color, index) => {
      color.id = timestamp + index;
    });
    return colors;
  },
  colorPicked(color, index) {
    const item = this.texture.items[this.selected];
    if (item) item.colors[index] = color;
  },
};
