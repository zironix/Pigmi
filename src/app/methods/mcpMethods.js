import { applyAiPlan } from '../../ai/aiPlanExecutor';
import { buildEditorOverview, fulfillEditorDataRequests } from '../../ai/editorContext';
import {
  buildEditorDiagnostics,
  buildFolderSnapshots,
  compareFolderSnapshots,
} from '../../ai/editorInspection';
import { collectItemFolderPaths, getMapValueById } from '../../ai/aiPlanShared';
import { applyLayerSelection } from '../../stores/layers';
import { documentRevision, fingerprint } from '../../ai/editorRevision';
import { saveDocumentSnapshot } from './filesMethods';

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

export function buildMcpWriteResult({ applied, dryRun, revision, result, texture }) {
  const itemFolderPaths = new Map();
  collectItemFolderPaths(texture?.layers, '', itemFolderPaths);
  const createdFolderPaths = [
    ...new Set(
      (result?.createdItemIds || []).map((id) => getMapValueById(itemFolderPaths, id) || '(root)'),
    ),
  ];

  return {
    ok: true,
    status: dryRun ? 'dry_run' : 'success',
    applied,
    dryRun,
    revision,
    ...result,
    createdCount: result?.createdItemIds?.length || 0,
    createdFolderPaths,
  };
}

export const mcpMethods = {
  getMcpSelectionIds() {
    return Array.isArray(this.ls?.selected) ? [...this.ls.selected] : [];
  },
  buildMcpOverview({ detail = 'full', knownState } = {}) {
    const revision = documentRevision(this.texture);
    const project = {
      directory: this.folder_path || null,
      document: this.selected_file || null,
      synchronized: this.sync === true,
    };
    const selectionIds = this.getMcpSelectionIds();
    // Include non-document state and the requested view. Identical texture JSON
    // alone cannot prove that selection, creation defaults, or project stayed put.
    const stateRevision = fingerprint({
      revision,
      project,
      selectionIds,
      activeId: this.ls?.active_id,
      activeType: this.ls?.active_type,
      lastItem: this.lastItem,
      detail,
    });
    if (knownState === stateRevision) return { revision, stateRevision, unchanged: true };
    return {
      revision,
      stateRevision,
      project,
      ...buildEditorOverview({
        texture: this.texture,
        selectionIds,
        activeId: this.ls?.active_id,
        lastItem: this.lastItem,
        detail,
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
      return buildMcpWriteResult({
        applied: false,
        dryRun: true,
        revision: currentRevision,
        result: { ...result, proposedRevision: nextRevision },
        texture: nextTexture,
      });
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

    return buildMcpWriteResult({
      applied: true,
      dryRun: false,
      revision: documentRevision(this.texture),
      result,
      texture: this.texture,
    });
  },
  async saveMcpDocument({ exportMaps = false } = {}) {
    if (!this.folder_path || !this.selected_file) {
      throw new Error('No project document is open');
    }
    const texture = this.texture;
    const folderPath = this.folder_path;
    const selectedFile = this.selected_file;
    const filePath = await saveDocumentSnapshot(this, { exportMaps });
    if (
      this.texture === texture &&
      this.folder_path === folderPath &&
      this.selected_file === selectedFile
    ) {
      this.sync = true;
    }

    return { saved: true, path: filePath, exportedMaps: exportMaps };
  },
  async openMcpDocument({ name } = {}) {
    const fileName = String(name || '').trim();
    await this.getFiles();
    const available = (this.files_in_folder || []).includes(fileName);
    if (!available) throw new Error(`Project document not found: ${fileName}`);
    const previousFile = this.selected_file;
    const previousTexture = this.texture;
    this.selected_file = fileName;
    try {
      await this.loadAndSync({ throwOnError: true });
    } catch (error) {
      if (this.selected_file === fileName && this.texture === previousTexture) {
        this.selected_file = previousFile;
      }
      throw error;
    }
    return this.buildMcpOverview({ detail: 'summary' });
  },
  getMcpCanvasPreview({ maxSide = 1024 } = {}) {
    const canvas = this.$refs.texture;
    if (!canvas || typeof canvas.toDataURL !== 'function') {
      throw new Error('Canvas preview is not available');
    }
    const limit = Math.max(64, Math.min(4096, Number(maxSide) || 1024));
    const scale = Math.min(1, limit / Math.max(canvas.width, canvas.height));
    let preview = canvas;
    if (scale < 1) {
      preview = document.createElement('canvas');
      preview.width = Math.max(1, Math.round(canvas.width * scale));
      preview.height = Math.max(1, Math.round(canvas.height * scale));
      const context = preview.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.drawImage(canvas, 0, 0, preview.width, preview.height);
    }
    return {
      dataUrl: preview.toDataURL('image/png'),
      width: preview.width,
      height: preview.height,
    };
  },
  async handleMcpRequest({ method, params }) {
    switch (method) {
      case 'get_overview':
        return this.buildMcpOverview(params);
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
            compact: params?.compact,
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
        return this.getMcpCanvasPreview(params);
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
