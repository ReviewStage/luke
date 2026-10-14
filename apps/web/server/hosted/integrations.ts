/**
 * integrations.ts -- every integration this deployment can offer, as one table.
 *
 * An integration is a provider's own hosted MCP server, reached with a grant
 * Vercel Connect holds for the account under one connector of this
 * deployment's. The table is the whole of what makes a provider one: the
 * variable its connector's UID is read from and the one naming the accounts
 * it is offered to (`integration-connect.ts`), the
 * server every agent's connection is opened to and what the model is told of
 * it (`integration-connection.ts`), and the name a nested call of one of its
 * tools is stored under in a transcript (`connection-tools.ts`). Its routes,
 * its row, and its landing page are the same for every provider.
 */

import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";

export interface IntegrationDefinition {
  /** The variable the connector's UID is read from, as `vercel connect create` printed it. */
  readonly CONNECTOR_VARIABLE: string;
  /**
   * The variable naming the accounts the integration is offered to, comma
   * separated: `@domain.com` for every email at that domain, or one exact
   * email. Unset, the integration is offered to every account.
   */
  readonly ALLOWED_ACCOUNTS_VARIABLE: string;
  /** The provider's own hosted MCP server. */
  readonly MCP_URL: string;
  /** What the model is told of the connection, so it can choose which one to search. */
  readonly DESCRIPTION: string;
  /** The fixed name a nested call of one of the provider's tools is stored under. */
  readonly REMOTE_TOOL: string;
  /** The provider's own tools the agents are offered, where not every tool it lists: the rest are never searched or run. */
  readonly ALLOWED_TOOLS?: readonly string[];
}

export const INTEGRATION = {
  [INTEGRATION_PROVIDER.LINEAR]: {
    CONNECTOR_VARIABLE: "LINEAR_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "LINEAR_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.linear.app/mcp",
    DESCRIPTION:
      "Linear, the developer's issue tracker, as their own account sees it: find, read, create, and update issues, projects, cycles, documents, and comments.",
    REMOTE_TOOL: "linear_remote",
  },
  [INTEGRATION_PROVIDER.NOTION]: {
    CONNECTOR_VARIABLE: "NOTION_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "NOTION_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.notion.com/mcp",
    DESCRIPTION:
      "Notion, the developer's workspace of pages and databases, as their own account sees it: search, read, create, and update pages, databases, and comments.",
    REMOTE_TOOL: "notion_remote",
  },
  [INTEGRATION_PROVIDER.SENTRY]: {
    CONNECTOR_VARIABLE: "SENTRY_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "SENTRY_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.sentry.dev/mcp",
    DESCRIPTION:
      "Sentry, the developer's error and performance monitoring, as their own account sees it: find and read issues, errors, events, traces, logs, and releases, and update issues where the account allows it.",
    REMOTE_TOOL: "sentry_remote",
  },
  /*
   * Slack is read-only: the agents are offered its search and read tools
   * alone, so nothing they do posts, schedules, reacts, or writes a canvas as
   * the developer. A tool Slack adds later is offered only once it is named
   * here.
   */
  [INTEGRATION_PROVIDER.SLACK]: {
    CONNECTOR_VARIABLE: "SLACK_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "SLACK_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.slack.com/mcp",
    DESCRIPTION:
      "Slack, the developer's team chat, as their own account sees it, read-only: search messages, files, channels, and people, and read channels, threads, canvases, and profiles. Nothing can be posted.",
    REMOTE_TOOL: "slack_remote",
    ALLOWED_TOOLS: [
      "slack_search_public",
      "slack_search_public_and_private",
      "slack_search_channels",
      "slack_search_users",
      "slack_read_channel",
      "slack_read_thread",
      "slack_read_canvas",
      "slack_read_user_profile",
    ],
  },
} as const satisfies Record<IntegrationProvider, IntegrationDefinition>;

/** Every integration's name as one phrase an instruction can say: "Linear or Notion". */
export const INTEGRATION_NAMES_SAID = new Intl.ListFormat("en", { type: "disjunction" }).format(
  INTEGRATION_PROVIDER_LIST.map((provider) => INTEGRATION_NAME[provider]),
);
