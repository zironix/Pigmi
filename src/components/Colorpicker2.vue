<template>
  <div class="pico" ref="pico">
    <div class="color-area" :style="{ background: bgColor }" @mousedown="svMouseDown">
      <div class="white"></div>
      <div class="black"></div>
      <div class="big-picker" :style="{ left: svLeft, top: svTop }"></div>
    </div>
    <div class="controls">
      <div class="row">
        <div class="preview">
          <div class="color" :style="{ background: previewColor }" @click="eyedropper()"></div>
        </div>
        <div class="sliders">
          <div class="hue-horizontal" @mousedown="hueMouseDown">
            <div class="picker" :style="{ left: hueLeft }"></div>
          </div>
          <div class="alpha-horizontal" @mousedown="alphaMouseDown">
            <div class="gradient"></div>
            <div class="picker" :style="{ left: alphaLeft }"></div>
          </div>
        </div>
      </div>
      <div class="row inputs">
        <div class="mode" v-if="color_mode === 'hsva'">
          <input
            type="text"
            v-model="color.hsv.h"
            @keydown.enter="color.hsv.h = evaluateInput(color.hsv.h)"
            @click="applyValueToPalette($event, 'hsv.h', color.hsv.h)"
            @keyup="makeColors('hsv')"
            @wheel.prevent="scrollInput($event, color.hsv, 'h', 1, 359)"
          />
          <input
            type="text"
            v-model="color.hsv.s"
            @keydown.enter="color.hsv.s = evaluateInput(color.hsv.s)"
            @click="applyValueToPalette($event, 'hsv.s', color.hsv.s)"
            @keyup="makeColors('hsv')"
            @wheel.prevent="scrollInput($event, color.hsv, 's', 1, 100)"
          />
          <input
            type="text"
            v-model="color.hsv.v"
            @keydown.enter="color.hsv.v = evaluateInput(color.hsv.v)"
            @click="applyValueToPalette($event, 'hsv.v', color.hsv.v)"
            @keyup="makeColors('hsv')"
            @wheel.prevent="scrollInput($event, color.hsv, 'v', 1, 100)"
          />
          <input
            type="text"
            v-model="color.alpha"
            @keydown.enter="color.alpha = evaluateInput(color.alpha, false)"
            @click="applyValueToPalette($event, 'alpha', color.alpha)"
            @keyup="makeColors('hsv')"
            @wheel="scrollInput($event, color, 'alpha', 0.01, 1)"
          />
          <div class="mode-name" @click="color_mode = 'hsla'">HSV</div>
        </div>
        <div class="mode" v-if="color_mode === 'hsla'">
          <input
            type="text"
            v-model="color.hsl.h"
            @keydown.enter="color.hsl.h = evaluateInput(color.hsl.h)"
            @click="applyValueToPalette($event, 'hsl.h', color.hsl.h)"
            @keyup="makeColors('hsl')"
            @wheel.prevent="scrollInput($event, color.hsl, 'h', 1, 359)"
          />
          <input
            type="text"
            v-model="color.hsl.s"
            @keydown.enter="color.hsl.s = evaluateInput(color.hsl.s)"
            @click="applyValueToPalette($event, 'hsl.s', color.hsl.s)"
            @keyup="makeColors('hsl')"
            @wheel.prevent="scrollInput($event, color.hsl, 's', 1, 100)"
          />
          <input
            type="text"
            v-model="color.hsl.l"
            @keydown.enter="color.hsl.l = evaluateInput(color.hsl.l)"
            @click="applyValueToPalette($event, 'hsl.l', color.hsl.l)"
            @keyup="makeColors('hsl')"
            @wheel.prevent="scrollInput($event, color.hsl, 'l', 1, 100)"
          />
          <input
            type="text"
            v-model="color.alpha"
            @keydown.enter="color.alpha = evaluateInput(color.alpha)"
            @click="applyValueToPalette($event, 'alpha', color.alpha)"
            @keyup="makeColors('hsl')"
            @wheel.prevent="scrollInput($event, color, 'alpha', 0.01, 1)"
          />
          <div class="mode-name" @click="color_mode = 'rgba'">HSL</div>
        </div>
        <div class="mode" v-if="color_mode === 'rgba'">
          <input
            type="text"
            v-model="color.rgb.r"
            @keydown.enter="color.rgb.r = evaluateInput(color.rgb.r)"
            @click="applyValueToPalette($event, 'rgb.r', color.rgb.r)"
            @keyup="makeColors('rgb')"
            @wheel.prevent="scrollInput($event, color.rgb, 'r', 1, 255)"
          />
          <input
            type="text"
            v-model="color.rgb.g"
            @keydown.enter="color.rgb.g = evaluateInput(color.rgb.g)"
            @click="applyValueToPalette($event, 'rgb.g', color.rgb.g)"
            @keyup="makeColors('rgb')"
            @wheel.prevent="scrollInput($event, color.rgb, 'g', 1, 255)"
          />
          <input
            type="text"
            v-model="color.rgb.b"
            @keydown.enter="color.rgb.b = evaluateInput(color.rgb.b)"
            @click="applyValueToPalette($event, 'rgb.b', color.rgb.b)"
            @keyup="makeColors('rgb')"
            @wheel.prevent="scrollInput($event, color.rgb, 'b', 1, 255)"
          />
          <input
            type="text"
            v-model="color.alpha"
            @keydown.enter="color.alpha = evaluateInput(color.alpha)"
            @click="applyValueToPalette($event, 'alpha', color.alpha)"
            @keyup="makeColors('rgb')"
            @wheel.prevent="scrollInput($event, color, 'alpha', 0.01, 1)"
          />
          <div class="mode-name" @click="color_mode = 'hex'">RGB</div>
        </div>
        <div class="mode" v-if="color_mode === 'hex'">
          <input type="text" v-model="color.hex" @input="makeColors('hex')" style="width: 150px" />
          <div class="mode-name" @click="color_mode = 'hsva'">HEX</div>
        </div>
      </div>
    </div>
    <div class="remove-color" @click="removeColorFromClick">
      <i class="las la-times"></i>
    </div>
  </div>
</template>

<style scoped>
.pico {
  height: 210px;
  position: relative;
  background: #242629;
  padding: 5px;
  border-radius: 4px;
}
.color-area {
  background: #008dff;
  width: 200px;
  height: 120px;
  position: relative;
  cursor: pointer;
}
.color-area .white {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, #fff, hsla(0, 0%, 100%, 0));
}
.color-area .black {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: linear-gradient(0deg, #000, transparent);
}
.controls {
  margin-top: 10px;
  padding: 0 3px 0 0;
}
.controls .row {
  display: flex;
}
.preview {
  position: relative;
  height: 30px;
  width: 30px;
  flex-shrink: 0;
  margin-right: 10px;
  background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2N89uzZfwY8QFJSEp80A+OoAcMiDP7//483HTx//hx/Ohg1gIFx6IcBALl+VXknOCvFAAAAAElFTkSuQmCC);
  background-size: 10px;
}
.preview .color {
  background: black;
  height: 30px;
  width: 30px;
  flex-shrink: 0;
  margin-right: 10px;
  cursor: pointer;
}
.sliders {
  width: 100%;
}
.sliders .hue-horizontal {
  position: relative;
  cursor: pointer;
  width: 100%;
  height: 10px;
  background: linear-gradient(90deg, red 0, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, red);
}

.sliders .alpha-horizontal {
  position: relative;
  cursor: pointer;
  margin-top: 10px;
  width: 100%;
  height: 10px;
  background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2N89uzZfwY8QFJSEp80A+OoAcMiDP7//483HTx//hx/Ohg1gIFx6IcBALl+VXknOCvFAAAAAElFTkSuQmCC);
  background-size: 10px;
}
.sliders .alpha-horizontal .gradient {
  height: 10px;
  width: 100%;
  background: linear-gradient(to right, rgba(87, 111, 148, 0) 0%, #008dff 100%);
}
.inputs {
  margin-top: 10px;
  align-items: center;
}
.inputs input {
  border: none;
  background: #2f2f2f;
  color: #ced0d6;
  width: 25px;
  text-align: center;
  padding: 2px 4px;
  margin: 0 9px 0 0;
  font-family: 'JetBrains Mono', serif;
  border-radius: 4px;
}
.inputs .mode {
  width: 100%;
  display: flex;
}
.inputs .mode-name {
  color: #ced0d6;
  font-size: 12px;
  line-height: 19px;
  cursor: pointer;
  margin-left: auto;
  user-select: none;
  display: flex;
  align-items: center;
}
.remove-color {
  position: absolute;
  z-index: 0;
  border-right: none;
  color: #858789;
  width: 18px;
  height: 18px;
  text-align: center;
  bottom: 0px;
  right: 0px;
  font-size: 14px;
  line-height: 17px;
  cursor: pointer;
  transition: all 0.2s ease;
}
.remove-color:hover {
  color: #e73535;
}

.draggerok {
  position: absolute;
  z-index: 0;
  border-right: none;
  color: #6f6f6f;
  width: 18px;
  height: 18px;
  text-align: center;
  padding-right: 20px;
  bottom: 0px;
  left: 2px;
  font-size: 15px;
  line-height: 17px;
  cursor: move;
}
.picker {
  pointer-events: none;
  position: absolute;
  width: 4px;
  height: 16px;
  top: -3px;
  background: #ffffff;
  border-radius: 2px;
  box-shadow: 0 0 4px #00000096;
  left: 0%;
  margin-left: -2px;
}
.big-picker {
  pointer-events: none;
  position: absolute;
  width: 5px;
  height: 5px;
  top: 0%;
  background: white;
  border-radius: 100%;
  box-shadow: 0 0 4px #00000096;
  left: 0%;
  margin-left: -2px;
  margin-top: -2px;
}
</style>

<script>
import LinearColorInterpolator from '../plugins/linearColorInterpolator.js';
import { evaluateArithmetic } from '../utils/arithmetic';
import { isPlatformPrimaryModifier } from '../utils/inputModifiers';

export default {
  name: 'colorpicker2',
  props: {
    rgba: Object,
    hsva: Object,
    type: String,
    remove: Function,
    index: Number,
    default_color_model: String,
  },
  data: () => ({
    width: 200,
    height: 120,
    sliderWidth: 157,
    color_mode: 'hsva',
    ignoreNextUpdate: false,

    color: {
      rgb: { r: 0, g: 0, b: 0 },
      hsl: { h: 0, s: 0, l: 0 },
      hsv: { h: 0, s: 0, v: 0 },
      hex: '',
      alpha: 1,
    },
    positions: {
      clientX: undefined,
      clientY: undefined,
      movementX: 0,
      movementY: 0,
      huePos: 0,
      alphaPos: 0,
      saturationPos: 0,
      valuePos: 0,
    },
  }),
  computed: {
    // геттер вычисляемого значения
    hueLeft() {
      return (this.color.hsv.h * 100) / 360 + '%';
    },
    alphaLeft() {
      return (this.color.alpha * 100 * 100) / 100 + '%';
    },
    svLeft() {
      return (this.color.hsv.s * 100) / 100 + '%';
    },
    svTop() {
      return 100 - (this.color.hsv.v * 100) / 100 + '%';
    },
    bgColor() {
      return `hsla(${this.color.hsv.h}, 100%, 50%)`;
    },
    previewColor() {
      const hsl = this.hsv2hsl(this.color.hsv.h, this.color.hsv.s, this.color.hsv.v);
      return `hsla(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%, ${this.color.alpha})`;
    },
  },
  created() {
    this.emitter.on('set', this.set);
  },
  beforeUnmount() {
    this.emitter.off('set', this.set);
  },
  mounted() {
    this.color.hsv = { h: this.hsva.h, s: this.hsva.s, v: this.hsva.v };
    this.color.alpha = this.hsva.a;
    if (this.default_color_model) {
      this.color_mode = this.default_color_model;
    }
    this.makeColors();
  },
  methods: {
    isPrimaryModifierPressed(event) {
      return isPlatformPrimaryModifier({
        platform: window.electronAPI?.platform,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      });
    },
    applyValueToPalette(event, field, value) {
      if (!this.isPrimaryModifierPressed(event)) return;
      event.preventDefault();
      this.emitter.emit('set', [field, value]);
    },
    removeColorFromClick(event) {
      this.remove(this.index, this.isPrimaryModifierPressed(event));
    },
    evaluateInput(expression, shouldRound = true) {
      const value = evaluateArithmetic(expression);
      if (value === null) return expression;
      return shouldRound ? Math.round(value) : Math.round(value * 100) / 100;
    },
    async eyedropper() {
      const eyeDropper = new EyeDropper();
      try {
        const result = await eyeDropper.open();
        this.color.hex = result.sRGBHex;
        this.makeColors('hex');
        this.makeColors('hsl');
      } catch {
        return null;
      }
    },
    set(value) {
      if (value[0] === 'alpha') {
        this.color.alpha = value[1];
        this.makeColors();
      } else {
        const arr = value[0].split('.');
        this.color[arr[0]][arr[1]] = value[1];
        if (arr[0] === 'hsl') {
          this.makeColors('hsl');
        } else if (arr[0] === 'rgb') {
          this.makeColors('rgb');
        } else {
          this.makeColors();
        }
      }
    },
    getPercent(total, position) {
      return (position * 100) / total;
    },

    hueMouseDown(event) {
      event.preventDefault();
      //document.body.requestPointerLock();
      document.onmousemove = this.hueDrag;
      document.onmouseup = this.stopDrag;

      this.positions.huePos = event.offsetX;
      this.color.hsv.h = Math.ceil(
        (this.getPercent(this.sliderWidth, this.positions.huePos) / 100) * 360,
      );
      this.makeColors();
    },
    hueDrag(event) {
      event.preventDefault();
      if (this.positions.huePos + event.movementX < 0) {
        this.color.hsv.h = 0;
      } else if (this.positions.huePos + event.movementX > this.sliderWidth) {
        this.color.hsv.h = 359;
      } else {
        this.positions.huePos += event.movementX;
        this.color.hsv.h = Math.ceil(
          (this.getPercent(this.sliderWidth, this.positions.huePos) / 100) * 359,
        );
      }
      this.makeColors();
    },

    alphaMouseDown(event) {
      event.preventDefault();
      document.onmousemove = this.alphaDrag;
      document.onmouseup = this.stopDrag;

      this.positions.alphaPos = event.offsetX;
      this.color.alpha = parseFloat(
        this.getPercent(this.sliderWidth, this.positions.alphaPos) / 100,
      ).toFixed(2);
      this.makeColors();
    },
    alphaDrag(event) {
      event.preventDefault();
      if (this.positions.alphaPos + event.movementX < 0) {
        this.color.alpha = 0;
      } else if (this.positions.alphaPos + event.movementX > this.sliderWidth) {
        this.color.alpha = 1;
      } else {
        this.positions.alphaPos += event.movementX;
        let alpha_val = parseFloat(
          this.getPercent(this.sliderWidth, this.positions.alphaPos) / 100,
        ).toFixed(2);
        if (alpha_val >= 1) {
          alpha_val = 1;
        }
        this.color.alpha = alpha_val;
      }
      this.makeColors();
    },

    svMouseDown(event) {
      event.preventDefault();
      document.onmousemove = this.svDrag;
      document.onmouseup = this.stopDrag;

      this.positions.saturationPos = event.offsetX;
      this.positions.valuePos = event.offsetY;

      this.color.hsv.s = Math.ceil(
        (this.getPercent(this.width, this.positions.saturationPos) / 100) * 100,
      );
      this.color.hsv.v =
        100 - Math.ceil((this.getPercent(this.height, this.positions.valuePos) / 100) * 100);
      this.makeColors();
    },
    svDrag(event) {
      event.preventDefault();
      if (this.positions.saturationPos + event.movementX < 0) {
        this.color.hsv.s = 0;
      } else if (this.positions.saturationPos + event.movementX > this.width) {
        this.color.hsv.s = 100;
      } else {
        this.positions.saturationPos += event.movementX;
        this.color.hsv.s = Math.ceil(
          (this.getPercent(this.width, this.positions.saturationPos) / 100) * 100,
        );
      }
      if (this.positions.valuePos + event.movementY > this.height) {
        this.color.hsv.v = 0;
      } else if (this.positions.valuePos + event.movementY < 0) {
        this.color.hsv.v = 100;
      } else {
        this.positions.valuePos += event.movementY;
        this.color.hsv.v =
          100 - Math.ceil((this.getPercent(this.height, this.positions.valuePos) / 100) * 100);
      }
      this.makeColors();
    },
    stopDrag() {
      document.onmouseup = null;
      document.onmousemove = null;
      document.exitPointerLock();
    },

    makeColors(space) {
      this.ignoreNextUpdate = true;
      if (space === undefined) space = 'hsv';

      if (space === 'hsv') {
        const hsl = this.hsv2hsl(this.color.hsv.h, this.color.hsv.s, this.color.hsv.v);
        this.color.hsl = { h: parseInt(hsl[0]), s: parseInt(hsl[1]), l: parseInt(hsl[2]) };

        const rgba = LinearColorInterpolator.HSLAToRGBA(
          `hsla(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%, 1)`,
        );
        this.color.rgb = { r: rgba.r, g: rgba.g, b: rgba.b };

        this.color.hex = LinearColorInterpolator.HSLAToHexA(
          `hsla(${hsl[0]}, ${hsl[1]}%, ${hsl[2]}%, ${this.color.alpha})`,
        );
        this.$emit('update:rgba', { r: rgba.r, g: rgba.g, b: rgba.b, a: this.color.alpha });
        this.$emit('update:hsva', {
          h: this.color.hsv.h,
          s: this.color.hsv.s,
          v: this.color.hsv.v,
          a: this.color.alpha,
        });

        setTimeout(() => {
          this.ignoreNextUpdate = false;
        }, 0);
      }
      if (space === 'hsl') {
        const hsv = this.hsl2hsv(
          parseInt(this.color.hsl.h),
          parseInt(this.color.hsl.s),
          parseInt(this.color.hsl.l),
        );
        this.color.hsv = { h: parseInt(hsv[0]), s: parseInt(hsv[1]), v: parseInt(hsv[2]) };

        const rgba = LinearColorInterpolator.HSLAToRGBA(
          `hsla(${this.color.hsl.h}, ${this.color.hsl.s}%, ${this.color.hsl.l}%, 1)`,
        );
        this.color.rgb = { r: rgba.r, g: rgba.g, b: rgba.b };

        this.color.hex = LinearColorInterpolator.HSLAToHexA(
          `hsla(${this.color.hsl.h}, ${this.color.hsl.s}%, ${this.color.hsl.l}%, ${this.color.alpha})`,
        );
        this.$emit('update:rgba', { r: rgba.r, g: rgba.g, b: rgba.b, a: this.color.alpha });
        this.$emit('update:hsva', {
          h: this.color.hsv.h,
          s: this.color.hsv.s,
          v: this.color.hsv.v,
          a: this.color.alpha,
        });

        setTimeout(() => {
          this.ignoreNextUpdate = false;
        }, 0);
      }
      if (space === 'rgb') {
        const hsl = LinearColorInterpolator.RGBAToHSLA(
          `rgba(${this.color.rgb.r}, ${this.color.rgb.g}, ${this.color.rgb.b}, 1)`,
        );
        this.color.hsl = { h: parseInt(hsl.h), s: parseInt(hsl.s), l: parseInt(hsl.l) };

        const hsv = this.hsl2hsv(parseInt(hsl.h), parseInt(hsl.s), parseInt(hsl.l));
        this.color.hsv = { h: parseInt(hsv[0]), s: parseInt(hsv[1]), v: parseInt(hsv[2]) };

        this.color.hex = LinearColorInterpolator.HSLAToHexA(
          `hsla(${hsl.h}, ${hsl.s}%, ${hsl.l}%, ${this.color.alpha})`,
        );
        this.$emit('update:rgba', {
          r: this.color.rgb.r,
          g: this.color.rgb.g,
          b: this.color.rgb.b,
          a: this.color.alpha,
        });
        this.$emit('update:hsva', {
          h: this.color.hsv.h,
          s: this.color.hsv.s,
          v: this.color.hsv.v,
          a: this.color.alpha,
        });

        setTimeout(() => {
          this.ignoreNextUpdate = false;
        }, 0);
      }
      if (space === 'hex') {
        var pattern1 = new RegExp('#');
        if (!pattern1.test(this.color.hex)) {
          this.color.hex = '#' + this.color.hex;
        }
        if (this.color.hex.length === 8) {
          this.color.hex = this.color.hex + 'f';
        }
        if (this.color.hex.length === 7) {
          this.color.hex = this.color.hex + 'ff';
        }

        const hsla = LinearColorInterpolator.hexAToHSLA(this.color.hex);
        const hsva = LinearColorInterpolator.hexAToHSVA(this.color.hex);
        const rgba = LinearColorInterpolator.hexAToRGBA(this.color.hex);
        if (typeof hsla === 'object' && typeof hsva === 'object' && typeof rgba === 'object') {
          this.color.hsl = {
            h: parseInt(hsla.h),
            s: parseInt(hsla.s),
            l: parseInt(hsla.l),
          };
          this.color.hsv = {
            h: parseInt(hsva.h),
            s: parseInt(hsva.s),
            v: parseInt(hsva.v),
          };
          this.color.rgb = {
            r: parseInt(rgba.r),
            g: parseInt(rgba.g),
            b: parseInt(rgba.b),
          };
          this.color.alpha = parseFloat(hsva.a);

          this.$emit('update:rgba', {
            r: this.color.rgb.r,
            g: this.color.rgb.g,
            b: this.color.rgb.b,
            a: this.color.alpha,
          });
          this.$emit('update:hsva', {
            h: this.color.hsv.h,
            s: this.color.hsv.s,
            v: this.color.hsv.v,
            a: this.color.alpha,
          });

          setTimeout(() => {
            this.ignoreNextUpdate = false;
          }, 0);
        }
      }
    },
    hsv2hsl(hsvH, hsvS, hsvV) {
      const hslL = ((200 - hsvS) * hsvV) / 100;
      const [hslS, hslV] = [
        hslL === 0 || hslL === 200
          ? 0
          : ((hsvS * hsvV) / 100 / (hslL <= 100 ? hslL : 200 - hslL)) * 100,
        (hslL * 5) / 10,
      ];
      return [hsvH, hslS, hslV];
    },
    hsl2hsv(hslH, hslS, hslL) {
      const hsv1 = (hslS * (hslL < 50 ? hslL : 100 - hslL)) / 100;
      const hsvS = hsv1 === 0 ? 0 : ((2 * hsv1) / (hslL + hsv1)) * 100;
      const hsvV = hslL + hsv1;
      return [hslH, hsvS, hsvV];
    },
    scrollInput(e, obj, key, step, max) {
      if (key === 'alpha') {
        if (e.wheelDelta > 0) {
          if (parseFloat(obj[key]) + step > max) {
            obj[key] = parseFloat(max).toFixed(0);
          } else {
            obj[key] = Math.round((parseFloat(obj[key]) + parseFloat(step)) * 100) / 100;
          }
        } else if (e.wheelDelta < 0) {
          if (parseFloat(obj[key]) - parseFloat(step) < 0) {
            obj[key] = 0;
          } else {
            obj[key] = Math.round((parseFloat(obj[key]) - parseFloat(step)) * 100) / 100;
          }
        }
      } else {
        obj[key] = parseInt(obj[key]);
        if (e.wheelDelta > 0) {
          if (parseInt(obj[key]) + parseInt(step) > max) {
            obj[key] = parseInt(max);
          } else {
            obj[key] += parseInt(step);
          }
        } else if (e.wheelDelta < 0) {
          if (parseInt(obj[key]) - parseInt(step) < 0) {
            obj[key] = 0;
          } else {
            obj[key] -= parseInt(step);
          }
        }
      }
      if (obj.l !== undefined) {
        this.makeColors('hsl');
      } else if (obj.r !== undefined) {
        this.makeColors('rgb');
      } else {
        this.makeColors();
      }
    },
  },
  watch: {
    hsva: {
      handler(newVal) {
        if (this.ignoreNextUpdate || !newVal) return;

        this.color.hsv = { h: newVal.h, s: newVal.s, v: newVal.v };
        this.color.alpha = newVal.a;
      },
      deep: true,
      immediate: true,
    },
  },
  components: {},
};
</script>
