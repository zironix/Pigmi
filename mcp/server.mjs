#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { PigmiBridgeClient } from './bridge-client.mjs';
import { FULL_PIGMI_MCP_INSTRUCTIONS, PIGMI_EDIT_PROMPT } from './instructions.mjs';
import { getOperationReference } from './operation-reference.mjs';

const bridge = new PigmiBridgeClient();
const server = new McpServer(
  { name: 'pigmi', version: '1.2.0' },
  { instructions: FULL_PIGMI_MCP_INSTRUCTIONS },
);

const itemRequestSchema = z.object({
  type: z.enum(['get_items', 'get_palette']).default('get_items'),
  ids: z.array(z.number()).max(100).default([]),
  query: z.string().default(''),
  folderPath: z.string().default(''),
  selected: z.boolean().default(false),
  fields: z
    .array(z.enum(['colors', 'gradient', 'material', 'transform', 'visibility']))
    .default([]),
  limit: z.number().int().min(1).max(100).default(30),
});

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
      'Start here. Returns document settings, selection, and a compact hierarchy index without full item payloads.',
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async () => callBridge('get_overview', {}),
);

server.registerTool(
  'pigmi_get_items',
  {
    description:
      'Fetch only the fields needed for matching items, or get a compact palette inventory. Use ids from pigmi_get_overview when possible.',
    inputSchema: { requests: z.array(itemRequestSchema).min(1).max(4) },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  async ({ requests }) => callBridge('get_items', { requests }),
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
      layout: z
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
        .optional(),
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
