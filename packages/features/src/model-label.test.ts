import assert from "node:assert/strict";
import { test } from "vitest";
import { agentName } from "./model-label.js";

const MODEL = "anthropic/claude-opus-5.5";

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
