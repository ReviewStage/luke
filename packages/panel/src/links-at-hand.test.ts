import assert from "node:assert/strict";
import { LINK_PLACE } from "@luke/features/link-grammar";
import { test } from "vitest";
import { panelTabPlace } from "./links-at-hand.js";

/**
 * The links a side panel's tabs are copied by. Synthetic ids.
 */

const AGENT = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

test("an agent's Changes tab is linked as its Changes, and one on another pull request by its number is linked as nothing", () => {
  assert.deepEqual(panelTabPlace({ agentId: AGENT }, { changes: AGENT }), {
    kind: LINK_PLACE.CHANGES,
    agentId: AGENT,
  });
  assert.equal(panelTabPlace({ agentId: AGENT }, { changes: AGENT, number: 34 }), undefined);
});
