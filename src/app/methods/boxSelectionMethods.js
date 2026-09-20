import { applyLayerSelection } from '../../stores/layers';
import { boxSelectionRect, selectItemsInBox } from '../../utils/boxSelection';

export const boxSelectionMethods = {
  canvasPointerPosition(event) {
    const rect = this.$refs.texture.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - 1) / this.finalZoom,
      y: (event.clientY - rect.top - 1) / this.finalZoom,
    };
  },
  handleCanvasBackgroundDown(event) {
    if (event.button === 0 && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.stopZoomAnimation();
      const start = this.canvasPointerPosition(event);
      this.boxSelection = {
        start,
        end: start,
        initialIds: [...this.ls.selected],
        initialActive: this.ls.active_id,
        initialActiveType: this.ls.active_type,
        mode: event.altKey ? 'subtract' : this.isToggleSelectionPressed(event) ? 'add' : 'replace',
        moved: false,
      };
      window.addEventListener('mousemove', this.moveBoxSelection);
      window.addEventListener('mouseup', this.finishBoxSelection);
      window.addEventListener('blur', this.cancelBoxSelection);
    } else if (event.target === this.$refs.canvasContainer && event.button === 1) {
      this.mousedown(event);
    }
  },
  moveBoxSelection(event) {
    const box = this.boxSelection;
    if (!box) return;
    box.end = this.canvasPointerPosition(event);
    if (
      Math.hypot(box.end.x - box.start.x, box.end.y - box.start.y) * this.finalZoom < 3 &&
      !box.moved
    )
      return;
    box.moved = true;
    const ids = selectItemsInBox(
      this.texture,
      boxSelectionRect(box.start, box.end),
      box.initialIds,
      box.mode,
    );
    if (JSON.stringify(ids) !== JSON.stringify(this.ls.selected))
      applyLayerSelection(this.ls, ids, 'item');
  },
  finishBoxSelection(event) {
    if (event && this.boxSelection) this.moveBoxSelection(event);
    this.boxSelection = null;
    window.removeEventListener('mousemove', this.moveBoxSelection);
    window.removeEventListener('mouseup', this.finishBoxSelection);
    window.removeEventListener('blur', this.cancelBoxSelection);
  },
  cancelBoxSelection() {
    const box = this.boxSelection;
    if (box) {
      applyLayerSelection(this.ls, box.initialIds, 'item');
      this.ls.active_id = box.initialActive;
      this.ls.active_type = box.initialActiveType;
    }
    this.finishBoxSelection();
  },
};
