import assert from "node:assert/strict";
import { test } from "vitest";
import type { IntegrationTool } from "./integration-health";
import { byName, TOOL_BADGE, toolBadge } from "./integration-tool-model";

/**
 * How a list of an integration's tools orders them and badges each: one
 * alphabetical list, and a badge only where the server's own annotations
 * earn one, never from a tool's name.
 */

/** Tools named `names`, each described as itself. */
function named(...names: string[]): IntegrationTool[] {
  return names.map((name) => ({ name, description: name }));
}

test("tools are one alphabetical list, whatever prefixes their names share", () => {
  const sorted = byName(
    named("slack_send_message", "hiring.list", "slack_search_users", "deploy", "hiring.advance"),
  );

  assert.deepEqual(
    sorted.map((tool) => tool.name),
    ["deploy", "hiring.advance", "hiring.list", "slack_search_users", "slack_send_message"],
  );
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
