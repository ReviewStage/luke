/**
 * integration-store.ts -- the reads and writes of an account's integration rows.
 *
 * A row (`schemas/integration.ts`) is Luke's word on whether its agents may
 * use the account's grant at one provider: `connected` lets them, anything
 * else or no row does not. A sign-in begins by writing its one-time state
 * beside whatever the row already said, so an account signing in again keeps
 * working while it does; the sign-in completes by setting the row connected
 * and clearing the state; a Disconnect deletes the row. Every function here
 * is an effect over the ambient `SqlClient`.
 */

import { Database, type DatabaseServices, type QueryError } from "@sidecar/database/core/query";
import { InstantColumnSchema } from "@sidecar/database/models/columns";
import { integrationConnection } from "@sidecar/database/schemas/integration";
import {
  type IntegrationProvider,
  integrationProviderSchema,
} from "@sidecar/hosted/integration-wire";
import { and, eq } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

/** What a row's status may say. No row is a disconnected provider. */
export const INTEGRATION_ROW_STATUS = {
  /** A first sign-in is under way and has not completed. */
  PENDING: "pending",
  /** A sign-in completed and Connect last answered with a token. */
  CONNECTED: "connected",
  /** The account was connected, and Connect then answered it holds no grant it can use. */
  EXPIRED: "expired",
} as const;

type IntegrationRowStatus = (typeof INTEGRATION_ROW_STATUS)[keyof typeof INTEGRATION_ROW_STATUS];

export type IntegrationStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** One account's row at one provider, as the group and the agents read it. */
export interface IntegrationConnectionRow {
  readonly userId: string;
  readonly provider: IntegrationProvider;
  readonly status: IntegrationRowStatus;
  /** The sign-in under way's own state, which only it may complete under; nothing when none is. */
  readonly state: string | undefined;
  /** When the sign-in under way began; nothing when none is. */
  readonly stateIssuedAt: Date | undefined;
  /** When a sign-in last completed, which names the grant the row stands for; nothing until one has. */
  readonly connectedAt: Date | undefined;
}

const IntegrationRowSchema = Schema.Struct({
  userId: Schema.String,
  provider: integrationProviderSchema,
  status: Schema.Literals(Object.values(INTEGRATION_ROW_STATUS)),
  state: Schema.NullOr(Schema.String),
  stateIssuedAt: Schema.NullOr(InstantColumnSchema),
  connectedAt: Schema.NullOr(InstantColumnSchema),
});

const ROW_COLUMNS = {
  userId: integrationConnection.userId,
  provider: integrationConnection.provider,
  status: integrationConnection.status,
  state: integrationConnection.state,
  stateIssuedAt: integrationConnection.stateIssuedAt,
  connectedAt: integrationConnection.connectedAt,
};

function rowOf(row: typeof IntegrationRowSchema.Type): IntegrationConnectionRow {
  return {
    userId: row.userId,
    provider: row.provider,
    status: row.status,
    state: row.state ?? undefined,
    stateIssuedAt: row.stateIssuedAt ?? undefined,
    connectedAt: row.connectedAt ?? undefined,
  };
}

const AccountSchema = Schema.Struct({ userId: Schema.String, provider: integrationProviderSchema });

/** The row one account holds at one provider. */
function ofAccount({ userId, provider }: typeof AccountSchema.Type) {
  return and(
    eq(integrationConnection.userId, userId),
    eq(integrationConnection.provider, provider),
  );
}

const findByAccount = SqlSchema.findOneOption({
  Request: AccountSchema,
  Result: IntegrationRowSchema,
  execute: (account) =>
    Database.use((db) =>
      db.select(ROW_COLUMNS).from(integrationConnection).where(ofAccount(account)),
    ),
});

const findAllByUser = SqlSchema.findAll({
  Request: Schema.String,
  Result: IntegrationRowSchema,
  execute: (userId) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(integrationConnection)
        .where(eq(integrationConnection.userId, userId)),
    ),
});

const findByState = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: IntegrationRowSchema,
  execute: (state) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(integrationConnection)
        .where(eq(integrationConnection.state, state)),
    ),
});

/** The account's row at one provider, or nothing where it is not connected and is not signing in. */
export function readIntegrationConnection(
  userId: string,
  provider: IntegrationProvider,
): IntegrationStoreEffect<IntegrationConnectionRow | undefined> {
  return Effect.map(
    findByAccount({ userId, provider }),
    Option.match({ onNone: () => undefined, onSome: rowOf }),
  );
}

/** Every row the account holds, one per provider it connected or is signing in to. */
export function readIntegrationConnections(
  userId: string,
): IntegrationStoreEffect<readonly IntegrationConnectionRow[]> {
  return Effect.map(findAllByUser(userId), (rows) => rows.map(rowOf));
}

/** The row whose sign-in under way carries this state, at whichever provider, or nothing where none does. */
export function readIntegrationSignIn(
  state: string,
): IntegrationStoreEffect<IntegrationConnectionRow | undefined> {
  return Effect.map(findByState(state), Option.match({ onNone: () => undefined, onSome: rowOf }));
}

const BeginSchema = Schema.Struct({
  userId: Schema.String,
  provider: integrationProviderSchema,
  state: Schema.String,
  at: Schema.Date,
});

/**
 * Note that the conflicting update leaves the status alone, because an
 * account signing in again stays as connected, or as expired, as it was
 * until the new sign-in completes.
 */
const upsertSignIn = SqlSchema.void({
  Request: BeginSchema,
  execute: ({ userId, provider, state, at }) =>
    Database.use((db) =>
      db
        .insert(integrationConnection)
        .values({
          userId,
          provider,
          status: INTEGRATION_ROW_STATUS.PENDING,
          state,
          stateIssuedAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [integrationConnection.userId, integrationConnection.provider],
          set: { state, stateIssuedAt: at, updatedAt: at },
        }),
    ),
});

/** Records a sign-in to one provider under way for the account, under the state only its callback carries back. */
export function beginIntegrationSignIn(
  userId: string,
  provider: IntegrationProvider,
  state: string,
): IntegrationStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) => upsertSignIn({ userId, provider, state, at }));
}

const StampedSchema = Schema.Struct({
  userId: Schema.String,
  provider: integrationProviderSchema,
  at: Schema.Date,
});

const CompleteSchema = Schema.Struct({
  userId: Schema.String,
  provider: integrationProviderSchema,
  state: Schema.String,
  at: Schema.Date,
});

const updateConnected = SqlSchema.findAll({
  Request: CompleteSchema,
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ at, state, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({
          status: INTEGRATION_ROW_STATUS.CONNECTED,
          state: null,
          stateIssuedAt: null,
          connectedAt: at,
          updatedAt: at,
        })
        .where(and(ofAccount(account), eq(integrationConnection.state, state)))
        .returning({ userId: integrationConnection.userId }),
    ),
});

/**
 * Sets the account connected to one provider and ends the sign-in begun
 * under `state`; answers whether that sign-in still stood to complete. A
 * Disconnect meanwhile removes it, and a sign-in begun again since replaces
 * its state, so a callback that answered late completes nothing but its own.
 */
export function completeIntegrationSignIn(
  userId: string,
  provider: IntegrationProvider,
  state: string,
): IntegrationStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.map(updateConnected({ userId, provider, state, at }), (rows) => rows.length > 0),
  );
}

const updateExpired = SqlSchema.void({
  Request: StampedSchema,
  execute: ({ at, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ status: INTEGRATION_ROW_STATUS.EXPIRED, updatedAt: at })
        .where(
          and(
            ofAccount(account),
            eq(integrationConnection.status, INTEGRATION_ROW_STATUS.CONNECTED),
          ),
        ),
    ),
});

/** Marks a connected provider expired, once Connect answered it holds no grant it can use; any other row stands. */
export function expireIntegrationConnection(
  userId: string,
  provider: IntegrationProvider,
): IntegrationStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) => updateExpired({ userId, provider, at }));
}

const deleteRow = SqlSchema.void({
  Request: AccountSchema,
  execute: (account) =>
    Database.use((db) => db.delete(integrationConnection).where(ofAccount(account))),
});

/** Disconnects the account from one provider: its row is gone, so no agent reads a token from the next ask on. */
export function deleteIntegrationConnection(
  userId: string,
  provider: IntegrationProvider,
): IntegrationStoreEffect<void> {
  return deleteRow({ userId, provider });
}
