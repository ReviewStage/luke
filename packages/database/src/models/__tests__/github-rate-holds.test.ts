import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { getTestDB } from "../../testing/index.js";
import {
  holdGitHubIdentity,
  liftGitHubRateHold,
  readGitHubRateHold,
} from "../github-rate-holds.js";

/**
 * The holds GitHub's rate limits put on an identity, over a real dialect: a
 * hold is never shortened by a later, shorter one; a refusal while a hold
 * stands is the strike that set it, and one after it lifted the next, held
 * for that strike's wait; and a lift lets go only of a hold that is over.
 * Each case holds an identity of its own, since the rows are the
 * deployment's.
 */

const AT = Date.UTC(2026, 9, 25, 12);
const at = (minutes: number) => new Date(AT + minutes * 60_000);
const MINUTES = (...minutes: [number, ...number[]]) =>
  minutes.map((count) => count * 60_000) as [number, ...number[]];

/** A minute, then two, then four for every strike after. */
const BACKOFF = MINUTES(1, 2, 4);

it.layer(getTestDB())("github rate holds", (it) => {
  it.effect("a shorter hold written later keeps the longer one standing", () =>
    Effect.gen(function* () {
      const identity = `member-${randomUUID()}`;
      const unheld = yield* readGitHubRateHold(identity);
      yield* holdGitHubIdentity(identity, at(0), MINUTES(60));
      const kept = yield* holdGitHubIdentity(identity, at(1), MINUTES(1));

      assert.equal(unheld, undefined);
      assert.deepEqual(kept, { heldUntil: at(60), strikes: 1 });
      assert.deepEqual(yield* readGitHubRateHold(identity), kept);
    }),
  );

  it.effect(
    "a refusal while the hold stands is the same strike, and one after it lifted holds for the next strike's wait",
    () =>
      Effect.gen(function* () {
        const identity = `member-${randomUUID()}`;
        const first = yield* holdGitHubIdentity(identity, at(0), BACKOFF);
        const burst = yield* holdGitHubIdentity(identity, at(0.5), BACKOFF);
        const second = yield* holdGitHubIdentity(identity, at(1), BACKOFF);
        const third = yield* holdGitHubIdentity(identity, at(3), BACKOFF);
        const fourth = yield* holdGitHubIdentity(identity, at(7), BACKOFF);

        assert.deepEqual(
          [first, burst, second, third, fourth],
          [
            { heldUntil: at(1), strikes: 1 },
            { heldUntil: at(1.5), strikes: 1 },
            // The burst's hold stood until 1.5, so the refusal at 1 is still the first strike.
            { heldUntil: at(2), strikes: 1 },
            { heldUntil: at(5), strikes: 2 },
            { heldUntil: at(11), strikes: 3 },
          ],
        );
      }),
  );

  it.effect("a lift lets go of a hold that is over, and leaves one still standing", () =>
    Effect.gen(function* () {
      const identity = `member-${randomUUID()}`;
      yield* holdGitHubIdentity(identity, at(0), BACKOFF);
      yield* liftGitHubRateHold(identity, at(0.5));
      const standing = yield* readGitHubRateHold(identity);
      yield* liftGitHubRateHold(identity, at(1));

      assert.deepEqual(standing, { heldUntil: at(1), strikes: 1 });
      assert.equal(yield* readGitHubRateHold(identity), undefined);
      const afresh = yield* holdGitHubIdentity(identity, at(2), BACKOFF);
      assert.deepEqual(afresh, { heldUntil: at(3), strikes: 1 }, "the strikes went with it");
    }),
  );
});
