import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_ISOLATION } from "@luke/features/device-agent-wire";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { DEVICE_LAYOUT, getTestDB } from "../../testing/index.js";
import {
  beatDevice,
  deviceLayout,
  devicesNamed,
  devicesSeenSince,
  registerDevice,
} from "../device-store.js";

/**
 * An account's Macs, over a real dialect: a Mac is registered, beaten, and
 * read by its own account alone, an id another account holds is never taken
 * over, a Mac that stopped beating is no longer read as there, a launch
 * reads how the Mac last said it runs its agents, and the Macs a read's
 * local agents name are read by their ids alone.
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

it.layer(getTestDB())("the device store", (it) => {
  it.effect("another account neither takes over, beats, nor reads an account's Mac", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const id = randomUUID();
      const since = new Date(0);

      const registered = yield* registerDevice(owner, {
        id,
        name: "Studio",
        ...DEVICE_LAYOUT,
      });
      const takenOver = yield* registerDevice(other, {
        id,
        name: "Not yours",
        ...DEVICE_LAYOUT,
      });
      const beatenByOther = yield* beatDevice(other, id);

      assert.equal(registered, true);
      assert.equal(takenOver, false, "an id another account holds is not moved");
      assert.equal(beatenByOther, false);
      assert.deepEqual(yield* devicesSeenSince(other, since), []);
      assert.deepEqual(
        (yield* devicesSeenSince(owner, since)).map((device) => device.name),
        ["Studio"],
        "the owner's Mac keeps its name",
      );
    }),
  );

  it.effect("a Mac reads as there from its last beat on, and not after", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const id = randomUUID();
      yield* registerDevice(owner, { id, name: "Laptop", ...DEVICE_LAYOUT });
      // Note that the cutoff is measured from the clock's reading, which the layer's clock carries from test to test.
      const cutoff = new Date((yield* Clock.currentTimeMillis) + 45_000);
      yield* TestClock.adjust("60 seconds");

      const staleRead = yield* devicesSeenSince(owner, cutoff);
      const beaten = yield* beatDevice(owner, id);
      const freshRead = yield* devicesSeenSince(owner, cutoff);

      assert.deepEqual(staleRead, [], "a Mac silent past the cutoff is not there");
      assert.equal(beaten, true);
      assert.deepEqual(
        freshRead.map((device) => device.id),
        [id],
      );
    }),
  );

  it.effect("a launch reads the isolation the Mac last registered", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const id = randomUUID();
      const isolationNow = Effect.map(deviceLayout(owner, id), (layout) =>
        Option.map(layout, (standing) => standing.isolation),
      );

      yield* registerDevice(owner, {
        id,
        name: "Studio",
        ...DEVICE_LAYOUT,
        isolation: DEVICE_ISOLATION.SANDBOX,
      });
      const sandboxed = yield* isolationNow;
      yield* registerDevice(owner, {
        id,
        name: "Studio",
        ...DEVICE_LAYOUT,
        isolation: DEVICE_ISOLATION.BARE,
      });
      const bare = yield* isolationNow;

      assert.deepEqual(sandboxed, Option.some(DEVICE_ISOLATION.SANDBOX));
      assert.deepEqual(bare, Option.some(DEVICE_ISOLATION.BARE), "a register again moves it");
    }),
  );

  it.effect(
    "the Macs agents are pinned to are read by id, whichever account holds each, and only those",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const [studio, laptop, unnamed] = [randomUUID(), randomUUID(), randomUUID()];
        yield* registerDevice(owner, { id: studio, name: "Studio", ...DEVICE_LAYOUT });
        yield* registerDevice(other, { id: laptop, name: "Laptop", ...DEVICE_LAYOUT });
        yield* registerDevice(owner, { id: unnamed, name: "Spare", ...DEVICE_LAYOUT });

        const named = yield* devicesNamed([studio, laptop, studio, randomUUID()]);

        assert.deepEqual([...named.values()].map((device) => device.name).sort(), [
          "Laptop",
          "Studio",
        ]);
      }),
  );
});
