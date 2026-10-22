import assert from "node:assert/strict";
import { test } from "vitest";
import { followedAgent, stampedViewed } from "./tab-strip-model.js";

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

test("a tab standing in its strip keeps its stamp past the bound, so stamping the strip again changes nothing and the tab still grows old", () => {
  const strip = Array.from({ length: 51 }, (_, at) => ({ file: `file-${at}` }));
  const gone = { file: "closed-elsewhere" };
  const first = stampedViewed([{ tab: gone, at: 0 }], [], strip, 1, 50);
  assert.deepEqual(
    first,
    strip.map((tab) => ({ tab, at: 1 })),
    "every standing tab is stamped, and only the tab no longer standing is let go",
  );
  assert.equal(stampedViewed(first ?? [], [], strip, 2, 50), undefined);
});
