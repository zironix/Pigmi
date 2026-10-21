// Zod emits JSON Schema noise that clients forward to the model with every
// request: safe-integer bounds on each .int(), record boilerplate, $schema, and
// anyOf wrappers for nullable fields. Strip it without changing what validates.
const SAFE_INTEGER_BOUNDS = new Set([Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);

function isEmptyObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length;
}

export function compactJsonSchema(schema) {
  if (Array.isArray(schema)) return schema.map(compactJsonSchema);
  if (!schema || typeof schema !== 'object') return schema;

  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue;
    if ((key === 'minimum' || key === 'maximum') && SAFE_INTEGER_BOUNDS.has(value)) continue;
    if (key === 'propertyNames' && value?.type === 'string' && Object.keys(value).length === 1) {
      continue;
    }
    if (key === 'additionalProperties' && isEmptyObject(value)) continue;
    result[key] = compactJsonSchema(value);
  }

  // { anyOf: [{ type: 'x', ... }, { type: 'null' }] } -> { type: ['x', 'null'], ... }
  if (Array.isArray(result.anyOf) && result.anyOf.length === 2) {
    const nullIndex = result.anyOf.findIndex(
      (entry) => entry?.type === 'null' && Object.keys(entry).length === 1,
    );
    const other = result.anyOf[1 - nullIndex];
    if (nullIndex !== -1 && typeof other?.type === 'string' && !other.anyOf) {
      delete result.anyOf;
      return { ...result, ...other, type: [other.type, 'null'] };
    }
  }
  return result;
}

export function compactToolList(result) {
  if (!Array.isArray(result?.tools)) return result;
  return {
    ...result,
    tools: result.tools.map(({ execution, inputSchema, ...tool }) => ({
      ...tool,
      inputSchema: compactJsonSchema(inputSchema),
      // taskSupport "forbidden" is the protocol default.
      ...(execution && execution.taskSupport !== 'forbidden' ? { execution } : {}),
    })),
  };
}
