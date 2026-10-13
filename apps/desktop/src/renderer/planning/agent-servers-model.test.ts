import assert from "node:assert/strict";
import {
  INTEGRATION_CALL_FAILURE,
  type IntegrationToolsView,
} from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  INTEGRATION_TOOLS_PROBLEM,
  type IntegrationProvider,
} from "@sidecar/hosted/integration-wire";
import { test } from "vitest";
import { CONNECTION_HEALTH, connectionHealth } from "../integration-health";
import { SERVER_ROW, serverRows } from "./agent-servers-model";

/**
 * What the MCP servers popover draws of a connected integration, from what
 * its server answered when asked for its tools: its switch and tools where
 * it answered with them, and its reason with Reconnect where it answered
 * why not, so a grant the server will not take never reads as working.
 */

/** Slack's row, connected, with its server's tools read answering `read`. */
function slackRow(read: IntegrationToolsView | undefined) {
  const rows = serverRows({
    statusOf: (provider: IntegrationProvider) =>
      provider === INTEGRATION_PROVIDER.SLACK
        ? INTEGRATION_STATUS.CONNECTED
        : INTEGRATION_STATUS.DISCONNECTED,
    healthOf: (provider) =>
      connectionHealth(provider, provider === INTEGRATION_PROVIDER.SLACK ? read : undefined),
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
