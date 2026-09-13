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
  offset: z
    .number()
    .int()
    .nonnegative()
    .default(0)
    .describe('Continue at nextOffset if truncated; keep the same selectors and revision.'),
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
    argsSchema: {
      request: z.string().min(1).describe('The requested Pigmi task'),
      detailed: z.enum(['true', 'false']).optional().describe('Include the full editing guide.'),
    },
  },
  async ({ request, detailed }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `${detailed === 'true' ? `${FULL_PIGMI_MCP_INSTRUCTIONS}\n\n` : ''}${PIGMI_EDIT_PROMPT}\n${request}`,
        },
      },
    ],
  }),
);

server.registerTool(
  'pigmi_get_overview',
  {
    description:
      'Returns revision, stateRevision, defaults, selection, and root/selected layers. Reuse knownState=stateRevision to get unchanged:true when current. Use detail:full for the full index or read exact folders/items. A simple new palette needs only this then pigmi_create_items.',
    inputSchema: {
      detail: z.enum(['summary', 'full']).default('summary'),
      knownState: z.string().optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async (params) => callBridge('get_overview', params),
);

server.registerTool(
  'pigmi_get_items',
  {
    description:
      'Fetch only missing fields for exact items or a palette inventory. Reuse details already in context when their revision is current.',
    inputSchema: { requests: z.array(itemRequestSchema).min(1).max(4) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ requests }) => callBridge('get_items', { requests }),
);

server.registerTool(
  'pigmi_get_folders',
  {
    description:
      'Read exact subtrees, bounds, and requested fields. Check complete/truncated before treating a result as a full template.',
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
      'Compare sibling folders by relative path. Compact output stores identical fields in role.shared; merge with each values entry. compact:false returns expanded values.',
    inputSchema: {
      paths: z.array(z.string().min(1)).min(2).max(8),
      fields: z.array(detailFieldSchema).default([]),
      compact: z.boolean().default(true),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ paths, fields, compact }) => callBridge('compare_folders', { paths, fields, compact }),
);

server.registerTool(
  'pigmi_validate_document',
  {
    description:
      'Check hierarchy, IDs, paths, gradients, materials, and bounds after complex or suspicious edits.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('validate_document', {}),
);

server.registerTool(
  'pigmi_duplicate_folder_variants',
  {
    description:
      'Duplicate complete folder variants with exact names and source-relative offsets; no operation reference needed.',
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
      'Edit roles inside existing folders by relative path; no operation reference needed.',
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
      'Create a new palette in one write. Omit folderPath for root; missing folders are created automatically. Items touch edge-to-edge unless spacing is requested. After success, never call again merely to organize. No operation reference needed.',
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
      'Atomic write for other operations. Fetch references only for unfamiliar operations. Pass expectedRevision. dryRun returns current revision and a separate proposedRevision without applying changes.',
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
    inputSchema: { maxSide: z.number().int().min(64).max(4096).default(1024) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ maxSide }) => {
    try {
      const preview = await bridge.call('get_canvas_preview', { maxSide });
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
    const overview = await bridge.call('get_overview', { detail: 'summary' });
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
