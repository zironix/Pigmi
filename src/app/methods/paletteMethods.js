import LinearColorInterpolator from '../../plugins/linearColorInterpolator';

export const paletteMethods = {
  generateAdjacencyMatrix(n, type = 'balanced') {
    const mat = Array.from({ length: n }, () => Array(n).fill(0));

    function setSym(i, j, value) {
      mat[i][j] = value;
      mat[j][i] = value;
    }

    switch (type) {
      case 'gradient':
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i !== j) {
              const diff = Math.abs(i - j);
              const value = Math.round((diff / (n - 1)) * 100);
              mat[i][j] = value;
            }
          }
        }
        break;

      case 'brand':
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i !== j) mat[i][j] = 65;
          }
        }
        break;

      case 'balanced': {
        const choices = [35, 45, 65];
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const value = choices[Math.floor(Math.random() * choices.length)];
            setSym(i, j, value);
          }
        }
        break;
      }

      case 'noise': // новый стиль
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const value = Math.floor(Math.random() * 81) + 10; // 10–90
            setSym(i, j, value);
          }
        }
        break;

      case 'website':
        if (n >= 4) {
          setSym(0, 1, 90); // фон - текст
          setSym(0, 2, 20); // фон - navbar
          setSym(1, 2, 70); // текст - navbar
          setSym(2, 3, 85); // navbar - logo
        }
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (mat[i][j] === 0) setSym(i, j, 30);
          }
        }
        break;

      case 'mondrian':
        for (let k = 0; k < Math.floor(n * 1.5); k++) {
          const i = Math.floor(Math.random() * n);
          const j = Math.floor(Math.random() * n);
          if (i !== j) setSym(i, j, Math.floor(Math.random() * 60 + 40));
        }
        break;

      case 'checkerboard':
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i !== j) mat[i][j] = (i + j) % 2 === 0 ? 80 : 20;
          }
        }
        break;

      case 'clustered': {
        const mid = Math.floor(n / 2);
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i !== j) {
              mat[i][j] = (i < mid && j < mid) || (i >= mid && j >= mid) ? 20 : 85;
            }
          }
        }
        break;
      }

      case 'ring':
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i !== j) {
              const diff = Math.min(Math.abs(i - j), n - Math.abs(i - j));
              const value = Math.round((1 - diff / (n / 2)) * 100);
              mat[i][j] = Math.max(0, value);
            }
          }
        }
        break;

      default:
        throw new Error(`Unknown type: ${type}`);
    }

    return mat.flat().map(String);
  },
  async generateColors() {
    const colors_count = this.texture.items[this.selected].colors.length;
    const palette = [];
    for (let i = 0; i < colors_count; i++) {
      if (
        this.texture.items[this.selected].colors[i].locked !== undefined &&
        this.texture.items[this.selected].colors[i].locked
      ) {
        const rgba = this.texture.items[this.selected].colors[i].rgba;
        const hex = LinearColorInterpolator.RGBToHex(`rgb(${rgba.r}, ${rgba.g}, ${rgba.b})`);
        palette.push(hex);
      } else {
        palette.push('-');
      }
    }

    const json_data = {
      mode: this.texture.generation.mode, // diffusion, diffusion or random
      num_colors: colors_count, // max 12, min 2
      temperature: this.texture.generation.temperature, // max 2.4, min 0
      num_results: 1, // max 50 for transformer, 5 for diffusion
      adjacency: this.generateAdjacencyMatrix(colors_count, this.texture.generation.adjacency), // nxn adjacency matrix as a flat array of strings
      palette, // locked colors as hex codes, or '-' if blank
    };

    try {
      const res = await fetch('https://api.huemint.com/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(json_data),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Тут мы ждём распарсенный JSON
      const data = await res.json();

      // убедимся что структура как ожидается
      //console.log('first palette:', data.results[0].palette); // массив из 4 цветов

      if (
        data.results &&
        data.results[0] &&
        data.results[0].palette &&
        data.results[0].palette.length === colors_count
      ) {
        // Создаем новый массив цветов вместо мутирования существующего
        const updatedColors = this.texture.items[this.selected].colors.map((color, i) => {
          if (i < data.results[0].palette.length) {
            const hexColor = data.results[0].palette[i];
            const hsva = LinearColorInterpolator.hexAToHSVA(hexColor + 'ff');
            const rgba = LinearColorInterpolator.hexAToRGBA(hexColor + 'ff');

            // Возвращаем новый объект вместо мутирования существующего
            return {
              ...color,
              hsva: { h: hsva.h, s: hsva.s, v: hsva.v, a: hsva.a },
              rgba: { r: rgba.r, g: rgba.g, b: rgba.b, a: rgba.a },
            };
          }
          return color;
        });

        // Создаем новый объект для реактивного обновления
        const updatedItem = {
          ...this.texture.items[this.selected],
          colors: updatedColors,
        };

        // Обновляем реактивно
        this.texture.items[this.selected] = updatedItem;
      }
    } catch (err) {
      console.error('Ошибка генерации цветов:', err);
    }
  },
};
