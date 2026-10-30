import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { DEVICE_LAYOUT, getTestDB } from "../../testing/index.js";
import { deviceLayout, registerDevice } from "../device-store.js";
import { enrollOwnDevice, hostBySecret, hostRemoved, hostsOf, removeHost } from "../host-store.js";

/**
 * An account's hosts, over a real dialect: a member's session creates a
 * machine its account never registered, and enrolls its own registered
 * desktop in place, which is then read, listed, and removed as a host is;
 * a removed host's secret resolves nothing, and no account enrolls, lists,
 * or removes another's.
 * Synthetic accounts, hashes, and machines throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

it.layer(getTestDB())("the host store", (it) => {
  it.effect(
    "a member's session creates a machine its account never registered, under that account alone, and never takes another account's id",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const id = randomUUID();
        const ownerHash = `secret-${randomUUID()}`;
        const machine = { name: "Mini", platform: DEVICE_PLATFORM.DARWIN, arch: DEVICE_ARCH.ARM64 };

        const unnamed = yield* enrollOwnDevice(owner, {
          id: randomUUID(),
          version: "0.1.0",
          secretHash: `secret-${randomUUID()}`,
        });
        const created = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: ownerHash,
          machine,
        });
        const byOther = yield* enrollOwnDevice(other, {
          id,
          version: "0.1.0",
          secretHash: `secret-${randomUUID()}`,
          machine,
        });

        assert.equal(unnamed, false, "an enroll naming no machine creates none");
        assert.equal(created, true);
        assert.equal(byOther, false, "another account's id is never taken");
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => [host.id, host.name, host.platform]),
          [[id, "Mini", DEVICE_PLATFORM.DARWIN]],
        );
        assert.deepEqual(yield* hostsOf(other), []);
        assert.deepEqual(
          Option.map(yield* hostBySecret(ownerHash), (host) => host.userId),
          Option.some(owner),
          "the owner's secret still stands",
        );
      }),
  );

  it.effect(
    "a member enrolls its own desktop in place, which is then listed and removed as any machine, and no other account enrolls it",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const id = randomUUID();
        yield* registerDevice(owner, { id, name: "Studio", ...DEVICE_LAYOUT });
        const otherHash = `secret-${randomUUID()}`;
        const firstHash = `secret-${randomUUID()}`;
        const rotatedHash = `secret-${randomUUID()}`;

        const byOther = yield* enrollOwnDevice(other, {
          id,
          version: "0.1.0",
          secretHash: otherHash,
        });
        const first = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: firstHash,
        });
        const listed = yield* hostsOf(owner);
        // Start offers and launches only on what this read answers the starter.
        const layoutForOther = yield* deviceLayout(other, id);
        const rotated = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: rotatedHash,
        });
        const firstAfterRotate = yield* hostBySecret(firstHash);
        const removedByOther = yield* removeHost(other, id);
        const removed = yield* removeHost(owner, id);

        assert.equal(byOther, false, "another account's session enrolls nothing");
        assert.equal(removedByOther, false, "another account removes nothing");
        assert.ok(Option.isNone(layoutForOther), "another account starts nothing on it");
        assert.ok(Option.isNone(yield* hostBySecret(otherHash)));
        assert.deepEqual(yield* hostsOf(other), []);
        assert.deepEqual([first, rotated], [true, true]);
        assert.deepEqual(
          listed.map((host) => [host.id, host.name, host.platform]),
          [[id, "Studio", DEVICE_PLATFORM.DARWIN]],
          "the desktop is listed under its own id and name",
        );
        assert.ok(Option.isNone(firstAfterRotate), "enrolling again refuses the old secret");
        assert.equal(removed, true);
        assert.ok(
          Option.isNone(yield* hostBySecret(rotatedHash)),
          "a removed Mac's secret is refused",
        );
        assert.deepEqual(yield* hostsOf(owner), []);
        assert.equal(yield* hostRemoved(owner, id), true);
      }),
  );
});
