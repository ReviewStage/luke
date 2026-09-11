import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as SqlClient from "@effect/sql/SqlClient";
import { it } from "@effect/vitest";
import { DEVICE_PLATFORM, PUSH_ENVIRONMENT } from "@sidecar/hosted";
import { Effect, Schema } from "effect";
import { forgetDevice, registerDevice, touchDevice } from "../server/hosted/device-store";
import { testSqlClient } from "./support/sql-client";

/**
 * The device seams read as what they now are: effects over the ambient
 * `SqlClient`. Every case reads the row back off the table rather than a
 * recorded write chain, which is what the promise-shaped `deviceSeams` no
 * longer offers a caller to intercept.
 *
 * Synthetic fixtures: no real installation, device, or token anywhere.
 */

const NOW = new Date("2026-09-09T12:00:00.000Z");
const LATER = new Date(NOW.getTime() + 120_000);
const TOKEN = "0a".repeat(32);

const openUser = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const userId = `user-${randomUUID()}`;
  yield* sql`
    insert into "user" (id, name, email)
    values (${userId}, ${"Test User"}, ${`${userId}@luke.test`})
  `;
  return userId;
});

const DeviceRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("user_id")),
  installationId: Schema.propertySignature(Schema.String).pipe(Schema.fromKey("installation_id")),
  platform: Schema.String,
  activeUntil: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("active_until"),
  ),
  quietUntil: Schema.propertySignature(Schema.NullOr(Schema.DateFromSelf)).pipe(
    Schema.fromKey("quiet_until"),
  ),
  pushToken: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("push_token"),
  ),
  pushEnvironment: Schema.propertySignature(Schema.NullOr(Schema.String)).pipe(
    Schema.fromKey("push_environment"),
  ),
  createdAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("created_at")),
  updatedAt: Schema.propertySignature(Schema.DateFromSelf).pipe(Schema.fromKey("updated_at")),
});

const readDeviceByInstallation = (installationId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql`select * from devices where installation_id = ${installationId}`;
    return yield* Schema.decodeUnknown(DeviceRowSchema)(rows[0]);
  });

it.layer(testSqlClient)("the device seams over @effect/sql", (it) => {
  it.effect("a first registration inserts the row under the account with the minted id", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const installationId = randomUUID();
      const deviceId = randomUUID();

      const answer = yield* registerDevice({
        id: deviceId,
        userId,
        installationId,
        platform: DEVICE_PLATFORM.MACOS,
        now: NOW,
        push: undefined,
      });
      assert.deepEqual(answer, { deviceId });

      const row = yield* readDeviceByInstallation(installationId);
      assert.deepEqual(row, {
        id: deviceId,
        userId,
        installationId,
        platform: DEVICE_PLATFORM.MACOS,
        activeUntil: null,
        quietUntil: null,
        pushToken: null,
        pushEnvironment: null,
        createdAt: NOW,
        updatedAt: NOW,
      });
    }),
  );

  it.effect(
    "a registration re-keys the installation's row to the account that presents it, clearing the instants a previous sign-in reported",
    () =>
      Effect.gen(function* () {
        const firstUser = yield* openUser;
        const secondUser = yield* openUser;
        const installationId = randomUUID();
        const deviceId = randomUUID();

        yield* registerDevice({
          id: deviceId,
          userId: firstUser,
          installationId,
          platform: DEVICE_PLATFORM.MACOS,
          now: NOW,
          push: undefined,
        });
        const rekeyed = yield* registerDevice({
          id: randomUUID(),
          userId: secondUser,
          installationId,
          platform: DEVICE_PLATFORM.IOS,
          now: LATER,
          push: undefined,
        });

        assert.deepEqual(rekeyed, { deviceId }, "the existing row's id stands, not the new mint");
        const row = yield* readDeviceByInstallation(installationId);
        assert.equal(row.userId, secondUser);
        assert.equal(row.platform, DEVICE_PLATFORM.IOS);
        assert.deepEqual(row.createdAt, NOW);
        assert.deepEqual(row.updatedAt, LATER);
      }),
  );

  it.effect("a registration with a push token takes it off any other installation first", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const installationA = randomUUID();
      const installationB = randomUUID();

      yield* registerDevice({
        id: randomUUID(),
        userId,
        installationId: installationA,
        platform: DEVICE_PLATFORM.IOS,
        now: NOW,
        push: { token: TOKEN, environment: PUSH_ENVIRONMENT.SANDBOX },
      });
      yield* registerDevice({
        id: randomUUID(),
        userId,
        installationId: installationB,
        platform: DEVICE_PLATFORM.IOS,
        now: LATER,
        push: { token: TOKEN, environment: PUSH_ENVIRONMENT.PRODUCTION },
      });

      const rowA = yield* readDeviceByInstallation(installationA);
      const rowB = yield* readDeviceByInstallation(installationB);
      assert.equal(rowA.pushToken, null);
      assert.equal(rowB.pushToken, TOKEN);
      assert.equal(rowB.pushEnvironment, PUSH_ENVIRONMENT.PRODUCTION);
    }),
  );

  it.effect(
    "a bare heartbeat moves only the instants, and one for a row the account does not hold evicts no token and answers false",
    () =>
      Effect.gen(function* () {
        const userId = yield* openUser;
        const installationId = randomUUID();
        const deviceId = randomUUID();
        yield* registerDevice({
          id: deviceId,
          userId,
          installationId,
          platform: DEVICE_PLATFORM.MACOS,
          now: NOW,
          push: undefined,
        });

        const seen = yield* touchDevice({
          userId,
          deviceId,
          now: LATER,
          activeUntil: undefined,
          quietUntil: undefined,
          push: undefined,
        });
        assert.equal(seen, true);
        const touched = yield* readDeviceByInstallation(installationId);
        assert.deepEqual(touched.updatedAt, LATER);
        assert.equal(touched.activeUntil, null);

        const stranger = yield* openUser;
        const unseen = yield* touchDevice({
          userId: stranger,
          deviceId,
          now: LATER,
          activeUntil: undefined,
          quietUntil: undefined,
          push: { token: TOKEN, environment: PUSH_ENVIRONMENT.SANDBOX },
        });
        assert.equal(unseen, false);
        const untouched = yield* readDeviceByInstallation(installationId);
        assert.equal(untouched.pushToken, null);
      }),
  );

  it.effect("a heartbeat carries presence, a new push address, or a cleared one", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const installationId = randomUUID();
      const deviceId = randomUUID();
      yield* registerDevice({
        id: deviceId,
        userId,
        installationId,
        platform: DEVICE_PLATFORM.MACOS,
        now: NOW,
        push: undefined,
      });

      yield* touchDevice({
        userId,
        deviceId,
        now: LATER,
        activeUntil: LATER,
        quietUntil: undefined,
        push: undefined,
      });
      assert.deepEqual((yield* readDeviceByInstallation(installationId)).activeUntil, LATER);

      yield* touchDevice({
        userId,
        deviceId,
        now: LATER,
        activeUntil: undefined,
        quietUntil: undefined,
        push: { token: TOKEN, environment: PUSH_ENVIRONMENT.PRODUCTION },
      });
      const retokened = yield* readDeviceByInstallation(installationId);
      assert.equal(retokened.pushToken, TOKEN);
      assert.equal(retokened.pushEnvironment, PUSH_ENVIRONMENT.PRODUCTION);

      yield* touchDevice({
        userId,
        deviceId,
        now: LATER,
        activeUntil: undefined,
        quietUntil: undefined,
        push: null,
      });
      const cleared = yield* readDeviceByInstallation(installationId);
      assert.equal(cleared.pushToken, null);
      assert.equal(cleared.pushEnvironment, null);
    }),
  );

  it.effect("a heartbeat with a push token evicts it from any other row first", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const installationA = randomUUID();
      const installationB = randomUUID();
      const deviceB = randomUUID();
      yield* registerDevice({
        id: randomUUID(),
        userId,
        installationId: installationA,
        platform: DEVICE_PLATFORM.IOS,
        now: NOW,
        push: { token: TOKEN, environment: PUSH_ENVIRONMENT.SANDBOX },
      });
      yield* registerDevice({
        id: deviceB,
        userId,
        installationId: installationB,
        platform: DEVICE_PLATFORM.IOS,
        now: NOW,
        push: undefined,
      });

      yield* touchDevice({
        userId,
        deviceId: deviceB,
        now: LATER,
        activeUntil: undefined,
        quietUntil: undefined,
        push: { token: TOKEN, environment: PUSH_ENVIRONMENT.PRODUCTION },
      });

      const rowA = yield* readDeviceByInstallation(installationA);
      const rowB = yield* readDeviceByInstallation(installationB);
      assert.equal(rowA.pushToken, null);
      assert.equal(rowB.pushToken, TOKEN);
    }),
  );

  it.effect("a forget deletes the account's own row and answers whether one went", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const installationId = randomUUID();
      const deviceId = randomUUID();
      yield* registerDevice({
        id: deviceId,
        userId,
        installationId,
        platform: DEVICE_PLATFORM.MACOS,
        now: NOW,
        push: undefined,
      });

      const stranger = yield* openUser;
      assert.equal(yield* forgetDevice(stranger, deviceId), false);
      assert.equal(yield* forgetDevice(userId, deviceId), true);
      assert.equal(yield* forgetDevice(userId, deviceId), false);
    }),
  );
});
