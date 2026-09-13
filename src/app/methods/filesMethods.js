import { MATERIAL_CHANNELS } from '../../utils/canvasRendering';

const saveStates = new WeakMap();

function captureExportSnapshot(editor, canPreview) {
  const snapshot = {
    folder_path: editor.folder_path,
    selected_file: editor.selected_file,
    slash: editor.slash,
    texture: { ...editor.texture },
    serializedTexture: JSON.stringify(editor.texture),
    finalZoom: editor.finalZoom,
    ctx: editor.ctx,
    canPreview,
  };
  const channels = new Set(
    MATERIAL_CHANNELS.filter((channel) => editor.texture[`save_${channel}`]),
  );
  if (channels.has('albedo')) {
    channels.add('emission');
    channels.add('emission_crop');
  }
  // Export from private canvases: editing or loading another document during
  // asynchronous image decoding must not change the file currently being saved.
  for (const channel of channels) {
    const source = editor[`canvas_${channel}`];
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const context = canvas.getContext('2d');
    context.drawImage(source, 0, 0);
    snapshot[`canvas_${channel}`] = canvas;
    snapshot[`ctx_${channel}`] = context;
  }
  return snapshot;
}

async function loadProjectImage(filePath) {
  // Chromium may reject arbitrary file:// URLs from a context-isolated
  // renderer. Read only an authorized project file through the main process
  // and decode it from a renderer-owned Blob URL instead.
  const contents = await window.electronAPI.readBinaryFile(filePath);
  const objectUrl = URL.createObjectURL(new Blob([contents], { type: 'image/png' }));
  const image = new Image();

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error(`Failed to load mix texture: ${filePath}`));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export const fileMethods = {
  async selectFolder() {
    const folderPath = await window.electronAPI.selectFolder();

    if (folderPath) {
      this.folder_path = folderPath;
      this.selected_file = false;
      this.getFiles();
    }
  },
  async getFiles() {
    this.files_in_folder = [];

    if (this.folder_path && this.folder_path.length > 0) {
      try {
        const files = await window.electronAPI.readDir(this.folder_path);

        files.forEach((file) => {
          // Project entries are JSON files; directories and other files are ignored.
          if (file.isFile) {
            if (file.name.endsWith('.json')) {
              this.files_in_folder.push(file.name);
              if (!this.selected_file) {
                this.selected_file = file.name;
              }
            }
          }
        });
      } catch (error) {
        console.error('Error reading directory:', error);
      }
    }
  },
  async mixTexture(type) {
    const path_without_ext = this.folder_path + this.slash + this.selected_file.slice(0, -5);
    let quality = 1;
    let format = 'png';

    if (this.texture[`save_${type}`] == 2) {
      format = 'webp';
      quality = 0.9999;
    }

    const mixFilePath =
      this.folder_path + this.slash + `${this.selected_file.slice(0, -5)}_${type}_mix.png`;
    const exists = await window.electronAPI.fileExists(mixFilePath);

    const writeCanvas = async () => {
      const blob = await new Promise((resolve, reject) => {
        this[`canvas_${type}`].toBlob(
          (result) => {
            if (result) resolve(result);
            else reject(new Error(`Failed to encode ${type} texture`));
          },
          `image/${format}`,
          quality,
        );
      });
      const arrayBuffer = await blob.arrayBuffer();
      const fileName = path_without_ext + `_${type}.${format}`;
      await window.electronAPI.writeBinaryFile(fileName, arrayBuffer);
    };

    if (exists) {
      const image = await loadProjectImage(mixFilePath);
      this[`ctx_${type}`].drawImage(image, 0, 0);

      // Preserve emissive pixels while blending an existing albedo mix texture.
      if (type === 'albedo') {
        const emission_data = this[`ctx_emission`].getImageData(
          0,
          0,
          this.texture.width,
          this.texture.height,
        );

        const emission_crop_data = this[`ctx_emission_crop`].getImageData(
          0,
          0,
          this.texture.width,
          this.texture.height,
        );

        const imgBitmap1 = await createImageBitmap(
          emission_crop_data,
          0,
          0,
          this.texture.width,
          this.texture.height,
        );
        let emissionBitmap;
        try {
          emissionBitmap = await createImageBitmap(
            emission_data,
            0,
            0,
            this.texture.width,
            this.texture.height,
          );
          this.ctx_emission.globalCompositeOperation = 'source-over';
          this.ctx_emission.drawImage(imgBitmap1, 0, 0);
          this.ctx_emission.globalCompositeOperation = 'source-in';
          this.ctx_emission.drawImage(image, 0, 0);
          this.ctx_emission.globalCompositeOperation = 'source-over';
          this.ctx_emission.drawImage(emissionBitmap, 0, 0);
        } finally {
          this.ctx_emission.globalCompositeOperation = 'source-over';
          imgBitmap1.close?.();
          emissionBitmap?.close?.();
        }
      }

      if (this.texture.mix_preview && (this.canPreview?.() ?? true)) {
        this.ctx.drawImage(
          image,
          0,
          0,
          this.texture.width * this.finalZoom,
          this.texture.height * this.finalZoom,
        );
      }
    }
    await writeCanvas();
  },
  async save() {
    const updateInterval = Math.max(100, Number(this.texture.update_interval) || 100);
    clearTimeout(this.save_timer);
    let state = saveStates.get(this);
    if (!state) {
      state = { revision: 0, pending: Promise.resolve() };
      saveStates.set(this, state);
    }
    const revision = ++state.revision;
    if (!this.sync || !this.folder_path || !this.selected_file) return;
    const texture = this.texture;
    const folderPath = this.folder_path;
    const selectedFile = this.selected_file;
    const isCurrent = () =>
      this.sync &&
      state.revision === revision &&
      this.texture === texture &&
      this.folder_path === folderPath &&
      this.selected_file === selectedFile;

    this.save_timer = setTimeout(() => {
      // Serialize writes; superseded queued saves are skipped before copying canvases.
      state.pending = state.pending.then(async () => {
        if (!isCurrent()) return;
        try {
          const snapshot = captureExportSnapshot(this, isCurrent);
          const path = snapshot.folder_path + snapshot.slash + snapshot.selected_file;
          await window.electronAPI.writeTextFile(path, snapshot.serializedTexture);
          // Albedo mixing updates emission, so preserve this export order.
          for (const channel of MATERIAL_CHANNELS) {
            if (snapshot.texture[`save_${channel}`]) await this.mixTexture.call(snapshot, channel);
          }
        } catch (error) {
          console.error('Error saving file:', error);
        }
      });
    }, updateInterval);
  },
  async newTexture() {
    this.selected_file = this.texture_name + '.json';
    this.texture_name = '';
    const path = this.folder_path + this.slash + this.selected_file;
    await window.electronAPI.writeTextFile(path, '');
    this.getFiles();
  },
  async loadAndSync({ throwOnError = false } = {}) {
    this.overwrite_confirmation = 0;

    if (this.folder_path !== '' && this.selected_file !== '') {
      const json_path = this.folder_path + this.slash + this.selected_file;

      try {
        const exists = await window.electronAPI.fileExists(json_path);

        if (exists) {
          const data = await window.electronAPI.readTextFile(json_path);

          if (data.length > 0) {
            this.texture = this.fixTexture(JSON.parse(data));
            if (this.texture.items.length) {
              this.lastItem = JSON.parse(JSON.stringify(this.texture.items[0]));
            }
          } else if (throwOnError) {
            throw new Error(`Document is empty: ${this.selected_file}`);
          }
          this.sync = true;
          this.undo_array = [];
          // Assigning a loaded texture updates every canvas width/height in the
          // template. Setting either attribute clears the bitmap, so drawing
          // before Vue finishes that DOM patch leaves the visible canvas blank.
          await this.$nextTick();
          this.draw();
          this.addUndo();
        }
      } catch (error) {
        console.error('Error loading file:', error);
        if (throwOnError) throw error;
      }
    } else {
      this.sync = false;
    }
  },
  fixTexture(texture) {
    if (!texture.max_item_size) {
      texture.max_item_size = 200;
    }
    if (texture.mix_preview == null) {
      texture.mix_preview = 1;
    }
    if (!texture.update_interval) {
      texture.update_interval = 200;
    }
    if (!texture.zoom_speed) {
      texture.zoom_speed = 50;
    }
    if (texture.center_locked == null) {
      texture.center_locked = true;
    }
    for (const channel of MATERIAL_CHANNELS) {
      texture[`save_${channel}`] ??= channel === 'mrc' ? 0 : 1;
    }
    if (!Array.isArray(texture.layers)) {
      texture.layers = [];
    }
    if (texture.generation === undefined) {
      texture.generation = {
        mode: 'transformer',
        temperature: 1.2,
        adjacency: 'balanced',
      };
    }
    delete texture.generation.ai;
    texture.items.forEach((item) => {
      item.selected = false;
      if (!item.type || item.type === 'gradient') {
        item.type = 'sg';
      }
      if (item.type === 'g') {
        if (item.color_offsets === undefined) {
          item.color_offsets = [0, 100];
        }
      }
      if (item.albedo === undefined) {
        item.albedo = 1;
      }
      if (item.shape === undefined) {
        item.shape = 'l';
      }
    });
    return texture;
  },
  overwriteAndSync() {
    this.overwrite_confirmation = 0;
    if (this.folder_path != '' && this.selected_file != '') {
      this.sync = true;
      this.draw();
    }
  },
};
