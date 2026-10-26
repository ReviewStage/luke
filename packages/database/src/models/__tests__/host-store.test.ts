import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { DEVICE_LAYOUT, getTestDB } from "../../testing/index.js";
import { deviceLayout, devicesSeenSince, registerDevice } from "../device-store.js";
import {
  enrollHost,
  type HostEnrollment,
  hostBySecret,
  hostsOf,
  mintHostInstallToken,
  removeHost,
  revokeHostInstallToken,
} from "../host-store.js";

/**
 * An account's install tokens and hosts, over a real dialect: a token
 * enrolls boxes under its own account alone, an expired or revoked one
 * enrolls none while the boxes it enrolled go on, a removed host's secret
 * resolves nothing, a standing host's id enrolls nothing while a removed
 * host's brings that one host back with a new secret, and no
 * account reads, revokes, removes, or starts on another's host.
 * Synthetic accounts, hashes, and boxes throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

/** A box enrolling under a fresh id with a fresh secret hash. */
function box(name: string, id: string = randomUUID()): HostEnrollment {
  return {
    id,
    name,
    platform: DEVICE_PLATFORM.LINUX,
    arch: DEVICE_ARCH.X64,
    version: "0.1.0",
    secretHash: `secret-${randomUUID()}`,
  };
}

/** A token of the account's, kept by a fresh synthetic hash, and that hash. */
const mintedToken = (userId: string) =>
  Effect.gen(function* () {
    const tokenHash = `token-${randomUUID()}`;
    const minted = yield* mintHostInstallToken(userId, tokenHash);
    return { tokenHash, id: minted.id };
  });

it.layer(getTestDB())("the host store", (it) => {
  it.effect(
    "a token enrolls under its own account alone, and no other account reads, revokes, removes, or starts on that host",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const token = yield* mintedToken(owner);
        const enrolled = box("fra-01");

        const enrolledUnder = yield* enrollHost(token.tokenHash, enrolled);
        yield* registerDevice(owner, { id: enrolled.id, name: "fra-01", ...DEVICE_LAYOUT });
        const revokedByOther = yield* revokeHostInstallToken(other, token.id);
        const removedByOther = yield* removeHost(other, enrolled.id);
        // Note that the other account's own token cannot take the owner's id over either.
        const otherToken = yield* mintedToken(other);
        const takenOver = yield* enrollHost(otherToken.tokenHash, box("not-yours", enrolled.id));

        assert.deepEqual(enrolledUnder, Option.some(owner));
        assert.deepEqual(
          [revokedByOther, removedByOther, takenOver],
          [false, false, Option.none()],
        );
        assert.deepEqual(yield* hostsOf(other), []);
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.name),
          ["fra-01"],
          "the owner's host keeps its name",
        );
        // Start offers and launches only on what these two reads answer the starter.
        assert.deepEqual(yield* devicesSeenSince(other, new Date(0)), []);
        assert.ok(Option.isNone(yield* deviceLayout(other, enrolled.id)));
        assert.deepEqual(
          (yield* devicesSeenSince(owner, new Date(0))).map((device) => device.id),
          [enrolled.id],
        );
      }),
  );

  it.effect("an expired or revoked token enrolls no new box, and the boxes it enrolled go on", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const revoked = yield* mintedToken(owner);
      const expiring = yield* mintedToken(owner);
      const first = box("fra-01");
      const second = box("fra-02");
      yield* enrollHost(revoked.tokenHash, first);
      yield* enrollHost(expiring.tokenHash, second);

      yield* revokeHostInstallToken(owner, revoked.id);
      yield* TestClock.adjust("25 hours");

      assert.deepEqual(yield* enrollHost(revoked.tokenHash, box("late-1")), Option.none());
      assert.deepEqual(yield* enrollHost(expiring.tokenHash, box("late-2")), Option.none());
      assert.deepEqual(yield* enrollHost(`token-${randomUUID()}`, box("unknown")), Option.none());
      assert.deepEqual(
        Option.map(yield* hostBySecret(first.secretHash), (host) => host.deviceId),
        Option.some(first.id),
      );
      assert.deepEqual(
        Option.map(yield* hostBySecret(second.secretHash), (host) => host.deviceId),
        Option.some(second.id),
      );
      assert.deepEqual(
        (yield* hostsOf(owner)).map((host) => host.name),
        ["fra-01", "fra-02"],
      );
    }),
  );

  it.effect(
    "a token keys no standing host again; a removed host's secret resolves nothing, and enrolling its id brings the one host back",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const token = yield* mintedToken(owner);
        const enrolled = box("fra-01");
        yield* enrollHost(token.tokenHash, enrolled);
        const takeover = { ...enrolled, name: "not-yours", secretHash: `secret-${randomUUID()}` };

        const takenOver = yield* enrollHost(token.tokenHash, takeover);
        const standingAfterTakeover = yield* hostBySecret(enrolled.secretHash);
        const removed = yield* removeHost(owner, enrolled.id);
        const afterRemove = yield* hostBySecret(enrolled.secretHash);
        const listedAfterRemove = yield* hostsOf(owner);
        const rekeyed = { ...enrolled, secretHash: `secret-${randomUUID()}` };
        yield* enrollHost(token.tokenHash, rekeyed);

        assert.deepEqual(takenOver, Option.none(), "a standing host's id is refused");
        assert.ok(Option.isSome(standingAfterTakeover), "the standing host keeps its secret");
        assert.ok(Option.isNone(yield* hostBySecret(takeover.secretHash)));
        assert.equal(removed, true);
        assert.ok(Option.isNone(afterRemove), "a removed host's secret is refused");
        assert.deepEqual(listedAfterRemove, []);
        assert.ok(
          Option.isNone(yield* hostBySecret(enrolled.secretHash)),
          "the old secret stays refused",
        );
        assert.deepEqual(
          Option.map(yield* hostBySecret(rekeyed.secretHash), (host) => host.userId),
          Option.some(owner),
        );
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id),
          [enrolled.id],
          "one host, not two",
        );
      }),
  );
});
