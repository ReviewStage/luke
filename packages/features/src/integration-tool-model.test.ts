import assert from "node:assert/strict";
import { test } from "vitest";
import type { IntegrationTool } from "./integration-health.js";
import {
  byName,
  requiredFirst,
  TOOL_BADGE,
  TOOL_HINT,
  toolBadge,
  toolHints,
  toolHintWords,
  toolSummary,
  toolTitle,
} from "./integration-tool-model.js";

/**
 * How a list of an integration's tools orders, names, and badges them: one
 * alphabetical list, each called by its title where its server gave one,
 * its row reading the first sentence of what it does, and a badge only
 * where the server's own annotations earn one, never from a tool's name;
 * and what a tool's page says of its server's hints, each only where the
 * server sent it, and of its parameters, the required first.
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

test("a tool's page says each hint its server sent, a write's only of a tool not marked read-only, and none it did not send", () => {
  assert.deepEqual(toolHints(undefined), []);
  assert.deepEqual(toolHints({}), []);
  assert.deepEqual(toolHints({ readOnlyHint: true, destructiveHint: true, idempotentHint: true }), [
    TOOL_HINT.READ_ONLY,
  ]);
  assert.deepEqual(
    toolHints({ destructiveHint: true, idempotentHint: true, openWorldHint: false }),
    [TOOL_HINT.DESTRUCTIVE, TOOL_HINT.IDEMPOTENT, TOOL_HINT.CLOSED_WORLD],
  );
  assert.deepEqual(toolHints({ readOnlyHint: false, destructiveHint: false }), [
    TOOL_HINT.ADDITIVE,
  ]);
  // Note that a write the server never said is additive is not called so, whatever the spec's defaults.
  assert.deepEqual(toolHints({ destructiveHint: false }), []);
  assert.deepEqual(toolHints({ readOnlyHint: false }), []);
  assert.deepEqual(toolHints({ readOnlyHint: true, openWorldHint: true }), [
    TOOL_HINT.READ_ONLY,
    TOOL_HINT.OPEN_WORLD,
  ]);
});

test("a hint is worded in the integration's name where it names how far the tool reaches", () => {
  assert.deepEqual(
    Object.values(TOOL_HINT).map((hint) => toolHintWords(hint, "PostHog")),
    [
      "Read-only",
      "Destructive",
      "Only adds, never deletes",
      "Safe to retry",
      "Reaches outside PostHog",
      "Only PostHog's own data",
    ],
  );
});

test("a tool is called by its title, else by its name where the title is missing or blank", () => {
  assert.equal(toolTitle({ name: "run_sql", title: "Run SQL" }), "Run SQL");
  assert.equal(toolTitle({ name: "run_sql", title: "  " }), "run_sql");
  assert.equal(toolTitle({ name: "run_sql" }), "run_sql");
});

test("a row reads the first sentence of a description's first paragraph of words, its marks taken off", () => {
  assert.equal(
    toolSummary("Run a **HogQL** query on `events`. Then return the rows.\n\nMore."),
    "Run a HogQL query on events.",
  );
  assert.equal(
    toolSummary(
      "## When to use\n\n- a list\n\n```sql\nSELECT 1\n```\n\nSee [the docs](https://x.test) first!",
    ),
    "See the docs first!",
  );
  assert.equal(toolSummary("## Usage\nReads projects. Then more."), "Reads projects.");
  assert.equal(toolSummary("1) First step\n> A quote\nReads projects."), "Reads projects.");
  assert.equal(toolSummary("---\n\nLists issues. More."), "Lists issues.");
  assert.equal(toolSummary("* * *\nLists issues."), "Lists issues.");
  assert.equal(toolSummary("Lists projects"), "Lists projects");
  assert.equal(
    toolSummary("Version 2.1 of the API, then\nmore"),
    "Version 2.1 of the API, then more",
  );
  assert.equal(toolSummary(""), "");
});

test("a tool's parameters stand with the required first, each half in its server's order", () => {
  const parameter = (name: string, required: boolean) => ({ name, type: "string", required });
  assert.deepEqual(
    requiredFirst([
      parameter("cursor", false),
      parameter("team", true),
      parameter("limit", false),
      parameter("query", true),
    ]).map((each) => each.name),
    ["team", "query", "cursor", "limit"],
  );
});
