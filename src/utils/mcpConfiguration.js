function tomlString(value) {
  return JSON.stringify(String(value));
}

function shellArgument(value, platform) {
  const source = String(value);

  if (platform === 'win32') {
    return `'${source.replaceAll("'", "''")}'`;
  }

  return `"${source.replace(/["\\$`]/g, '\\$&')}"`;
}

/** Builds the command accepted by Codex CLI on the current operating system. */
export function createCodexMcpCommand({ serverPath, connectionFile, platform }) {
  if (!serverPath || !connectionFile) return '';

  return [
    'codex mcp add pigmi -- node',
    shellArgument(serverPath, platform),
    '--connection-file',
    shellArgument(connectionFile, platform),
  ].join(' ');
}

/** Builds a Codex config.toml entry for Pigmi's local stdio MCP server. */
export function createCodexMcpToml({ serverPath, connectionFile }) {
  if (!serverPath || !connectionFile) return '';

  return [
    '[mcp_servers.pigmi]',
    'command = "node"',
    'args = [',
    `  ${tomlString(serverPath)},`,
    '  "--connection-file",',
    `  ${tomlString(connectionFile)}`,
    ']',
    'startup_timeout_sec = 20',
    'tool_timeout_sec = 60',
  ].join('\n');
}

/** Builds the common JSON shape accepted by Claude Desktop and many other MCP clients. */
export function createMcpJsonConfiguration({ serverPath, connectionFile }) {
  if (!serverPath || !connectionFile) return '';

  return JSON.stringify(
    {
      mcpServers: {
        pigmi: {
          command: 'node',
          args: [serverPath, '--connection-file', connectionFile],
        },
      },
    },
    null,
    2,
  );
}
