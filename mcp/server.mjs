#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { PigmiBridgeClient } from './bridge-client.mjs';
import { FULL_PIGMI_MCP_INSTRUCTIONS, PIGMI_EDIT_PROMPT } from './instructions.mjs';
import { getOperationReference } from './operation-reference.mjs';

const bridge = new PigmiBridgeClient();
const server = new McpServer(
  { name: 'pigmi', version: '1.3.1' },
  { instructions: FULL_PIGMI_MCP_INSTRUCTIONS },
);

const itemRequestSchema = z.object({
  type: z.enum(['get_items', 'get_palette']).default('get_items'),
  ids: z
    .array(z.union([z.number(), z.string()]))
    .max(100)
    .default([]),
  paths: z.array(z.string()).max(100).default([]),
  query: z.string().default(''),
  folderPath: z.string().default(''),
  selected: z.boolean().default(false),
  rect: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number().nonnegative(),
      height: z.number().nonnegative(),
    })
    .nullable()
    .default(null),
  fields: z
    .array(z.enum(['colors', 'gradient', 'material', 'transform', 'visibility']))
    .default([]),
  limit: z.number().int().min(1).max(100).default(30),
});

const detailFieldSchema = z.enum(['colors', 'gradient', 'material', 'transform', 'visibility']);

const materialSchema = z.object({
  albedo: z.number().min(0).max(1).optional(),
  roughness: z.number().min(0).max(100).optional(),
  metallic: z.number().min(0).max(100).optional(),
  emission: z.number().min(0).max(1).optional(),
  emissionStrength: z.number().min(0).max(100).optional(),
  clearcoat: z.number().min(0).max(100).optional(),
  clearcoatRoughness: z.number().min(0).max(100).optional(),
});

const folderItemEditSchema = z.object({
  relativePath: z.string().min(1),
  newName: z.string().min(1).optional(),
  itemType: z.enum(['g', 'sg']).optional(),
  shape: z.enum(['l', 'r', 'c']).optional(),
  direction: z.enum(['horizontal', 'vertical']).optional(),
  colorMode: z.enum(['rgb', 'hsl', 'black_to_white']).optional(),
  colors: z.array(z.string()).min(1).optional(),
  opacity: z.number().min(0).max(100).optional(),
  opacities: z.array(z.number().min(0).max(100)).optional(),
  colorOffsets: z.array(z.number().min(0).max(100)).optional(),
  size: z
    .union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive()])])
    .optional(),
  sizeW: z.number().positive().optional(),
  sizeH: z.number().positive().optional(),
  steps: z.number().positive().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  offset: z.object({ x: z.number().optional(), y: z.number().optional() }).optional(),
  offsetCells: z.object({ x: z.number().optional(), y: z.number().optional() }).optional(),
  visible: z.boolean().optional(),
  material: materialSchema.optional(),
});

const gradientItemSchema = z.object({
  name: z.string().min(1),
  folderPath: z.string().optional(),
  itemType: z.enum(['g', 'sg']).optional(),
  shape: z.enum(['l', 'r', 'c']).optional(),
  direction: z.enum(['horizontal', 'vertical']).optional(),
  colorMode: z.enum(['rgb', 'hsl', 'black_to_white']).optional(),
  colors: z.array(z.string()).min(1),
  colorOffsets: z.array(z.number().min(0).max(100)).optional(),
  opacity: z.number().min(0).max(100).optional(),
  opacities: z.array(z.number().min(0).max(100)).optional(),
  size: z
    .union([z.number().positive(), z.tuple([z.number().positive(), z.number().positive()])])
    .optional(),
  sizeW: z.number().positive().optional(),
  sizeH: z.number().positive().optional(),
  steps: z.number().positive().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  material: materialSchema.optional(),
});

const layoutSchema = z
  .object({
    compactCreated: z.boolean().optional(),
    flowDirection: z.enum(['horizontal', 'vertical']).optional(),
    itemsPerRow: z.number().int().positive().nullable().optional(),
    itemsPerColumn: z.number().int().positive().nullable().optional(),
    startRow: z.number().int().positive().nullable().optional(),
    startColumn: z.number().int().positive().nullable().optional(),
    offsetCellsX: z.number().int().optional(),
    offsetCellsY: z.number().int().optional(),
    itemGapSteps: z.number().min(0).optional(),
  })
  .nullable()
  .optional();

function textResult(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
}

function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}

async function callBridge(method, params) {
  try {
    return textResult(await bridge.call(method, params));
  } catch (error) {
    return errorResult(error);
  }
}

server.registerPrompt(
  'edit-pigmi-document',
  {
    title: 'Edit the active Pigmi document',
    description:
      'Runs the recommended progressive-read and atomic-write workflow for a Pigmi request.',
    argsSchema: { request: z.string().min(1).describe('The requested Pigmi task') },
  },
  async ({ request }) => ({
    messages: [
      {
        role: 'user',
        content: { type: 'text', text: `${PIGMI_EDIT_PROMPT}\n${request}` },
      },
    ],
  }),
);

server.registerTool(
  'pigmi_get_overview',
  {
    description:
      'Start here. Returns document settings, selection, explicit folder-child relationships, and hierarchy validation without full item payloads.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('get_overview', {}),
);

server.registerTool(
  'pigmi_get_items',
  {
    description:
      'Fetch only the fields needed for matching items, or get a compact palette inventory. For template variants, fetch corresponding items from the relevant source folders before recoloring duplicates.',
    inputSchema: { requests: z.array(itemRequestSchema).min(1).max(4) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ requests }) => callBridge('get_items', { requests }),
);

server.registerTool(
  'pigmi_get_folders',
  {
    description:
      'Fetch exact folders as complete semantic templates: nested structure, relative child paths, and requested item fields. Use this for repeated objects, variants, assemblies, or any edit that must preserve a hierarchy.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(8),
      fields: z.array(detailFieldSchema).default(['colors', 'gradient', 'material']),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ paths, fields }) => callBridge('get_folders', { paths, fields }),
);

server.registerTool(
  'pigmi_compare_folders',
  {
    description:
      'Aligns items from several folders by exact relative semantic path and reports missing roles and field differences. Use before extending a family of objects or applying consistent cross-variant edits.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(2).max(8),
      fields: z.array(detailFieldSchema).default(['colors', 'gradient', 'material']),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ paths, fields }) => callBridge('compare_folders', { paths, fields }),
);

server.registerTool(
  'pigmi_validate_document',
  {
    description:
      'Checks the active document for hierarchy/payload mismatches, duplicate ids or semantic paths, invalid gradients/material values, and items outside the canvas. Use after complex structural edits when verification is useful.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('validate_document', {}),
);

server.registerTool(
  'pigmi_duplicate_folder_variants',
  {
    description:
      'Create complete variants from an existing folder template. Every descendant is preserved; itemEdits change generated children by exact path relative to the source folder, so generated ids are not needed.',
    inputSchema: {
      sourcePath: z.string().min(1),
      variants: z
        .array(
          z.object({
            newPath: z.string().min(1),
            offset: z.object({ x: z.number().optional(), y: z.number().optional() }).optional(),
            itemEdits: z.array(folderItemEditSchema).default([]),
          }),
        )
        .min(1)
        .max(20),
      expectedRevision: z.string().optional(),
      dryRun: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ sourcePath, variants, expectedRevision, dryRun }) =>
    callBridge('apply_operations', {
      operations: variants.map((variant) => ({
        type: 'duplicate_folder',
        sourcePath,
        newPath: variant.newPath,
        offset: variant.offset,
        itemEdits: variant.itemEdits,
      })),
      expectedRevision,
      dryRun,
      allowPartial: false,
    }),
);

server.registerTool(
  'pigmi_edit_folder_items',
  {
    description:
      'Edits exact semantic roles inside one or more existing folders. Each item is addressed by its path relative to that folder, avoiding generated ids and accidental matches in other subtrees.',
    inputSchema: {
      folders: z
        .array(
          z.object({
            path: z.string().min(1),
            itemEdits: z.array(folderItemEditSchema).min(1).max(300),
          }),
        )
        .min(1)
        .max(20),
      expectedRevision: z.string().optional(),
      dryRun: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ folders, expectedRevision, dryRun }) =>
    callBridge('apply_operations', {
      operations: folders.map((folder) => ({
        type: 'edit_folder_items',
        folderPath: folder.path,
        itemEdits: folder.itemEdits,
      })),
      expectedRevision,
      dryRun,
      allowPartial: false,
    }),
);

server.registerTool(
  'pigmi_create_items',
  {
    description:
      'Creates a typed batch of new gradient or material items, optionally in nested folders and with compact layout. Use for genuinely new palettes or structures when no existing folder should be used as a template.',
    inputSchema: {
      items: z.array(gradientItemSchema).min(1).max(200),
      defaults: gradientItemSchema.partial().optional(),
      layout: layoutSchema,
      expectedRevision: z.string().optional(),
      dryRun: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ items, defaults, layout, expectedRevision, dryRun }) =>
    callBridge('apply_operations', {
      operations: [{ type: 'create_gradient_items', defaults, items }],
      layout,
      expectedRevision,
      dryRun,
      allowPartial: false,
    }),
);

server.registerTool(
  'pigmi_get_operation_reference',
  {
    description:
      'Returns concise argument references for requested edit operation types. Request only the operations you plan to use.',
    inputSchema: { operations: z.array(z.string()).max(20).default([]) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ operations }) => textResult({ operations: getOperationReference(operations) }),
);

server.registerTool(
  'pigmi_apply_operations',
  {
    description:
      'Atomically applies typed operations to the active Pigmi document. Pass expectedRevision from a read to prevent stale writes. Created items are not selected unless set_selection is explicit. Use dryRun for uncertain plans.',
    inputSchema: {
      operations: z.array(z.record(z.string(), z.unknown())).max(500),
      expectedRevision: z.string().optional(),
      dryRun: z.boolean().default(false),
      allowPartial: z.boolean().default(false),
      layout: layoutSchema,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async (params) => callBridge('apply_operations', params),
);

server.registerTool(
  'pigmi_undo',
  {
    description: 'Undo the latest Pigmi document change.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  async () => callBridge('undo', {}),
);

server.registerTool(
  'pigmi_get_canvas_preview',
  {
    description: 'Returns the current rendered Pigmi canvas as a PNG image.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => {
    try {
      const preview = await bridge.call('get_canvas_preview', {});
      const match = /^data:image\/png;base64,(.+)$/.exec(preview.dataUrl || '');
      if (!match) throw new Error('Pigmi returned an invalid canvas preview');
      return {
        content: [
          { type: 'image', data: match[1], mimeType: 'image/png' },
          { type: 'text', text: `${preview.width}x${preview.height}` },
        ],
      };
    } catch (error) {
      return errorResult(error);
    }
  },
);

server.registerTool(
  'pigmi_get_project',
  {
    description: 'Lists JSON documents in the current Pigmi project and identifies the open one.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('get_project', {}),
);

server.registerTool(
  'pigmi_open_document',
  {
    description: 'Opens an existing JSON document from the current Pigmi project.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async (params) => callBridge('open_document', params),
);

server.registerTool(
  'pigmi_save_document',
  {
    description: 'Saves the active Pigmi document. Optionally exports all enabled texture maps.',
    inputSchema: { exportMaps: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async (params) => callBridge('save_document', params),
);

server.registerResource(
  'active-document-overview',
  'pigmi://document/overview',
  {
    title: 'Active Pigmi document overview',
    description: 'Compact settings, hierarchy, and selection for the active Pigmi document.',
    mimeType: 'application/json',
  },
  async (uri) => {
    const overview = await bridge.call('get_overview', {});
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(overview) }],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
const heartbeat = setInterval(() => {
  void bridge.call('__ping').catch(() => {});
}, 25_000);
heartbeat.unref();
void bridge.call('__ping').catch(() => {});
console.error('Pigmi MCP server is ready on stdio');
