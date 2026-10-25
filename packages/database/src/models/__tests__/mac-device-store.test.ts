import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, MAC_DEVICE_LAYOUT } from "../../testing/index.js";
import {
  beatMacDevice,
  macDevicesNamed,
  macDevicesSeenSince,
  registerMacDevice,
} from "../mac-device-store.js";

/**
 * An account's Macs, over a real dialect: a Mac is registered, beaten, and
 * read by its own account alone, an id another account holds is never taken
 * over, a Mac that stopped beating is no longer read as there, and the
 * Macs a read's local agents name are read by their ids alone.
 * Synthetic accounts and Macs throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

it.layer(getTestDB())("the Mac device store", (it) => {
  it.effect("another account neither takes over, beats, nor reads an account's Mac", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const id = randomUUID();
      const since = new Date(0);

      const registered = yield* registerMacDevice(owner, {
        id,
        name: "Studio",
        ...MAC_DEVICE_LAYOUT,
      });
      const takenOver = yield* registerMacDevice(other, {
        id,
        name: "Not yours",
        ...MAC_DEVICE_LAYOUT,
      });
      const beatenByOther = yield* beatMacDevice(other, id);

      assert.equal(registered, true);
      assert.equal(takenOver, false, "an id another account holds is not moved");
      assert.equal(beatenByOther, false);
      assert.deepEqual(yield* macDevicesSeenSince(other, since), []);
      assert.deepEqual(
        (yield* macDevicesSeenSince(owner, since)).map((device) => device.name),
        ["Studio"],
        "the owner's Mac keeps its name",
      );
    }),
  );

  it.effect("a Mac reads as there from its last beat on, and not after", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const id = randomUUID();
      yield* registerMacDevice(owner, { id, name: "Laptop", ...MAC_DEVICE_LAYOUT });
      // Note that the cutoff is measured from the clock's reading, which the layer's clock carries from test to test.
      const cutoff = new Date((yield* Clock.currentTimeMillis) + 45_000);
      yield* TestClock.adjust("60 seconds");

      const staleRead = yield* macDevicesSeenSince(owner, cutoff);
      const beaten = yield* beatMacDevice(owner, id);
      const freshRead = yield* macDevicesSeenSince(owner, cutoff);

      assert.deepEqual(staleRead, [], "a Mac silent past the cutoff is not there");
      assert.equal(beaten, true);
      assert.deepEqual(
        freshRead.map((device) => device.id),
        [id],
      );
    }),
  );

  it.effect(
    "the Macs agents are pinned to are read by id, whichever account holds each, and only those",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const [studio, laptop, unnamed] = [randomUUID(), randomUUID(), randomUUID()];
        yield* registerMacDevice(owner, { id: studio, name: "Studio", ...MAC_DEVICE_LAYOUT });
        yield* registerMacDevice(other, { id: laptop, name: "Laptop", ...MAC_DEVICE_LAYOUT });
        yield* registerMacDevice(owner, { id: unnamed, name: "Spare", ...MAC_DEVICE_LAYOUT });

        const named = yield* macDevicesNamed([studio, laptop, studio, randomUUID()]);

        assert.deepEqual([...named.values()].map((device) => device.name).sort(), [
          "Laptop",
          "Studio",
        ]);
      }),
  );
});
