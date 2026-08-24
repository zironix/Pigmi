import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let client;
let tools;

beforeAll(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['mcp/server.mjs'],
    cwd: path.resolve(import.meta.dirname, '..'),
    stderr: 'pipe',
  });
  client = new Client({ name: 'pigmi-contract-test', version: '1.0.0' });
  await client.connect(transport);
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await client?.close();
});

describe('Pigmi MCP server contract', () => {
  it('keeps the complete tool context below its previous size', () => {
    expect(JSON.stringify(tools).length).toBeLessThan(16_500);
  });

  it('keeps straightforward palette creation compact and unambiguous', () => {
    const createTool = tools.find((tool) => tool.name === 'pigmi_create_items');

    expect(createTool).toBeDefined();
    expect(createTool.inputSchema.properties.folderPath).toMatchObject({ type: 'string' });
    expect(createTool.description).toContain('missing folders are created automatically');
    expect(createTool.description).toContain('never call again merely to organize');
    expect(JSON.stringify(createTool).length).toBeLessThan(4_000);
  });

  it('does not duplicate the complete item schema inside defaults', () => {
    const createTool = tools.find((tool) => tool.name === 'pigmi_create_items');
    const defaultsSchema = createTool.inputSchema.properties.defaults;

    expect(defaultsSchema.type).toBe('object');
    expect(defaultsSchema).not.toHaveProperty('properties');
    expect(defaultsSchema.additionalProperties).toEqual({});
  });
});
