import assert from "node:assert/strict";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";
import type { McpClientConnectionDefinition } from "eve/connections";
import { test } from "vitest";
import coderLinear from "../coder/connections/linear";
import coderNotion from "../coder/connections/notion";
import coderSentry from "../coder/connections/sentry";
import coderSlack from "../coder/connections/slack";
import coderWorkerLinear from "../coder/subagents/worker/connections/linear";
import coderWorkerNotion from "../coder/subagents/worker/connections/notion";
import coderWorkerSentry from "../coder/subagents/worker/connections/sentry";
import coderWorkerSlack from "../coder/subagents/worker/connections/slack";
import planningLinear from "../eve/connections/linear";
import planningNotion from "../eve/connections/notion";
import planningSentry from "../eve/connections/sentry";
import planningSlack from "../eve/connections/slack";
import planningWorkerLinear from "../eve/subagents/worker/connections/linear";
import planningWorkerNotion from "../eve/subagents/worker/connections/notion";
import planningWorkerSentry from "../eve/subagents/worker/connections/sentry";
import planningWorkerSlack from "../eve/subagents/worker/connections/slack";
import type { switchableConnection } from "../server/hosted/coder-host/servers";
import { INTEGRATION, type IntegrationDefinition } from "../server/hosted/integrations";

/**
 * Each of the four agents registers every integration's one connection under
 * its own ownership check, since eve hands a declared worker none of its
 * parent's: the planning model, the planning worker, the coding agent, and
 * the coding agent's worker. Which check each runs under is the token read's
 * to show (`integration-connection.test.ts`); this holds that each planning
 * agent registers the provider's own server, every tool on it or the ones its
 * entry allows, and a credential resolved per session, and that each coding agent resolves its
 * connection as each turn starts, since the developer may switch a server off
 * for one agent between turns (`coder-servers.test.ts` holds what the
 * resolution hands a turn).
 */

const PLANNING: readonly (readonly [string, IntegrationProvider, McpClientConnectionDefinition])[] =
  [
    ["planning", INTEGRATION_PROVIDER.LINEAR, planningLinear],
    ["planning worker", INTEGRATION_PROVIDER.LINEAR, planningWorkerLinear],
    ["planning", INTEGRATION_PROVIDER.NOTION, planningNotion],
    ["planning worker", INTEGRATION_PROVIDER.NOTION, planningWorkerNotion],
    ["planning", INTEGRATION_PROVIDER.SENTRY, planningSentry],
    ["planning worker", INTEGRATION_PROVIDER.SENTRY, planningWorkerSentry],
    ["planning", INTEGRATION_PROVIDER.SLACK, planningSlack],
    ["planning worker", INTEGRATION_PROVIDER.SLACK, planningWorkerSlack],
  ];

const CODING: readonly (readonly [
  string,
  IntegrationProvider,
  ReturnType<typeof switchableConnection>,
])[] = [
  ["coding agent", INTEGRATION_PROVIDER.LINEAR, coderLinear],
  ["coding agent's worker", INTEGRATION_PROVIDER.LINEAR, coderWorkerLinear],
  ["coding agent", INTEGRATION_PROVIDER.NOTION, coderNotion],
  ["coding agent's worker", INTEGRATION_PROVIDER.NOTION, coderWorkerNotion],
  ["coding agent", INTEGRATION_PROVIDER.SENTRY, coderSentry],
  ["coding agent's worker", INTEGRATION_PROVIDER.SENTRY, coderWorkerSentry],
  ["coding agent", INTEGRATION_PROVIDER.SLACK, coderSlack],
  ["coding agent's worker", INTEGRATION_PROVIDER.SLACK, coderWorkerSlack],
];

test.for(PLANNING)(
  "the %s registers %s's own server, credentialed per session",
  ([, provider, definition]) => {
    const integration: IntegrationDefinition = INTEGRATION[provider];
    assert.equal(definition.url, integration.MCP_URL);
    assert.equal(definition.description, integration.DESCRIPTION);
    assert.deepEqual(
      definition.tools,
      integration.ALLOWED_TOOLS === undefined ? undefined : { allow: integration.ALLOWED_TOOLS },
    );
    assert.equal(definition.approval, undefined);
    assert.ok(definition.auth instanceof Function);
  },
);

test.for(CODING)("the %s resolves its %s connection as each turn starts", ([, , registered]) => {
  assert.ok(registered.events["turn.started"] instanceof Function);
});

test("Slack is offered its search and read tools alone, so no agent can post, schedule, react, or write a canvas", () => {
  const allowed: readonly string[] = INTEGRATION[INTEGRATION_PROVIDER.SLACK].ALLOWED_TOOLS;
  for (const write of [
    "slack_send_message",
    "slack_send_message_draft",
    "slack_schedule_message",
    "slack_create_canvas",
    "slack_update_canvas",
    "slack_add_reaction",
  ]) {
    assert.ok(!allowed.includes(write), write);
  }
  for (const name of allowed) assert.match(name, /^slack_(search|read)_/);
});
