import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { DEVICE_ARCH, DEVICE_PLATFORM } from "@repo/features/device-agent-wire";
import { HOST_PAIRING_POLL_STATUS } from "@repo/features/host-wire";
import { inArray } from "drizzle-orm";
import { Effect, Exit, Option } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { hostPairing, hostPairingGuess } from "../../schemas/host-pairing.js";
import { getTestDB } from "../../testing/index.js";
import {
  approveHostPairing,
  denyHostPairing,
  HOST_PAIRING_GUESS,
  openHostPairing,
  pollHostPairing,
  readHostPairing,
} from "../host-pairing-store.js";
import { enrollOwnDevice, hostBySecret, hostsOf, removeHost } from "../host-store.js";

/**
 * A box's pairings, over a real dialect: once one account approved or
 * denied a code, no account reads, approves, or denies it again, and the
 * approve made one host, listed under its approver alone; an approve never
 * takes over a device that stands; a box that polls past its collect
 * grace is handed no secret; and a start deletes a lapsed pairing, the
 * address it kept with it, a host whose box never collected its secret, and
 * a guess window that ended, while a keyed host, a live pairing, the host
 * it approved, and a window still open stay; and a host whose box never
 * collected its secret leaves the list as its pairing lapses, before any
 * start deletes it.
 * Synthetic accounts, codes, hashes, addresses, and boxes throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
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
      const standing = {
        id: randomUUID(),
        version: "0.1.0",
        secretHash: `secret-${randomUUID()}`,
        machine: { name: "theirs", platform: DEVICE_PLATFORM.LINUX, arch: DEVICE_ARCH.X64 },
      };
      yield* enrollOwnDevice(other, standing);
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
    "a host whose box never collected its secret is listed until its pairing lapses, with no start, and is not removed after",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const collected = yield* opened;
        const uncollected = yield* opened;
        const [collectedId, uncollectedId] = [randomUUID(), randomUUID()];
        yield* approveHostPairing(owner, collected.userCode, collectedId);
        yield* approveHostPairing(owner, uncollected.userCode, uncollectedId);
        yield* pollHostPairing(collected.pollSecretHash, `secret-${randomUUID()}`);

        yield* TestClock.adjust("9 minutes");
        const beforeLapse = (yield* hostsOf(owner)).map((host) => host.id).sort();
        yield* TestClock.adjust("1 minute");

        assert.deepEqual(beforeLapse, [collectedId, uncollectedId].sort());
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id),
          [collectedId],
        );
        assert.equal(yield* removeHost(owner, uncollectedId), undefined);
      }),
  );

  it.effect(
    "a start deletes lapsed pairings, the address each kept, a host whose box never collected its secret, and ended guess windows, and leaves what is live",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, other } = yield* openAccounts;
        const collected = yield* opened;
        const uncollected = yield* opened;
        const pending = yield* opened;
        const [collectedId, uncollectedId, liveId] = [randomUUID(), randomUUID(), randomUUID()];
        yield* approveHostPairing(owner, collected.userCode, collectedId);
        yield* approveHostPairing(owner, uncollected.userCode, uncollectedId);
        yield* readHostPairing(other, randomUUID());
        const polled = yield* pollHostPairing(collected.pollSecretHash, `secret-${randomUUID()}`);
        const listedBefore = (yield* hostsOf(owner)).map((host) => host.id).sort();

        yield* TestClock.adjust("16 minutes");
        const late = yield* pollHostPairing(uncollected.pollSecretHash, `secret-${randomUUID()}`);
        const live = yield* opened;
        yield* approveHostPairing(owner, live.userCode, liveId);
        const livePending = yield* opened;

        assert.equal(polled.status, HOST_PAIRING_POLL_STATUS.APPROVED);
        assert.equal(late.status, HOST_PAIRING_POLL_STATUS.EXPIRED, "past its grace, no secret");
        assert.deepEqual(listedBefore, [collectedId, uncollectedId].sort());
        assert.deepEqual(
          (yield* hostsOf(owner)).map((host) => host.id).sort(),
          [collectedId, liveId].sort(),
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
        const windows = yield* db
          .select({ userId: hostPairingGuess.userId })
          .from(hostPairingGuess)
          .where(inArray(hostPairingGuess.userId, [owner, other]));
        assert.deepEqual(windows, [{ userId: owner }]);
        assert.equal((yield* readHostPairing(owner, livePending.userCode)).guess, "found");
        assert.equal(
          (yield* pollHostPairing(live.pollSecretHash, `secret-${randomUUID()}`)).status,
          HOST_PAIRING_POLL_STATUS.APPROVED,
        );
      }),
  );
});
