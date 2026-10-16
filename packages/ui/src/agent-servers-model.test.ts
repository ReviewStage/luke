import assert from "node:assert/strict";
import { CONNECTION_HEALTH, connectionHealth } from "@luke/features/integration-health";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@luke/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationProvider,
  integrationProviderFromWire,
} from "@luke/features/integration-wire";
import { test } from "vitest";
import {
  SERVER_ROW,
  SERVER_SECTION,
  searchServers,
  serverGroups,
  serverRows,
  switchedServers,
} from "./agent-servers-model.js";

/**
 * What the MCP servers popover draws of a connected integration, from what
 * its server answered when asked for its tools: its switch and tools where
 * it answered with them, and its reason with Reconnect where it answered
 * why not, so a grant the server will not take never reads as working;
 * which section each server stands under; and what a search finds.
 */

/** Slack's row, connected, with its server's tools read answering `read`. */
function slackRow(read: IntegrationToolsView | undefined) {
  const rows = serverRows({
    statusOf: (server: string) =>
      server === INTEGRATION_PROVIDER.SLACK
        ? INTEGRATION_STATUS.CONNECTED
        : INTEGRATION_STATUS.DISCONNECTED,
    healthOf: (server) =>
      connectionHealth(
        integrationProviderFromWire(server) ?? INTEGRATION_PROVIDER.GITHUB,
        server === INTEGRATION_PROVIDER.SLACK ? read : undefined,
      ),
    signInOf: () => undefined,
    readFailed: false,
    disabled: [],
  });
  const row = rows.find((each) => each.provider === INTEGRATION_PROVIDER.SLACK);
  assert.ok(row !== undefined);
  return row;
}

test("a connected server whose tools read failed offers Reconnect with the server's reason, not its switch", () => {
  const row = slackRow({
    problem: {
      reason: INTEGRATION_TOOLS_PROBLEM.REJECTED,
      message: "App is not enabled for Slack MCP server access",
    },
  });

  assert.equal(row.kind, SERVER_ROW.RECONNECT);
  assert.equal(row.problem, "Can't reach Slack: App is not enabled for Slack MCP server access");
  assert.equal(row.tools, undefined);
});

test("a server that refused the sign-in says so", () => {
  const row = slackRow({ problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED } });

  assert.equal(row.kind, SERVER_ROW.RECONNECT);
  assert.equal(row.problem, "Slack refused the sign-in.");
});

test("a server that could not be reached keeps its switch and says so, since reconnecting would not mend it", () => {
  const row = slackRow({ problem: { reason: INTEGRATION_TOOLS_PROBLEM.UNREACHABLE } });

  assert.equal(row.kind, SERVER_ROW.SWITCH);
  assert.equal(row.problem, "Can't reach Slack.");
  assert.equal(row.tools, undefined);
});

test("a working server keeps its switch and the tools it listed", () => {
  const tools = [
    { name: "slack_search_public", description: "Search public channels" },
    { name: "slack_read_thread", description: "Read a thread" },
  ];
  const row = slackRow({ tools });

  assert.equal(row.kind, SERVER_ROW.SWITCH);
  assert.deepEqual(row.tools, tools);
  assert.equal(row.problem, undefined);
});

test("a connection is checked until its server answers, and stands as the service says when Luke could not ask", () => {
  assert.equal(
    connectionHealth(INTEGRATION_PROVIDER.SLACK, undefined).kind,
    CONNECTION_HEALTH.CHECKING,
  );
  assert.equal(slackRow(undefined).kind, SERVER_ROW.SWITCH);
  assert.equal(slackRow({ failure: INTEGRATION_CALL_FAILURE.UNANSWERED }).kind, SERVER_ROW.SWITCH);
});

/** Every offered server's row where each stands as `standing` says, Linear's server answering `tools`. */
function rowsWhere(
  standing: Partial<
    Record<IntegrationProvider, (typeof INTEGRATION_STATUS)[keyof typeof INTEGRATION_STATUS]>
  >,
  tools: IntegrationToolsView = { tools: [] },
) {
  return serverRows({
    statusOf: (server) => {
      const provider = integrationProviderFromWire(server);
      return provider === undefined
        ? undefined
        : (standing[provider] ?? INTEGRATION_STATUS.UNAVAILABLE);
    },
    healthOf: (server) =>
      connectionHealth(
        integrationProviderFromWire(server) ?? INTEGRATION_PROVIDER.GITHUB,
        server === INTEGRATION_PROVIDER.LINEAR ? tools : { tools: [] },
      ),
    signInOf: () => undefined,
    readFailed: false,
    disabled: [],
  });
}

test("connected servers stand under Connected and the rest under Not connected, a lapsed one among the connected", () => {
  const groups = serverGroups(
    rowsWhere({
      [INTEGRATION_PROVIDER.VERCEL]: INTEGRATION_STATUS.CONNECTED,
      [INTEGRATION_PROVIDER.MERCURY]: INTEGRATION_STATUS.DISCONNECTED,
      [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_STATUS.CONNECTED,
      [INTEGRATION_PROVIDER.SLACK]: INTEGRATION_STATUS.EXPIRED,
      [INTEGRATION_PROVIDER.NEON]: INTEGRATION_STATUS.PENDING,
    }),
  );

  assert.deepEqual(
    groups.map((group) => [group.heading, group.rows.map((row) => row.provider)]),
    [
      [
        SERVER_SECTION.CONNECTED,
        [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.SLACK, INTEGRATION_PROVIDER.VERCEL],
      ],
      [SERVER_SECTION.NOT_CONNECTED, [INTEGRATION_PROVIDER.MERCURY, INTEGRATION_PROVIDER.NEON]],
    ],
  );
});

test("servers whose standing is unread stand first under no heading", () => {
  const groups = serverGroups(
    serverRows({
      statusOf: () => undefined,
      healthOf: () => ({ kind: CONNECTION_HEALTH.CHECKING }),
      signInOf: () => undefined,
      readFailed: false,
      disabled: [],
    }),
  );

  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.heading, undefined);
});

test("a search finds servers by name or what they are for and any connected server's tools by name or description, alphabetically", () => {
  const rows = rowsWhere(
    {
      [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_STATUS.CONNECTED,
      [INTEGRATION_PROVIDER.NEON]: INTEGRATION_STATUS.DISCONNECTED,
    },
    {
      tools: [
        { name: "save_issue", description: "Creates or updates an issue." },
        { name: "list_projects", description: "Lists projects." },
        { name: "get_issue", description: "Gets one issue." },
      ],
    },
  );

  const byTool = searchServers(rows, "Issue");
  assert.deepEqual(
    byTool.rows.map((row) => row.provider),
    [INTEGRATION_PROVIDER.LINEAR],
  );
  assert.deepEqual(
    byTool.tools.map((hit) => [hit.row.provider, hit.tool.name]),
    [
      [INTEGRATION_PROVIDER.LINEAR, "get_issue"],
      [INTEGRATION_PROVIDER.LINEAR, "save_issue"],
    ],
  );

  const byName = searchServers(rows, "ne");
  assert.deepEqual(
    byName.rows.map((row) => row.provider),
    [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.NEON],
  );
  assert.deepEqual(searchServers(rows, "  ").tools, []);
});

test("a search finds a server by what it is for, and a word naming a server counts toward its tools, as Settings › Integrations' filter does", () => {
  const rows = rowsWhere(
    {
      [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_STATUS.CONNECTED,
      [INTEGRATION_PROVIDER.NEON]: INTEGRATION_STATUS.DISCONNECTED,
    },
    {
      tools: [
        { name: "save_issue", description: "Creates or updates an issue." },
        { name: "get_issue", description: "Gets one issue." },
      ],
    },
  );

  assert.deepEqual(
    searchServers(rows, "postgres").rows.map((row) => row.provider),
    [INTEGRATION_PROVIDER.NEON],
  );
  assert.deepEqual(
    searchServers(rows, "linear get").tools.map((hit) => hit.tool.name),
    ["get_issue"],
  );
});

test("a search finds a tool by the title its server gave it", () => {
  const rows = rowsWhere(
    { [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_STATUS.CONNECTED },
    {
      tools: [
        { name: "save_issue", title: "Write ticket", description: "Creates or updates an issue." },
        { name: "list_issues", description: "Lists issues." },
      ],
    },
  );

  assert.deepEqual(
    searchServers(rows, "ticket").tools.map((hit) => hit.tool.name),
    ["save_issue"],
  );
});

test("switching one server keeps every other one off, an account this window draws no row of among them", () => {
  assert.deepEqual(switchedServers(["linear", "notion-2"], "slack", false), [
    "linear",
    "notion-2",
    "slack",
  ]);
  assert.deepEqual(switchedServers(["linear", "notion-2"], "linear", true), ["notion-2"]);
});
