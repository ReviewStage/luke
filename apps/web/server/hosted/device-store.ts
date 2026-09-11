import { SqlClient, SqlSchema } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, Option, type ParseResult, Schema } from "effect";
import type { DeviceSeams } from "./devices.js";
import type { HostedStoreRun } from "./store/database.js";

/**
 * The device seams over `@effect/sql`. A push token is unique across rows
 * because Apple issues one per installation: a reinstall that minted a fresh
 * installation id but kept its token takes the token off the old row in the
 * same transaction, so the row that can be addressed is always the one that
 * last said so. Every write is scoped to the account the bearer resolved to,
 * except that eviction, which is scoped to the token itself and runs only
 * where the caller's own row takes the token in the same transaction: the
 * token then belongs to whoever just presented it, whichever account held
 * the old row, and a caller who takes nothing evicts nothing.
 */

type DeviceFailure = SqlError | ParseResult.ParseError;

/** A statement over the ambient client, so the query below reads as the query it is. */
const statement = <A, E>(build: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>) =>
  Effect.flatMap(SqlClient.SqlClient, build);

const DeviceIdRowSchema = Schema.Struct({ id: Schema.String });

const PushAddressSchema = Schema.Struct({ token: Schema.String, environment: Schema.String });

const RegisterWriteSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  installationId: Schema.String,
  platform: Schema.String,
  now: Schema.DateFromSelf,
  push: Schema.UndefinedOr(PushAddressSchema),
});

const upsertDeviceRow = SqlSchema.findOne({
  Request: RegisterWriteSchema,
  Result: DeviceIdRowSchema,
  execute: (write) =>
    statement((sql) =>
      sql.withTransaction(
        Effect.gen(function* () {
          if (write.push) {
            yield* sql`
              update devices
              set push_token = null, push_environment = null, updated_at = ${write.now}
              where push_token = ${write.push.token} and installation_id <> ${write.installationId}
            `;
          }
          return yield* sql`
            insert into devices (
              id, user_id, installation_id, platform, last_seen_at,
              active_until, quiet_until, push_token, push_environment, created_at, updated_at
            )
            values (
              ${write.id}, ${write.userId}, ${write.installationId}, ${write.platform}, ${write.now},
              null, null, ${write.push?.token ?? null}, ${write.push?.environment ?? null}, ${write.now}, ${write.now}
            )
            on conflict (installation_id) do update
              set ${sql.csv([
                "user_id = excluded.user_id",
                "platform = excluded.platform",
                "last_seen_at = excluded.last_seen_at",
                "active_until = null",
                "quiet_until = null",
                "updated_at = excluded.updated_at",
                ...(write.push
                  ? [
                      "push_token = excluded.push_token",
                      "push_environment = excluded.push_environment",
                    ]
                  : []),
              ])}
            returning id
          `;
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

/** The account's own device row by id, or none: the one fact a voice session's device claim is admitted on. */
export const findHeldDevice = SqlSchema.findOne({
  Request: HeldDeviceSchema,
  Result: DeviceIdRowSchema,
  execute: (key) =>
    statement(
      (sql) => sql`
        select id from devices where user_id = ${key.userId} and id = ${key.deviceId} limit 1
      `,
    ),
});

const TouchWriteSchema = Schema.Struct({
  userId: Schema.String,
  deviceId: Schema.String,
  now: Schema.DateFromSelf,
  activeUntil: Schema.NullishOr(Schema.DateFromSelf),
  quietUntil: Schema.NullishOr(Schema.DateFromSelf),
  push: Schema.NullishOr(PushAddressSchema),
});

const touchDeviceRow = SqlSchema.findAll({
  Request: TouchWriteSchema,
  Result: DeviceIdRowSchema,
  execute: (write) =>
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql.withTransaction(
        Effect.gen(function* () {
          const held = yield* findHeldDevice({ userId: write.userId, deviceId: write.deviceId });
          if (Option.isNone(held)) return [];
          if (write.push) {
            yield* sql`
              update devices
              set push_token = null, push_environment = null, updated_at = ${write.now}
              where push_token = ${write.push.token} and id <> ${write.deviceId}
            `;
          }
          const clauses = [sql`last_seen_at = ${write.now}`, sql`updated_at = ${write.now}`];
          if (write.activeUntil !== undefined)
            clauses.push(sql`active_until = ${write.activeUntil}`);
          if (write.quietUntil !== undefined) clauses.push(sql`quiet_until = ${write.quietUntil}`);
          if (write.push === null) {
            clauses.push(sql`push_token = null`, sql`push_environment = null`);
          } else if (write.push !== undefined) {
            clauses.push(
              sql`push_token = ${write.push.token}`,
              sql`push_environment = ${write.push.environment}`,
            );
          }
          return yield* sql`
            update devices
            set ${sql.csv(clauses)}
            where user_id = ${write.userId} and id = ${write.deviceId}
            returning id
          `;
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
    statement(
      (sql) => sql`
        delete from devices where user_id = ${key.userId} and id = ${key.deviceId} returning id
      `,
    ),
});

/** Deletes the row only where this account holds it; answers whether one went. */
export function forgetDevice(
  userId: string,
  deviceId: string,
): Effect.Effect<boolean, DeviceFailure, SqlClient.SqlClient> {
  return Effect.map(deleteDeviceRow({ userId, deviceId }), (rows) => rows.length > 0);
}

export function deviceSeams(run: HostedStoreRun): DeviceSeams {
  return {
    registerDevice: (userId, registration, mintId, now) =>
      run(
        registerDevice({
          id: mintId(),
          userId,
          installationId: registration.installationId,
          platform: registration.platform,
          now,
          push: registration.push,
        }),
      ),
    touchDevice: (userId, heartbeat, now) =>
      run(
        touchDevice({
          userId,
          deviceId: heartbeat.deviceId,
          now,
          activeUntil: heartbeat.activeUntil,
          quietUntil: heartbeat.quietUntil,
          push: heartbeat.push,
        }),
      ),
    forgetDevice: (userId, deviceId) => run(forgetDevice(userId, deviceId)),
  };
}
