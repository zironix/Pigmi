import { describe, expect, it } from 'vitest';

import { errorToolResult, jsonToolResult } from '../mcp/tool-results.mjs';

describe('MCP tool result serialization', () => {
  it('returns JSON once instead of duplicating it as structured content', () => {
    const payload = { revision: '10-deadbeef', items: [{ id: 1, name: 'Accent' }] };
    const result = jsonToolResult(payload);

    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    });
    expect(result).not.toHaveProperty('structuredContent');
  });

  it('keeps tool errors concise', () => {
    expect(errorToolResult(new Error('Editor unavailable'))).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Editor unavailable' }],
    });
  });
});
