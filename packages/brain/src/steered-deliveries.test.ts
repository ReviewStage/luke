import assert from "node:assert/strict";
import { test } from "vitest";
import { SteeredDeliveries } from "./steered-deliveries.js";

/** The rule in one place: on disk is delivered; ingested but never checkpointed, or never ingested, is not. */

async function settled(promise: Promise<boolean>): Promise<boolean | "pending"> {
  return Promise.race([
    promise,
    new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
  ]);
}

test("a checkpoint settles the opening words and the ingested steered words, and only those", async () => {
  const deliveries = new SteeredDeliveries();
  assert.equal(deliveries.openingPersisted, false);
  const ingested = deliveries.steered();
  deliveries.ingested();
  const later = deliveries.steered();
  deliveries.persisted();
  assert.equal(deliveries.openingPersisted, true);
  assert.equal(await settled(ingested), true);
  assert.equal(await settled(later), "pending");
  deliveries.ingested();
  deliveries.persisted();
  assert.equal(await settled(later), true);
});

test("words the run never ingested settle false at its end; ingested words wait for the turn's end and settle false without a checkpoint", async () => {
  const deliveries = new SteeredDeliveries();
  const ingested = deliveries.steered();
  deliveries.ingested();
  const never = deliveries.steered();
  deliveries.runEnded();
  assert.equal(await settled(never), false);
  assert.equal(await settled(ingested), "pending");
  deliveries.turnEnded();
  assert.equal(await settled(ingested), false);
  assert.equal(deliveries.openingPersisted, false);
});

test("a turn that ends before any checkpoint owes every steered word", async () => {
  const deliveries = new SteeredDeliveries();
  const first = deliveries.steered();
  deliveries.ingested();
  const second = deliveries.steered();
  deliveries.turnEnded();
  assert.equal(await settled(first), false);
  assert.equal(await settled(second), false);
});
