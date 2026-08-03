import { describe, expect, it } from 'vitest';

import { createCodexMcpCommand, createCodexMcpToml } from '../src/utils/mcpConfiguration';

describe('Codex MCP configuration', () => {
  const paths = {
    connectionFile: '/Users/example/Library/Application Support/Pigmi/mcp-connection.json',
    serverPath: '/Applications/Pigmi.app/Contents/Resources/mcp/server.mjs',
  };

  it('creates a directly runnable POSIX Codex CLI command', () => {
    expect(createCodexMcpCommand({ ...paths, platform: 'darwin' })).toBe(
      'codex mcp add pigmi -- node "/Applications/Pigmi.app/Contents/Resources/mcp/server.mjs" --connection-file "/Users/example/Library/Application Support/Pigmi/mcp-connection.json"',
    );
  });

  it('quotes Windows paths for PowerShell', () => {
    expect(
      createCodexMcpCommand({
        connectionFile: String.raw`C:\Users\Example\AppData\Roaming\Pigmi\mcp-connection.json`,
        platform: 'win32',
        serverPath: String.raw`C:\Program Files\Pigmi\resources\mcp\server.mjs`,
      }),
    ).toContain("node 'C:\\Program Files\\Pigmi\\resources\\mcp\\server.mjs'");
  });

  it('creates valid Codex config.toml fields with escaped paths', () => {
    const configuration = createCodexMcpToml(paths);

    expect(configuration).toContain('[mcp_servers.pigmi]');
    expect(configuration).toContain('command = "node"');
    expect(configuration).toContain('"--connection-file"');
    expect(configuration).toContain('startup_timeout_sec = 20');
  });
});
