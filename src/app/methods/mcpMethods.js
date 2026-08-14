import { applyAiPlan } from '../../ai/aiPlanExecutor';
import { buildEditorOverview, fulfillEditorDataRequests } from '../../ai/editorContext';
import {
  buildEditorDiagnostics,
  buildFolderSnapshots,
  compareFolderSnapshots,
} from '../../ai/editorInspection';
import { applyLayerSelection } from '../../stores/layers';

const MAX_OPERATIONS = 500;
const SUPPORTED_OPERATIONS = new Set([
  'create_folder',
  'duplicate_folder',
  'edit_folder_items',
  'rename_folder',
  'delete_folder',
  'create_gradient_item',
  'create_gradient_items',
  'duplicate_item',
  'edit_items',
  'recolor_item',
  'update_item',
  'move_item',
  'rename_item',
  'delete_item',
  'set_visibility',
  'set_folder_state',
  'set_selection',
  'move_layer',
  'update_texture',
]);

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function documentRevision(texture) {
  const source = JSON.stringify(texture);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function createIdFactory(texture) {
  const ids = [];
  const visit = (nodes) => {
    if (!Array.isArray(nodes)) return;
    nodes.forEach((node) => {
      if (Number.isSafeInteger(Number(node?.id))) ids.push(Number(node.id));
      visit(node?.childs);
    });
  };
  visit(texture?.layers);
  for (const item of texture?.items || []) {
    if (Number.isSafeInteger(Number(item?.id))) ids.push(Number(item.id));
  }

  let nextId = Math.max(Date.now() * 1000, ids.length ? Math.max(...ids) + 1 : 1);
  return () => nextId++;
}

function validateOperations(operations) {
  if (!Array.isArray(operations)) throw new TypeError('operations must be an array');
  if (operations.length > MAX_OPERATIONS) {
    throw new RangeError(`A single request may contain at most ${MAX_OPERATIONS} operations`);
  }
  operations.forEach((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new TypeError(`operations[${index}] must be an object`);
    }
    if (!SUPPORTED_OPERATIONS.has(operation.type)) {
      throw new TypeError(`Unsupported operation type at operations[${index}]: ${operation.type}`);
    }
  });
}

function serializeMcpError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : 'EDITOR_ERROR',
    message: error instanceof Error ? error.message : String(error),
  };
}

export const mcpMethods = {
  getMcpSelectionIds() {
    return Array.isArray(this.ls?.selected) ? [...this.ls.selected] : [];
  },
  buildMcpOverview() {
    return {
      revision: documentRevision(this.texture),
      project: {
        directory: this.folder_path || null,
        document: this.selected_file || null,
        synchronized: this.sync === true,
      },
      ...buildEditorOverview({
        texture: this.texture,
        selectionIds: this.getMcpSelectionIds(),
        activeId: this.ls?.active_id,
        lastItem: this.lastItem,
      }),
    };
  },
  getMcpProject() {
    return {
      directory: this.folder_path || null,
      document: this.selected_file || null,
      synchronized: this.sync === true,
      files: (this.files_in_folder || []).map((file) => ({
        name: file,
        selected: file === this.selected_file,
      })),
    };
  },
  async applyMcpOperations(params) {
    const operations = params?.operations;
    validateOperations(operations);

    const currentRevision = documentRevision(this.texture);
    if (params?.expectedRevision && params.expectedRevision !== currentRevision) {
      const error = new Error(
        `Document changed since it was inspected (expected ${params.expectedRevision}, current ${currentRevision})`,
      );
      error.code = 'REVISION_CONFLICT';
      throw error;
    }

    const nextTexture = deepClone(this.texture);
    const nextSelection = {
      selected: this.getMcpSelectionIds(),
      active_id: this.ls?.active_id ?? null,
      active_type: this.ls?.active_type ?? null,
    };
    const result = applyAiPlan({
      plan: { operations, layout: params?.layout || null },
      texture: nextTexture,
      layersStore: nextSelection,
      nextLayerId: createIdFactory(nextTexture),
      layoutHints: params?.layout || null,
      lastItem: deepClone(this.lastItem),
    });

    if (result.warnings.length && params?.allowPartial !== true) {
      const error = new Error(`No changes applied: ${result.warnings.join('; ')}`);
      error.code = 'OPERATION_REJECTED';
      throw error;
    }

    const nextRevision = documentRevision(nextTexture);
    if (params?.dryRun === true) {
      return { applied: false, dryRun: true, revision: nextRevision, ...result };
    }

    this.pushUndoSnapshot();
    this.texture = nextTexture;
    applyLayerSelection(this.ls, nextSelection.selected, nextSelection.active_type);

    const activeIndex = this.texture.items.findIndex((item) => item.id === nextSelection.active_id);
    this.is_syncing_layers = true;
    this.selected = activeIndex === -1 ? false : activeIndex;
    await this.$nextTick();
    this.draw();
    this.pushUndoSnapshot();

    return { applied: true, dryRun: false, revision: nextRevision, ...result };
  },
  async saveMcpDocument({ exportMaps = false } = {}) {
    if (!this.folder_path || !this.selected_file) {
      throw new Error('No project document is open');
    }
    const filePath = window.electronAPI.joinPath(this.folder_path, this.selected_file);
    await window.electronAPI.writeTextFile(filePath, JSON.stringify(this.texture));
    this.sync = true;

    if (exportMaps) {
      const maps = [
        ['save_albedo', 'albedo'],
        ['save_roughness', 'roughness'],
        ['save_metallic', 'metallic'],
        ['save_emission', 'emission'],
        ['save_clearcoat', 'clearcoat'],
        ['save_clearcoat_roughness', 'clearcoat_roughness'],
        ['save_mrc', 'mrc'],
      ];
      for (const [flag, map] of maps) {
        if (this.texture[flag]) await this.mixTexture(map);
      }
    }

    return { saved: true, path: filePath, exportedMaps: exportMaps };
  },
  async openMcpDocument({ name } = {}) {
    const fileName = String(name || '').trim();
    await this.getFiles();
    const available = (this.files_in_folder || []).includes(fileName);
    if (!available) throw new Error(`Project document not found: ${fileName}`);
    this.selected_file = fileName;
    await this.loadAndSync({ throwOnError: true });
    return this.buildMcpOverview();
  },
  getMcpCanvasPreview() {
    const canvas = this.$refs.texture;
    if (!canvas || typeof canvas.toDataURL !== 'function') {
      throw new Error('Canvas preview is not available');
    }
    return {
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    };
  },
  async handleMcpRequest({ method, params }) {
    switch (method) {
      case 'get_overview':
        return this.buildMcpOverview();
      case 'get_items':
        return {
          revision: documentRevision(this.texture),
          ...fulfillEditorDataRequests({
            texture: this.texture,
            selectionIds: this.getMcpSelectionIds(),
            requests: params?.requests,
          }),
        };
      case 'get_folders':
        return {
          revision: documentRevision(this.texture),
          ...buildFolderSnapshots({
            texture: this.texture,
            paths: params?.paths,
            fields: params?.fields,
          }),
        };
      case 'compare_folders':
        return {
          revision: documentRevision(this.texture),
          ...compareFolderSnapshots({
            texture: this.texture,
            paths: params?.paths,
            fields: params?.fields,
          }),
        };
      case 'validate_document':
        return {
          revision: documentRevision(this.texture),
          ...buildEditorDiagnostics({ texture: this.texture }),
        };
      case 'apply_operations':
        return this.applyMcpOperations(params);
      case 'undo': {
        const previousLength = this.undo_array.length;
        this.undo();
        await this.$nextTick();
        return {
          undone: this.undo_array.length < previousLength,
          revision: documentRevision(this.texture),
        };
      }
      case 'get_canvas_preview':
        return this.getMcpCanvasPreview();
      case 'get_project':
        await this.getFiles();
        return this.getMcpProject();
      case 'open_document':
        return this.openMcpDocument(params);
      case 'save_document':
        return this.saveMcpDocument(params);
      default:
        throw new Error(`Unknown Pigmi MCP method: ${method}`);
    }
  },
  async receiveMcpRequest(request) {
    try {
      const result = await this.handleMcpRequest(request || {});
      // Vue keeps the active document in reactive proxies, which Electron IPC
      // cannot clone. MCP responses are JSON by contract, so normalize them at
      // the renderer boundary before sending them to the main process.
      const serializableResult = deepClone(result);
      window.electronAPI.respondToMcpRequest({
        requestId: request?.requestId,
        result: serializableResult,
      });
    } catch (error) {
      window.electronAPI.respondToMcpRequest({
        requestId: request?.requestId,
        error: serializeMcpError(error),
      });
    }
  },
  async initializeMcpIntegration() {
    this.disposeMcpRequest = window.electronAPI?.onMcpRequest?.((request) => {
      void this.receiveMcpRequest(request);
    });
    this.disposeMcpStatus = window.electronAPI?.onMcpStatus?.((status) => {
      this.mcp = { ...this.mcp, ...status };
    });
    const info = await window.electronAPI?.getMcpInfo?.();
    if (info) this.mcp = { ...this.mcp, ...info };
  },
};
