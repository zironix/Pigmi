import { applyLayerSelection } from '../../stores/layers';
import { isPlatformPrimaryModifier } from '../../utils/inputModifiers';
import {
  calculateAnchoredCanvasPosition,
  classifyWheelInput,
  WHEEL_GESTURE_IDLE_MS,
} from '../../utils/wheelInput';

export const canvasInteractionMethods = {
  isToggleSelectionPressed(event) {
    return isPlatformPrimaryModifier({
      platform: window.electronAPI?.platform,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
  },
  mousedown(event) {
    const isToggleSelection = this.isToggleSelectionPressed(event);

    if (event.button === 0) {
      this.is_pressed = true;
      this.drag_hit_index = null;
      this.drag_moved = false;
      this.drag_pending_single = false;
      this.selection_drag_toggled = new Set();
      this.selection_drag_active = false;
      this.selection_drag_mode = null;
      this.drag_start_mouse = {
        x: event.offsetX / this.finalZoom,
        y: event.offsetY / this.finalZoom,
      };
      if (!isToggleSelection) {
        const hitIndex = this.getHitIndex(event);
        if (hitIndex === null || hitIndex === undefined) {
          this.selected_offset.x = 0;
          this.selected_offset.y = 0;
          this.selected = this.create(event);
        } else if (
          this.ls &&
          Array.isArray(this.ls.selected) &&
          this.ls.selected.length > 1 &&
          this.ls.selected.includes(this.texture.items[hitIndex].id)
        ) {
          // keep multi-selection when dragging any selected item
        } else {
          const selectedIndex = this.select(event, false, false);
          if (selectedIndex !== null && selectedIndex !== undefined && selectedIndex !== false) {
            this.selected = selectedIndex;
          }
        }
      }
      const ids = this.ls && Array.isArray(this.ls.selected) ? this.ls.selected : [];
      const selectedSet = new Set(ids);
      const positions = {};
      this.texture.items.forEach((it) => {
        if (
          selectedSet.size
            ? selectedSet.has(it.id)
            : this.selected !== false &&
              this.texture.items[this.selected] &&
              it.id === this.texture.items[this.selected].id
        ) {
          positions[it.id] = { x: it.x, y: it.y };
        }
      });
      this.drag_start_positions = positions;
      if (selectedSet.size > 1) {
        const activeId =
          this.ls && this.ls.active_id !== null && this.ls.active_id !== undefined
            ? this.ls.active_id
            : selectedSet.size
              ? Array.from(selectedSet)[0]
              : null;
        if (activeId && positions[activeId]) {
          this.drag_anchor_offset = {
            x: this.drag_start_mouse.x - positions[activeId].x,
            y: this.drag_start_mouse.y - positions[activeId].y,
          };
        } else {
          this.drag_anchor_offset = { x: 0, y: 0 };
        }
      } else {
        this.drag_anchor_offset = null;
      }
    }
    if (event.button === 2) {
      const idx = this.select(event, false);
      if (idx !== null && idx !== undefined && idx !== false) {
        this.remove(idx);
      } else {
        this.selected = false;
        for (let i = this.texture.items.length - 1; i >= 0; i--) {
          this.texture.items[i].selected = false;
        }
        if (this.ls) {
          applyLayerSelection(this.ls, []);
        }
      }
      this.draw();
    }

    //middle
    if (event.button === 1) {
      event.preventDefault();
      this.unlockCanvasForPan();

      // начинаем панинг
      this.isPanning = true;
      this.panInput = 'mouse';
      this.panStartMouse.x = event.clientX;
      this.panStartMouse.y = event.clientY;
      this.panStartPos.left = this.canvasPos.left;
      this.panStartPos.top = this.canvasPos.top;

      // слушаем глобально, чтобы не терять движение, если курсор уйдёт
      window.addEventListener('mousemove', this.onPanMove, { passive: false });
      window.addEventListener('mouseup', this.onPanEnd, { passive: false });
      document.body.style.cursor = 'grabbing';
    }
  },
  toggleCenterLock() {
    const container = this.$refs.canvasContainer;
    const canvas = this.$refs.texture;

    // Если переключаемся ОТ режима centerLocked === true -> в false,
    // нужно сохранить текущую визуальную позицию в canvasPos, чтобы не было "прыжка".
    if (this.texture.center_locked) {
      if (container && canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        // переводим экранную позицию в координаты внутри "контента" контейнера
        const left = Math.round(canvasRect.left - containerRect.left + container.scrollLeft);
        const top = Math.round(canvasRect.top - containerRect.top + container.scrollTop);

        this.canvasPos.left = left;
        this.canvasPos.top = top;
      } else {
        // refs ещё нет — можно оставить canvasPos как есть
      }

      // выключаем центрирование — теперь используем canvasPos для absolute-позиционирования
      this.texture.center_locked = false;
    } else {
      // включаем центрирование — CSS (flex + margin:auto) его отцентрует
      // не трогаем canvasPos (можно оставить прошлую позицию, если понадобится)
      this.texture.center_locked = true;
    }
  },
  unlockCanvasForPan() {
    if (!this.texture.center_locked) return;

    const container = this.$refs.canvasContainer;
    const canvas = this.$refs.texture;
    if (container && canvas) {
      const canvasRect = canvas.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      this.canvasPos.left = Math.round(canvasRect.left - containerRect.left + container.scrollLeft);
      this.canvasPos.top = Math.round(canvasRect.top - containerRect.top + container.scrollTop);
    } else {
      this.canvasPos.left = this.centerLeft;
      this.canvasPos.top = this.centerTop;
    }
    this.texture.center_locked = false;
  },
  async openFolderInOS(path) {
    await window.electronAPI.openFolder(path);
  },
  onPanMove(event) {
    if (!this.isPanning || this.panInput !== 'mouse') return;
    event.preventDefault();
    const dx = event.clientX - this.panStartMouse.x;
    const dy = event.clientY - this.panStartMouse.y;
    this.canvasPos.left = this.panStartPos.left + dx;
    this.canvasPos.top = this.panStartPos.top + dy;
  },
  onPanEnd() {
    if (!this.isPanning || this.panInput !== 'mouse') return;
    this.isPanning = false;
    this.panInput = null;
    window.removeEventListener('mousemove', this.onPanMove);
    window.removeEventListener('mouseup', this.onPanEnd);
    document.body.style.cursor = '';
  },
  mouseup(event) {
    if (this.is_pressed && !this.drag_moved && !this.selection_drag_active) {
      if (event.button === 0) {
        if (this.isToggleSelectionPressed(event)) {
          this.select(event, false, true, 'add');
        } else {
          this.select(event, true, false);
        }
      }
    }
    this.is_pressed = false;
    if (this.is_moving) {
      this.is_moving = false;
    }
    this.drag_hit_index = null;
    this.drag_moved = false;
    this.drag_pending_single = false;
    this.selection_drag_toggled = null;
    this.selection_drag_active = false;
    this.selection_drag_mode = null;
    this.selection_drag_anchor = null;
  },
  mousemove(event) {
    if (this.ls) {
      this.ls.last_canvas_in_bounds = true;
      this.ls.last_canvas_pos = {
        x: event.offsetX / this.finalZoom,
        y: event.offsetY / this.finalZoom,
      };
      if (this.selected !== false && this.texture.items[this.selected]) {
        const currentItem = this.texture.items[this.selected];
        let offsetX = 0;
        let offsetY = 0;
        if (currentItem.type === 'sg') {
          offsetX = this.selected_offset.x * currentItem.size;
          offsetY = this.selected_offset.y * currentItem.size;
        } else {
          offsetX = this.selected_offset.x * currentItem.size[0];
          offsetY = this.selected_offset.y * currentItem.size[1];
        }
        this.ls.paste_offset = { x: offsetX, y: offsetY };
      } else {
        this.ls.paste_offset = { x: 0, y: 0 };
      }
    }
    if (this.is_pressed && this.isToggleSelectionPressed(event)) {
      const ids = this.ls && Array.isArray(this.ls.selected) ? this.ls.selected : [];
      const hitIndex = this.getHitIndex(event);
      if (hitIndex === null || hitIndex === undefined) {
        return;
      }
      const id = this.texture.items[hitIndex].id;
      if (!this.selection_drag_active) {
        this.selection_drag_active = true;
        this.selection_drag_mode = ids.includes(id) ? 'remove' : 'add';
        this.selection_drag_anchor = this.selection_drag_mode === 'add' ? id : null;
        if (this.selection_drag_mode === 'add') {
          applyLayerSelection(this.ls, [...ids, id], 'item');
          this.selection_drag_toggled.add(id);
          return;
        }
      }
      if (!this.selection_drag_toggled) {
        this.selection_drag_toggled = new Set();
      }
      if (this.selection_drag_toggled.has(id)) {
        return;
      }
      if (this.selection_drag_mode === 'remove') {
        const activeBefore = this.ls.active_id;
        const next = ids.filter((x) => x !== id);
        applyLayerSelection(this.ls, next, 'item');
        if (activeBefore === id) {
          this.ls.active_id = null;
          this.ls.active_type = 'none';
        } else if (activeBefore !== null && next.includes(activeBefore)) {
          this.ls.active_id = activeBefore;
          this.ls.active_type = 'item';
        } else {
          this.ls.active_id = null;
          this.ls.active_type = 'none';
        }
      } else if (this.selection_drag_mode === 'add') {
        if (!ids.includes(id)) {
          const next = [...ids, id];
          applyLayerSelection(this.ls, next, 'item');
          if (this.selection_drag_anchor !== null && this.selection_drag_anchor !== id) {
            this.ls.active_id = this.selection_drag_anchor;
            this.ls.active_type = 'item';
          }
        }
      }
      this.selection_drag_toggled.add(id);
      return;
    }
    if (this.is_pressed && this.drag_start_mouse) {
      const dx = event.offsetX / this.finalZoom - this.drag_start_mouse.x;
      const dy = event.offsetY / this.finalZoom - this.drag_start_mouse.y;
      if (!this.drag_moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
        this.drag_moved = true;
      }
      const ids = this.ls && Array.isArray(this.ls.selected) ? this.ls.selected : [];
      const selectedSet = new Set(ids);
      if (selectedSet.size > 1 && this.drag_start_positions) {
        if (this.drag_moved) {
          this.is_moving = true;
          const step = Number(this.texture.step) || 1;
          this.texture.items.forEach((it) => {
            if (!selectedSet.has(it.id)) return;
            const start = this.drag_start_positions[it.id];
            if (!start) return;
            let nx = start.x + dx;
            let ny = start.y + dy;
            nx = Math.round(nx / step) * step;
            ny = Math.round(ny / step) * step;
            it.x = nx;
            it.y = ny;
          });
          this.draw();
        }
        return;
      }
    }
    if (this.is_pressed && this.selected !== false) {
      this.is_moving = true;

      if (this.texture.items[this.selected].type === 'sg') {
        const old_x = this.texture.items[this.selected].x * this.finalZoom;
        const old_y = this.texture.items[this.selected].y * this.finalZoom;

        this.texture.items[this.selected].x =
          Math.floor(
            (event.offsetX -
              this.selected_offset.x * this.texture.items[this.selected].size * this.finalZoom) /
              (this.texture.step * this.finalZoom),
          ) * this.texture.step;

        this.texture.items[this.selected].y =
          Math.floor(
            (event.offsetY -
              this.selected_offset.y * this.texture.items[this.selected].size * this.finalZoom) /
              (this.texture.step * this.finalZoom),
          ) * this.texture.step;

        if (
          old_x != this.texture.items[this.selected].x ||
          old_y != this.texture.items[this.selected].y
        ) {
          this.draw();
        }
      } else {
        const old_x = this.texture.items[this.selected].x * this.finalZoom;
        const old_y = this.texture.items[this.selected].y * this.finalZoom;

        this.texture.items[this.selected].x =
          Math.floor(
            (event.offsetX -
              this.selected_offset.x * this.texture.items[this.selected].size[0] * this.finalZoom) /
              (this.texture.step * this.finalZoom),
          ) * this.texture.step;

        this.texture.items[this.selected].y =
          Math.floor(
            (event.offsetY -
              this.selected_offset.y * this.texture.items[this.selected].size[1] * this.finalZoom) /
              (this.texture.step * this.finalZoom),
          ) * this.texture.step;

        if (
          old_x != this.texture.items[this.selected].x ||
          old_y != this.texture.items[this.selected].y
        ) {
          this.draw();
        }
      }
    }
  },
  getWheelGestureMode(event) {
    if (event.ctrlKey || event.metaKey) {
      this.wheelGestureMode = null;
      clearTimeout(this.wheelGestureResetTimer);
      return 'zoom';
    }

    const now = performance.now();
    if (this.wheelGestureMode && now - this.wheelGestureLastAt <= WHEEL_GESTURE_IDLE_MS) {
      this.wheelGestureLastAt = now;
      this.scheduleWheelGestureReset();
      return this.wheelGestureMode;
    }

    this.wheelGestureMode = classifyWheelInput({
      platform: window.electronAPI?.platform,
      deltaMode: event.deltaMode,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    });
    this.wheelGestureLastAt = now;
    this.scheduleWheelGestureReset();
    return this.wheelGestureMode;
  },
  scheduleWheelGestureReset() {
    clearTimeout(this.wheelGestureResetTimer);
    this.wheelGestureResetTimer = setTimeout(() => {
      this.wheelGestureMode = null;
    }, WHEEL_GESTURE_IDLE_MS);
  },
  panCanvasWithTrackpad(event) {
    if (this.isPanning && this.panInput === 'mouse') return;
    this.unlockCanvasForPan();
    this.canvasPos.left -= event.deltaX;
    this.canvasPos.top -= event.deltaY;
    this.isPanning = true;
    this.panInput = 'trackpad';
    document.body.style.cursor = 'grabbing';

    clearTimeout(this.trackpadPanEndTimer);
    this.trackpadPanEndTimer = setTimeout(() => {
      if (this.panInput !== 'trackpad') return;
      this.isPanning = false;
      this.panInput = null;
      document.body.style.cursor = '';
    }, WHEEL_GESTURE_IDLE_MS);
  },
  mousewheel(event) {
    event.preventDefault();

    if (this.getWheelGestureMode(event) === 'pan') {
      this.panCanvasWithTrackpad(event);
      return;
    }

    const container = this.$refs.canvasContainer;
    const canvas = this.$refs.texture;
    if (!container || !canvas) return;

    // Cursor-anchored zoom requires a freely positioned canvas. Converting from
    // centered to absolute positioning preserves its current on-screen location.
    this.unlockCanvasForPan();

    const oldZoom = this.finalZoom;
    const canvasRect = canvas.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Рассчитываем адаптивный шаг зума на основе размера текстуры
    const textureSize = Math.max(this.texture.width, this.texture.height); // или Math.sqrt(this.texture.width ** 2 + this.texture.height ** 2)
    const baseZoomStep = this.texture.zoom_speed || 1; // Базовый шаг зума
    // Адаптивный шаг: для маленьких текстур увеличиваем шаг, для больших — уменьшаем
    const adaptiveZoomStep = baseZoomStep * (100 / textureSize); // Нормируем относительно, например, 100 пикселей
    const step = event.deltaY < 0 ? adaptiveZoomStep : -adaptiveZoomStep;

    // Ограничиваем texture.zoom в разумных пределах
    const minTextureZoom = -99; // Минимальный зум (например, finalZoom = -99/100 + 1 = 0.01)
    const maxTextureZoom = 10000; // Максимальный зум (например, finalZoom = 1000/100 + 1 = 11)
    this.texture.zoom = Math.max(
      minTextureZoom,
      Math.min(maxTextureZoom, (this.texture.zoom + step).toFixed(3)),
    );

    const nextPosition = calculateAnchoredCanvasPosition({
      cursorX: event.clientX,
      cursorY: event.clientY,
      canvasLeft: canvasRect.left,
      canvasTop: canvasRect.top,
      containerLeft: containerRect.left,
      containerTop: containerRect.top,
      containerScrollLeft: container.scrollLeft,
      containerScrollTop: container.scrollTop,
      oldScale: oldZoom,
      newScale: this.finalZoom,
    });
    this.canvasPos.left = nextPosition.left;
    this.canvasPos.top = nextPosition.top;
    this.$nextTick(() => this.redrawCanvasAfterResize());
  },
  select(event, createOnMiss = true, additive = false, additiveMode = 'toggle') {
    this.selecting = true;
    this.selected_offset.x = 0;
    this.selected_offset.y = 0;
    if (!additive) {
      for (let i = this.texture.items.length - 1; i >= 0; i--) {
        this.texture.items[i].selected = false;
      }
    }
    for (let i = this.texture.items.length - 1; i >= 0; i--) {
      if (this.texture.items[i].visible === false) {
        continue;
      }

      if (this.texture.items[i].type === 'sg') {
        let x_steps = 1,
          y_steps = 1;

        if (
          this.texture.items[i].direction &&
          this.texture.items[i].steps &&
          this.texture.items[i].steps > 1
        ) {
          let m = this.texture.items[i].colors.length - 1;
          let a_steps = 0;
          if (!m) {
            m = 1;
          }

          if (this.texture.items[i].color_mode === 'black_to_white') {
            m = 1;
            a_steps = this.texture.items[i].steps + 1;
          }
          if (this.texture.items[i].direction === 'horizontal') {
            x_steps = this.texture.items[i].steps * m + a_steps;
          } else {
            y_steps = this.texture.items[i].steps * m + a_steps;
          }
        }
        if (
          event.offsetX >= this.texture.items[i].x * this.finalZoom &&
          event.offsetX <=
            +this.texture.items[i].x * this.finalZoom +
              this.texture.items[i].size * x_steps * this.finalZoom &&
          event.offsetY >= this.texture.items[i].y * this.finalZoom &&
          event.offsetY <=
            +this.texture.items[i].y * this.finalZoom +
              this.texture.items[i].size * y_steps * this.finalZoom
        ) {
          if (this.texture.items[i].direction === 'horizontal') {
            const left = this.texture.items[i].x * this.finalZoom;
            const relative_x = event.offsetX - left;
            this.selected_offset.x =
              Math.ceil(relative_x / (this.texture.items[i].size * this.finalZoom)) - 1;
            this.selected_offset.y = 0;
          } else {
            const top = this.texture.items[i].y * this.finalZoom;
            const relative_y = event.offsetY - top;
            this.selected_offset.x = 0;
            this.selected_offset.y =
              Math.ceil(relative_y / (this.texture.items[i].size * this.finalZoom)) - 1;
          }

          //this.texture.items.push(...this.texture.items.splice(i, 1));
          this.showItemPanelAfterSelection();
          if (additive && this.ls) {
            const ids = Array.isArray(this.ls.selected) ? [...this.ls.selected] : [];
            const idx = ids.indexOf(this.texture.items[i].id);
            if (idx === -1) {
              ids.push(this.texture.items[i].id);
            } else if (additiveMode === 'toggle' && ids.length > 1) {
              ids.splice(idx, 1);
            } else if (additiveMode === 'add') {
              ids.splice(idx, 1);
              ids.push(this.texture.items[i].id);
            }
            applyLayerSelection(this.ls, ids, 'item');
          } else {
            this.texture.items[i].selected = true;
            if (this.ls) {
              applyLayerSelection(this.ls, [this.texture.items[i].id], 'item');
            }
          }
          return i;
        }
      } else {
        if (
          event.offsetX >= this.texture.items[i].x * this.finalZoom &&
          event.offsetX <=
            +this.texture.items[i].x * this.finalZoom +
              this.texture.items[i].size[0] * this.finalZoom &&
          event.offsetY >= this.texture.items[i].y * this.finalZoom &&
          event.offsetY <=
            +this.texture.items[i].y * this.finalZoom +
              this.texture.items[i].size[1] * this.finalZoom
        ) {
          const left = this.texture.items[i].x * this.finalZoom;
          const top = this.texture.items[i].y * this.finalZoom;

          const relative_x = event.offsetX - left;
          const relative_y = event.offsetY - top;

          this.selected_offset.x =
            Math.ceil(relative_x / (this.texture.items[i].size[0] * this.finalZoom)) - 1;
          this.selected_offset.y =
            Math.ceil(relative_y / (this.texture.items[i].size[1] * this.finalZoom)) - 1;

          this.showItemPanelAfterSelection();

          if (additive && this.ls) {
            const ids = Array.isArray(this.ls.selected) ? [...this.ls.selected] : [];
            const idx = ids.indexOf(this.texture.items[i].id);
            if (idx === -1) {
              ids.push(this.texture.items[i].id);
            } else if (additiveMode === 'toggle' && ids.length > 1) {
              ids.splice(idx, 1);
            } else if (additiveMode === 'add') {
              ids.splice(idx, 1);
              ids.push(this.texture.items[i].id);
            }
            applyLayerSelection(this.ls, ids, 'item');
          } else {
            this.texture.items[i].selected = true;
            if (this.ls) {
              applyLayerSelection(this.ls, [this.texture.items[i].id], 'item');
            }
          }
          return i;
        }
      }
    }
    this.selecting = false;
    if (this.ls) {
      if (
        this.ls.active_type === 'folder' &&
        this.ls.active_id !== null &&
        this.ls.active_id !== undefined
      ) {
        this.ls.pending_insert = { mode: 'folder', target_id: this.ls.active_id };
      } else if (
        this.ls.active_type === 'item' &&
        this.ls.active_id !== null &&
        this.ls.active_id !== undefined
      ) {
        this.ls.pending_insert = { mode: 'sibling', target_id: this.ls.active_id };
      } else {
        this.ls.pending_insert = null;
      }
    }
    if (!createOnMiss) {
      this.selecting = false;
      return null;
    }
    this.create(event);
    return null;
  },
  getHitIndex(event) {
    for (let i = this.texture.items.length - 1; i >= 0; i--) {
      if (this.texture.items[i].visible === false) continue;
      if (this.texture.items[i].type === 'sg') {
        let x_steps = 1,
          y_steps = 1;
        if (
          this.texture.items[i].direction &&
          this.texture.items[i].steps &&
          this.texture.items[i].steps > 1
        ) {
          let m = this.texture.items[i].colors.length - 1;
          let a_steps = 0;
          if (!m) m = 1;
          if (this.texture.items[i].color_mode === 'black_to_white') {
            m = 1;
            a_steps = this.texture.items[i].steps + 1;
          }
          if (this.texture.items[i].direction === 'horizontal') {
            x_steps = this.texture.items[i].steps * m + a_steps;
          } else {
            y_steps = this.texture.items[i].steps * m + a_steps;
          }
        }
        if (
          event.offsetX >= this.texture.items[i].x * this.finalZoom &&
          event.offsetX <=
            +this.texture.items[i].x * this.finalZoom +
              this.texture.items[i].size * x_steps * this.finalZoom &&
          event.offsetY >= this.texture.items[i].y * this.finalZoom &&
          event.offsetY <=
            +this.texture.items[i].y * this.finalZoom +
              this.texture.items[i].size * y_steps * this.finalZoom
        ) {
          return i;
        }
      } else {
        if (
          event.offsetX >= this.texture.items[i].x * this.finalZoom &&
          event.offsetX <=
            +this.texture.items[i].x * this.finalZoom +
              this.texture.items[i].size[0] * this.finalZoom &&
          event.offsetY >= this.texture.items[i].y * this.finalZoom &&
          event.offsetY <=
            +this.texture.items[i].y * this.finalZoom +
              this.texture.items[i].size[1] * this.finalZoom
        ) {
          return i;
        }
      }
    }
    return null;
  },
  mouseLeave() {
    if (this.ls) {
      this.ls.last_canvas_in_bounds = false;
    }
  },
};
