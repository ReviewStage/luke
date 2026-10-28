import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Metric } from "effect";
import { TestClock } from "effect/testing";
import { countAnswerBytes, countAnswerWait, TRANSCRIPT_METRIC } from "./transcript-metrics.js";

/** The measures a transcript's live answers are counted by: a held answer that moved is counted by the bytes of its rows, and one that ended unmoved is not. */
it.effect(
  "counts the bytes of the rows an answer carries, and none for an answer with no rows",
  () =>
    Effect.gen(function* () {
      const sealed = { capability: "c", queryFingerprint: "q", expiresAt: 0 };
      yield* countAnswerBytes({ unmoved: { ...sealed, digest: "d" } });
      yield* countAnswerBytes({
        window: { ...sealed, digest: "d", rows: [{ id: 1 }, { id: 2 }] },
        parts: { ...sealed, digest: "d", rows: [] },
      });

      const bytes = yield* Metric.value(TRANSCRIPT_METRIC.ANSWER_BYTES);
      // `[{"id":1},{"id":2}]` is 19 bytes and `[]` is 2.
      assert.equal(bytes.count, 1);
      assert.equal(bytes.sum, 21);
    }),
);

it.effect("counts how long a heard write waited for its answer", () =>
  Effect.gen(function* () {
    yield* TestClock.adjust(1000);
    yield* countAnswerWait(250);

    const waited = yield* Metric.value(TRANSCRIPT_METRIC.ANSWER_MILLIS);
    assert.equal(waited.count, 1);
    assert.equal(waited.sum, 750);
  }),
);
