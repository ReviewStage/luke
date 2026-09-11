import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { LIVE_BRAIN_SUBMISSION, type LiveBrain } from "../live-session/live-brain.js";
import { LiveBrainTag, liveBrainLayer } from "./live-brain.js";

const fakeBrain: LiveBrain = {
  submitAsk: () => Promise.resolve({ outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: "run-1" }),
  onRunEvent: () => () => undefined,
};

describe("liveBrainLayer", () => {
  it.effect("hands the same brain object back through the tag", () =>
    Effect.gen(function* () {
      const brain = yield* LiveBrainTag;
      assert.equal(brain, fakeBrain);
    }).pipe(Effect.provide(liveBrainLayer(fakeBrain))),
  );
});
