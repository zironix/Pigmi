<template>
  <div id="app-window" @keyup="addUndo" @click="addUndo('click')" @dragend="addUndo">
    <div class="top-controls">
      <div class="logo">
        <div style="background: #f300ac"></div>
        <div style="background: #ef0a62"></div>
        <div style="background: #fd6445"></div>
        <div style="background: #fdc822"></div>
      </div>
      <div class="logo-text">
        <div>PIGMI</div>
        <div class="version">v2.0</div>
      </div>

      <div class="dragger"></div>

      <div class="frame-buttons" aria-label="Window controls">
        <button
          class="window-control"
          type="button"
          title="Minimize"
          aria-label="Minimize window"
          @click.stop="minimize"
        >
          <i class="las la-minus" aria-hidden="true"></i>
        </button>
        <button
          class="window-control"
          type="button"
          title="Maximize"
          aria-label="Maximize or restore window"
          @click.stop="maximize"
        >
          <i class="las la-expand" aria-hidden="true"></i>
        </button>
        <button
          class="window-control close-btn"
          type="button"
          title="Close"
          aria-label="Close window"
          @click.stop="close"
        >
          <i class="las la-times" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div
      ref="canvasContainer"
      class="canvas-container"
      @contextmenu.prevent
      @wheel="mousewheel"
      :class="{
        full: !selected,
        'locked-left': texture.locked_left,
        'locked-right': texture.locked_right,
        'center-mode': texture.center_locked,
      }"
    >
      <canvas
        id="texture"
        ref="texture"
        :width="texture.width * finalZoom"
        :height="texture.height * finalZoom"
        @mousedown="mousedown"
        @mouseup="mouseup"
        @mousemove="mousemove"
        @mouseleave="mouseLeave"
        :style="canvasStyle"
      />
      <canvas
        id="albedo_texture"
        ref="albedo_texture"
        :width="texture.width"
        :height="texture.height"
      />
      <canvas
        id="emission_texture"
        ref="emission_texture"
        :width="texture.width"
        :height="texture.height"
      />
      <canvas
        id="emission_crop_texture"
        ref="emission_crop_texture"
        :width="texture.width"
        :height="texture.height"
      />
      <canvas
        id="roughness_texture"
        ref="roughness_texture"
        :width="texture.width"
        :height="texture.height"
      />
      <canvas
        id="metallic_texture"
        ref="metallic_texture"
        :width="texture.width"
        :height="texture.height"
      />
      <canvas
        id="clearcoat_texture"
        ref="clearcoat_texture"
        :width="texture.width"
        :height="texture.height"
      />
      <canvas
        id="clearcoat_roughness_texture"
        ref="clearcoat_roughness_texture"
        :width="texture.width"
        :height="texture.height"
      />
      <canvas id="mrc_texture" ref="mrc_texture" :width="texture.width" :height="texture.height" />
    </div>
    <div
      class="color-offset-slider"
      v-if="
        selected !== false &&
        colors_visible &&
        texture.items[selected].color_mode === 'rgb' &&
        texture.items[selected].type === 'g'
      "
    >
      <div class="color-offset-slider-container">
        <vue-slider
          v-model="texture.items[selected].color_offsets"
          :max="100"
          :enable-cross="false"
          @dragStart="offsetDrag"
        >
          <template v-slot:dot="{ focus, index }">
            <div
              :class="['custom-dot', { focus }]"
              :style="{
                background: `rgba(${texture.items[selected].colors[index].rgba.r}, ${texture.items[selected].colors[index].rgba.g}, ${texture.items[selected].colors[index].rgba.b}, ${texture.items[selected].colors[index].rgba.a})`,
              }"
            ></div>
          </template>
        </vue-slider>
      </div>
    </div>

    <div
      ref="leftSidebar"
      class="sidebar"
      :class="{ 'split-item-search': isItemSearchSplitVisible, 'left-locked': texture.locked_left }"
      :style="leftSidebarStyle"
    >
      <div class="tabs">
        <div
          class="tab"
          @click="handleTabClick('item')"
          v-if="selected !== false"
          :class="{ active: isTabActive('item') }"
        >
          <i class="las la-edit"></i>
        </div>
        <div
          class="tab"
          @click="handleTabClick('search')"
          :class="{ active: isTabActive('search') }"
        >
          <i class="las la-layer-group"></i>
        </div>
        <div
          class="tab"
          @click="handleTabClick('texture')"
          :class="{ active: current_tab == 'texture' && !isItemSearchSplitVisible }"
        >
          <i class="las la-sliders-h"></i>
        </div>
        <div
          class="tab"
          @click="handleTabClick('generation')"
          :class="{ active: current_tab == 'generation' && !isItemSearchSplitVisible }"
        >
          <i class="las la-meteor"></i>
        </div>
        <div
          class="tab"
          title="MCP / Connect Codex"
          aria-label="MCP / Connect Codex"
          @click="handleTabClick('mcp')"
          :class="{ active: current_tab == 'mcp' && !isItemSearchSplitVisible }"
        >
          <i class="las la-plug"></i>
        </div>
      </div>
      <div
        class="item-settings"
        v-if="selected !== false && (current_tab === 'item' || isItemSearchSplitVisible)"
        :class="{ locked: texture.locked_left }"
      >
        <div class="custom-input">
          <div class="name">Name</div>
          <input type="text" v-model="texture.items[selected].name" placeholder="Item name" />
        </div>
        <div
          class="custom-input"
          v-if="
            texture.items[selected].type === 'sg' && !Array.isArray(texture.items[selected].size)
          "
        >
          <div class="name">Size</div>
          <vue-slider v-model.number="texture.items[selected].size" />
          <input type="number" v-model.number="texture.items[selected].size" />
        </div>
        <div class="custom-input" v-if="texture.items[selected].type === 'sg'">
          <div class="name">Number of steps</div>
          <vue-slider v-model.number="texture.items[selected].steps" :max="texture.max_item_size" />
          <input type="number" v-model.number="texture.items[selected].steps" />
        </div>
        <div class="custom-input" v-if="texture.items[selected].type === 'g'">
          <div class="name">Width</div>
          <vue-slider v-model="texture.items[selected].size[0]" :max="texture.max_item_size" />
          <input
            type="text"
            v-model="texture.items[selected].size[0]"
            @keydown.enter="
              texture.items[selected].size[0] = evaluateInput(texture.items[selected].size[0])
            "
          />
        </div>
        <div class="custom-input" v-if="texture.items[selected].type === 'g'">
          <div class="name">Height</div>
          <vue-slider v-model="texture.items[selected].size[1]" :max="texture.max_item_size" />
          <input
            type="text"
            v-model="texture.items[selected].size[1]"
            @keydown.enter="
              texture.items[selected].size[1] = evaluateInput(texture.items[selected].size[1])
            "
          />
        </div>
        <div class="custom-input">
          <div class="name">Type</div>

          <VueSelect
            v-model="texture.items[selected].type"
            :options="[
              { label: 'Step gradient', value: 'sg' },
              { label: 'Gradient', value: 'g' },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Shape</div>

          <VueSelect
            v-model="texture.items[selected].shape"
            :options="[
              { label: 'Linear', value: 'l' },
              { label: 'Radial', value: 'r' },
              { label: 'Conic', value: 'c' },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Direction</div>

          <VueSelect
            v-model="texture.items[selected].direction"
            :options="[
              { label: 'Horizontal', value: 'horizontal' },
              { label: 'Vertical', value: 'vertical' },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Color mode</div>

          <VueSelect
            v-model="texture.items[selected].color_mode"
            :options="[
              { label: 'RGB', value: 'rgb' },
              { label: 'HSL', value: 'hsl' },
              ...(texture.items[selected]?.type === 'sg'
                ? [{ label: 'Black To White', value: 'black_to_white' }]
                : []),
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Albedo</div>

          <VueSelect
            v-model="texture.items[selected].albedo"
            :options="[
              { label: 'Disabled', value: 0 },
              { label: 'Enabled', value: 1 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Emission</div>

          <VueSelect
            v-model="texture.items[selected].emission"
            :options="[
              { label: 'Disabled', value: 0 },
              { label: 'Enabled', value: 1 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Roughness</div>
          <vue-slider v-model="texture.items[selected].roughness" :max="100" />
          <input
            type="text"
            v-model="texture.items[selected].roughness"
            @keydown.enter="
              texture.items[selected].roughness = evaluateInput(texture.items[selected].roughness)
            "
          />
        </div>
        <div class="custom-input">
          <div class="name">Metallic</div>
          <vue-slider v-model="texture.items[selected].metallic" :max="100" />
          <input
            type="text"
            v-model="texture.items[selected].metallic"
            @keydown.enter="
              texture.items[selected].metallic = evaluateInput(texture.items[selected].metallic)
            "
          />
        </div>
        <div class="custom-input" v-if="texture.items[selected].emission">
          <div class="name">Emission strength</div>
          <vue-slider v-model="texture.items[selected].emission_strength" :max="100" />
          <input
            type="text"
            v-model="texture.items[selected].emission_strength"
            @keydown.enter="
              texture.items[selected].emission_strength = evaluateInput(
                texture.items[selected].emission_strength,
              )
            "
          />
        </div>
        <div class="custom-input">
          <div class="name">Clearcoat</div>
          <vue-slider v-model="texture.items[selected].clearcoat" :max="100" />
          <input
            type="text"
            v-model="texture.items[selected].clearcoat"
            @keydown.enter="
              texture.items[selected].clearcoat = evaluateInput(texture.items[selected].clearcoat)
            "
          />
        </div>
        <div class="custom-input">
          <div class="name">Clearcoat roughness</div>
          <vue-slider v-model="texture.items[selected].clearcoat_roughness" :max="100" />
          <input
            type="text"
            v-model="texture.items[selected].clearcoat_roughness"
            @keydown.enter="
              texture.items[selected].clearcoat_roughness = evaluateInput(
                texture.items[selected].clearcoat_roughness,
              )
            "
          />
        </div>
      </div>

      <div
        class="item-search-resizer"
        v-if="isItemSearchSplitVisible"
        :class="{ locked: texture.locked_left }"
        @mousedown.prevent="startItemSearchResize"
      ></div>

      <div
        class="texture-settings"
        v-if="current_tab === 'texture' && !isItemSearchSplitVisible"
        :class="{ locked: texture.locked_left }"
      >
        <div class="custom-input">
          <div v-if="folder_path" class="name with-icon" style="display: flex; align-items: center">
            Folder path
            <i class="las la-external-link-square-alt" @click="openFolderInOS(folder_path)"></i>
          </div>
          <input
            type="text"
            v-model="folder_path"
            @click="selectFolder"
            placeholder="Select folder..."
          />
        </div>
        <div class="custom-input" v-if="folder_path">
          <div class="name">Texture name</div>
          <input type="text" v-model="texture_name" placeholder="Enter name" />
          <div class="new-file" @click="newTexture()">Create</div>
        </div>
        <div class="custom-input" v-if="folder_path">
          <div class="name">Select texture JSON</div>

          <VueSelect
            v-model="selected_file"
            :options="files_in_folder?.map((f) => ({ label: f, value: f })) || []"
          />
        </div>
        <div class="custom-input" v-if="selected_file && folder_path">
          <div class="synchronize" v-if="sync == false" @click="loadAndSync()">Load and sync</div>
          <div
            class="overwrite"
            v-if="sync == false && !overwrite_confirmation"
            @click="overwrite_confirmation = 1"
          >
            Overwrite and sync
          </div>
          <div class="overwrite-confirmation" v-if="sync == false && overwrite_confirmation">
            <div class="confirm" @click="overwriteAndSync()">Overwrite</div>
            <div class="cancel" @click="overwrite_confirmation = 0">Cancel</div>
          </div>
          <div class="desynchronize" v-if="sync == true" @click="sync = false">Desynchronize</div>
        </div>
        <div class="custom-input">
          <div class="name">Texture width (px)</div>
          <input
            type="text"
            v-model="texture.width"
            @keydown.enter="texture.width = evaluateInput(texture.width)"
          />
        </div>
        <div class="custom-input">
          <div class="name">Texture height (px)</div>
          <input
            type="text"
            v-model="texture.height"
            @keydown.enter="texture.height = evaluateInput(texture.height)"
          />
        </div>
        <div class="custom-input">
          <div class="name">Max item size (px)</div>
          <input
            type="text"
            v-model="texture.max_item_size"
            @keydown.enter="texture.max_item_size = evaluateInput(texture.max_item_size)"
          />
        </div>
        <div class="custom-input">
          <div class="name">Snapping step (px)</div>
          <input
            type="text"
            v-model="texture.step"
            @keydown.enter="texture.step = evaluateInput(texture.step)"
          />
        </div>
        <div class="custom-input">
          <div class="name">Undo count</div>
          <input
            type="text"
            v-model="texture.undo_count"
            @keydown.enter="texture.undo_count = evaluateInput(texture.undo_count)"
          />
        </div>
        <div class="custom-input">
          <div class="name">Zoom</div>
          <input
            type="number"
            v-model="texture.zoom"
            @keydown.enter="texture.zoom = evaluateInput(texture.zoom)"
          />
        </div>
        <div class="custom-input">
          <div class="name">Zoom speed</div>
          <input
            type="number"
            v-model="texture.zoom_speed"
            @keydown.enter="texture.zoom_speed = evaluateInput(texture.zoom_speed)"
          />
        </div>
        <div class="custom-input">
          <div class="name">Default color model</div>
          <VueSelect
            v-model="texture.default_color_model"
            :options="[
              { label: 'HSV', value: 'hsva' },
              { label: 'HSL', value: 'hsla' },
              { label: 'RGB', value: 'rgba' },
              { label: 'HEX', value: 'hex' },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Mass resize</div>
          <div class="row">
            <input type="number" placeholder="New item size" v-model.number="resize_value" />
            <div class="btn" @click="resizeItems()">Resize</div>
          </div>
        </div>
        <div class="custom-input">
          <div class="name">Albedo texture</div>
          <VueSelect
            v-model="texture.save_albedo"
            :options="[
              { label: 'PNG', value: 1 },
              { label: 'WEBP', value: 2 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Roughness texture</div>
          <VueSelect
            v-model="texture.save_roughness"
            :options="[
              { label: 'PNG', value: 1 },
              { label: 'WEBP', value: 2 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Metallic texture</div>
          <VueSelect
            v-model="texture.save_metallic"
            :options="[
              { label: 'PNG', value: 1 },
              { label: 'WEBP', value: 2 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Emission texture</div>
          <VueSelect
            v-model="texture.save_emission"
            :options="[
              { label: 'PNG', value: 1 },
              { label: 'WEBP', value: 2 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Clearcoat texture</div>
          <VueSelect
            v-model="texture.save_clearcoat"
            :options="[
              { label: 'PNG', value: 1 },
              { label: 'WEBP', value: 2 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Clearcoat roughness texture</div>
          <VueSelect
            v-model="texture.save_clearcoat_roughness"
            :options="[
              { label: 'PNG', value: 1 },
              { label: 'WEBP', value: 2 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">MRC texture</div>
          <VueSelect
            v-model="texture.save_mrc"
            :options="[
              { label: 'PNG', value: 1 },
              { label: 'WEBP', value: 2 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Mix preview</div>
          <VueSelect
            v-model="texture.mix_preview"
            :options="[
              { label: 'Enabled', value: 1 },
              { label: 'Disabled', value: 0 },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Update interval (ms)</div>
          <input
            type="number"
            placeholder="New item size"
            v-model.number="texture.update_interval"
          />
        </div>
      </div>

      <div
        class="search"
        v-show="current_tab === 'search' || isItemSearchSplitVisible"
        :class="{ locked: texture.locked_left }"
      >
        <LayersPanel
          ref="layersPanel"
          :items="texture.items"
          :layers="texture.layers"
          :step="texture.step"
          :textureWidth="texture.width"
          :textureHeight="texture.height"
          :onStructureChanged="addUndo"
        />
      </div>

      <div
        class="generation-settings"
        v-if="current_tab === 'generation' && !isItemSearchSplitVisible"
        :class="{ locked: texture.locked_left }"
      >
        <div class="custom-input">
          <div class="name">Mode</div>
          <VueSelect
            v-model="texture.generation.mode"
            :options="[
              { label: 'Transformer', value: 'transformer' },
              { label: 'Diffusion', value: 'diffusion' },
              { label: 'Random', value: 'random' },
            ]"
          />
        </div>
        <div class="custom-input">
          <div class="name">Adjacency</div>
          <VueSelect
            v-model="texture.generation.adjacency"
            :options="[
              { label: 'Balanced', value: 'balanced' },
              { label: 'Gradient', value: 'gradient' },
              { label: 'Brand', value: 'brand' },
              { label: 'Noise', value: 'noise' },
              { label: 'Website', value: 'website' },
              { label: 'Mondrian', value: 'mondrian' },
              { label: 'Checkerboard', value: 'checkerboard' },
              { label: 'Clustered', value: 'clustered' },
              { label: 'Ring', value: 'ring' },
            ]"
          />
        </div>

        <div class="custom-input">
          <div class="name">Temperature</div>
          <vue-slider
            v-model="texture.generation.temperature"
            :max="2.4"
            :min="0"
            :interval="0.1"
          />
          <input
            type="text"
            v-model="texture.generation.temperature"
            @keydown.enter="
              texture.generation.temperature = evaluateInput(texture.generation.temperature)
            "
          />
        </div>
        <div class="version" style="color: #3f3f3f; font-size: 12px; padding: 0 10px 10px">
          Palette generator via huemint.com.
        </div>
      </div>

      <div
        class="mcp-settings"
        v-if="current_tab === 'mcp' && !isItemSearchSplitVisible"
        :class="{ locked: texture.locked_left }"
      >
        <div class="mcp-heading">
          <div>
            <div class="mcp-title">Connect Codex</div>
            <div class="mcp-subtitle">Let Codex inspect and edit the active Pigmi document.</div>
          </div>
          <span
            class="mcp-status"
            :class="{ connected: mcp.clientCount > 0, unavailable: !mcp.running }"
          >
            {{
              !mcp.running
                ? 'Unavailable'
                : mcp.clientCount > 0
                  ? `${mcp.clientCount} connected`
                  : 'Waiting'
            }}
          </span>
        </div>

        <p class="mcp-description">
          Keep Pigmi open. The fastest setup is to run the command below in a terminal, then restart
          Codex. Alternatively, open <strong>Settings → MCP servers → Add server</strong> and choose
          <strong>STDIO</strong>.
        </p>

        <div class="custom-input">
          <div class="name">Codex CLI command</div>
          <textarea
            class="mcp-config mcp-command"
            :value="codexMcpCommand"
            rows="5"
            readonly
          ></textarea>
        </div>

        <p class="mcp-description mcp-or">
          Or paste this into <strong>~/.codex/config.toml</strong>:
        </p>

        <div class="custom-input">
          <div class="name">Codex config.toml</div>
          <textarea class="mcp-config" :value="codexMcpConfiguration" rows="10" readonly></textarea>
        </div>

        <p class="mcp-description mcp-note">
          Node.js 20.19 or newer is required. The status changes after Codex calls its first Pigmi
          tool.
        </p>

        <div class="mcp-capabilities">
          <div><i class="las la-search"></i> Selective document reads</div>
          <div><i class="las la-edit"></i> Atomic editing operations</div>
          <div><i class="las la-image"></i> Canvas preview access</div>
          <div><i class="las la-save"></i> Open and save project files</div>
        </div>
      </div>
      <div
        class="sidebar-width-resizer"
        :class="{ locked: texture.locked_left }"
        @mousedown.prevent="startSidebarResize"
      ></div>
    </div>
    <div class="sidebar2">
      <div
        class="colors"
        v-if="selected !== false && colors_visible"
        :class="{ locked: texture.locked_right }"
      >
        <SlickList axis="y" v-model:list="texture.items[selected].colors" useDragHandle>
          <SlickItem
            v-for="(color, index) in texture.items[selected].colors"
            :key="color.id"
            :index="index"
            class="draggable-color"
            :class="{ selected: index === current_color_offset }"
          >
            <Colorpicker2
              :remove="removeColor"
              :index="index"
              :type="texture.items[selected].type"
              :default_color_model="texture.default_color_model"
              v-model:hsva="texture.items[selected].colors[index].hsva"
              v-model:rgba="texture.items[selected].colors[index].rgba"
            />
            <div class="dragger-container">
              <DragHandle class="c-dragger">
                <i class="las la-bars"></i>
              </DragHandle>
            </div>
            <div
              class="lock-color"
              :class="{ locked: texture.items[selected].colors[index].locked }"
              @click="
                texture.items[selected].colors[index].locked =
                  !texture.items[selected].colors[index].locked
              "
            >
              <i class="las la-unlock"></i>
            </div>
          </SlickItem>
        </SlickList>
        <div class="bottom-buttons">
          <div class="add-color" @click="addColorFromClick">
            <i class="las la-plus"></i>
          </div>
          <div class="generate-colors" @click.exact="generateColors">
            <i class="las la-meteor"></i>
          </div>
        </div>
      </div>
      <div class="tabs">
        <div class="tab" :class="{ active: selected !== false }">
          <i class="las la-palette"></i>
        </div>
        <div class="toggle-locked" @click="toggleCenterLock">
          <i v-if="!texture.center_locked" class="las la-compress-arrows-alt"></i>
        </div>
      </div>
    </div>
    <div class="footer">
      <div
        class="left-btn"
        :class="{ active: texture.locked_left }"
        @click="texture.locked_left = !texture.locked_left"
      >
        <i class="las la-lock-open" v-if="!texture.locked_left"></i>
        <i class="las la-lock" v-else></i>
      </div>
      <div class="center"></div>
      <div
        class="right-btn"
        :class="{ active: texture.locked_right }"
        @click="texture.locked_right = !texture.locked_right"
      >
        <i class="las la-lock-open" v-if="!texture.locked_right"></i>
        <i class="las la-lock" v-else></i>
      </div>
    </div>
  </div>
</template>
<script src="./app/appOptions.js"></script>
<style src="./styles/app.css"></style>
