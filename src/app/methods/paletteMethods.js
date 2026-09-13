import LinearColorInterpolator from '../../plugins/linearColorInterpolator';

const pendingGenerations = new WeakMap();

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

      case 'noise':
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            const value = Math.floor(Math.random() * 81) + 10; // 10–90
            setSym(i, j, value);
          }
        }
        break;

      case 'website':
        if (n >= 4) {
          setSym(0, 1, 90); // background - text
          setSym(0, 2, 20); // background - navigation
          setSym(1, 2, 70); // text - navigation
          setSym(2, 3, 85); // navigation - logo
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
    const texture = this.texture;
    const item = texture.items[this.selected];
    if (!item) return;
    const request = {};
    const originalColors = JSON.stringify(item.colors);
    pendingGenerations.set(item, request);
    const palette = item.colors.map((color) => {
      if (!color.locked) return '-';
      const { r, g, b } = color.rgba;
      return LinearColorInterpolator.RGBToHex(`rgb(${r}, ${g}, ${b})`);
    });
    const payload = {
      mode: texture.generation.mode,
      num_colors: palette.length,
      temperature: texture.generation.temperature,
      num_results: 1,
      adjacency: this.generateAdjacencyMatrix(palette.length, texture.generation.adjacency),
      palette,
    };

    try {
      const response = await fetch('https://api.huemint.com/color', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const generatedPalette = data.results?.[0]?.palette;
      if (!Array.isArray(generatedPalette) || generatedPalette.length !== palette.length) return;

      // A response belongs to the original item, even if selection/order changed.
      // Discard it after document replacement, deletion, newer requests, or color edits.
      if (
        this.texture !== texture ||
        !texture.items.includes(item) ||
        pendingGenerations.get(item) !== request ||
        JSON.stringify(item.colors) !== originalColors
      )
        return;

      const colors = item.colors.map((color, index) => {
        if (color.locked) return color;
        const rgba = LinearColorInterpolator.hexAToRGBA(generatedPalette[index]);
        const hsva = LinearColorInterpolator.hexAToHSVA(generatedPalette[index]);
        if (!rgba || !hsva) throw new Error('Generator returned an invalid color');
        const alpha = color.rgba.a;
        return { ...color, rgba: { ...rgba, a: alpha }, hsva: { ...hsva, a: alpha } };
      });
      item.colors = colors;
    } catch (error) {
      console.error('Failed to generate colors:', error);
    } finally {
      if (pendingGenerations.get(item) === request) pendingGenerations.delete(item);
    }
  },
};
