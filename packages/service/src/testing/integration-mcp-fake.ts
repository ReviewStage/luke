/**
 * integration-mcp-fake.ts -- an integration's hosted MCP server as a suite stands it up: Linear's, at its own address, admitting one member's bearer.
 *
 * The server is the MCP SDK's own, over its web-standard transport with no
 * session, so a client of Luke's speaks to it as it speaks to a provider.
 * Its tools answer fixed results: a JSON text, structured content, a
 * picture, and an error of the tool's own; `list_issues` refuses one team
 * with a JSON-RPC error instead. Vercel Connect is a fake that
 * issues each account a token naming it, for Linear and Notion; every
 * other provider is one this deployment never set up.
 */

import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@luke/features/integration-wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect, Redacted } from "effect";
import type { ConnectorService } from "../integrations/integration-connect.js";
import { INTEGRATION } from "../integrations/integrations.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "./integration-connect.js";

const LINEAR = INTEGRATION_PROVIDER.LINEAR;
const NOTION = INTEGRATION_PROVIDER.NOTION;

/** The token Connect issues a member for Linear, which names the member. */
export function linearTokenOf(userId: string): string {
  return `lin_oauth_${userId}_${"k".repeat(24)}`;
}

/** A connector this deployment set up, issuing every account its token. */
const ISSUING: ConnectorService = {
  ...CONNECTOR_ASKED_NOTHING,
  token: (subject) =>
    Effect.succeed({ token: Redacted.make(linearTokenOf(subject)), expiresAt: Infinity }),
};

/** A provider this deployment never set up. */
const UNCONFIGURED: ConnectorService = { ...CONNECTOR_ASKED_NOTHING, configured: false };

export const LINEAR_AND_NOTION_CONNECT = integrationConnectOf((provider: IntegrationProvider) =>
  provider === LINEAR || provider === NOTION ? ISSUING : UNCONFIGURED,
);

/** Linear's tools, as its server lists them. */
const LINEAR_TOOLS = [
  {
    name: "list_issues",
    description: "List issues in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", description: "The team's key." },
        limit: { type: "integer", minimum: 1, description: "How many." },
      },
      required: ["team"],
    },
  },
  {
    name: "create_issue",
    description: "Create an issue.",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, priority: { enum: [1, 2, 3] } },
      required: ["title"],
    },
    outputSchema: { type: "object", properties: { id: { type: "string" } } },
  },
  { name: "fail", description: "Always fails.", inputSchema: { type: "object" } },
  { name: "draw", description: "Draws a picture.", inputSchema: { type: "object" } },
  { name: "attach", description: "Attaches files.", inputSchema: { type: "object" } },
];

/** The team `list_issues` refuses with a JSON-RPC error, after the session listed its tools. */
export const REJECTED_TEAM = "REJECT";

/** What Linear's fake server heard: each call's tool and arguments, and the bearers it was sent. */
export interface Heard {
  readonly calls: { readonly name: string; readonly arguments: unknown }[];
  readonly bearers: string[];
}

/** Linear's MCP server for the member: the SDK's own, admitting their bearer alone, and listing `tools`; anything else answers 401. */
export function linearServer(
  bearer: string,
  heard: Heard,
  tools: readonly object[] = LINEAR_TOOLS,
) {
  return fakeHttpClientLayer(async (url, init) => {
    if (url !== INTEGRATION[LINEAR].MCP_URL) {
      return new Response("not found", { status: 404 });
    }
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    heard.bearers.push(authorization);
    if (authorization !== `Bearer ${bearer}`) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32001, message: `bad ${authorization}` } },
        { status: 401 },
      );
    }
    const server = new Server(
      { name: "linear-fake", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...tools] }));
    server.setRequestHandler(CallToolRequestSchema, (request): CallToolResult => {
      heard.calls.push({ name: request.params.name, arguments: request.params.arguments });
      switch (request.params.name) {
        case "list_issues":
          // A team the server refuses outright, as a JSON-RPC error rather than the tool's own.
          if (request.params.arguments?.team === REJECTED_TEAM) {
            throw new McpError(ErrorCode.InvalidParams, "Unknown team.");
          }
          return {
            content: [{ type: "text", text: JSON.stringify({ issues: [{ id: "LIN-1" }] }) }],
          };
        case "create_issue":
          return {
            content: [{ type: "text", text: '{"id":"LIN-2"}' }],
            structuredContent: { id: "LIN-2" },
          };
        case "draw":
          return {
            content: [
              { type: "text", text: "A chart:" },
              { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
            ],
          };
        case "attach":
          return {
            content: [
              {
                type: "resource",
                resource: { uri: "file:///chart.png", mimeType: "image/png", blob: "iVBORw0KGgo=" },
              },
              {
                type: "resource",
                resource: {
                  uri: "file:///notes.pdf",
                  mimeType: "application/pdf",
                  blob: "JVBERi0=",
                },
              },
              { type: "image", data: "R0lGODlh", mimeType: "image/gif" },
            ],
          };
        default:
          return { content: [{ type: "text", text: "Team not found." }], isError: true };
      }
    });
    // No session id generator: the server keeps no session, as a stateless provider does.
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(new Request(url, init));
  });
}
