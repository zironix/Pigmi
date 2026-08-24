/**
 * MCP text content is supported by every client. Returning the same payload as
 * structuredContent as well can make clients feed an identical JSON document
 * to the model twice, so Pigmi deliberately uses one representation.
 */
export function jsonToolResult(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

export function errorToolResult(error) {
  const code = typeof error?.code === 'string' ? error.code : 'TOOL_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  const payload = {
    ok: false,
    status: 'error',
    successConfirmed: false,
    error: { code, message },
    instruction:
      code === 'PIGMI_UNAVAILABLE'
        ? 'Do not claim success. Reconnect Pigmi, then inspect current state before retrying a write.'
        : 'Do not claim success. Inspect current state, fix the cause, and retry only if still needed.',
  };

  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}
