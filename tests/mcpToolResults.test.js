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

  it('makes failure impossible to mistake for a successful edit', () => {
    const error = new Error('Editor unavailable');
    error.code = 'PIGMI_UNAVAILABLE';
    const result = errorToolResult(error);
    const payload = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      ok: false,
      status: 'error',
      successConfirmed: false,
      error: { code: 'PIGMI_UNAVAILABLE', message: 'Editor unavailable' },
    });
    expect(payload.instruction).toContain('Do not claim success');
  });
});
