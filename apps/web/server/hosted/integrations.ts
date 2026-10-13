/**
 * integrations.ts -- every integration this deployment can offer, as one table.
 *
 * An integration is a provider's own hosted MCP server, reached with a grant
 * Vercel Connect holds for the account under one connector of this
 * deployment's. The table is the whole of what makes a provider one: the
 * variable its connector's UID is read from (`integration-connect.ts`), the
 * server every agent's connection is opened to and what the model is told of
 * it (`integration-connection.ts`), and the name a nested call of one of its
 * tools is stored under in a transcript (`connection-tools.ts`). Its routes,
 * its row, and its landing page are the same for every provider.
 */

import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";

export interface IntegrationDefinition {
  /** The variable the connector's UID is read from, as `vercel connect create` printed it. */
  readonly CONNECTOR_VARIABLE: string;
  /** The provider's own hosted MCP server. */
  readonly MCP_URL: string;
  /** What the model is told of the connection, so it can choose which one to search. */
  readonly DESCRIPTION: string;
  /** The fixed name a nested call of one of the provider's tools is stored under. */
  readonly REMOTE_TOOL: string;
}

export const INTEGRATION = {
  [INTEGRATION_PROVIDER.LINEAR]: {
    CONNECTOR_VARIABLE: "LINEAR_CONNECTOR_UID",
    MCP_URL: "https://mcp.linear.app/mcp",
    DESCRIPTION:
      "Linear, the developer's issue tracker, as their own account sees it: find, read, create, and update issues, projects, cycles, documents, and comments.",
    REMOTE_TOOL: "linear_remote",
  },
} as const satisfies Record<IntegrationProvider, IntegrationDefinition>;
