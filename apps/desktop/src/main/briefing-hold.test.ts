import assert from "node:assert/strict";
import test from "node:test";
import { BRAIN_DELIVERY_SOURCE, type BrainDelivery } from "@sidecar/brain";
import { BriefingHold, MAXIMUM_HELD_BRIEFINGS } from "./briefing-hold";

function delivery(briefing: string): BrainDelivery {
  return { briefing, decidedAt: 1, source: BRAIN_DELIVERY_SOURCE.WAKE };
}

test("a hold keeps the most recent briefings and hands them back once", () => {
  const hold = new BriefingHold();
  for (let index = 0; index < MAXIMUM_HELD_BRIEFINGS + 2; index += 1) {
    hold.hold(delivery(`briefing ${index}`));
  }

  assert.equal(hold.count, MAXIMUM_HELD_BRIEFINGS);
  const released = hold.release();
  assert.equal(released.length, MAXIMUM_HELD_BRIEFINGS);
  // The oldest go first: a backlog re-decided in one turn wants the recent few.
  assert.equal(released[0]?.briefing, "briefing 2");
  assert.equal(released.at(-1)?.briefing, `briefing ${MAXIMUM_HELD_BRIEFINGS + 1}`);
  assert.equal(hold.count, 0);
  assert.deepEqual(hold.release(), []);
});
