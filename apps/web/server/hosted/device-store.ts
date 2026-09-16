import { and, eq, ne } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { devices } from "../db/devices-schema.js";
import { db } from "../db/query.js";
import type { DeviceSeams } from "./devices.js";

/**
 * The device seams over `effect/unstable/sql`. A push token is unique across rows
 * because Apple issues one per installation: a reinstall that minted a fresh
 * installation id but kept its token takes the token off the old row in the
 * same transaction, so the row that can be addressed is always the one that
 * last said so. Every write is scoped to the account the bearer resolved to,
 * except that eviction, which is scoped to the token itself and runs only
 * where the caller's own row takes the token in the same transaction: the
 * token then belongs to whoever just presented it, whichever account held
 * the old row, and a caller who takes nothing evicts nothing.
 */

type DeviceFailure = SqlError | Schema.SchemaError;

const DeviceIdRowSchema = Schema.Struct({ id: Schema.String });

const PushAddressSchema = Schema.Struct({ token: Schema.String, environment: Schema.String });

/** The push columns as a row loses them, which is what an eviction and a cleared report both write. */
const NO_PUSH_ADDRESS = { pushToken: null, pushEnvironment: null } as const;

const RegisterWriteSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  installationId: Schema.String,
  platform: Schema.String,
  now: Schema.Date,
  push: Schema.UndefinedOr(PushAddressSchema),
});

type RegisterWrite = Schema.Schema.Type<typeof RegisterWriteSchema>;

/**
 * What a registration writes on the row the installation already has: the
 * account and platform it now reports, its presence cleared because a
 * registration reports none of its own, and the push address only where it
 * named one — a registration that named none leaves the row's alone.
 */
interface RegisteredColumns {
  userId: string;
  platform: string;
  lastSeenAt: Date;
  activeUntil: null;
  quietUntil: null;
  updatedAt: Date;
  pushToken?: string;
  pushEnvironment?: string;
}

function registeredColumns(write: RegisterWrite): RegisteredColumns {
  const columns: RegisteredColumns = {
    userId: write.userId,
    platform: write.platform,
    lastSeenAt: write.now,
    activeUntil: null,
    quietUntil: null,
    updatedAt: write.now,
  };
  if (write.push) {
    columns.pushToken = write.push.token;
    columns.pushEnvironment = write.push.environment;
  }
  return columns;
}

const upsertDeviceRow = SqlSchema.findOneOption({
  Request: RegisterWriteSchema,
  Result: DeviceIdRowSchema,
  execute: (write) =>
    Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.withTransaction(
        Effect.gen(function* () {
          if (write.push) {
            yield* db
              .update(devices)
              .set({ ...NO_PUSH_ADDRESS, updatedAt: write.now })
              .where(
                and(
                  eq(devices.pushToken, write.push.token),
                  ne(devices.installationId, write.installationId),
                ),
              );
          }
          // Note that the conflicting update sets the values the insert
          // carried rather than reading them back out of `excluded`, because
          // a single-row insert's `excluded` row is exactly those values.
          return yield* db
            .insert(devices)
            .values({
              id: write.id,
              userId: write.userId,
              installationId: write.installationId,
              platform: write.platform,
              lastSeenAt: write.now,
              activeUntil: null,
              quietUntil: null,
              pushToken: write.push?.token ?? null,
              pushEnvironment: write.push?.environment ?? null,
              createdAt: write.now,
              updatedAt: write.now,
            })
            .onConflictDoUpdate({
              target: devices.installationId,
              set: registeredColumns(write),
            })
            .returning({ id: devices.id });
        }),
      ),
    ),
});

/** Upserts the installation's row under the account, evicting the push token from any other row first. */
export function registerDevice(write: {
  readonly id: string;
  readonly userId: string;
  readonly installationId: string;
  readonly platform: string;
  readonly now: Date;
  readonly push: { readonly token: string; readonly environment: string } | undefined;
}): Effect.Effect<{ deviceId: string }, DeviceFailure, SqlClient.SqlClient> {
  return Effect.flatMap(upsertDeviceRow(write), (row) =>
    Option.match(row, {
      onNone: () => Effect.die(new Error("The device upsert returned no row.")),
      onSome: (found) => Effect.succeed({ deviceId: found.id }),
    }),
  );
}

const HeldDeviceSchema = Schema.Struct({ userId: Schema.String, deviceId: Schema.String });

const HeldDeviceRowSchema = Schema.Struct({ id: Schema.String, platform: Schema.String });

/**
 * The account's own device row by id, or none: the one fact a voice session's
 * device claim is admitted on, with the platform the row named beside it, so
 * the caller a session was opened from is read here rather than from a header
 * the caller chose. The platform is answered as the column holds it, a word
 * this build may not know, and `isDevicePlatform` is what narrows it.
 */
export const findHeldDevice = SqlSchema.findOneOption({
  Request: HeldDeviceSchema,
  Result: HeldDeviceRowSchema,
  execute: (key) =>
    db
      .select({ id: devices.id, platform: devices.platform })
      .from(devices)
      .where(and(eq(devices.userId, key.userId), eq(devices.id, key.deviceId)))
      .limit(1),
});

const TouchWriteSchema = Schema.Struct({
  userId: Schema.String,
  deviceId: Schema.String,
  now: Schema.Date,
  activeUntil: Schema.NullishOr(Schema.Date),
  quietUntil: Schema.NullishOr(Schema.Date),
  push: Schema.NullishOr(PushAddressSchema),
});

type TouchWrite = Schema.Schema.Type<typeof TouchWriteSchema>;

/**
 * What a heartbeat writes on the row: the instant it was seen, and whichever
 * of its three reports it carried. A column the heartbeat said nothing of is
 * absent here rather than written back, so a report that carries one instant
 * cannot blank the other, and one that named no push address leaves the row's
 * standing.
 */
interface TouchedColumns {
  lastSeenAt: Date;
  updatedAt: Date;
  activeUntil?: Date | null;
  quietUntil?: Date | null;
  pushToken?: string | null;
  pushEnvironment?: string | null;
}

function touchedColumns(write: TouchWrite): TouchedColumns {
  const columns: TouchedColumns = { lastSeenAt: write.now, updatedAt: write.now };
  if (write.activeUntil !== undefined) columns.activeUntil = write.activeUntil;
  if (write.quietUntil !== undefined) columns.quietUntil = write.quietUntil;
  if (write.push === null) {
    columns.pushToken = null;
    columns.pushEnvironment = null;
  } else if (write.push !== undefined) {
    columns.pushToken = write.push.token;
    columns.pushEnvironment = write.push.environment;
  }
  return columns;
}

const touchDeviceRow = SqlSchema.findAll({
  Request: TouchWriteSchema,
  Result: DeviceIdRowSchema,
  execute: (write) =>
    Effect.flatMap(SqlClient.SqlClient, (client) =>
      client.withTransaction(
        Effect.gen(function* () {
          const held = yield* findHeldDevice({ userId: write.userId, deviceId: write.deviceId });
          if (Option.isNone(held)) return [];
          if (write.push) {
            yield* db
              .update(devices)
              .set({ ...NO_PUSH_ADDRESS, updatedAt: write.now })
              .where(and(eq(devices.pushToken, write.push.token), ne(devices.id, write.deviceId)));
          }
          return yield* db
            .update(devices)
            .set(touchedColumns(write))
            .where(and(eq(devices.userId, write.userId), eq(devices.id, write.deviceId)))
            .returning({ id: devices.id });
        }),
      ),
    ),
});

/** Moves the row's last-seen instant and applies the heartbeat's changes; answers whether the account holds the row. */
export function touchDevice(write: {
  readonly userId: string;
  readonly deviceId: string;
  readonly now: Date;
  readonly activeUntil: Date | null | undefined;
  readonly quietUntil: Date | null | undefined;
  readonly push: { readonly token: string; readonly environment: string } | null | undefined;
}): Effect.Effect<boolean, DeviceFailure, SqlClient.SqlClient> {
  return Effect.map(touchDeviceRow(write), (rows) => rows.length > 0);
}

const ForgetDeviceSchema = Schema.Struct({ userId: Schema.String, deviceId: Schema.String });

const deleteDeviceRow = SqlSchema.findAll({
  Request: ForgetDeviceSchema,
  Result: DeviceIdRowSchema,
  execute: (key) =>
    db
      .delete(devices)
      .where(and(eq(devices.userId, key.userId), eq(devices.id, key.deviceId)))
      .returning({ id: devices.id }),
});

/** Deletes the row only where this account holds it; answers whether one went. */
export function forgetDevice(
  userId: string,
  deviceId: string,
): Effect.Effect<boolean, DeviceFailure, SqlClient.SqlClient> {
  return Effect.map(deleteDeviceRow({ userId, deviceId }), (rows) => rows.length > 0);
}

export function deviceSeams(): DeviceSeams {
  return {
    registerDevice: (userId, registration, mintId, now) =>
      registerDevice({
        id: mintId(),
        userId,
        installationId: registration.installationId,
        platform: registration.platform,
        now,
        push: registration.push,
      }),
    touchDevice: (userId, heartbeat, now) =>
      touchDevice({
        userId,
        deviceId: heartbeat.deviceId,
        now,
        activeUntil: heartbeat.activeUntil,
        quietUntil: heartbeat.quietUntil,
        push: heartbeat.push,
      }),
    forgetDevice: (userId, deviceId) => forgetDevice(userId, deviceId),
  };
}
