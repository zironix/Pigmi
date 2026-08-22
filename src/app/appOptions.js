import Colorpicker2 from '../components/Colorpicker2.vue';
import LayersPanel from '../components/LayersPanel.vue';
import McpSetupPanel from '../components/McpSetupPanel.vue';
import { applyLayerSelection, useLayersStore } from '../stores/layers';
import { canvasInteractionMethods } from './methods/canvasInteractionMethods';
import { canvasItemMethods } from './methods/canvasItemMethods';
import { canvasRenderMethods } from './methods/canvasRenderMethods';
import { colorMethods } from './methods/colorMethods';
import { fileMethods } from './methods/filesMethods';
import { historyMethods } from './methods/historyMethods';
import { mcpMethods } from './methods/mcpMethods';
import { paletteMethods } from './methods/paletteMethods';
import { uiMethods } from './methods/uiMethods';
import {
  createCodexMcpCommand,
  createCodexMcpToml,
  createMcpJsonConfiguration,
} from '../utils/mcpConfiguration';
import '../assets/cssfont/audiowide/stylesheet.css';
import '../assets/icon-font/line-awesome.css';
import '../assets/cssfont/mono/stylesheet.css';
import VueSlider from 'vue-3-slider-component';
import { DragHandle, SlickItem, SlickList } from 'vue-slicksort';
import { Select as VueSelect } from 'vue3-select-component';
import 'vue3-select-component/styles.css';

export default {
  name: 'App',
  components: {
    Colorpicker2,
    DragHandle,
    LayersPanel,
    McpSetupPanel,
    SlickItem,
    SlickList,
    VueSelect,
    VueSlider,
  },
  data() {
    return {
      slash: window.electronAPI?.sep ?? '/',
      canvas: false,
      ctx: false,
      is_pressed: false,
      is_moving: false,
      is_color_changing: false,
      search: '',
      // This legacy UI uses `false` to mean that no texture item is selected.
      selected: false,
      ls: null,
      is_syncing_layers: false,
      save_timer: false,
      current_tab: 'texture',

      // Sidebar and split-view layout state.
      isItemSearchSplitVisible: false,
      itemSearchSplitRatio: 50,
      isItemSearchResizing: false,
      sidebarWidth: 220,
      isSidebarResizing: false,
      lastItemSearchState: 'search',
      mcp: {
        running: false,
        clientCount: 0,
        connectionFile: '',
        serverPath: '',
      },
      colors_visible: true,
      layersPanel: null,
      selected_offset: {
        x: 0,
        y: 0,
      },
      folder_path: '',
      texture_name: '',
      files_in_folder: [],
      selected_file: false,
      sync: false,
      overwrite_confirmation: false,
      undo_array: [],
      resize_value: 0,
      drag: false,
      current_color_offset_first_change: false,
      current_color_offset: -1,

      // Canvas selection and drag state.
      drag_start_mouse: null,
      drag_start_positions: null,
      drag_moved: false,
      selection_drag_toggled: null,
      selection_drag_active: false,
      selection_drag_mode: null,
      selection_drag_anchor: null,
      disposeMcpRequest: null,
      disposeMcpStatus: null,

      // This object is serialized to project files. Its snake_case keys are intentional.
      texture: {
        step: 64,
        width: 2048,
        height: 2048,
        zoom: -70,
        zoom_speed: 50,
        center_locked: true,
        undo_count: 20,
        locked_left: true,
        locked_right: true,
        default_color_model: 'hsva',
        max_item_size: 200,
        mix_preview: 1,
        save_albedo: 1,
        save_roughness: 1,
        save_metallic: 1,
        save_emission: 1,
        save_clearcoat: 1,
        save_clearcoat_roughness: 1,
        save_mrc: 0,
        update_interval: 200,
        items: [],
        layers: [],
        generation: {
          mode: 'transformer',
          temperature: 1.2,
          adjacency: 'balanced',
        },
      },
      lastItem: {
        name: 'Item',
        color_mode: 'rgb',
        type: 'g',
        shape: 'l',
        direction: 'vertical',
        colors: [
          {
            rgba: { r: 0, g: 0, b: 0, a: 1 },
            hsva: { h: 0, s: 0, v: 0, a: 1 },
            id: '0',
          },
          {
            rgba: { r: 255, g: 255, b: 255, a: 1 },
            hsva: { h: 0, s: 0, v: 100, a: 1 },
            id: '1',
          },
        ],
        color_offsets: [0, 100],
        albedo: 1,
        roughness: 50,
        metallic: 0,
        emission: 0,
        emission_strength: 100,
        clearcoat: 0,
        clearcoat_roughness: 0,
        selected: false,
        size: 64,
        steps: 1,
      },

      // Canvas position used while center locking is disabled.
      canvasPos: { left: 0, top: 0 },
      isPanning: false,
      panInput: null,
      panStartMouse: { x: 0, y: 0 },
      panStartPos: { left: 0, top: 0 },
      trackpadPanEndTimer: null,
      wheelGestureMode: null,
      wheelGestureLastAt: 0,
      wheelGestureResetTimer: null,
    };
  },
  created() {
    this.ls = useLayersStore();
  },
  computed: {
    finalZoom() {
      return this.texture.zoom / 100 + 1;
    },
    codexMcpCommand() {
      return createCodexMcpCommand({
        connectionFile: this.mcp.connectionFile,
        platform: window.electronAPI?.platform,
        serverPath: this.mcp.serverPath,
      });
    },
    codexMcpConfiguration() {
      return createCodexMcpToml({
        connectionFile: this.mcp.connectionFile,
        serverPath: this.mcp.serverPath,
      });
    },
    mcpJsonConfiguration() {
      return createMcpJsonConfiguration({
        connectionFile: this.mcp.connectionFile,
        serverPath: this.mcp.serverPath,
      });
    },
    canvasRenderedWidth() {
      return (this.texture?.width || 0) * (this.finalZoom || 1);
    },
    canvasRenderedHeight() {
      return (this.texture?.height || 0) * (this.finalZoom || 1);
    },
    leftSidebarStyle() {
      return {
        '--sidebar-panel-width': `${this.sidebarWidth}px`,
        ...(this.isItemSearchSplitVisible
          ? { '--item-search-split': this.itemSearchSplitRatio }
          : {}),
      };
    },
    // Centered coordinates are derived from the current container and canvas sizes.
    centerLeft() {
      const container = this.$refs.canvasContainer;
      const containerWidth = container?.clientWidth ?? 0;
      return Math.round((containerWidth - this.canvasRenderedWidth) / 2);
    },
    centerTop() {
      const container = this.$refs.canvasContainer;
      const containerHeight = container?.clientHeight ?? 0;
      return Math.round((containerHeight - this.canvasRenderedHeight) / 2);
    },
    canvasStyle() {
      if (this.texture.center_locked) {
        return {
          position: 'relative',
          margin: 'auto',
          left: 'auto',
          top: 'auto',
          cursor: this.isPanning ? 'grabbing' : 'pointer',
          userSelect: 'none',
          touchAction: 'none',
        };
      }

      return {
        position: 'absolute',
        left: `${this.canvasPos.left}px`,
        top: `${this.canvasPos.top}px`,
        cursor: this.isPanning ? 'grabbing' : 'pointer',
        userSelect: 'none',
        touchAction: 'none',
      };
    },
  },
  watch: {
    texture: {
      handler() {
        if (this.selected !== false) {
          const currentItem = this.texture.items[this.selected];
          if (!currentItem) {
            this.selected = false;
            return;
          }
          this.lastItem = JSON.parse(JSON.stringify(currentItem));
          const needsColor =
            currentItem.colors.length === 0 &&
            (currentItem.type === 'g' ||
              (currentItem.type === 'sg' && currentItem.color_mode !== 'black_to_white'));
          if (needsColor) {
            this.addColor();
          }
        }
        this.draw();
      },
      deep: true,
    },
    selected(newValue, oldValue) {
      const fromLayers = this.is_syncing_layers;
      this.is_syncing_layers = false;
      if (newValue === false && this.isItemSearchSplitVisible) {
        this.isItemSearchSplitVisible = false;
        this.current_tab = 'search';
        this.lastItemSearchState = 'split';
      }
      if (newValue !== false) {
        this.showItemPanelAfterSelection();
      }
      this.$nextTick(() => {
        if (newValue !== oldValue) {
          for (let i = this.texture.items.length - 1; i >= 0; i--) {
            this.texture.items[i].selected = false;
          }
          if (this.texture.items[newValue]) {
            this.texture.items[newValue].selected = true;
          }
        }

        if (this.ls && !fromLayers) {
          const item = this.texture.items[newValue];
          if (item && item.id !== undefined) {
            applyLayerSelection(this.ls, [item.id], 'item');
          } else {
            applyLayerSelection(this.ls, [], null);
          }
        }
      });
    },
    current_tab(newTab) {
      if (this.isItemSearchSplitVisible && newTab !== 'item' && newTab !== 'search') {
        this.isItemSearchSplitVisible = false;
      }
    },
    'texture.items'() {
      if (this.selected !== false && !this.texture.items[this.selected]) {
        this.is_syncing_layers = true;
        this.selected = false;
      }
      if (
        this.ls &&
        this.ls.pending_select_id !== null &&
        this.ls.pending_select_id !== undefined
      ) {
        const pendingIndex = this.texture.items.findIndex(
          (item) => item.id === this.ls.pending_select_id,
        );
        if (pendingIndex !== -1) {
          for (let i = this.texture.items.length - 1; i >= 0; i--) {
            this.texture.items[i].selected = false;
          }
          this.texture.items[pendingIndex].selected = true;
          this.is_syncing_layers = true;
          this.selected = pendingIndex;
        }
        this.ls.pending_select_id = null;
        return;
      }
      if (!this.ls || this.ls.active_id === null || this.ls.active_id === undefined) return;
      if (this.ls.active_type === 'folder') return;
      const index = this.texture.items.findIndex((item) => item.id === this.ls.active_id);
      if (index !== -1 && this.selected !== index) {
        this.is_syncing_layers = true;
        this.selected = index;
      }
    },
    'ls.selected': {
      handler(newSelection) {
        if (!this.ls) return;
        if (this.ls.active_type === 'folder') return;
        const ids = Array.isArray(newSelection) ? newSelection : [];

        if (ids.length === 0) {
          if (this.selected !== false) {
            this.is_syncing_layers = true;
            this.selected = false;
          }
          for (let i = this.texture.items.length - 1; i >= 0; i--) {
            this.texture.items[i].selected = false;
          }
          if (this.ctx && this.ctx.clearRect) {
            this.draw();
          }
          return;
        }

        if (this.ls.active_id === null && this.ls.active_type === 'none') {
          const selectedSet = new Set(ids);
          for (let i = this.texture.items.length - 1; i >= 0; i--) {
            this.texture.items[i].selected = selectedSet.has(this.texture.items[i].id);
          }
          this.is_syncing_layers = true;
          this.selected = false;
          if (this.ctx && this.ctx.clearRect) {
            this.draw();
          }
          return;
        }

        const activeId =
          this.ls.active_id !== null && this.ls.active_id !== undefined
            ? this.ls.active_id
            : ids[ids.length - 1];
        const selectedSet = new Set(ids);
        for (let i = this.texture.items.length - 1; i >= 0; i--) {
          this.texture.items[i].selected = selectedSet.has(this.texture.items[i].id);
        }
        const index = this.texture.items.findIndex((item) => item.id === activeId);
        if (index === -1) {
          this.is_syncing_layers = true;
          this.selected = false;
          if (this.ctx && this.ctx.clearRect) {
            this.draw();
          }
          return;
        }
        if (this.selected !== index) {
          this.is_syncing_layers = true;
          this.selected = index;
        }
        if (this.ctx && this.ctx.clearRect) {
          this.draw();
        }
      },
      deep: true,
    },
    texture_name() {
      this.sync = false;
    },
    folder_path() {
      this.sync = false;
    },
    selected_file(newValue, oldValue) {
      if (newValue !== oldValue) {
        this.sync = false;
      }
    },
  },
  methods: {
    ...canvasInteractionMethods,
    ...canvasItemMethods,
    ...canvasRenderMethods,
    ...colorMethods,
    ...fileMethods,
    ...historyMethods,
    ...mcpMethods,
    ...paletteMethods,
    ...uiMethods,
  },
  mounted() {
    void this.initializeMcpIntegration();
    this.canvas = this.$refs.texture;
    this.canvas_albedo = this.$refs.albedo_texture;
    this.canvas_roughness = this.$refs.roughness_texture;
    this.canvas_metallic = this.$refs.metallic_texture;
    this.canvas_emission = this.$refs.emission_texture;
    this.canvas_emission_crop = this.$refs.emission_crop_texture;
    this.canvas_clearcoat = this.$refs.clearcoat_texture;
    this.canvas_clearcoat_roughness = this.$refs.clearcoat_roughness_texture;
    this.canvas_mrc = this.$refs.mrc_texture;

    this.ctx = this.$refs.texture.getContext('2d');
    this.ctx_albedo = this.$refs.albedo_texture.getContext('2d');
    this.ctx_roughness = this.$refs.roughness_texture.getContext('2d');
    this.ctx_metallic = this.$refs.metallic_texture.getContext('2d');
    this.ctx_emission = this.$refs.emission_texture.getContext('2d', { willReadFrequently: true });
    this.ctx_emission_crop = this.$refs.emission_crop_texture.getContext('2d', {
      willReadFrequently: true,
    });
    this.ctx_clearcoat = this.$refs.clearcoat_texture.getContext('2d');
    this.ctx_clearcoat_roughness = this.$refs.clearcoat_roughness_texture.getContext('2d');
    this.ctx_mrc = this.$refs.mrc_texture.getContext('2d');

    document.addEventListener('keyup', this.keyupHandler);
    document.addEventListener('keydown', this.keydownHandler);
    this.$nextTick(() => {
      this.draw();
    });
  },
  beforeUnmount() {
    this.disposeMcpRequest?.();
    this.disposeMcpStatus?.();
    document.removeEventListener('keyup', this.keyupHandler);
    document.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('mousemove', this.onItemSearchResize);
    window.removeEventListener('mouseup', this.stopItemSearchResize);
    window.removeEventListener('mousemove', this.onSidebarResize);
    window.removeEventListener('mouseup', this.stopSidebarResize);
    window.removeEventListener('mousemove', this.onPanMove);
    window.removeEventListener('mouseup', this.onPanEnd);
    clearTimeout(this.trackpadPanEndTimer);
    clearTimeout(this.wheelGestureResetTimer);
    document.body.style.cursor = '';
  },
};
