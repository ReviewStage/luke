import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Chunk, Effect, type Scope, TestClock } from "effect";
import { detachOn } from "./effect/carry.js";
import {
  BRAIN_GENERATION_LIFETIME_MS,
  type BrainPersistedState,
  freshBrainState,
} from "./envelope.js";
import { BrainGenerationClock } from "./generation-clock.js";
import { BrainStateStore } from "./state-store.js";
import { type FakeBrainStateRepository, fakeBrainStateRepository } from "./testing.js";

/**
 * Retention as the shipped policy has it: the store and its clock stand from
 * launch in a live run, whether or not any capability builds an agent, and
 * with no automatic reset an old checkpoint is loaded whole, past its stamped
 * deadline, while the clock arms nothing.
 */

const NOW = 1_800_000_000_000;
const EXPIRED_SECRET = "EXPIRED_SECRET_MARKER";

/**
 * The store and its generation clock as a launch builds them, on this test's
 * own `TestClock`: nothing is due until the test advances it, and the wait the
 * clock would arm is a fiber in the test's own scope.
 */
const launch = (
  repository: FakeBrainStateRepository,
): Effect.Effect<
  { store: BrainStateStore; generationClock: BrainGenerationClock; reports: string[] },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const clock = yield* Effect.clock;
    const reports: string[] = [];
    let generations = 0;
    const store = new BrainStateStore({
      automaticReset: false,
      repository,
      createGenerationId: () => `gen-${++generations}`,
      now: () => clock.unsafeCurrentTimeMillis(),
      report: (message) => reports.push(message),
    });
    const generationClock = new BrainGenerationClock({
      store,
      clock,
      detach: detachOn(yield* Effect.runtime<never>()),
      scope: yield* Effect.scope,
    });
    return { store, generationClock, reports };
  });

it.scoped(
  "a launch under the default policy keeps a checkpoint past its stamped deadline and arms no clock",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const stale: BrainPersistedState = {
        ...freshBrainState("gen-old", NOW - BRAIN_GENERATION_LIFETIME_MS - 1),
        items: [{ type: "message", role: "user", content: EXPIRED_SECRET }],
      };
      const repository = fakeBrainStateRepository(stale);
      const { store, generationClock, reports } = yield* launch(repository);
      yield* generationClock.start();
      assert.equal(store.generationId(), "gen-old");
      assert.deepEqual(store.current()?.items, stale.items);
      assert.equal(reports.length, 0);
      assert.deepEqual(Chunk.toReadonlyArray(yield* TestClock.sleeps()), []);
      // Nothing was armed, so advancing past the deadline fires nothing and the
      // generation stands: only a store with automatic reset has a clock to keep.
      yield* TestClock.setTime(NOW + BRAIN_GENERATION_LIFETIME_MS);
      assert.equal(store.generationId(), "gen-old");
      generationClock.stop();
    }),
);
