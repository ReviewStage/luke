import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  LIVE_BRAIN_CANCEL,
  LIVE_BRAIN_SUBMISSION,
  type LiveBrain,
} from "../live-session/live-brain.js";
import { LiveBrainTag, liveBrainLayer } from "./live-brain.js";

const fakeBrain: LiveBrain = {
  submitAsk: () => Effect.succeed({ outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: "run-1" }),
  explore: () => Effect.succeed({ outcome: LIVE_BRAIN_SUBMISSION.ACCEPTED, runId: "run-0" }),
  cancelRun: () => Effect.succeed(LIVE_BRAIN_CANCEL.NOT_RUNNING),
  recoverRuns: () => Effect.succeed({ revision: 0, runs: [], follow: Effect.void }),
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
