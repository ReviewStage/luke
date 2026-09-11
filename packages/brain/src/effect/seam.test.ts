import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { AgentSeam } from "../seam.js";
import { AgentSeamTag, agentSeamLayer } from "./seam.js";

const fakeSeam: AgentSeam = {
  now: () => 0,
  schedule: () => ({}),
  cancel: () => undefined,
  report: () => undefined,
  // SAFETY: this test only asserts the seam object's identity round-trips through the tag; the ledger is never read.
  ledger: {} as AgentSeam["ledger"],
  generation: () => undefined,
  stopped: () => false,
  ready: () => Promise.resolve(),
  expireIfDue: () => undefined,
  reportIncompatible: () => undefined,
  runRevoked: () => false,
  queueTurn: (_trigger, work) => work(),
  enqueue: (work) => work(),
};

describe("agentSeamLayer", () => {
  it.effect("hands the same seam object back through the tag", () =>
    Effect.gen(function* () {
      const seam = yield* AgentSeamTag;
      assert.equal(seam, fakeSeam);
    }).pipe(Effect.provide(agentSeamLayer(fakeSeam))),
  );
});
