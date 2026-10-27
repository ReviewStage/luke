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
  enrollOwnDevice,
  HOST_ENROLL_REFUSAL,
  type HostEnrollment,
  hostBySecret,
  hostRemoved,
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
 * account reads, revokes, removes, or starts on another's host. A
 * member's own registered desktop enrolls in place on its session alone,
 * and is then read, listed, and removed as a host is; no account enrolls
 * another's.
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

        assert.deepEqual(enrolledUnder, { userId: owner });
        assert.deepEqual(
          [revokedByOther, removedByOther, takenOver],
          [false, false, { refused: HOST_ENROLL_REFUSAL.REFUSED }],
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

      assert.deepEqual(yield* enrollHost(revoked.tokenHash, box("late-1")), {
        refused: HOST_ENROLL_REFUSAL.REFUSED,
      });
      assert.deepEqual(yield* enrollHost(expiring.tokenHash, box("late-2")), {
        refused: HOST_ENROLL_REFUSAL.REFUSED,
      });
      assert.deepEqual(yield* enrollHost(`token-${randomUUID()}`, box("unknown")), {
        refused: HOST_ENROLL_REFUSAL.REFUSED,
      });
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

        assert.deepEqual(
          takenOver,
          { refused: HOST_ENROLL_REFUSAL.STILL_ENROLLED },
          "a standing host's id is refused, and said apart",
        );
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
        const rotated = yield* enrollOwnDevice(owner, {
          id,
          version: "0.1.0",
          secretHash: rotatedHash,
        });
        const firstAfterRotate = yield* hostBySecret(firstHash);
        const removed = yield* removeHost(owner, id);

        assert.equal(byOther, false, "another account's session enrolls nothing");
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
