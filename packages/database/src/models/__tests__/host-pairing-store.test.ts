import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@luke/features/device-agent-wire";
import { HOST_PAIRING_POLL_STATUS } from "@luke/features/host-wire";
import { inArray } from "drizzle-orm";
import { Clock, Effect, Exit, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { hostPairing } from "../../schemas/host-pairing.js";
import { getTestDB } from "../../testing/index.js";
import {
  approveHostPairing,
  denyHostPairing,
  HOST_PAIRING_GUESS,
  openHostPairing,
  pollHostPairing,
  readHostPairing,
  sweepHostPairings,
} from "../host-pairing-store.js";
import { enrollHost, hostBySecret, hostsOf, mintHostInstallToken } from "../host-store.js";

/**
 * A box's pairings, over a real dialect: once one account approved or
 * denied a code, no account reads, approves, or denies it again, and the
 * approve made one host, listed under its approver alone; an approve never
 * takes over a device that stands; and the sweep deletes a lapsed pairing,
 * the address it kept with it, and a host whose box never collected its
 * secret, while a host keyed by its poll stays.
 * Synthetic accounts, codes, hashes, addresses, and boxes throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

/** A pending pairing opened under a fresh code and poll secret hash: that code and hash. */
const opened = Effect.gen(function* () {
  const userCode = randomUUID();
  const pollSecretHash = `poll-${randomUUID()}`;
  const kept = yield* openHostPairing({
    pollSecretHash,
    userCode,
    name: "fra-01",
    platform: DEVICE_PLATFORM.LINUX,
    arch: DEVICE_ARCH.X64,
    version: "0.1.0",
    ip: "203.0.113.7",
  });
  assert.ok(Option.isSome(kept));
  return { userCode, pollSecretHash };
});

const MISSED = { guess: HOST_PAIRING_GUESS.MISSED };

it.layer(getTestDB())("a box's pairings", (it) => {
  it.effect(
    "once one account approved or denied a code, no account reads, approves, or denies it again, and the approve made one host, its approver's alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const approved = yield* opened;
        const denied = yield* opened;
        const deviceId = randomUUID();

        const approve = yield* approveHostPairing(owner, approved.userCode, deviceId);
        const deny = yield* denyHostPairing(owner, denied.userCode);
        const afterwards = [];
        for (const { userCode } of [approved, denied]) {
          afterwards.push(
            yield* readHostPairing(other, userCode),
            yield* approveHostPairing(other, userCode, randomUUID()),
            yield* denyHostPairing(other, userCode),
            yield* approveHostPairing(owner, userCode, randomUUID()),
          );
        }

        assert.deepEqual(approve, { guess: HOST_PAIRING_GUESS.FOUND, found: deviceId });
        assert.deepEqual(deny, { guess: HOST_PAIRING_GUESS.FOUND, found: true });
        assert.deepEqual(
          afterwards,
          Array.from({ length: 8 }, () => MISSED),
        );
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id),
          [deviceId],
        );
        assert.deepEqual(yield* hostsOf(other), []);
      }),
  );

  it.effect("an approve under the id of a device that stands fails, and writes nothing", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const tokenHash = `token-${randomUUID()}`;
      yield* mintHostInstallToken(other, tokenHash);
      const standing = {
        id: randomUUID(),
        name: "theirs",
        platform: DEVICE_PLATFORM.LINUX,
        arch: DEVICE_ARCH.X64,
        version: "0.1.0",
        secretHash: `secret-${randomUUID()}`,
      };
      yield* enrollHost(tokenHash, standing);
      const pairing = yield* opened;

      const taken = yield* Effect.exit(approveHostPairing(owner, pairing.userCode, standing.id));

      assert.ok(Exit.isFailure(taken));
      assert.deepEqual(
        Option.map(yield* hostBySecret(standing.secretHash), (host) => host.userId),
        Option.some(other),
      );
      assert.equal((yield* readHostPairing(owner, pairing.userCode)).guess, "found");
      assert.deepEqual(yield* hostsOf(owner), []);
    }),
  );

  it.effect(
    "the sweep deletes lapsed pairings and the address each kept, and a host whose box never collected its secret, while a keyed host stays",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner } = yield* openAccounts;
        const collected = yield* opened;
        const uncollected = yield* opened;
        const pending = yield* opened;
        const [collectedId, uncollectedId] = [randomUUID(), randomUUID()];
        yield* approveHostPairing(owner, collected.userCode, collectedId);
        yield* approveHostPairing(owner, uncollected.userCode, uncollectedId);
        const polled = yield* pollHostPairing(collected.pollSecretHash, `secret-${randomUUID()}`);
        const listedBefore = (yield* hostsOf(owner)).map((host) => host.id).sort();

        yield* TestClock.adjust("11 minutes");
        yield* sweepHostPairings(new Date(yield* Clock.currentTimeMillis));

        assert.equal(polled.status, HOST_PAIRING_POLL_STATUS.APPROVED);
        assert.deepEqual(listedBefore, [collectedId, uncollectedId].sort());
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id),
          [collectedId],
        );
        const kept = yield* db
          .select({ ip: hostPairing.ip })
          .from(hostPairing)
          .where(
            inArray(hostPairing.pollSecretHash, [
              collected.pollSecretHash,
              uncollected.pollSecretHash,
              pending.pollSecretHash,
            ]),
          );
        assert.deepEqual(kept, []);
      }),
  );
});
