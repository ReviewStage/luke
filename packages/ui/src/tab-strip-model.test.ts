import assert from "node:assert/strict";
import { test } from "vitest";
import { followedAgent } from "./tab-strip-model.js";

/**
 * tab-strip-model.test.ts -- the agent whose tab follows its run is the one
 * the plan's column shows while the column is on screen, and nobody while a
 * panel fills the window over it, the plan's page is not shown, or another
 * tab is. Synthetic ids.
 */

test("an agent's tab follows its run only while the plan's column shows it on screen", () => {
  const agent = { agent: "agent-1" };
  assert.equal(followedAgent(agent, { shown: true, covered: false }), "agent-1");
  assert.equal(
    followedAgent(agent, { shown: true, covered: true }),
    undefined,
    "a panel fills the window",
  );
  assert.equal(
    followedAgent(agent, { shown: false, covered: false }),
    undefined,
    "the plan's page is not shown",
  );
  assert.equal(
    followedAgent({ changes: "agent-1" }, { shown: true, covered: false }),
    undefined,
    "another tab is shown",
  );
});
