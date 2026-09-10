import assert from "node:assert/strict";
import test, { after } from "node:test";
import { MAIN_SESSION_KEY } from "../server/core";
import { acquireLeaseWithin } from "../server/hosted/brain-host/lease-run";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";

/** Synthetic fixtures: owner ids and instants alone. */

const NOW = 1_800_000_000_000;
const TTL = 30_000;

const opening = openHostedStoreTestDatabase();
after(async () => {
  await (await opening).close();
});

test("a lease is taken once, kept by its holder's heartbeat, refused to another while it stands, and taken over once it expires", async () => {
  const database = await opening;
  const userId = await database.createUser();
  const { leases } = database.store;

  assert.equal(await leases.acquire(userId, MAIN_SESSION_KEY, "first", NOW, TTL), true);
  assert.equal(await leases.acquire(userId, MAIN_SESSION_KEY, "second", NOW + 1_000, TTL), false);
  assert.deepEqual(await leases.read(userId, MAIN_SESSION_KEY), {
    ownerId: "first",
    acquiredAt: NOW,
    heartbeatAt: NOW,
    expiresAt: NOW + TTL,
  });

  // The heartbeat moves the expiry along, and only the holder's does.
  assert.equal(await leases.heartbeat(userId, MAIN_SESSION_KEY, "first", NOW + 10_000, TTL), true);
  assert.equal(
    await leases.heartbeat(userId, MAIN_SESSION_KEY, "second", NOW + 10_000, TTL),
    false,
  );
  assert.equal((await leases.read(userId, MAIN_SESSION_KEY))?.expiresAt, NOW + 10_000 + TTL);
  assert.equal(await leases.acquire(userId, MAIN_SESSION_KEY, "second", NOW + 35_000, TTL), false);

  // Past the last heartbeat's life the lease is another's to take, and the
  // old holder's heartbeat and release then reach nothing.
  assert.equal(await leases.acquire(userId, MAIN_SESSION_KEY, "second", NOW + 40_000, TTL), true);
  assert.equal((await leases.read(userId, MAIN_SESSION_KEY))?.ownerId, "second");
  assert.equal(await leases.heartbeat(userId, MAIN_SESSION_KEY, "first", NOW + 41_000, TTL), false);
  assert.equal(await leases.release(userId, MAIN_SESSION_KEY, "first"), false);
  assert.equal((await leases.read(userId, MAIN_SESSION_KEY))?.ownerId, "second");

  assert.equal(await leases.release(userId, MAIN_SESSION_KEY, "second"), true);
  assert.equal(await leases.read(userId, MAIN_SESSION_KEY), undefined);
  // Two conversations of one account lease independently.
  assert.equal(await leases.acquire(userId, MAIN_SESSION_KEY, "third", NOW + 50_000, TTL), true);
});

test("a bounded wait for the lease takes it when the holder lets go, and answers nothing when the holder keeps it", async () => {
  const database = await opening;
  const userId = await database.createUser();
  const { leases } = database.store;
  let now = NOW;
  const seams = {
    store: database.store,
    userId,
    sessionKey: MAIN_SESSION_KEY,
    ownerId: "waiter",
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
  };

  assert.equal(await leases.acquire(userId, MAIN_SESSION_KEY, "holder", NOW, TTL), true);
  const refused = await acquireLeaseWithin(seams, 5_000, 1_000);
  assert.equal(refused, undefined);
  assert.equal((await leases.read(userId, MAIN_SESSION_KEY))?.ownerId, "holder");

  // The holder releases two polls in: the waiter takes the lease then.
  let polls = 0;
  const taken = await acquireLeaseWithin(
    {
      ...seams,
      sleep: async (ms) => {
        now += ms;
        polls += 1;
        if (polls === 2) await leases.release(userId, MAIN_SESSION_KEY, "holder");
      },
    },
    10_000,
    1_000,
  );
  assert.ok(taken);
  assert.equal(taken.ownerId, "waiter");
  assert.equal((await leases.read(userId, MAIN_SESSION_KEY))?.ownerId, "waiter");
  await taken.release();
  assert.equal(await leases.read(userId, MAIN_SESSION_KEY), undefined);
});
