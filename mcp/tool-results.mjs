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
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
  };
}
