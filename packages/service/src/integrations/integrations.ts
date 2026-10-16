/**
 * integrations.ts -- every integration this deployment can offer, as one table.
 *
 * An integration is a provider's own hosted MCP server, reached with a grant
 * Vercel Connect holds for the account under one connector of this
 * deployment's, or, for GitHub, with the account's own GitHub sign-in
 * (`INTEGRATION_GRANT_OF`, `github-integration.ts`). The table, beside the
 * names the wire gives it (`@luke/features/integration-wire`, the name a
 * nested call of one of its tools is stored under among them), is the whole
 * of what makes a provider one: the variable its connector's UID is read
 * from and the one naming the accounts it is offered to
 * (`integration-connect.ts`) and the one that holds it to one account, the
 * server every agent's connection is opened to and what the model is told of
 * it (`integration-connection.ts`). Its routes,
 * its row, and its landing page are the same for every provider. Every tool
 * a provider's server lists is offered, the ones that write and the ones
 * that answer a credential among them (`AGENTS.md`'s carve-out for
 * integrations).
 */

import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  type IntegrationProvider,
} from "@luke/features/integration-wire";

export interface IntegrationDefinition {
  /**
   * The variable the connector's UID is read from, as `vercel connect create`
   * printed it; absent for a provider granted by the account's own sign-in,
   * which has no connector.
   */
  readonly CONNECTOR_VARIABLE?: string;
  /**
   * The variable naming the accounts the integration is offered to, comma
   * separated: `@domain.com` for every email at that domain, or one exact
   * email. Unset, the integration is offered to every account; absent, as
   * the connector's is.
   */
  readonly ALLOWED_ACCOUNTS_VARIABLE?: string;
  /**
   * The variable that holds the provider to one account per Luke account,
   * set to `off`, `false`, or `0`; present only for a provider that offers
   * more than one by default, whose grant at the provider is one workspace's
   * or one organization's, so a second account reaches what the first does
   * not. Unset, the provider offers more than one; a provider with no such
   * variable offers one. It is what switches a provider back off at once
   * where a second grant turns out to cost the first (a provider that keeps
   * one grant per user and client).
   */
  readonly MULTIPLE_ACCOUNTS_VARIABLE?: string;
  /** The OAuth `prompt` a sign-in for another account asks the provider for, where the provider documents one that shows its workspace picker. */
  readonly ADD_ACCOUNT_PROMPT?: string;
  /** The provider's own hosted MCP server. */
  readonly MCP_URL: string;
  /** What the model is told of the connection, so it can choose which one to search. */
  readonly DESCRIPTION: string;
}

export const INTEGRATION = {
  /*
   * Executor's server fronts every app the developer set up in Executor
   * behind a few fixed tools (`skills`, `search`, `describe`, `call`,
   * `execute`, `resume`) and attaches each app's credential itself. Its
   * plain `/mcp` is its default `model` elicitation mode, which answers a
   * call an app's policy holds for approval as a tool result for the agent
   * to put to the developer and `resume`, where `native` would ask over an
   * MCP elicitation that eve's client never answers
   * (https://executor.sh/docs/mcp, "Elicitation modes").
   */
  [INTEGRATION_PROVIDER.EXECUTOR]: {
    CONNECTOR_VARIABLE: "EXECUTOR_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "EXECUTOR_ALLOWED_ACCOUNTS",
    MULTIPLE_ACCOUNTS_VARIABLE: "EXECUTOR_MULTIPLE_ACCOUNTS",
    MCP_URL: "https://mcp.executor.sh/mcp",
    DESCRIPTION:
      "Executor, the developer's gateway to the apps they set up in it (MCP servers, OpenAPI and GraphQL APIs, skills, and automations), as their own account sees it: read the apps' skills, search and describe their tools, and call them or run a script over them, writes included. A call that pauses for an approval or for input answers with a request id: put the question to the developer, and resume it only with their answer.",
  },
  /*
   * GitHub's server takes the GitHub App user token the account's own
   * sign-in holds, so it has no connector; `/x/all` is the server with
   * every toolset on rather than its default few.
   */
  [INTEGRATION_PROVIDER.GITHUB]: {
    MCP_URL: "https://api.githubcopilot.com/mcp/x/all",
    DESCRIPTION:
      "GitHub, the developer's code host, as their own account sees it through the Luke GitHub App: find, read, create, and update repositories, files, branches, issues, pull requests and their reviews, discussions, Actions runs and their logs, and code search, on the repositories the App is installed on.",
  },
  [INTEGRATION_PROVIDER.GRANOLA]: {
    CONNECTOR_VARIABLE: "GRANOLA_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "GRANOLA_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.granola.ai/mcp",
    DESCRIPTION:
      "Granola, the developer's meeting notes, as their own account sees it: search and read meetings, their notes, transcripts, attachments, and folders.",
  },
  [INTEGRATION_PROVIDER.LINEAR]: {
    CONNECTOR_VARIABLE: "LINEAR_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "LINEAR_ALLOWED_ACCOUNTS",
    MULTIPLE_ACCOUNTS_VARIABLE: "LINEAR_MULTIPLE_ACCOUNTS",
    // Linear's own OAuth guide: `prompt=consent` "to connect multiple workspaces".
    ADD_ACCOUNT_PROMPT: "consent",
    MCP_URL: "https://mcp.linear.app/mcp",
    DESCRIPTION:
      "Linear, the developer's issue tracker, as their own account sees it: find, read, create, and update issues, projects, cycles, documents, and comments.",
  },
  [INTEGRATION_PROVIDER.MERCURY]: {
    CONNECTOR_VARIABLE: "MERCURY_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "MERCURY_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.mercury.com/mcp",
    DESCRIPTION:
      "Mercury, the developer's company banking, as their own account sees it: read accounts, balances, transactions, cards, recipients, invoices, and treasury, categorize and annotate transactions, and request payments and transfers, which an approver confirms in Mercury.",
  },
  [INTEGRATION_PROVIDER.NEON]: {
    CONNECTOR_VARIABLE: "NEON_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "NEON_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.neon.tech/mcp",
    DESCRIPTION:
      "Neon, the developer's serverless Postgres, as their own account sees it: find and manage projects, branches, databases, roles, and computes, read schemas, run SQL, and prepare and apply migrations.",
  },
  [INTEGRATION_PROVIDER.NOTION]: {
    CONNECTOR_VARIABLE: "NOTION_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "NOTION_ALLOWED_ACCOUNTS",
    MULTIPLE_ACCOUNTS_VARIABLE: "NOTION_MULTIPLE_ACCOUNTS",
    MCP_URL: "https://mcp.notion.com/mcp",
    DESCRIPTION:
      "Notion, the developer's workspace of pages and databases, as their own account sees it: search, read, create, and update pages, databases, and comments.",
  },
  /*
   * PostHog's server picks its mode by the client it sees, and most get its
   * one `exec` tool; `mode=tools` lists every tool by its own name, writes
   * included, as every other server here does
   * (https://posthog.com/docs/model-context-protocol/faq).
   */
  [INTEGRATION_PROVIDER.POSTHOG]: {
    CONNECTOR_VARIABLE: "POSTHOG_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "POSTHOG_ALLOWED_ACCOUNTS",
    MULTIPLE_ACCOUNTS_VARIABLE: "POSTHOG_MULTIPLE_ACCOUNTS",
    MCP_URL: "https://mcp.posthog.com/mcp?mode=tools",
    DESCRIPTION:
      "PostHog, the developer's product analytics, as their own account sees it: query events and insights with SQL, and read and change dashboards, feature flags, experiments, surveys, error tracking, and session recordings.",
  },
  [INTEGRATION_PROVIDER.SENTRY]: {
    CONNECTOR_VARIABLE: "SENTRY_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "SENTRY_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.sentry.dev/mcp",
    DESCRIPTION:
      "Sentry, the developer's error and performance monitoring, as their own account sees it: find and read issues, errors, events, traces, logs, and releases, and update issues where the account allows it.",
  },
  [INTEGRATION_PROVIDER.SLACK]: {
    CONNECTOR_VARIABLE: "SLACK_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "SLACK_ALLOWED_ACCOUNTS",
    MULTIPLE_ACCOUNTS_VARIABLE: "SLACK_MULTIPLE_ACCOUNTS",
    MCP_URL: "https://mcp.slack.com/mcp",
    DESCRIPTION:
      "Slack, the developer's team chat, as their own account sees it: search messages, files, channels, and people, read channels, threads, canvases, and profiles, and send and schedule messages, react, and write canvases as the developer.",
  },
  [INTEGRATION_PROVIDER.SUPABASE]: {
    CONNECTOR_VARIABLE: "SUPABASE_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "SUPABASE_ALLOWED_ACCOUNTS",
    MULTIPLE_ACCOUNTS_VARIABLE: "SUPABASE_MULTIPLE_ACCOUNTS",
    MCP_URL: "https://mcp.supabase.com/mcp",
    DESCRIPTION:
      "Supabase, the developer's Postgres backend, as their own account sees it: find and manage projects and branches, read schemas, run SQL, apply migrations, read logs, and deploy edge functions.",
  },
  [INTEGRATION_PROVIDER.VERCEL]: {
    CONNECTOR_VARIABLE: "VERCEL_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "VERCEL_ALLOWED_ACCOUNTS",
    MCP_URL: "https://mcp.vercel.com",
    DESCRIPTION:
      "Vercel, the developer's hosting, as their own account sees it: find and manage teams, projects, deployments, domains, and environment variables, read build and runtime logs and errors, and search Vercel's documentation.",
  },
  [INTEGRATION_PROVIDER.YCOMBINATOR]: {
    CONNECTOR_VARIABLE: "YCOMBINATOR_CONNECTOR_UID",
    ALLOWED_ACCOUNTS_VARIABLE: "YCOMBINATOR_ALLOWED_ACCOUNTS",
    MCP_URL: "https://api.ycombinator.com/v1/mcp",
    DESCRIPTION:
      "Y Combinator's Bookface, as the developer's own YC account sees it: search YC companies, founders, investors, forum posts, launches, and the startup library, and work with the company's hiring, fundraising, launches, office hours, and profile.",
  },
} as const satisfies Record<IntegrationProvider, IntegrationDefinition>;

/** Every integration's name as one phrase an instruction can say: "Linear or Notion". */
export const INTEGRATION_NAMES_SAID = new Intl.ListFormat("en", { type: "disjunction" }).format(
  INTEGRATION_PROVIDER_LIST.map((provider) => INTEGRATION_NAME[provider]),
);
