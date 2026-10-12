/**
 * linear-store.ts -- the reads and writes of an account's Linear connection row.
 *
 * The row (`db/linear-schema.ts`) is Luke's word on whether its agents may
 * use the account's Linear grant: `connected` lets them, anything else or no
 * row does not. A sign-in begins by writing its one-time state beside
 * whatever the row already said, so an account signing in again keeps
 * working while it does; the sign-in completes by setting the row connected
 * and clearing the state; a Disconnect deletes the row. Every function here
 * is an effect over the ambient `SqlClient`.
 */

import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { type SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { linearConnection } from "../db/linear-schema.js";
import { db } from "../db/query.js";
import { InstantColumnSchema } from "./store/database.js";

/** What a row's status may say. No row is a disconnected account. */
export const LINEAR_ROW_STATUS = {
  /** A first sign-in is under way and has not completed. */
  PENDING: "pending",
  /** A sign-in completed and Connect last answered with a token. */
  CONNECTED: "connected",
  /** The account was connected, and Connect then answered it holds no grant it can use. */
  EXPIRED: "expired",
} as const;

export type LinearRowStatus = (typeof LINEAR_ROW_STATUS)[keyof typeof LINEAR_ROW_STATUS];

export type LinearStoreEffect<A> = Effect.Effect<
  A,
  SqlError | Schema.SchemaError,
  SqlClient.SqlClient
>;

/** One account's row as the group and the agents read it. */
export interface LinearConnectionRow {
  readonly userId: string;
  readonly status: LinearRowStatus;
  /** When the sign-in under way began; nothing when none is. */
  readonly stateIssuedAt: Date | undefined;
}

const LinearRowSchema = Schema.Struct({
  userId: Schema.String,
  status: Schema.Literals(Object.values(LINEAR_ROW_STATUS)),
  stateIssuedAt: Schema.NullOr(InstantColumnSchema),
});

const ROW_COLUMNS = {
  userId: linearConnection.userId,
  status: linearConnection.status,
  stateIssuedAt: linearConnection.stateIssuedAt,
};

function rowOf(row: typeof LinearRowSchema.Type): LinearConnectionRow {
  return { userId: row.userId, status: row.status, stateIssuedAt: row.stateIssuedAt ?? undefined };
}

const findByUser = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: LinearRowSchema,
  execute: (userId) =>
    db.select(ROW_COLUMNS).from(linearConnection).where(eq(linearConnection.userId, userId)),
});

const findByState = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: LinearRowSchema,
  execute: (state) =>
    db.select(ROW_COLUMNS).from(linearConnection).where(eq(linearConnection.state, state)),
});

/** The account's row, or nothing for an account that is not connected and is not signing in. */
export function readLinearConnection(
  userId: string,
): LinearStoreEffect<LinearConnectionRow | undefined> {
  return Effect.map(findByUser(userId), Option.match({ onNone: () => undefined, onSome: rowOf }));
}

/** The row whose sign-in under way carries this state, or nothing where none does. */
export function readLinearSignIn(
  state: string,
): LinearStoreEffect<LinearConnectionRow | undefined> {
  return Effect.map(findByState(state), Option.match({ onNone: () => undefined, onSome: rowOf }));
}

const BeginSchema = Schema.Struct({ userId: Schema.String, state: Schema.String, at: Schema.Date });

/**
 * Note that the conflicting update leaves the status alone, because an
 * account signing in again stays as connected, or as expired, as it was
 * until the new sign-in completes.
 */
const upsertSignIn = SqlSchema.void({
  Request: BeginSchema,
  execute: ({ userId, state, at }) =>
    db
      .insert(linearConnection)
      .values({
        userId,
        status: LINEAR_ROW_STATUS.PENDING,
        state,
        stateIssuedAt: at,
        updatedAt: at,
      })
      .onConflictDoUpdate({
        target: linearConnection.userId,
        set: { state, stateIssuedAt: at, updatedAt: at },
      }),
});

/** Records a sign-in under way for the account, under the state only its callback carries back. */
export function beginLinearSignIn(userId: string, state: string): LinearStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) => upsertSignIn({ userId, state, at }));
}

const CompleteSchema = Schema.Struct({ userId: Schema.String, at: Schema.Date });

const updateConnected = SqlSchema.findAll({
  Request: CompleteSchema,
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, at }) =>
    db
      .update(linearConnection)
      .set({
        status: LINEAR_ROW_STATUS.CONNECTED,
        state: null,
        stateIssuedAt: null,
        connectedAt: at,
        updatedAt: at,
      })
      .where(eq(linearConnection.userId, userId))
      .returning({ userId: linearConnection.userId }),
});

/** Sets the account connected and ends its sign-in; answers whether a row stood to set, which a Disconnect meanwhile removes. */
export function completeLinearSignIn(userId: string): LinearStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.map(updateConnected({ userId, at }), (rows) => rows.length > 0),
  );
}

const updateExpired = SqlSchema.void({
  Request: CompleteSchema,
  execute: ({ userId, at }) =>
    db
      .update(linearConnection)
      .set({ status: LINEAR_ROW_STATUS.EXPIRED, updatedAt: at })
      .where(
        and(
          eq(linearConnection.userId, userId),
          eq(linearConnection.status, LINEAR_ROW_STATUS.CONNECTED),
        ),
      ),
});

/** Marks a connected account expired, once Connect answered it holds no grant it can use; any other row stands. */
export function expireLinearConnection(userId: string): LinearStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) => updateExpired({ userId, at }));
}

const deleteRow = SqlSchema.void({
  Request: Schema.String,
  execute: (userId) => db.delete(linearConnection).where(eq(linearConnection.userId, userId)),
});

/** Disconnects the account: its row is gone, so no agent reads a token from the next ask on. */
export function deleteLinearConnection(userId: string): LinearStoreEffect<void> {
  return deleteRow(userId);
}
