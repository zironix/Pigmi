import LinearColorInterpolator from '../../plugins/linearColorInterpolator';

export const canvasRenderMethods = {
  draw() {
    //console.log(this.texture)
    //очищаем весь канвас
    this.ctx.clearRect(
      0,
      0,
      this.texture.width * this.finalZoom,
      this.texture.height * this.finalZoom,
    );
    this.ctx_albedo.clearRect(0, 0, this.texture.width, this.texture.height);
    this.ctx_roughness.clearRect(0, 0, this.texture.width, this.texture.height);
    this.ctx_metallic.clearRect(0, 0, this.texture.width, this.texture.height);
    this.ctx_emission.clearRect(0, 0, this.texture.width, this.texture.height);
    this.ctx_emission_crop.clearRect(0, 0, this.texture.width, this.texture.height);
    this.ctx_clearcoat.clearRect(0, 0, this.texture.width, this.texture.height);
    this.ctx_clearcoat_roughness.clearRect(0, 0, this.texture.width, this.texture.height);
    this.ctx_mrc.clearRect(0, 0, this.texture.width, this.texture.height);

    //идем по всем айтемам
    this.texture.items.forEach((item) => {
      if (item.visible === false) {
        return;
      }

      //если был изменен тип и есть несоответствия
      let last_item_size_flat = 0;
      if (Array.isArray(item.size)) {
        if (/^\d+$/.test(item.size[0])) {
          item.size[0] = parseInt(item.size[0]);
        }
        if (/^\d+$/.test(item.size[1])) {
          item.size[1] = parseInt(item.size[1]);
        }
        last_item_size_flat = item.size[0];
      } else {
        if (/^\d+$/.test(item.size)) {
          item.size = parseInt(item.size);
        }

        last_item_size_flat = item.size;
      }
      if (item.type === 'g') {
        if (item.color_mode === 'black_to_white') {
          item.color_mode = 'rgb';
        }
        if (!Array.isArray(item.size)) {
          item.size = [last_item_size_flat, last_item_size_flat];
        }
        /*if(item.colors.length !== 2){
            item.colors = [
              {
                rgba: { r: 0, g: 0, b: 0, a: 1 },
                hsva: { h: 0, s: 0, v: 0, a: 1 },
                id: new Date().getTime() + 1
              },
              {
                rgba: { r: 255, g: 255, b: 255, a: 1 },
                hsva: { h: 0, s: 0, v: 100, a: 1 },
                id: new Date().getTime() + 2
              },
            ];
          }*/
      }
      if (item.type === 'sg') {
        if (Array.isArray(item.size)) {
          item.size = last_item_size_flat;
        }
      }

      //***

      const roughness = parseFloat((255 / 100) * item.roughness).toFixed(2);
      this.ctx_roughness.fillStyle = 'rgb(' + roughness + ', ' + roughness + ', ' + roughness + ')';

      const metallic = parseFloat((255 / 100) * item.metallic).toFixed(2);
      this.ctx_metallic.fillStyle = 'rgb(' + metallic + ', ' + metallic + ', ' + metallic + ')';

      const clearcoat = parseFloat((255 / 100) * item.clearcoat).toFixed(2);
      this.ctx_clearcoat.fillStyle = 'rgb(' + clearcoat + ', ' + clearcoat + ', ' + clearcoat + ')';

      const clearcoat_roughness = parseFloat((255 / 100) * item.clearcoat_roughness).toFixed(2);
      this.ctx_clearcoat_roughness.fillStyle =
        'rgb(' +
        clearcoat_roughness +
        ', ' +
        clearcoat_roughness +
        ', ' +
        clearcoat_roughness +
        ')';

      this.ctx_mrc.fillStyle =
        'rgba(' +
        metallic +
        ', ' +
        roughness +
        ', ' +
        clearcoat +
        ', ' +
        Math.max(parseFloat((1 / 100) * item.clearcoat_roughness).toFixed(2), 0.01) +
        ')';

      //если градиент ступенчатый
      if (item.type === 'sg') {
        //если больше одного цвета и от черного к белому - рисуем обычный ступенчатый градиент
        if (item.colors.length > 1 && item.color_mode !== 'black_to_white') {
          for (let c = 1; c < item.colors.length; c++) {
            for (let i = 0; i <= item.steps - 1; i++) {
              const color_from = item.colors[c - 1];
              let color_to = item.colors[c - 1];
              if (item.colors[c]) {
                color_to = item.colors[c];
              }
              this.ctx.fillStyle = LinearColorInterpolator.findColorBetween(
                color_from.rgba,
                color_to.rgba,
                Math.floor((100 / (item.steps - 1)) * i),
                item.color_mode,
              );
              this.ctx_albedo.fillStyle = LinearColorInterpolator.findColorBetween(
                color_from.rgba,
                color_to.rgba,
                Math.floor((100 / (item.steps - 1)) * i),
                item.color_mode,
              );
              this.ctx_emission.fillStyle = LinearColorInterpolator.findColorBetween(
                color_from.rgba,
                color_to.rgba,
                Math.floor((100 / (item.steps - 1)) * i),
                item.color_mode,
              );
              //console.log(this.search)
              if (item.direction === 'horizontal') {
                if (
                  this.search === '' ||
                  (item.name && item.name.toLowerCase().includes(this.search.toLowerCase()))
                ) {
                  this.ctx.fillRect(
                    Math.ceil(
                      item.x * this.finalZoom +
                        i * item.size * this.finalZoom +
                        (c - 1) * item.size * (item.steps - 1) * this.finalZoom,
                    ).toFixed(2),
                    Math.ceil(item.y * this.finalZoom).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                  );
                  if (this.isItemSelected(item) && c === 1 && i === 0) {
                    this.drawSelectionCircle(item);
                  }
                }

                if (item.albedo) {
                  this.ctx_albedo.fillRect(
                    item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                    item.y,
                    item.size,
                    item.size,
                  );
                }

                if (item.emission === 1) {
                  this.ctx_emission_crop.fillStyle = 'rgba(255,255,255,1)';
                  this.ctx_emission_crop.fillRect(
                    item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                    item.y,
                    item.size,
                    item.size,
                  );
                  if (item.albedo) {
                    this.ctx_emission.fillRect(
                      item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                      item.y,
                      item.size,
                      item.size,
                    );
                  }
                  this.ctx_emission.fillStyle =
                    'rgba(0,0,0,' + (100 - item.emission_strength) / 100 + ')';
                  this.ctx_emission.fillRect(
                    item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                    item.y,
                    item.size,
                    item.size,
                  );
                }
                this.ctx_roughness.fillRect(
                  item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_metallic.fillRect(
                  item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat.fillRect(
                  item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat_roughness.fillRect(
                  item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_mrc.fillRect(
                  item.x + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.y,
                  item.size,
                  item.size,
                );
              } else {
                if (
                  this.search === '' ||
                  (item.name && item.name.toLowerCase().includes(this.search.toLowerCase()))
                ) {
                  this.ctx.fillRect(
                    Math.ceil(item.x * this.finalZoom).toFixed(2),
                    Math.ceil(
                      item.y * this.finalZoom +
                        i * item.size * this.finalZoom +
                        (c - 1) * item.size * (item.steps - 1) * this.finalZoom,
                    ).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                  );
                  if (this.isItemSelected(item) && c === 1 && i === 0) {
                    this.drawSelectionCircle(item);
                  }
                }

                if (item.albedo) {
                  this.ctx_albedo.fillRect(
                    item.x,
                    item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                    item.size,
                    item.size,
                  );
                }

                if (item.emission === 1) {
                  this.ctx_emission_crop.fillStyle = 'rgba(255,255,255,1)';
                  this.ctx_emission_crop.fillRect(
                    item.x,
                    item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                    item.size,
                    item.size,
                  );
                  if (item.albedo) {
                    this.ctx_emission.fillRect(
                      item.x,
                      item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                      item.size,
                      item.size,
                    );
                  }
                  this.ctx_emission.fillStyle =
                    'rgba(0,0,0,' + (100 - item.emission_strength) / 100 + ')';
                  this.ctx_emission.fillRect(
                    item.x,
                    item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                    item.size,
                    item.size,
                  );
                }
                this.ctx_roughness.fillRect(
                  item.x,
                  item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.size,
                  item.size,
                );
                this.ctx_metallic.fillRect(
                  item.x,
                  item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat.fillRect(
                  item.x,
                  item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat_roughness.fillRect(
                  item.x,
                  item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.size,
                  item.size,
                );
                this.ctx_mrc.fillRect(
                  item.x,
                  item.y + i * item.size + (c - 1) * item.size * (item.steps - 1),
                  item.size,
                  item.size,
                );
              }
            }
          }
        } else {
          //если только один цвет - рисуем одноцветные квадратики в зависимости от выбранного направления
          if (item.color_mode !== 'black_to_white') {
            this.ctx.fillStyle =
              'rgba(' +
              item.colors[0].rgba.r +
              ', ' +
              item.colors[0].rgba.g +
              ', ' +
              item.colors[0].rgba.b +
              ', ' +
              item.colors[0].rgba.a +
              ')';
            this.ctx_albedo.fillStyle =
              'rgba(' +
              item.colors[0].rgba.r +
              ', ' +
              item.colors[0].rgba.g +
              ', ' +
              item.colors[0].rgba.b +
              ', ' +
              item.colors[0].rgba.a +
              ')';
            this.ctx_emission.fillStyle =
              'rgba(' +
              item.colors[0].rgba.r +
              ', ' +
              item.colors[0].rgba.g +
              ', ' +
              item.colors[0].rgba.b +
              ', ' +
              item.colors[0].rgba.a +
              ')';

            if (item.direction === 'horizontal') {
              if (
                this.search === '' ||
                (item.name && item.name.toLowerCase().includes(this.search.toLowerCase()))
              ) {
                this.ctx.fillRect(
                  Math.ceil(item.x * this.finalZoom).toFixed(2),
                  Math.ceil(item.y * this.finalZoom).toFixed(2),
                  Math.ceil(item.size * item.steps * this.finalZoom).toFixed(2),
                  Math.ceil(item.size * this.finalZoom).toFixed(2),
                );
                if (this.isItemSelected(item)) {
                  this.drawSelectionCircle(item);
                }
              }

              if (item.albedo) {
                this.ctx_albedo.fillRect(item.x, item.y, item.size * item.steps, item.size);
              }

              if (item.emission === 1) {
                this.ctx_emission_crop.fillStyle = 'rgba(255,255,255,1)';
                this.ctx_emission_crop.fillRect(item.x, item.y, item.size * item.steps, item.size);
                if (item.albedo) {
                  this.ctx_emission.fillRect(item.x, item.y, item.size * item.steps, item.size);
                }
                this.ctx_emission.fillStyle =
                  'rgba(0,0,0,' + (100 - item.emission_strength) / 100 + ')';
                this.ctx_emission.fillRect(item.x, item.y, item.size * item.steps, item.size);
              }
              this.ctx_roughness.fillRect(item.x, item.y, item.size * item.steps, item.size);
              this.ctx_metallic.fillRect(item.x, item.y, item.size * item.steps, item.size);
              this.ctx_clearcoat.fillRect(item.x, item.y, item.size * item.steps, item.size);
              this.ctx_clearcoat_roughness.fillRect(
                item.x,
                item.y,
                item.size * item.steps,
                item.size,
              );
              this.ctx_mrc.fillRect(item.x, item.y, item.size * item.steps, item.size);
            } else {
              if (
                this.search === '' ||
                (item.name && item.name.toLowerCase().includes(this.search.toLowerCase()))
              ) {
                this.ctx.fillRect(
                  Math.ceil(item.x * this.finalZoom).toFixed(2),
                  Math.ceil(item.y * this.finalZoom).toFixed(2),
                  Math.ceil(item.size * this.finalZoom).toFixed(2),
                  Math.ceil(item.size * item.steps * this.finalZoom).toFixed(2),
                );
                if (this.isItemSelected(item)) {
                  this.drawSelectionCircle(item);
                }
              }

              if (item.albedo) {
                this.ctx_albedo.fillRect(item.x, item.y, item.size, item.size * item.steps);
              }

              if (item.emission === 1) {
                this.ctx_emission_crop.fillStyle = 'rgba(255,255,255,1)';
                this.ctx_emission_crop.fillRect(item.x, item.y, item.size, item.size * item.steps);
                if (item.albedo) {
                  this.ctx_emission.fillRect(item.x, item.y, item.size, item.size * item.steps);
                }
                this.ctx_emission.fillStyle =
                  'rgba(0,0,0,' + (100 - item.emission_strength) / 100 + ')';
                this.ctx_emission.fillRect(item.x, item.y, item.size, item.size * item.steps);
              }
              this.ctx_roughness.fillRect(item.x, item.y, item.size, item.size * item.steps);
              this.ctx_metallic.fillRect(item.x, item.y, item.size, item.size * item.steps);
              this.ctx_clearcoat.fillRect(item.x, item.y, item.size, item.size * item.steps);
              this.ctx_clearcoat_roughness.fillRect(
                item.x,
                item.y,
                item.size,
                item.size * item.steps,
              );
              this.ctx_mrc.fillRect(item.x, item.y, item.size, item.size * item.steps);
            }
          } else {
            //иначе рисуем градиент между белым и черным цветом
            for (let i = 1; i <= item.steps * 2 + 1; i++) {
              const black = { r: 0, g: 0, b: 0, a: 1 };
              const white = { r: 255, g: 255, b: 255, a: 1 };
              const color = item.colors[0].rgba;

              if (i <= item.steps + 1) {
                this.ctx.fillStyle = LinearColorInterpolator.findColorBetween(
                  black,
                  color,
                  Math.floor((100 / (item.steps + 1)) * i),
                  'rgb',
                );
                this.ctx_albedo.fillStyle = LinearColorInterpolator.findColorBetween(
                  black,
                  color,
                  Math.floor((100 / (item.steps + 1)) * i),
                  'rgb',
                );
                this.ctx_emission.fillStyle = LinearColorInterpolator.findColorBetween(
                  black,
                  color,
                  Math.floor((100 / (item.steps + 1)) * i),
                  'rgb',
                );
              } else {
                this.ctx.fillStyle = LinearColorInterpolator.findColorBetween(
                  color,
                  white,
                  Math.floor((100 / (item.steps + 1)) * (i - item.steps - 1)),
                  'rgb',
                );
                this.ctx_albedo.fillStyle = LinearColorInterpolator.findColorBetween(
                  color,
                  white,
                  Math.floor((100 / (item.steps + 1)) * (i - item.steps - 1)),
                  'rgb',
                );
                this.ctx_emission.fillStyle = LinearColorInterpolator.findColorBetween(
                  color,
                  white,
                  Math.floor((100 / (item.steps + 1)) * (i - item.steps - 1)),
                  'rgb',
                );
              }

              //this.ctx_albedo.fillStyle = LinearColorInterpolator.findColorBetween(color_from.color, color_to.color, Math.floor(100 / (item.steps - 1) * i), item.color_mode);
              //this.ctx_emission.fillStyle = LinearColorInterpolator.findColorBetween(color_from.color, color_to.color, Math.floor(100 / (item.steps - 1) * i), item.color_mode);

              if (item.direction === 'horizontal') {
                if (
                  this.search === '' ||
                  (item.name && item.name.toLowerCase().includes(this.search.toLowerCase()))
                ) {
                  this.ctx.fillRect(
                    Math.ceil(
                      item.x * this.finalZoom + (i - 1) * item.size * this.finalZoom,
                    ).toFixed(2),
                    Math.ceil(item.y * this.finalZoom).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                  );
                  if (this.isItemSelected(item) && i === 1) {
                    this.drawSelectionCircle(item);
                  }
                }

                if (item.albedo) {
                  this.ctx_albedo.fillRect(
                    item.x + (i - 1) * item.size,
                    item.y,
                    item.size,
                    item.size,
                  );
                }

                if (item.emission === 1) {
                  this.ctx_emission_crop.fillStyle = 'rgba(255,255,255,1)';
                  this.ctx_emission_crop.fillRect(
                    item.x + (i - 1) * item.size,
                    item.y,
                    item.size,
                    item.size,
                  );
                  if (item.albedo) {
                    this.ctx_emission.fillRect(
                      item.x + (i - 1) * item.size,
                      item.y,
                      item.size,
                      item.size,
                    );
                  }
                  this.ctx_emission.fillStyle =
                    'rgba(0,0,0,' + (100 - item.emission_strength) / 100 + ')';
                  this.ctx_emission.fillRect(
                    item.x + (i - 1) * item.size,
                    item.y,
                    item.size,
                    item.size,
                  );
                }
                this.ctx_roughness.fillRect(
                  item.x + (i - 1) * item.size,
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_metallic.fillRect(
                  item.x + (i - 1) * item.size,
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat.fillRect(
                  item.x + (i - 1) * item.size,
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat_roughness.fillRect(
                  item.x + (i - 1) * item.size,
                  item.y,
                  item.size,
                  item.size,
                );
                this.ctx_mrc.fillRect(item.x + (i - 1) * item.size, item.y, item.size, item.size);
              } else {
                if (
                  this.search === '' ||
                  (item.name && item.name.toLowerCase().includes(this.search.toLowerCase()))
                ) {
                  this.ctx.fillRect(
                    Math.ceil(item.x * this.finalZoom).toFixed(2),
                    Math.ceil(
                      item.y * this.finalZoom + (i - 1) * item.size * this.finalZoom,
                    ).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                    Math.ceil(item.size * this.finalZoom).toFixed(2),
                  );
                  if (this.isItemSelected(item) && i === 1) {
                    this.drawSelectionCircle(item);
                  }
                }

                if (item.albedo) {
                  this.ctx_albedo.fillRect(
                    item.x,
                    item.y + (i - 1) * item.size,
                    item.size,
                    item.size,
                  );
                }

                if (item.emission === 1) {
                  this.ctx_emission_crop.fillStyle = 'rgba(255,255,255,1)';
                  this.ctx_emission_crop.fillRect(
                    item.x,
                    item.y + (i - 1) * item.size,
                    item.size,
                    item.size,
                  );
                  if (item.albedo) {
                    this.ctx_emission.fillRect(
                      item.x,
                      item.y + (i - 1) * item.size,
                      item.size,
                      item.size,
                    );
                  }
                  this.ctx_emission.fillStyle =
                    'rgba(0,0,0,' + (100 - item.emission_strength) / 100 + ')';
                  this.ctx_emission.fillRect(
                    item.x,
                    item.y + (i - 1) * item.size,
                    item.size,
                    item.size,
                  );
                }
                this.ctx_roughness.fillRect(
                  item.x,
                  item.y + (i - 1) * item.size,
                  item.size,
                  item.size,
                );
                this.ctx_metallic.fillRect(
                  item.x,
                  item.y + (i - 1) * item.size,
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat.fillRect(
                  item.x,
                  item.y + (i - 1) * item.size,
                  item.size,
                  item.size,
                );
                this.ctx_clearcoat_roughness.fillRect(
                  item.x,
                  item.y + (i - 1) * item.size,
                  item.size,
                  item.size,
                );
                this.ctx_mrc.fillRect(item.x, item.y + (i - 1) * item.size, item.size, item.size);
              }
            }
          }
        }
      } else {
        //если градиент обычный
        let gradient = false;
        let gradient_albedo = false;
        let gradient_emission = false;
        if (!item.shape) {
          item.shape = 'l';
        }
        if (item.direction === 'horizontal') {
          if (item.shape === 'l') {
            gradient = this.ctx.createLinearGradient(
              Math.ceil(item.x * this.finalZoom).toFixed(2),
              Math.ceil(item.y * this.finalZoom).toFixed(2),
              Math.ceil((item.x + parseInt(item.size[0])) * this.finalZoom).toFixed(2),
              Math.ceil(item.y * this.finalZoom).toFixed(2),
            );
            gradient_albedo = this.ctx_albedo.createLinearGradient(
              item.x,
              item.y,
              item.x + item.size[0],
              item.y,
            );
            gradient_emission = this.ctx_emission.createLinearGradient(
              item.x,
              item.y,
              item.x + item.size[0],
              item.y,
            );
          }

          if (item.shape === 'r') {
            gradient = this.ctx.createRadialGradient(
              Math.ceil((item.x + parseInt(item.size[0]) / 2) * this.finalZoom),
              Math.ceil((item.y + parseInt(item.size[1]) / 2) * this.finalZoom),
              0,
              Math.ceil((item.x + parseInt(item.size[0]) / 2) * this.finalZoom),
              Math.ceil((item.y + parseInt(item.size[1]) / 2) * this.finalZoom),
              Math.ceil((Math.min(item.size[0], item.size[1]) / 2) * this.finalZoom).toFixed(2),
            );
            gradient_albedo = this.ctx_albedo.createRadialGradient(
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              0,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              Math.min(item.size[0], item.size[1]) / 2,
            );
            gradient_emission = this.ctx_emission.createRadialGradient(
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              0,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              Math.min(item.size[0], item.size[1]) / 2,
            );
          }
          if (item.shape === 'c') {
            gradient = this.ctx.createConicGradient(
              0,
              Math.ceil((item.x + parseInt(item.size[0]) / 2) * this.finalZoom),
              Math.ceil((item.y + parseInt(item.size[1]) / 2) * this.finalZoom),
            );
            gradient_albedo = this.ctx_albedo.createConicGradient(
              0,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[1]) / 2,
            );
            gradient_emission = this.ctx_emission.createConicGradient(
              0,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[1]) / 2,
            );
          }
        } else {
          //vertical
          if (item.shape === 'l') {
            gradient = this.ctx.createLinearGradient(
              Math.ceil(item.x * this.finalZoom).toFixed(2),
              Math.ceil(item.y * this.finalZoom).toFixed(2),
              Math.ceil(item.x * this.finalZoom).toFixed(2),
              Math.ceil((item.y + parseInt(item.size[1])) * this.finalZoom).toFixed(2),
            );
            gradient_albedo = this.ctx_albedo.createLinearGradient(
              item.x,
              item.y,
              item.x,
              item.y + item.size[1],
            );
            gradient_emission = this.ctx_emission.createLinearGradient(
              item.x,
              item.y,
              item.x,
              item.y + item.size[1],
            );
          }
          if (item.shape === 'r') {
            gradient = this.ctx.createRadialGradient(
              Math.ceil((item.x + parseInt(item.size[0]) / 2) * this.finalZoom),
              Math.ceil((item.y + parseInt(item.size[1]) / 2) * this.finalZoom),
              0,
              Math.ceil((item.x + parseInt(item.size[0]) / 2) * this.finalZoom),
              Math.ceil((item.y + parseInt(item.size[1]) / 2) * this.finalZoom),
              Math.ceil((Math.min(item.size[0], item.size[1]) / 2) * this.finalZoom).toFixed(2),
            );
            gradient_albedo = this.ctx_albedo.createRadialGradient(
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              0,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              Math.min(item.size[0], item.size[1]) / 2,
            );
            gradient_emission = this.ctx_emission.createRadialGradient(
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              0,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[0]) / 2,
              Math.min(item.size[0], item.size[1]) / 2,
            );
          }
          if (item.shape === 'c') {
            gradient = this.ctx.createConicGradient(
              1.5708,
              Math.ceil((item.x + parseInt(item.size[0]) / 2) * this.finalZoom),
              Math.ceil((item.y + parseInt(item.size[1]) / 2) * this.finalZoom),
            );
            gradient_albedo = this.ctx_albedo.createConicGradient(
              1.5708,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[1]) / 2,
            );
            gradient_emission = this.ctx_emission.createConicGradient(
              1.5708,
              item.x + parseInt(item.size[0]) / 2,
              item.y + parseInt(item.size[1]) / 2,
            );
          }
        }
        if (item.color_mode === 'rgb') {
          item.colors.forEach((color_item, i) => {
            gradient.addColorStop(
              item.color_offsets[i] / 100,
              'rgba(' +
                item.colors[i].rgba.r +
                ', ' +
                item.colors[i].rgba.g +
                ', ' +
                item.colors[i].rgba.b +
                ', ' +
                item.colors[i].rgba.a +
                ')',
            );
            gradient_albedo.addColorStop(
              item.color_offsets[i] / 100,
              'rgba(' +
                item.colors[i].rgba.r +
                ', ' +
                item.colors[i].rgba.g +
                ', ' +
                item.colors[i].rgba.b +
                ', ' +
                item.colors[i].rgba.a +
                ')',
            );
            gradient_emission.addColorStop(
              item.color_offsets[i] / 100,
              'rgba(' +
                item.colors[i].rgba.r +
                ', ' +
                item.colors[i].rgba.g +
                ', ' +
                item.colors[i].rgba.b +
                ', ' +
                item.colors[i].rgba.a +
                ')',
            );
          });
          /*gradient.addColorStop(item.color_offsets[0]/100, "rgba(" + item.colors[0].rgba.r + ", " + item.colors[0].rgba.g + ", " + item.colors[0].rgba.b + ", " + item.colors[0].rgba.a + ")");
            gradient.addColorStop(item.color_offsets[1]/100, "rgba(" + item.colors[1].rgba.r + ", " + item.colors[1].rgba.g + ", " + item.colors[1].rgba.b + ", " + item.colors[1].rgba.a + ")");
            gradient_albedo.addColorStop(item.color_offsets[0]/100, "rgba(" + item.colors[0].rgba.r + ", " + item.colors[0].rgba.g + ", " + item.colors[0].rgba.b + ", " + item.colors[0].rgba.a + ")");
            gradient_albedo.addColorStop(item.color_offsets[1]/100, "rgba(" + item.colors[1].rgba.r + ", " + item.colors[1].rgba.g + ", " + item.colors[1].rgba.b + ", " + item.colors[1].rgba.a + ")");
            gradient_emission.addColorStop(item.color_offsets[0]/100, "rgba(" + item.colors[0].rgba.r + ", " + item.colors[0].rgba.g + ", " + item.colors[0].rgba.b + ", " + item.colors[0].rgba.a + ")");
            gradient_emission.addColorStop(item.color_offsets[1]/100, "rgba(" + item.colors[1].rgba.r + ", " + item.colors[1].rgba.g + ", " + item.colors[1].rgba.b + ", " + item.colors[1].rgba.a + ")");*/
        } else {
          for (let line_index = 0; line_index < 10; line_index++) {
            const color = LinearColorInterpolator.findColorBetween(
              item.colors[0].rgba,
              item.colors[1].rgba,
              Math.floor((100 / 10) * line_index),
              item.color_mode,
            );
            let offset = (1 / 10) * line_index;
            if (offset > 1) {
              offset = 1;
            }
            gradient.addColorStop(offset, color);
            gradient_albedo.addColorStop(offset, color);
            gradient_emission.addColorStop(offset, color);
          }
        }
        this.ctx.fillStyle = gradient;
        this.ctx_albedo.fillStyle = gradient_albedo;
        this.ctx_emission.fillStyle = gradient_emission;

        if (
          this.search === '' ||
          (item.name && item.name.toLowerCase().includes(this.search.toLowerCase()))
        ) {
          this.ctx.fillRect(
            Math.ceil(item.x * this.finalZoom).toFixed(2),
            Math.ceil(item.y * this.finalZoom).toFixed(2),
            Math.ceil(item.size[0] * this.finalZoom).toFixed(2),
            Math.ceil(item.size[1] * this.finalZoom).toFixed(2),
          );
          if (this.isItemSelected(item)) {
            this.drawSelectionCircle(item);
          }
        }

        if (item.albedo) {
          this.ctx_albedo.fillRect(item.x, item.y, item.size[0], item.size[1]);
        }
        if (item.emission === 1) {
          this.ctx_emission_crop.fillStyle = 'rgba(255,255,255,1)';
          this.ctx_emission_crop.fillRect(item.x, item.y, item.size[0], item.size[1]);
          if (item.albedo) {
            this.ctx_emission.fillRect(item.x, item.y, item.size[0], item.size[1]);
          }
          this.ctx_emission.fillStyle = 'rgba(0,0,0,' + (100 - item.emission_strength) / 100 + ')';
          this.ctx_emission.fillRect(item.x, item.y, item.size[0], item.size[1]);
        }
        this.ctx_roughness.fillRect(item.x, item.y, item.size[0], item.size[1]);
        this.ctx_metallic.fillRect(item.x, item.y, item.size[0], item.size[1]);
        this.ctx_clearcoat.fillRect(item.x, item.y, item.size[0], item.size[1]);
        this.ctx_clearcoat_roughness.fillRect(item.x, item.y, item.size[0], item.size[1]);
        this.ctx_mrc.fillRect(item.x, item.y, item.size[0], item.size[1]);
      }
    });
    this.save();
  },
  drawCircle(ctx, x, y, radius, fill, stroke, strokeWidth) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI, false);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.lineWidth = strokeWidth;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  },
  isItemSelected(item) {
    return this.ls && Array.isArray(this.ls.selected) && this.ls.selected.includes(item.id);
  },
  isItemActive(item) {
    return (
      this.ls &&
      this.ls.active_id !== null &&
      this.ls.active_id !== undefined &&
      this.ls.active_id === item.id
    );
  },
  drawSelectionCircle(item) {
    if (!this.isItemSelected(item)) return;
    const isActive = this.isItemActive(item);
    const fill = isActive ? '#e91e63' : '#858585';
    const stroke = isActive ? '#FFFFFF' : '#ffffff';
    this.drawCircle(
      this.ctx,
      item.x * this.finalZoom + 8,
      item.y * this.finalZoom + 8,
      4,
      fill,
      stroke,
      1,
    );
  },
};
