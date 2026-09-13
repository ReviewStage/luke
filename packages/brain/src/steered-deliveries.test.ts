import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { SteeredDeliveries } from "./steered-deliveries.js";

/** The rule in one place: on disk is delivered; ingested but never checkpointed, or never ingested, is not. */

const assertPending = (effect: Effect.Effect<boolean>): Effect.Effect<void> =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* Effect.yieldNow;
    assert.equal(fiber.pollUnsafe(), undefined);
  });

it.effect(
  "a checkpoint settles the opening words and the ingested steered words, and only those",
  () =>
    Effect.gen(function* () {
      const deliveries = new SteeredDeliveries();
      assert.equal(deliveries.openingPersisted, false);
      const ingested = deliveries.steered();
      deliveries.ingested();
      const later = deliveries.steered();
      deliveries.persisted();
      assert.equal(deliveries.openingPersisted, true);
      assert.equal(yield* ingested, true);
      yield* assertPending(later);
      deliveries.ingested();
      deliveries.persisted();
      assert.equal(yield* later, true);
    }),
);

it.effect(
  "words the run never ingested settle false at its end; ingested words wait for the turn's end and settle false without a checkpoint",
  () =>
    Effect.gen(function* () {
      const deliveries = new SteeredDeliveries();
      const ingested = deliveries.steered();
      deliveries.ingested();
      const never = deliveries.steered();
      deliveries.runEnded();
      assert.equal(yield* never, false);
      yield* assertPending(ingested);
      deliveries.turnEnded();
      assert.equal(yield* ingested, false);
      assert.equal(deliveries.openingPersisted, false);
    }),
);

it.effect("a turn that ends before any checkpoint owes every steered word", () =>
  Effect.gen(function* () {
    const deliveries = new SteeredDeliveries();
    const first = deliveries.steered();
    deliveries.ingested();
    const second = deliveries.steered();
    deliveries.turnEnded();
    assert.equal(yield* first, false);
    assert.equal(yield* second, false);
  }),
);
