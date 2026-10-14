import assert from "node:assert/strict";
import { test } from "vitest";
import type { IntegrationTool } from "../integration-health";
import { TOOL_BADGE, toolBadge, toolGroups } from "./server-tools-model";

/**
 * How a server's page lists its tools: runs under the prefixes the names
 * clearly share, else one alphabetical list; and a badge only where the
 * server's own annotations earn one, never from a tool's name.
 */

/** Tools named `names`, each described as itself. */
function named(...names: string[]): IntegrationTool[] {
  return names.map((name) => ({ name, description: name }));
}

/** Each run's heading and its tools' names. */
function runsOf(tools: readonly IntegrationTool[]) {
  return toolGroups(tools).map((run) => [run.prefix, run.tools.map((tool) => tool.name)]);
}

test("namespaced names run under their namespaces, in order, each run alphabetical", () => {
  const runs = runsOf(
    named(
      "jobs.update",
      "hiring.list_candidates",
      "jobs.list",
      "hiring.get_candidate",
      "hiring.advance",
      "jobs.close",
      "company.get",
      "company.update",
      "jobs.create",
      "hiring.reject",
    ),
  );

  assert.deepEqual(runs, [
    ["company.", ["company.get", "company.update"]],
    [
      "hiring.",
      ["hiring.advance", "hiring.get_candidate", "hiring.list_candidates", "hiring.reject"],
    ],
    ["jobs.", ["jobs.close", "jobs.create", "jobs.list", "jobs.update"]],
  ]);
});

test("a prefix every name shares is cut, and the runs follow it, a lone name kept under none", () => {
  const runs = runsOf(
    named(
      "slack_search_messages",
      "slack_search_users",
      "slack_search_channels",
      "slack_read_channel",
      "slack_read_thread",
      "slack_read_canvas",
      "slack_send_message",
      "slack_send_draft",
      "slack_schedule_message",
      "slack_create_canvas",
      "slack_create_reminder",
    ),
  );

  assert.deepEqual(runs, [
    ["slack_create_", ["slack_create_canvas", "slack_create_reminder"]],
    ["slack_read_", ["slack_read_canvas", "slack_read_channel", "slack_read_thread"]],
    ["slack_search_", ["slack_search_channels", "slack_search_messages", "slack_search_users"]],
    ["slack_send_", ["slack_send_draft", "slack_send_message"]],
    [undefined, ["slack_schedule_message"]],
  ]);
});

test("names that share no clear prefixes are one alphabetical list", () => {
  const runs = runsOf(
    named(
      "search_errors",
      "find_projects",
      "analyze_issue_with_seer",
      "update_issue",
      "get_sentry_resource",
      "search_issues",
      "find_organizations",
      "execute_sentry_tool",
      "search_logs",
      "whoami",
    ),
  );

  assert.deepEqual(runs, [
    [
      undefined,
      [
        "analyze_issue_with_seer",
        "execute_sentry_tool",
        "find_organizations",
        "find_projects",
        "get_sentry_resource",
        "search_errors",
        "search_issues",
        "search_logs",
        "update_issue",
        "whoami",
      ],
    ],
  ]);
});

test("a short list stays one list even where its names share prefixes", () => {
  const runs = runsOf(named("get_meeting", "get_meetings", "list_meetings", "list_folders"));

  assert.deepEqual(runs, [
    [undefined, ["get_meeting", "get_meetings", "list_folders", "list_meetings"]],
  ]);
});

test("a tool's badge is what its server's annotations say, and nothing where they say nothing", () => {
  assert.equal(toolBadge({ readOnlyHint: true }), TOOL_BADGE.READ_ONLY);
  assert.equal(toolBadge({ readOnlyHint: false, destructiveHint: true }), TOOL_BADGE.DESTRUCTIVE);
  assert.equal(toolBadge({ destructiveHint: true }), TOOL_BADGE.DESTRUCTIVE);
  assert.equal(toolBadge({ readOnlyHint: true, destructiveHint: true }), TOOL_BADGE.READ_ONLY);
  assert.equal(toolBadge({ readOnlyHint: false, destructiveHint: false }), undefined);
  assert.equal(toolBadge({ idempotentHint: true, openWorldHint: false }), undefined);
  assert.equal(toolBadge(undefined), undefined);
});
