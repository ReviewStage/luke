/**
 * mcp-connect.ts -- how each coding agent adds our MCP server: the server's path, the name each agent knows it by, the command that adds it, and Cursor's install link and config entry.
 *
 * Settings › our MCP shows these steps for a person to copy, and `vespin
 * mcp install` runs them, so both read them here and the commands and
 * addresses never drift apart. A command is kept as its arguments, run as
 * they stand, and shown as the one line a shell reads them back from
 * (`shellLine`).
 */

import { PRODUCT_NAME } from "./product-name.js";

/** The member MCP server's path under the service origin. */
export const MCP_SERVER_PATH = "/api/mcp";

/** The name each agent knows the server by. */
export const MCP_SERVER_NAME = PRODUCT_NAME.toLowerCase();

/** The agents that add a remote server by a command of their own. */
export const MCP_COMMAND_AGENT = {
  CLAUDE_CODE: "claudeCode",
  CODEX: "codex",
  VS_CODE: "vsCode",
} as const;

export type McpCommandAgent = (typeof MCP_COMMAND_AGENT)[keyof typeof MCP_COMMAND_AGENT];

/** A command as it is run: the program, then its arguments. */
export type McpCommand = readonly [program: string, ...args: string[]];

/** The server's address on a service origin. */
export function mcpServerUrl(origin: string): string {
  return `${origin}${MCP_SERVER_PATH}`;
}

/** The command each agent adds a remote MCP server signed in with OAuth by, as its own docs say. */
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

/** A word a POSIX shell reads as itself, unquoted. */
const PLAIN_WORD = /^[\w@%+=:,./-]+$/u;

/** A command as one line to paste in a shell: each word bare where a shell reads it as itself, else single-quoted. */
export function shellLine(command: McpCommand): string {
  return command
    .map((word) => (PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`))
    .join(" ");
}

/** The entry Cursor keeps for a remote server: its address alone. */
function cursorEntry(serverUrl: string): { readonly url: string } {
  return { url: serverUrl };
}

/** Cursor's install link for a remote server: its name and its config, `{ url }`, in base64 (cursor.com/docs/mcp/install-links). */
export function cursorInstallUrl(serverUrl: string): string {
  const config = btoa(JSON.stringify(cursorEntry(serverUrl)));
  return `https://cursor.com/en/install-mcp?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(config)}`;
}

/** Where Cursor reads the servers it runs everywhere, under the home folder. */
export const CURSOR_CONFIG_PATH = [".cursor", "mcp.json"] as const;

/** Whether a value read from JSON is an object of named values, rather than an array, a word, or nothing. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Cursor's `mcp.json` with the server's entry in it, every other key and
 * server kept as it stood; none where what stands there is no config this
 * could add to, which is left for the person rather than overwritten.
 */
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

/** Cursor's config with only the server's entry, as a person adds it by hand. */
export function cursorConfigSnippet(serverUrl: string): string {
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: cursorEntry(serverUrl) } }, null, 2);
}
