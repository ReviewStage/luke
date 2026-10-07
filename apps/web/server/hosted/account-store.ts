import { type AccountPreferences, accountPreferencesFromStored } from "@sidecar/settings";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { user } from "../db/auth-schema.js";
import { accountPreference } from "../db/preferences-schema.js";
import { db } from "../db/query.js";
import { InstantColumnSchema } from "./store/database.js";

/**
 * What the account group reads and writes of an account: the erasure, and
 * the cross-device preferences snapshot behind `/api/account/preferences`.
 * Every function here is an effect over the ambient `SqlClient` and names no
 * database of its own; `account-seams.ts` beside it runs them at the web
 * edge and is the only file of the two that reaches the auth session.
 */

type AccountSeamFailure = SqlError | Schema.SchemaError;

/** One account's stored snapshot: the preferences every device shares, and the instant they were written. */
export interface AccountPreferencesRow {
  preferences: AccountPreferences;
  updatedAt: Date;
}

/** What an account seam answers: an effect over the ambient client, composed into the request that made it. */
export type AccountSeamEffect<A> = Effect.Effect<A, AccountSeamFailure, SqlClient.SqlClient>;

/**
 * The account's erasure is the one delete, and the row's own foreign keys are
 * what carry it: every table naming a user declares `on delete cascade`, so
 * the dependent rows go with the row that names them, in one statement and
 * therefore as one unit. Nothing here enumerates the dependents, because a
 * list here could fall behind a table added later and leave a row standing
 * after the account it belongs to is gone.
 */
const deleteUserRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) => db.delete(user).where(eq(user.id, userId)),
});

/** Erases the user row; every dependent row cascades with it. */
export function deleteAccount(
  userId: string,
): Effect.Effect<void, AccountSeamFailure, SqlClient.SqlClient> {
  return deleteUserRow(userId);
}

const PreferenceRowSchema = Schema.Struct({
  voice: Schema.NullOr(Schema.String),
  updatedAt: InstantColumnSchema,
});

const findPreference = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: PreferenceRowSchema,
  execute: (userId) =>
    db
      .select({
        voice: accountPreference.voice,
        updatedAt: accountPreference.updatedAt,
      })
      .from(accountPreference)
      .where(eq(accountPreference.userId, userId))
      .limit(1),
});

/** One account's stored snapshot, or nothing for an account that has stored none. */
export function readAccountPreferences(
  userId: string,
): Effect.Effect<AccountPreferencesRow | undefined, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.map(
    findPreference(userId),
    Option.match({
      onNone: () => undefined,
      onSome: (row) => ({
        preferences: accountPreferencesFromStored(row.voice ? { voice: row.voice } : {}) ?? {},
        updatedAt: row.updatedAt,
      }),
    }),
  );
}

const PreferenceWriteSchema = Schema.Struct({
  userId: Schema.String,
  voice: Schema.NullOr(Schema.String),
  updatedAt: Schema.Date,
});

/**
 * Note that the conflicting update sets the values the insert carried rather
 * than reading them back out of `excluded`, because a single-row insert's
 * `excluded` row is exactly those values.
 */
const upsertPreference = SqlSchema.void({
  Request: PreferenceWriteSchema,
  execute: (write) =>
    db
      .insert(accountPreference)
      .values({
        userId: write.userId,
        voice: write.voice,
        updatedAt: write.updatedAt,
      })
      .onConflictDoUpdate({
        target: accountPreference.userId,
        set: { voice: write.voice, updatedAt: write.updatedAt },
      }),
});

/** Replaces the account's stored snapshot whole, and answers the instant it was written. */
export function writeAccountPreferences(
  userId: string,
  preferences: AccountPreferences,
): Effect.Effect<Date, AccountSeamFailure, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const updatedAt = yield* DateTime.nowAsDate;
    yield* upsertPreference({ userId, voice: preferences.voice ?? null, updatedAt });
    return updatedAt;
  });
}
