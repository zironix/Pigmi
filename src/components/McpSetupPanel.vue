<script setup>
import { onBeforeUnmount, ref } from 'vue';

defineProps({
  codexCommand: { type: String, default: '' },
  codexToml: { type: String, default: '' },
  connectionFile: { type: String, default: '' },
  jsonConfiguration: { type: String, default: '' },
  running: { type: Boolean, default: false },
  clientCount: { type: Number, default: 0 },
  serverPath: { type: String, default: '' },
});

const copiedField = ref('');
let copiedTimer = null;

function fallbackCopy(value) {
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function copyValue(value, field) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    fallbackCopy(value);
  }
  copiedField.value = field;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedField.value = '';
  }, 1600);
}

onBeforeUnmount(() => clearTimeout(copiedTimer));
</script>

<template>
  <main class="mcp-workspace">
    <div class="mcp-page">
      <header class="mcp-page-header">
        <div>
          <div class="mcp-eyebrow">MODEL CONTEXT PROTOCOL</div>
          <h1>Connect an AI client to Pigmi</h1>
          <p>
            Pigmi exposes the active document through a local STDIO MCP server. Choose your client
            below, copy the generated configuration, then keep Pigmi open while the client works.
          </p>
        </div>
        <span class="mcp-status" :class="{ connected: clientCount > 0, unavailable: !running }">
          {{ !running ? 'Unavailable' : clientCount > 0 ? `${clientCount} connected` : 'Waiting' }}
        </span>
      </header>

      <section class="mcp-path-card">
        <div class="mcp-path-intro">
          <h2>These are the only two paths a client needs</h2>
          <p>
            Do not browse for <code>Pigmi.app</code>, <code>Pigmi.exe</code>, or the AppImage. The
            client launches the JavaScript server below with Node.js, then uses the live connection
            file to reach this Pigmi window.
          </p>
        </div>
        <div class="mcp-paths">
          <div class="mcp-value">
            <div class="mcp-value-heading">
              <span>MCP server</span>
              <button type="button" @click="copyValue(serverPath, 'server')">
                {{ copiedField === 'server' ? 'Copied' : 'Copy path' }}
              </button>
            </div>
            <code>{{ serverPath || 'Path is not available' }}</code>
          </div>
          <div class="mcp-value">
            <div class="mcp-value-heading">
              <span>Live connection file</span>
              <button type="button" @click="copyValue(connectionFile, 'connection')">
                {{ copiedField === 'connection' ? 'Copied' : 'Copy path' }}
              </button>
            </div>
            <code>{{ connectionFile || 'Path is not available' }}</code>
          </div>
        </div>
      </section>

      <div class="mcp-client-grid">
        <section class="mcp-client-card mcp-client-card-primary">
          <div class="mcp-client-heading">
            <div>
              <div class="mcp-client-kicker">RECOMMENDED</div>
              <h2>Codex Desktop / CLI</h2>
            </div>
            <button type="button" @click="copyValue(codexCommand, 'codex-command')">
              {{ copiedField === 'codex-command' ? 'Copied' : 'Copy command' }}
            </button>
          </div>
          <ol>
            <li>Verify Node.js with <code>node --version</code> (20.19 or newer).</li>
            <li>Copy the command below and run it in Terminal or PowerShell.</li>
            <li>Completely restart Codex and make sure <code>pigmi</code> is enabled in MCP.</li>
            <li>Keep Pigmi open, then ask Codex to inspect the active Pigmi document.</li>
          </ol>
          <pre>{{ codexCommand }}</pre>
          <details>
            <summary>Manual Codex config.toml</summary>
            <p>
              Replace the existing <code>[mcp_servers.pigmi]</code> section, or append this block to
              <code>~/.codex/config.toml</code>.
            </p>
            <div class="mcp-code-heading">
              <span>Codex TOML</span>
              <button type="button" @click="copyValue(codexToml, 'codex-toml')">
                {{ copiedField === 'codex-toml' ? 'Copied' : 'Copy' }}
              </button>
            </div>
            <pre>{{ codexToml }}</pre>
          </details>
        </section>

        <section class="mcp-client-card">
          <div class="mcp-client-heading">
            <div>
              <div class="mcp-client-kicker">JSON CONFIG</div>
              <h2>Claude Desktop</h2>
            </div>
            <button type="button" @click="copyValue(jsonConfiguration, 'claude-json')">
              {{ copiedField === 'claude-json' ? 'Copied' : 'Copy JSON' }}
            </button>
          </div>
          <ol>
            <li>Open Claude Desktop <strong>Settings → Developer → Edit Config</strong>.</li>
            <li>
              Add the <code>pigmi</code> entry from the JSON below without removing other configured
              servers.
            </li>
            <li>Save the file, completely quit Claude Desktop, then open it again.</li>
            <li>Keep Pigmi open and confirm that Pigmi tools are available in a new chat.</li>
          </ol>
          <p class="mcp-location-note">
            macOS: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code
            ><br />
            Windows: <code>%APPDATA%\Claude\claude_desktop_config.json</code>
          </p>
          <pre>{{ jsonConfiguration }}</pre>
        </section>

        <section class="mcp-client-card">
          <div class="mcp-client-heading">
            <div>
              <div class="mcp-client-kicker">UNIVERSAL</div>
              <h2>Any STDIO MCP client</h2>
            </div>
            <button type="button" @click="copyValue(jsonConfiguration, 'generic-json')">
              {{ copiedField === 'generic-json' ? 'Copied' : 'Copy JSON' }}
            </button>
          </div>
          <p>
            In Cursor, Windsurf, VS Code, another IDE, or any compatible host, add a local MCP
            server with these values. The location of the client's settings file may differ, but the
            launch data is always the same.
          </p>
          <dl class="mcp-fields">
            <div>
              <dt>Name</dt>
              <dd>pigmi</dd>
            </div>
            <div>
              <dt>Transport</dt>
              <dd>STDIO</dd>
            </div>
            <div>
              <dt>Command</dt>
              <dd>node</dd>
            </div>
            <div>
              <dt>Argument 1</dt>
              <dd>{{ serverPath }}</dd>
            </div>
            <div>
              <dt>Argument 2</dt>
              <dd>--connection-file</dd>
            </div>
            <div>
              <dt>Argument 3</dt>
              <dd>{{ connectionFile }}</dd>
            </div>
          </dl>
          <pre>{{ jsonConfiguration }}</pre>
        </section>

        <section class="mcp-client-card">
          <div class="mcp-client-heading">
            <div>
              <div class="mcp-client-kicker">CHECK</div>
              <h2>Verify and troubleshoot</h2>
            </div>
          </div>
          <ol>
            <li>Keep Pigmi running with a document open.</li>
            <li>Restart the MCP client after changing its configuration.</li>
            <li>Ask it to read Pigmi's canvas size without changing anything.</li>
            <li>
              This page should change from <strong>Waiting</strong> to <strong>Connected</strong>.
            </li>
          </ol>
          <div class="mcp-warning">
            <strong>Connection file not found?</strong>
            Start Pigmi first and copy the current path again. Never create
            <code>mcp-connection.json</code> yourself: it contains a temporary port and token.
          </div>
          <div class="mcp-warning">
            <strong>Server will not start?</strong>
            Check <code>node --version</code>, preserve absolute paths, and fully restart the
            client.
          </div>
        </section>
      </div>

      <section class="mcp-footer-note">
        <div>
          <strong>Local and private.</strong> The bridge listens only on <code>127.0.0.1</code>. Do
          not publish the contents of <code>mcp-connection.json</code>.
        </div>
        <div>
          Selective reads · atomic edits · hierarchy templates · PBR materials · canvas preview ·
          project open/save
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.mcp-workspace {
  position: fixed;
  inset: 45px 0 0 42px;
  z-index: 30;
  overflow: auto;
  background: radial-gradient(circle at 85% 0%, rgba(239, 10, 98, 0.11), transparent 34%), #191a1c;
  color: #d4d7dc;
}
.mcp-page {
  box-sizing: border-box;
  width: min(1420px, 100%);
  margin: 0 auto;
  padding: 34px clamp(22px, 4vw, 64px) 50px;
}
.mcp-page-header,
.mcp-client-heading,
.mcp-value-heading,
.mcp-code-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}
.mcp-page-header h1 {
  margin: 5px 0 10px;
  color: #fff;
  font-size: clamp(24px, 3vw, 38px);
  font-weight: 500;
  letter-spacing: -1.5px;
}
.mcp-page-header p,
.mcp-path-card p,
.mcp-client-card p,
.mcp-client-card li {
  color: #979ca5;
  font-size: 12px;
  line-height: 1.7;
}
.mcp-page-header p {
  max-width: 820px;
  margin: 0;
}
.mcp-eyebrow,
.mcp-client-kicker {
  color: #ef0a62;
  font-size: 10px;
  letter-spacing: 1.5px;
}
.mcp-status {
  flex: 0 0 auto;
  padding: 7px 11px;
  border: 1px solid #45484d;
  border-radius: 16px;
  background: #303338;
  color: #b7bcc4;
  font-size: 11px;
  white-space: nowrap;
}
.mcp-status.connected {
  border-color: #2e7558;
  background: #1d513c;
  color: #a9ebce;
}
.mcp-status.unavailable {
  border-color: #704141;
  background: #553030;
  color: #efb0b0;
}
.mcp-path-card,
.mcp-client-card,
.mcp-footer-note {
  border: 1px solid #303237;
  border-radius: 8px;
  background: rgba(32, 34, 37, 0.95);
}
.mcp-path-card {
  display: grid;
  grid-template-columns: minmax(220px, 0.65fr) minmax(420px, 1.35fr);
  gap: 28px;
  margin-top: 28px;
  padding: 22px;
}
.mcp-path-card h2,
.mcp-client-card h2 {
  margin: 0;
  color: #f5f5f6;
  font-size: 16px;
  font-weight: 500;
}
.mcp-path-card p {
  margin: 10px 0 0;
}
.mcp-paths {
  display: grid;
  gap: 12px;
}
.mcp-value {
  min-width: 0;
  padding: 12px 14px;
  border: 1px solid #2b2d31;
  border-radius: 5px;
  background: #191a1c;
}
.mcp-value-heading,
.mcp-code-heading {
  align-items: center;
  margin-bottom: 8px;
  color: #aeb3bb;
  font-size: 10px;
  text-transform: uppercase;
}
.mcp-value > code {
  display: block;
  overflow: auto;
  color: #dadddf;
  font-size: 11px;
  white-space: nowrap;
}
button {
  appearance: none;
  padding: 6px 9px;
  border: 1px solid #4a4d53;
  border-radius: 4px;
  background: #303338;
  color: #d8dbe0;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  transition: 0.15s ease;
}
button:hover {
  border-color: #ef0a62;
  background: #3b3036;
  color: #fff;
}
.mcp-client-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.mcp-client-card {
  min-width: 0;
  padding: 22px;
}
.mcp-client-card-primary {
  border-color: #54313e;
}
.mcp-client-heading {
  align-items: center;
}
.mcp-client-kicker {
  margin-bottom: 5px;
}
.mcp-client-card ol {
  margin: 18px 0;
  padding-left: 20px;
}
.mcp-client-card li + li {
  margin-top: 5px;
}
pre {
  box-sizing: border-box;
  max-width: 100%;
  margin: 14px 0 0;
  padding: 13px;
  overflow: auto;
  border: 1px solid #121315;
  border-radius: 5px;
  background: #151618;
  color: #d8dbe0;
  font:
    10px/1.65 'JetBrains Mono',
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
code {
  color: #d7dae0;
  font-family: 'JetBrains Mono', monospace;
}
details {
  margin-top: 16px;
  border-top: 1px solid #303237;
  padding-top: 14px;
}
summary {
  color: #c9cdd3;
  cursor: pointer;
  font-size: 11px;
}
.mcp-code-heading {
  margin-top: 12px;
}
.mcp-location-note {
  padding: 10px 12px;
  border-left: 2px solid #ef0a62;
  background: #1b1c1f;
}
.mcp-fields {
  display: grid;
  gap: 1px;
  margin: 16px 0 0;
  overflow: hidden;
  border: 1px solid #2e3034;
  border-radius: 5px;
  background: #2e3034;
}
.mcp-fields div {
  display: grid;
  grid-template-columns: 105px minmax(0, 1fr);
  background: #1b1c1f;
}
.mcp-fields dt,
.mcp-fields dd {
  margin: 0;
  padding: 8px 10px;
  font-size: 10px;
}
.mcp-fields dt {
  color: #878c95;
}
.mcp-fields dd {
  overflow-wrap: anywhere;
  color: #d4d7dc;
}
.mcp-warning {
  margin-top: 10px;
  padding: 11px 12px;
  border-radius: 5px;
  background: #292628;
  color: #9fa4ac;
  font-size: 11px;
  line-height: 1.6;
}
.mcp-warning strong {
  color: #e0e2e5;
}
.mcp-footer-note {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  margin-top: 16px;
  padding: 18px 22px;
  color: #858b94;
  font-size: 10px;
  line-height: 1.6;
}
.mcp-footer-note strong {
  color: #cfd3d9;
}
@media (max-width: 920px) {
  .mcp-path-card,
  .mcp-client-grid {
    grid-template-columns: 1fr;
  }
  .mcp-footer-note {
    flex-direction: column;
  }
}
</style>
