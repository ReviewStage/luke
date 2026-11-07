import assert from "node:assert/strict";
import { CONNECTION_HEALTH, connectionHealth } from "@repo/features/integration-health";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@repo/features/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationProvider,
  integrationProviderFromWire,
} from "@repo/features/integration-wire";
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
 * its server answered when asked for its tools: its switch where it
 * answered with them, and its reason with Reconnect where it answered
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

test("a connected server whose tools read failed offers Reconnect, saying so in our words and the server's own quoted after them, not its switch", () => {
  const row = slackRow({
    problem: {
      reason: INTEGRATION_TOOLS_PROBLEM.REJECTED,
      message: "App is not enabled for Slack MCP server access",
    },
  });

  assert.equal(row.kind, SERVER_ROW.RECONNECT);
  assert.equal(row.problem, "Slack could not be reached.");
  assert.equal(row.said, "Slack said: “App is not enabled for Slack MCP server access”");
});

test("a server that refused the sign-in says so", () => {
  const row = slackRow({ problem: { reason: INTEGRATION_TOOLS_PROBLEM.REFUSED } });

  assert.equal(row.kind, SERVER_ROW.RECONNECT);
  assert.equal(row.problem, "Slack refused the sign-in.");
});

test("a server that could not be reached keeps its switch and says so, since reconnecting would not mend it", () => {
  const row = slackRow({ problem: { reason: INTEGRATION_TOOLS_PROBLEM.UNREACHABLE } });

  assert.equal(row.kind, SERVER_ROW.SWITCH);
  assert.equal(row.problem, "Slack could not be reached.");
  assert.equal(row.said, undefined);
});

test("a working server keeps its switch and says nothing more", () => {
  const row = slackRow({ tools: [{ name: "slack_read_thread", description: "Read a thread" }] });

  assert.equal(row.kind, SERVER_ROW.SWITCH);
  assert.equal(row.problem, undefined);
});

test("a connection is checked until its server answers, and says its tools could not be read when Vespin could not ask", () => {
  assert.equal(
    connectionHealth(INTEGRATION_PROVIDER.SLACK, undefined).kind,
    CONNECTION_HEALTH.CHECKING,
  );
  const checking = slackRow(undefined);
  const failed = slackRow({ failure: INTEGRATION_CALL_FAILURE.UNANSWERED });

  assert.equal(checking.kind, SERVER_ROW.SWITCH);
  assert.equal(checking.problem, undefined);
  assert.equal(failed.kind, SERVER_ROW.SWITCH, "the agent's switch stays");
  assert.equal(failed.problem, "The tools could not be read.");
});

/** Every offered server's row where each stands as `standing` says, every connected server working. */
function rowsWhere(
  standing: Partial<
    Record<IntegrationProvider, (typeof INTEGRATION_STATUS)[keyof typeof INTEGRATION_STATUS]>
  >,
) {
  return serverRows({
    statusOf: (server) => {
      const provider = integrationProviderFromWire(server);
      return provider === undefined
        ? undefined
        : (standing[provider] ?? INTEGRATION_STATUS.UNAVAILABLE);
    },
    healthOf: (server) =>
      connectionHealth(integrationProviderFromWire(server) ?? INTEGRATION_PROVIDER.GITHUB, {
        tools: [],
      }),
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

test("a search finds servers by name or by what they are for", () => {
  const rows = rowsWhere({
    [INTEGRATION_PROVIDER.LINEAR]: INTEGRATION_STATUS.CONNECTED,
    [INTEGRATION_PROVIDER.NEON]: INTEGRATION_STATUS.DISCONNECTED,
  });

  assert.deepEqual(
    searchServers(rows, "ne").map((row) => row.provider),
    [INTEGRATION_PROVIDER.LINEAR, INTEGRATION_PROVIDER.NEON],
  );
  assert.deepEqual(
    searchServers(rows, "postgres").map((row) => row.provider),
    [INTEGRATION_PROVIDER.NEON],
  );
  assert.equal(searchServers(rows, "  ").length, rows.length);
});

test("switching one server keeps every other one off, an account this window draws no row of among them", () => {
  assert.deepEqual(switchedServers(["linear", "notion-2"], "slack", false), [
    "linear",
    "notion-2",
    "slack",
  ]);
  assert.deepEqual(switchedServers(["linear", "notion-2"], "linear", true), ["notion-2"]);
});
