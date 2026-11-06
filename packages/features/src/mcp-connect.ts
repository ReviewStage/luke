import { PRODUCT_NAME } from "./product-name.js";

export const MCP_SERVER_PATH = "/api/mcp";

export const MCP_SERVER_NAME = PRODUCT_NAME.toLowerCase();

export const MCP_COMMAND_AGENT = {
  CLAUDE_CODE: "claudeCode",
  CODEX: "codex",
  VS_CODE: "vsCode",
} as const;

export type McpCommandAgent = (typeof MCP_COMMAND_AGENT)[keyof typeof MCP_COMMAND_AGENT];

export type McpCommand = readonly [program: string, ...args: string[]];

export function mcpServerUrl(origin: string): string {
  return `${origin}${MCP_SERVER_PATH}`;
}

export const MCP_ADD_COMMAND: Readonly<Record<McpCommandAgent, (serverUrl: string) => McpCommand>> =
  {
    [MCP_COMMAND_AGENT.CLAUDE_CODE]: (serverUrl) => [
      "claude",
      "mcp",
      "add",
      "--transport",
      "http",
      MCP_SERVER_NAME,
      serverUrl,
    ],
    [MCP_COMMAND_AGENT.CODEX]: (serverUrl) => [
      "codex",
      "mcp",
      "add",
      MCP_SERVER_NAME,
      "--url",
      serverUrl,
    ],
    [MCP_COMMAND_AGENT.VS_CODE]: (serverUrl) => [
      "code",
      "--add-mcp",
      JSON.stringify({ name: MCP_SERVER_NAME, type: "http", url: serverUrl }),
    ],
  };

const PLAIN_WORD = /^[\w@%+=:,./-]+$/u;

export function shellLine(command: McpCommand): string {
  return command
    .map((word) => (PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`))
    .join(" ");
}

function cursorEntry(serverUrl: string): { readonly url: string } {
  return { url: serverUrl };
}

export function cursorInstallUrl(serverUrl: string): string {
  const config = btoa(JSON.stringify(cursorEntry(serverUrl)));
  return `https://cursor.com/en/install-mcp?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

export const CURSOR_CONFIG_PATH = [".cursor", "mcp.json"] as const;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cursorConfigWithServer(
  config: unknown,
  serverUrl: string,
): Readonly<Record<string, unknown>> | undefined {
  const existing = config ?? {};
  if (!isRecord(existing)) return undefined;
  const servers = existing.mcpServers ?? {};
  if (!isRecord(servers)) return undefined;
  return { ...existing, mcpServers: { ...servers, [MCP_SERVER_NAME]: cursorEntry(serverUrl) } };
}

export function cursorConfigSnippet(serverUrl: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: cursorEntry(serverUrl) } }, null, 2);
}
