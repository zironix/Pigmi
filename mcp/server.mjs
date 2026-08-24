#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { PigmiBridgeClient } from './bridge-client.mjs';
import { buildCreateItemsOperation } from './create-items.mjs';
import {
  FULL_PIGMI_MCP_INSTRUCTIONS,
  PIGMI_EDIT_PROMPT,
  PIGMI_SERVER_INSTRUCTIONS,
} from './instructions.mjs';
import { getOperationReference } from './operation-reference.mjs';
import { errorToolResult, jsonToolResult } from './tool-results.mjs';

const bridge = new PigmiBridgeClient();
const server = new McpServer(
  { name: 'pigmi', version: '1.5.0' },
  { instructions: PIGMI_SERVER_INSTRUCTIONS },
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

const gradientItemStyleFields = {
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
  material: materialSchema.optional(),
};

const gradientItemSchema = z.object({
  name: z.string().min(1),
  colors: z.array(z.string()).min(1),
  folderPath: z
    .string()
    .optional()
    .describe('Per-item destination override; omit when the common folderPath applies.'),
  ...gradientItemStyleFields,
  x: z.number().optional(),
  y: z.number().optional(),
});

const gradientDefaultsSchema = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    'Shared optional item fields; each item overrides them. Omit to inherit Pigmi defaults.',
  );

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
    itemGapSteps: z
      .number()
      .min(0)
      .optional()
      .describe('Internal palette gap in grid steps; omit unless the user requests spacing.'),
  })
  .nullable()
  .optional();

async function callBridge(method, params) {
  try {
    return jsonToolResult(await bridge.call(method, params));
  } catch (error) {
    return errorToolResult(error);
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
        content: {
          type: 'text',
          text: `${FULL_PIGMI_MCP_INSTRUCTIONS}\n\n${PIGMI_EDIT_PROMPT}\n${request}`,
        },
      },
    ],
  }),
);

server.registerTool(
  'pigmi_get_overview',
  {
    description:
      'Start every document task here, once. Returns revision, defaults, selection, semantic paths, folder bounds, and hierarchy validity. For a straightforward new palette, call pigmi_create_items next without another read.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('get_overview', {}),
);

server.registerTool(
  'pigmi_get_items',
  {
    description:
      'After overview, fetch only necessary fields for exact items or a compact palette inventory. Skip this for a straightforward new palette whose request and overview already provide enough evidence.',
    inputSchema: { requests: z.array(itemRequestSchema).min(1).max(4) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ requests }) => callBridge('get_items', { requests }),
);

server.registerTool(
  'pigmi_get_folders',
  {
    description:
      'After overview, fetch exact folders as complete templates with bounds, relative paths, and only requested fields. Use when a variant or edit must preserve an existing hierarchy.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(1).max(8),
      fields: z.array(detailFieldSchema).default([]),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ paths, fields }) => callBridge('get_folders', { paths, fields }),
);

server.registerTool(
  'pigmi_compare_folders',
  {
    description:
      'After overview, align relevant sibling folders by relative path and return raw placements and requested differences. Use only when extending an existing repeated family.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(2).max(8),
      fields: z.array(detailFieldSchema).default([]),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ paths, fields }) => callBridge('compare_folders', { paths, fields }),
);

server.registerTool(
  'pigmi_validate_document',
  {
    description:
      'Checks hierarchy, ids, paths, gradients, materials, and canvas bounds. Reserve for complex or suspicious structural edits; routine successful palette creation does not need it.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('validate_document', {}),
);

server.registerTool(
  'pigmi_duplicate_folder_variants',
  {
    description:
      'Specialized write for complete folder variants. After overview and only the relevant folder evidence, infer exact names and source-relative offsets, then write directly without an operation reference.',
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
      'Specialized write for exact roles inside existing folders. Address items by relative path and write directly after the necessary read; no generic operation reference is needed.',
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
      'One-write fast path for a new palette after overview. Omit folderPath for root; use it only when the user or a clear local pattern requires a folder, and missing folders are created automatically. Items are edge-to-edge unless spacing is explicit; otherwise flow left-to-right then top-to-bottom. A success response is final: never call again merely to organize. Do not fetch references, preview, or validate unless ambiguity requires it.',
    inputSchema: {
      items: z.array(gradientItemSchema).min(1).max(200),
      folderPath: z
        .string()
        .optional()
        .describe('Common destination; omit or use an empty string for root.'),
      defaults: gradientDefaultsSchema,
      layout: layoutSchema,
      expectedRevision: z.string().optional(),
      dryRun: z.boolean().default(false),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  async ({ items, folderPath, defaults, layout, expectedRevision, dryRun }) => {
    return callBridge('apply_operations', {
      operations: [buildCreateItemsOperation({ items, folderPath, defaults })],
      layout,
      expectedRevision,
      dryRun,
      allowPartial: false,
    });
  },
);

server.registerTool(
  'pigmi_get_operation_reference',
  {
    description:
      'Returns references only for a planned generic pigmi_apply_operations call. Never use before pigmi_create_items, pigmi_duplicate_folder_variants, or pigmi_edit_folder_items.',
    inputSchema: { operations: z.array(z.string()).min(1).max(20) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ operations }) => jsonToolResult({ operations: getOperationReference(operations) }),
);

server.registerTool(
  'pigmi_apply_operations',
  {
    description:
      'Generic atomic write for operations not covered by specialized tools. First request references only for the operation types used. Pass expectedRevision; use dryRun only when a concrete ambiguity makes it useful.',
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
    description:
      'Returns the rendered canvas as PNG. Use only when visual evidence is needed; routine successful writes do not require a preview.',
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
      return errorToolResult(error);
    }
  },
);

server.registerTool(
  'pigmi_get_project',
  {
    description:
      'Lists project documents and the open one. Use only for an explicit project/document request.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('get_project', {}),
);

server.registerTool(
  'pigmi_open_document',
  {
    description: 'Opens an existing project document only when the user requests it.',
    inputSchema: { name: z.string().min(1) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  async (params) => callBridge('open_document', params),
);

server.registerTool(
  'pigmi_save_document',
  {
    description:
      'Saves the active document and optionally exports enabled maps. Do not save unless requested or required by the task.',
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
