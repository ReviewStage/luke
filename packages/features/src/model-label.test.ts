import assert from "node:assert/strict";
import { test } from "vitest";
import { CODING_AGENT_KIND } from "./coding-agent-wire.js";
import { agentName } from "./model-label.js";

/**
 * An agent as every place names it, the window's and the service's alike:
 * Luke for an operator, else its title, else the automation whose run
 * started it, whether the wire or the service's own row carries it, else
 * its model's name, never its bare id.
 */

const MODEL = "anthropic/claude-opus-5.5";

test("an operator is Luke, whatever else it holds", () => {
  assert.equal(
    agentName({ kind: CODING_AGENT_KIND.OPERATOR, title: "Desk", model: MODEL }),
    "Luke",
  );
});

test("an untitled agent an automation's run started is named by its automation, as the wire or the row carries it", () => {
  assert.equal(
    agentName({ title: null, model: MODEL, automationName: "Code review" }),
    "Code review",
  );
  assert.equal(
    agentName({ title: null, model: MODEL, automationOrigin: { name: "Code review" } }),
    "Code review",
  );
  assert.equal(
    agentName({ title: "Review #41", model: MODEL, automationOrigin: { name: "Code review" } }),
    "Review #41",
  );
});

test("an untitled agent started by hand is named by its model's name, never its id", () => {
  assert.equal(agentName({ title: null, model: MODEL, automationOrigin: null }), "Opus 5.5");
});
