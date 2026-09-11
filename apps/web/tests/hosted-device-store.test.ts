import assert from "node:assert/strict";
import { DEVICE_PLATFORM, PUSH_ENVIRONMENT } from "@sidecar/hosted";
import { test } from "vitest";
import { devices } from "../server/db/devices-schema";
import { deviceSeams } from "../server/hosted/device-store";

const INSTALLATION_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const DEVICE_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "0a".repeat(32);
const NOW = new Date("2026-09-09T12:00:00.000Z");

type DeviceDatabase = Parameters<typeof deviceSeams>[0];

/** What the seams write into a column: an id, a platform, a token, an instant, or a cleared value. */
type WrittenValue = string | Date | null;

type WrittenColumns = Record<string, WrittenValue>;

interface RecordedWrite {
  kind: "update" | "insert" | "delete" | "select";
  values?: WrittenColumns;
  set?: WrittenColumns;
  target?: typeof devices.installationId;
  hasWhere: boolean;
}

/**
 * A database that answers the write chains the device seams make, recording
 * what each was asked. The chain mirrors drizzle's fluent insert, update, and
 * delete, and `transaction` hands the same recorder back as the transaction.
 */
function deviceDatabase(answers: {
  updatedRows: number;
  deletedRows: number;
  /** Whether the account holds the row a heartbeat names; the heartbeat's own update answers `updatedRows`. */
  heldRows?: number;
}) {
  const writes: RecordedWrite[] = [];
  const rows = (count: number) => Array.from({ length: count }, () => ({ deviceId: DEVICE_ID }));
  const heldRows = answers.heldRows ?? answers.updatedRows;
  // A where() is awaited bare by the token eviction and chained into returning()
  // by every other write, so the fake answers as a real promise carrying both.
  const settled = (count: number) =>
    Object.assign(Promise.resolve(rows(count)), { returning: async () => rows(count) });
  const recorder = {
    select() {
      const write: RecordedWrite = { kind: "select", hasWhere: false };
      writes.push(write);
      return {
        from(table: typeof devices) {
          assert.equal(table, devices);
          return {
            where() {
              write.hasWhere = true;
              return { limit: async () => rows(heldRows) };
            },
          };
        },
      };
    },
    update(table: typeof devices) {
      assert.equal(table, devices);
      return {
        set(set: WrittenColumns) {
          const write: RecordedWrite = { kind: "update", set, hasWhere: false };
          writes.push(write);
          return {
            where() {
              write.hasWhere = true;
              return settled(answers.updatedRows);
            },
          };
        },
      };
    },
    insert(table: typeof devices) {
      assert.equal(table, devices);
      return {
        values(values: WrittenColumns) {
          const write: RecordedWrite = { kind: "insert", values, hasWhere: false };
          writes.push(write);
          return {
            onConflictDoUpdate(update: {
              target: typeof devices.installationId;
              set: WrittenColumns;
            }) {
              write.target = update.target;
              write.set = update.set;
              return { returning: async () => [{ deviceId: String(values.id) }] };
            },
          };
        },
      };
    },
    delete(table: typeof devices) {
      assert.equal(table, devices);
      const write: RecordedWrite = { kind: "delete", hasWhere: false };
      writes.push(write);
      return {
        where() {
          write.hasWhere = true;
          return settled(answers.deletedRows);
        },
      };
    },
    transaction: <Result>(run: (transaction: DeviceDatabase) => Promise<Result>) => run(database),
  };
  // SAFETY: Test double implements only the write chains deviceSeams exercises.
  const database = recorder as unknown as DeviceDatabase;
  return { database, writes };
}

test("a first registration inserts the row under the account with the minted id", async () => {
  const { database, writes } = deviceDatabase({ updatedRows: 0, deletedRows: 0 });
  const answer = await deviceSeams(database).registerDevice(
    "user-1",
    { installationId: INSTALLATION_ID, platform: DEVICE_PLATFORM.MACOS, push: undefined },
    () => DEVICE_ID,
    NOW,
  );

  assert.deepEqual(answer, { deviceId: DEVICE_ID });
  assert.equal(writes.length, 1);
  const [insert] = writes;
  assert.equal(insert?.kind, "insert");
  assert.deepEqual(insert?.values, {
    id: DEVICE_ID,
    userId: "user-1",
    installationId: INSTALLATION_ID,
    platform: DEVICE_PLATFORM.MACOS,
    lastSeenAt: NOW,
    activeUntil: null,
    quietUntil: null,
    pushToken: null,
    pushEnvironment: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(insert?.target, devices.installationId);
  assert.deepEqual(
    insert?.set,
    {
      userId: "user-1",
      platform: DEVICE_PLATFORM.MACOS,
      lastSeenAt: NOW,
      activeUntil: null,
      quietUntil: null,
      updatedAt: NOW,
    },
    "a registration without a token leaves the one on file, and clears the instants a previous sign-in reported",
  );
});

test("a registration re-keys the installation's row to the account that presents it", () => {
  const { database, writes } = deviceDatabase({ updatedRows: 0, deletedRows: 0 });
  return deviceSeams(database)
    .registerDevice(
      "user-2",
      { installationId: INSTALLATION_ID, platform: DEVICE_PLATFORM.IOS, push: undefined },
      () => DEVICE_ID,
      NOW,
    )
    .then(() => {
      const [insert] = writes;
      assert.equal(insert?.target, devices.installationId);
      assert.equal(insert?.set?.userId, "user-2");
      assert.equal(Object.hasOwn(insert?.set ?? {}, "createdAt"), false);
      assert.equal(Object.hasOwn(insert?.set ?? {}, "installationId"), false);
    });
});

test("a registration with a push token takes it off any other installation first", async () => {
  const { database, writes } = deviceDatabase({ updatedRows: 1, deletedRows: 0 });
  await deviceSeams(database).registerDevice(
    "user-1",
    {
      installationId: INSTALLATION_ID,
      platform: DEVICE_PLATFORM.IOS,
      push: { token: TOKEN, environment: PUSH_ENVIRONMENT.SANDBOX },
    },
    () => DEVICE_ID,
    NOW,
  );

  assert.deepEqual(
    writes.map((write) => write.kind),
    ["update", "insert"],
  );
  const [eviction, insert] = writes;
  assert.deepEqual(eviction?.set, { pushToken: null, pushEnvironment: null, updatedAt: NOW });
  assert.equal(eviction?.hasWhere, true);
  assert.equal(insert?.values?.pushToken, TOKEN);
  assert.equal(insert?.values?.pushEnvironment, PUSH_ENVIRONMENT.SANDBOX);
  assert.equal(insert?.set?.pushToken, TOKEN);
});

test("a bare heartbeat moves only the instants, scoped by account and row", async () => {
  const { database, writes } = deviceDatabase({ updatedRows: 1, deletedRows: 0 });
  const seen = await deviceSeams(database).touchDevice(
    "user-1",
    { deviceId: DEVICE_ID, activeUntil: undefined, push: undefined },
    NOW,
  );

  assert.equal(seen, true);
  assert.deepEqual(
    writes.map((write) => write.kind),
    ["select", "update"],
  );
  assert.deepEqual(writes[1]?.set, { lastSeenAt: NOW, updatedAt: NOW });
  assert.equal(writes[1]?.hasWhere, true);
});

test("a heartbeat naming a row the account does not hold evicts no token", async () => {
  const { database, writes } = deviceDatabase({ updatedRows: 0, deletedRows: 0, heldRows: 0 });
  const seen = await deviceSeams(database).touchDevice(
    "user-1",
    {
      deviceId: DEVICE_ID,
      activeUntil: undefined,
      push: { token: TOKEN, environment: PUSH_ENVIRONMENT.SANDBOX },
    },
    NOW,
  );

  assert.equal(seen, false);
  assert.deepEqual(
    writes.map((write) => write.kind),
    ["select"],
    "another account's token is stripped only by a row that takes it",
  );
});

test("a heartbeat carries presence, a new push address, or a cleared one", async () => {
  const presence = deviceDatabase({ updatedRows: 1, deletedRows: 0 });
  await deviceSeams(presence.database).touchDevice(
    "user-1",
    { deviceId: DEVICE_ID, activeUntil: new Date(NOW.getTime() + 120_000), push: undefined },
    NOW,
  );
  assert.deepEqual(presence.writes[1]?.set, {
    lastSeenAt: NOW,
    updatedAt: NOW,
    activeUntil: new Date(NOW.getTime() + 120_000),
  });

  const quiet = deviceDatabase({ updatedRows: 1, deletedRows: 0 });
  await deviceSeams(quiet.database).touchDevice(
    "user-1",
    {
      deviceId: DEVICE_ID,
      activeUntil: null,
      quietUntil: new Date(NOW.getTime() + 1_800_000),
      push: undefined,
    },
    NOW,
  );
  assert.deepEqual(quiet.writes[1]?.set, {
    lastSeenAt: NOW,
    updatedAt: NOW,
    activeUntil: null,
    quietUntil: new Date(NOW.getTime() + 1_800_000),
  });

  const unquieted = deviceDatabase({ updatedRows: 1, deletedRows: 0 });
  await deviceSeams(unquieted.database).touchDevice(
    "user-1",
    { deviceId: DEVICE_ID, activeUntil: undefined, quietUntil: null, push: undefined },
    NOW,
  );
  assert.deepEqual(unquieted.writes[1]?.set, {
    lastSeenAt: NOW,
    updatedAt: NOW,
    quietUntil: null,
  });

  const retokened = deviceDatabase({ updatedRows: 1, deletedRows: 0 });
  await deviceSeams(retokened.database).touchDevice(
    "user-1",
    {
      deviceId: DEVICE_ID,
      activeUntil: undefined,
      push: { token: TOKEN, environment: PUSH_ENVIRONMENT.PRODUCTION },
    },
    NOW,
  );
  assert.deepEqual(
    retokened.writes.map((write) => write.kind),
    ["select", "update", "update"],
  );
  assert.deepEqual(retokened.writes[1]?.set, {
    pushToken: null,
    pushEnvironment: null,
    updatedAt: NOW,
  });
  assert.deepEqual(retokened.writes[2]?.set, {
    lastSeenAt: NOW,
    updatedAt: NOW,
    pushToken: TOKEN,
    pushEnvironment: PUSH_ENVIRONMENT.PRODUCTION,
  });

  const cleared = deviceDatabase({ updatedRows: 1, deletedRows: 0 });
  await deviceSeams(cleared.database).touchDevice(
    "user-1",
    { deviceId: DEVICE_ID, activeUntil: undefined, push: null },
    NOW,
  );
  assert.deepEqual(
    cleared.writes.map((write) => write.kind),
    ["select", "update"],
  );
  assert.deepEqual(cleared.writes[1]?.set, {
    lastSeenAt: NOW,
    updatedAt: NOW,
    pushToken: null,
    pushEnvironment: null,
  });
});

test("a heartbeat for a row the account does not hold moves nothing and says so", async () => {
  const { database } = deviceDatabase({ updatedRows: 0, deletedRows: 0 });
  const seen = await deviceSeams(database).touchDevice(
    "user-1",
    { deviceId: DEVICE_ID, activeUntil: undefined, push: undefined },
    NOW,
  );
  assert.equal(seen, false);
});

test("a forget deletes the account's own row and answers whether one went", async () => {
  const present = deviceDatabase({ updatedRows: 0, deletedRows: 1 });
  assert.equal(await deviceSeams(present.database).forgetDevice("user-1", DEVICE_ID), true);
  assert.deepEqual(present.writes, [{ kind: "delete", hasWhere: true }]);

  const absent = deviceDatabase({ updatedRows: 0, deletedRows: 0 });
  assert.equal(await deviceSeams(absent.database).forgetDevice("user-1", DEVICE_ID), false);
});
