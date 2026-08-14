export const fileMethods = {
  async selectFolder() {
    const folderPath = await window.electronAPI.selectFolder();

    if (folderPath) {
      this.folder_path = folderPath;
      this.selected_file = false;
      this.getFiles();
    }
    /*const file = await open({
        multiple: false,
        directory: true,
      });
      this.folder_path = file;
      this.selected_file = false;
      this.getFiles();*/
  },
  async getFiles() {
    this.files_in_folder = [];

    if (this.folder_path && this.folder_path.length > 0) {
      try {
        const files = await window.electronAPI.readDir(this.folder_path);

        files.forEach((file) => {
          // Проверяем, что это файл (не директория) и имеет расширение .json
          if (file.isFile) {
            const ext = file.name.substr(-5);
            if (ext === '.json') {
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
      const mix_url = `${window.electronAPI.toFileUrl(mixFilePath)}?${Date.now()}${type}`;
      const image = new Image();
      image.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        image.onload = async () => {
          try {
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
              this[`ctx_emission`].globalCompositeOperation = 'source-over';
              this[`ctx_emission`].drawImage(imgBitmap1, 0, 0);

              this[`ctx_emission`].globalCompositeOperation = 'source-in';
              this[`ctx_emission`].drawImage(image, 0, 0);

              const imgBitmap2 = await createImageBitmap(
                emission_data,
                0,
                0,
                this.texture.width,
                this.texture.height,
              );
              this[`ctx_emission`].globalCompositeOperation = 'source-over';
              this[`ctx_emission`].drawImage(imgBitmap2, 0, 0);
            }

            if (this.texture.mix_preview) {
              this.ctx.drawImage(
                image,
                0,
                0,
                this.texture.width * this.finalZoom,
                this.texture.height * this.finalZoom,
              );
            }

            await writeCanvas();
            resolve();
          } catch (error) {
            reject(error);
          }
        };
        image.onerror = () => reject(new Error(`Failed to load mix texture: ${mixFilePath}`));

        image.src = mix_url;
      });
    } else {
      await writeCanvas();
    }
  },
  async save() {
    let upd_int = 100;
    if (this.texture.update_interval < 100) {
      upd_int = 100;
    } else {
      upd_int = this.texture.update_interval;
    }

    clearTimeout(this.save_timer);

    this.save_timer = setTimeout(async () => {
      if (this.sync) {
        if (this.folder_path !== '' && this.selected_file !== '') {
          const path = this.folder_path + this.slash + this.selected_file;
          try {
            await window.electronAPI.writeTextFile(path, JSON.stringify(this.texture));

            if (this.texture.save_albedo) {
              await this.mixTexture('albedo');
            }
            if (this.texture.save_roughness) {
              await this.mixTexture('roughness');
            }
            if (this.texture.save_metallic) {
              await this.mixTexture('metallic');
            }
            if (this.texture.save_emission) {
              await this.mixTexture('emission');
            }
            if (this.texture.save_clearcoat) {
              await this.mixTexture('clearcoat');
            }
            if (this.texture.save_clearcoat_roughness) {
              await this.mixTexture('clearcoat_roughness');
            }
            if (this.texture.save_mrc) {
              await this.mixTexture('mrc');
            }
          } catch (error) {
            console.error('Error saving file:', error);
          }
        }
      }
    }, upd_int);
  },
  async newTexture() {
    this.selected_file = this.texture_name + '.json';
    this.texture_name = '';
    const path = this.folder_path + this.slash + this.selected_file;
    //await writeTextFile(path, '');
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
    if (!texture.mix_preview) {
      texture.mix_preview = 1;
    }
    if (!texture.update_interval) {
      texture.update_interval = 200;
    }
    if (!texture.zoom_speed) {
      texture.zoom_speed = 50;
    }
    if (!texture.center_locked) {
      texture.center_locked = true;
    }
    if (texture.save_albedo === undefined) {
      texture.save_albedo = 1;
    }
    if (texture.save_roughness === undefined) {
      texture.save_roughness = 1;
    }
    if (texture.save_metallic === undefined) {
      texture.save_metallic = 1;
    }
    if (texture.save_emission === undefined) {
      texture.save_emission = 1;
    }
    if (texture.save_clearcoat === undefined) {
      texture.save_clearcoat = 1;
    }
    if (texture.save_clearcoat_roughness === undefined) {
      texture.save_clearcoat_roughness = 1;
    }
    if (texture.save_mrc === undefined) {
      texture.save_mrc = 0;
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
