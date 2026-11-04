/**
 * integration-store.ts -- the reads and writes of an account's integration rows.
 *
 * A row (`schemas/integration.ts`) is our word on whether our agents may
 * use the grant Connect holds for one account at one provider: `connected`
 * lets them, anything else or no row does not. A user account may hold more
 * than one account at a provider, each its own row under its own connection
 * name, so every read and write here names the row by the user account and
 * that name. A sign-in begins by writing its one-time state beside whatever
 * the row already said, so an account signing in again keeps working while
 * it does; the sign-in completes by setting the row connected and clearing the
 * state, or ends without a grant by clearing the state alone (a first
 * sign-in's row with it); a Disconnect deletes the row. Every function here
 * is an effect over the ambient `SqlClient`.
 */

import { randomUUID } from "node:crypto";
import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import {
  Database,
  type DatabaseServices,
  type QueryError,
  queryBuilder,
} from "@repo/database/core/query";
import {
  INTEGRATION_ROW_STATUS,
  type IntegrationRowStatus,
} from "@repo/database/integration-vocabulary";
import { InstantColumnSchema } from "@repo/database/models/columns";
import { integrationConnection } from "@repo/database/schemas/integration";
import {
  INTEGRATION_STATUS,
  type IntegrationProvider,
  integrationProviderSchema,
} from "@repo/features/integration-wire";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

export type IntegrationStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

/** One account's row at one provider, as the group and the agents read it. */
export interface IntegrationConnectionRow {
  /** The row's own id. */
  readonly id: string;
  readonly userId: string;
  readonly provider: IntegrationProvider;
  /** The subject Connect holds this account's grant under; never answered to a window. */
  readonly connectSubject: string;
  /** The name the account goes by everywhere (`notion`, `notion-2`). */
  readonly connectionName: string;
  /** The account's name at the provider, or the developer's own for it; nothing until either is known. */
  readonly label: string | undefined;
  readonly status: IntegrationRowStatus;
  /** The sign-in under way's own state, which only it may complete under; nothing when none is. */
  readonly state: string | undefined;
  /** When the sign-in under way began; nothing when none is. */
  readonly stateIssuedAt: Date | undefined;
  /** When a sign-in last completed, which names the grant the row stands for; nothing until one has. */
  readonly connectedAt: Date | undefined;
}

/** The account a sign-in is begun for: which provider, the name it goes by, and the subject Connect holds its grant under. */
export interface IntegrationAccountKey {
  readonly provider: IntegrationProvider;
  readonly connectionName: string;
  readonly connectSubject: string;
}

const IntegrationRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  provider: integrationProviderSchema,
  connectSubject: Schema.String,
  connectionName: Schema.String,
  label: Schema.NullOr(Schema.String),
  status: Schema.Literals(Object.values(INTEGRATION_ROW_STATUS)),
  state: Schema.NullOr(Schema.String),
  stateIssuedAt: Schema.NullOr(InstantColumnSchema),
  connectedAt: Schema.NullOr(InstantColumnSchema),
});

const ROW_COLUMNS = {
  id: integrationConnection.id,
  userId: integrationConnection.userId,
  provider: integrationConnection.provider,
  connectSubject: integrationConnection.connectSubject,
  connectionName: integrationConnection.connectionName,
  label: integrationConnection.label,
  status: integrationConnection.status,
  state: integrationConnection.state,
  stateIssuedAt: integrationConnection.stateIssuedAt,
  connectedAt: integrationConnection.connectedAt,
};

function rowOf(row: typeof IntegrationRowSchema.Type): IntegrationConnectionRow {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider,
    connectSubject: row.connectSubject,
    connectionName: row.connectionName,
    label: row.label ?? undefined,
    status: row.status,
    state: row.state ?? undefined,
    stateIssuedAt: row.stateIssuedAt ?? undefined,
    connectedAt: row.connectedAt ?? undefined,
  };
}

const AccountSchema = Schema.Struct({ userId: Schema.String, connectionName: Schema.String });

/** The row one user account holds under one connection name. */
function ofAccount({ userId, connectionName }: typeof AccountSchema.Type) {
  return and(
    eq(integrationConnection.userId, userId),
    eq(integrationConnection.connectionName, connectionName),
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
        .where(eq(integrationConnection.userId, userId))
        .orderBy(integrationConnection.provider, integrationConnection.connectionName),
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

/** The account's row under one connection name, or nothing where it is not connected and is not signing in. */
export function readIntegrationConnection(
  userId: string,
  connectionName: string,
): IntegrationStoreEffect<IntegrationConnectionRow | undefined> {
  return Effect.map(
    findByAccount({ userId, connectionName }),
    Option.match({ onNone: () => undefined, onSome: rowOf }),
  );
}

/**
 * Where a row stands as stored, settling nothing, in the wire's words, as
 * the statuses read answers one that settles nothing
 * (`integrations-procedures.ts`'s `storedStanding`): connected, else
 * pending while a sign-in begun at `issuedSince` or later stands, else
 * expired, else disconnected. Note that a sign-in under way is told by when
 * it began alone, since its state is set and cleared beside that instant
 * and the capture ignores it.
 */
function storedStatusWord(issuedSince: Date) {
  return sql<string>`case
    when ${eq(integrationConnection.status, INTEGRATION_ROW_STATUS.CONNECTED)} then ${INTEGRATION_STATUS.CONNECTED}
    when ${gte(integrationConnection.stateIssuedAt, issuedSince)} then ${INTEGRATION_STATUS.PENDING}
    when ${eq(integrationConnection.status, INTEGRATION_ROW_STATUS.EXPIRED)} then ${INTEGRATION_STATUS.EXPIRED}
    else ${INTEGRATION_STATUS.DISCONNECTED}
  end`;
}

/**
 * Every row the account holds as its live read answers them
 * (`@repo/service`'s `integrationStatusesLive`): each by its id, under the
 * name it goes by, its provider, its label, and where it stands as stored
 * (`storedStatusWord`), each under the key `@repo/features/integration-live`
 * reads it by. Nothing reads the clock: a sign-in's window is bound by the
 * reader as `issuedSince`, and the order is the reader's, since Realtime
 * keeps none. The grant's subject, the state, and the tools are never
 * selected.
 */
export function integrationStatusesLiveStatement(
  userId: string,
  issuedSince: Date,
): Option.Option<LiveStatement> {
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection({
          id: integrationConnection.id,
          connection: integrationConnection.connectionName,
          provider: integrationConnection.provider,
          label: integrationConnection.label,
          status: storedStatusWord(issuedSince),
        }),
      )
      .from(integrationConnection)
      .where(eq(integrationConnection.userId, userId)),
  );
}

/** Every row the account holds, one per account it connected or is signing in to, by provider and then by name. */
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
  id: Schema.String,
  userId: Schema.String,
  provider: integrationProviderSchema,
  connectionName: Schema.String,
  connectSubject: Schema.String,
  state: Schema.String,
  at: Schema.Date,
});

/**
 * Note that the conflicting update leaves the status alone, because an
 * account signing in again stays as connected, or as expired, as it was
 * until the new sign-in completes; it keeps its id, subject, and label for
 * the same reason. It takes only a row under the same subject, so a sign-in for another account that minted the same name
 * meanwhile never puts its state on a row whose grant it would not settle.
 */
const upsertSignIn = SqlSchema.findAll({
  Request: BeginSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, userId, provider, connectionName, connectSubject, state, at }) =>
    Database.use((db) =>
      db
        .insert(integrationConnection)
        .values({
          id,
          userId,
          provider,
          connectSubject,
          connectionName,
          status: INTEGRATION_ROW_STATUS.PENDING,
          state,
          stateIssuedAt: at,
          updatedAt: at,
        })
        .onConflictDoUpdate({
          target: [integrationConnection.userId, integrationConnection.connectionName],
          set: { state, stateIssuedAt: at, updatedAt: at },
          setWhere: eq(integrationConnection.connectSubject, connectSubject),
        })
        .returning({ id: integrationConnection.id }),
    ),
});

/**
 * Records a sign-in under way for one account at a provider, under the
 * state only its callback carries back; answers whether it took, which it does not where the name already
 * stands for another subject's account.
 */
export function beginIntegrationSignIn(
  userId: string,
  account: IntegrationAccountKey,
  state: string,
): IntegrationStoreEffect<boolean> {
  return Effect.gen(function* () {
    const at = yield* DateTime.nowAsDate;
    const taken = yield* upsertSignIn({
      id: randomUUID(),
      userId,
      provider: account.provider,
      connectionName: account.connectionName,
      connectSubject: account.connectSubject,
      state,
      at,
    });
    return taken.length > 0;
  });
}

const StampedSchema = Schema.Struct({
  userId: Schema.String,
  connectionName: Schema.String,
  at: Schema.Date,
});

const CompleteSchema = Schema.Struct({
  userId: Schema.String,
  connectionName: Schema.String,
  state: Schema.String,
  at: Schema.Date,
});

const ConnectedSchema = Schema.Struct({
  userId: Schema.String,
  connectionName: Schema.String,
  state: Schema.String,
  label: Schema.NullOr(Schema.String),
  at: Schema.Date,
});

const updateConnected = SqlSchema.findAll({
  Request: ConnectedSchema,
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ at, state, label, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({
          status: INTEGRATION_ROW_STATUS.CONNECTED,
          state: null,
          stateIssuedAt: null,
          // A label the account already carries, the developer's own among them, is kept over the grant's; an empty one, which a grant that named nothing left, is not.
          label: sql`coalesce(nullif(${integrationConnection.label}, ''), ${label})`,
          connectedAt: at,
          // The tools kept for the grant this sign-in replaces are not this one's.
          tools: null,
          toolsListedAt: null,
          updatedAt: at,
        })
        .where(and(ofAccount(account), eq(integrationConnection.state, state)))
        .returning({ userId: integrationConnection.userId }),
    ),
});

/**
 * Sets one account connected and ends the sign-in begun under `state`,
 * taking the account's name at the provider as its label where it carries
 * none yet; answers whether that sign-in still stood to complete. A
 * Disconnect meanwhile removes it, and a sign-in begun again since replaces
 * its state, so a callback that answered late completes nothing but its own.
 */
export function completeIntegrationSignIn(
  userId: string,
  connectionName: string,
  state: string,
  accountName?: string,
): IntegrationStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.map(
      updateConnected({ userId, connectionName, state, label: accountName ?? null, at }),
      (rows) => rows.length > 0,
    ),
  );
}

const RenameSchema = Schema.Struct({
  userId: Schema.String,
  connectionName: Schema.String,
  label: Schema.String,
  at: Schema.Date,
});

const updateLabel = SqlSchema.findAll({
  Request: RenameSchema,
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ at, label, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ label, updatedAt: at })
        .where(ofAccount(account))
        .returning({ userId: integrationConnection.userId }),
    ),
});

const FillSchema = Schema.Struct({
  userId: Schema.String,
  connectionName: Schema.String,
  connectSubject: Schema.String,
  label: Schema.String,
  at: Schema.Date,
});

const updateUnlabeled = SqlSchema.void({
  Request: FillSchema,
  execute: ({ at, label, connectSubject, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ label, updatedAt: at })
        .where(
          and(
            ofAccount(account),
            eq(integrationConnection.connectSubject, connectSubject),
            or(isNull(integrationConnection.label), eq(integrationConnection.label, "")),
          ),
        ),
    ),
});

/**
 * Labels one account that carries no label yet, or an empty one, with its
 * name at the provider as Connect's grant or the provider read it, or with
 * an empty label where neither named anything, which marks it read so its
 * grant is never asked again for a name; a label the account carries, the
 * developer's own among them, stands. Only the account under the subject the name was read for
 * takes it, so one disconnected and replaced under the same name meanwhile
 * never wears its predecessor's.
 */
export function fillIntegrationLabel(
  account: Pick<IntegrationConnectionRow, "userId" | "connectionName" | "connectSubject">,
  label: string,
): IntegrationStoreEffect<void> {
  const { userId, connectionName, connectSubject } = account;
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    updateUnlabeled({ userId, connectionName, connectSubject, label, at }),
  );
}

/** Names one account as the developer calls it; answers whether the account held such a row. */
export function renameIntegrationConnection(
  userId: string,
  connectionName: string,
  label: string,
): IntegrationStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.map(updateLabel({ userId, connectionName, label, at }), (rows) => rows.length > 0),
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

/** Marks a connected account expired, once Connect answered it holds no grant it can use; any other row stands. */
export function expireIntegrationConnection(
  userId: string,
  connectionName: string,
): IntegrationStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) => updateExpired({ userId, connectionName, at }));
}

const deleteRow = SqlSchema.void({
  Request: AccountSchema,
  execute: (account) =>
    Database.use((db) => db.delete(integrationConnection).where(ofAccount(account))),
});

/** Disconnects one account: its row is gone, so no agent reads a token from the next ask on. */
export function deleteIntegrationConnection(
  userId: string,
  connectionName: string,
): IntegrationStoreEffect<void> {
  return deleteRow({ userId, connectionName });
}

const HeldAccountSchema = Schema.Struct({
  userId: Schema.String,
  connectionName: Schema.String,
  id: Schema.String,
});

const deleteHeld = SqlSchema.findAll({
  Request: HeldAccountSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ id, ...account }) =>
    Database.use((db) =>
      db
        .delete(integrationConnection)
        .where(and(ofAccount(account), eq(integrationConnection.id, id)))
        .returning({ id: integrationConnection.id }),
    ),
});

/**
 * Disconnects the one account read, by its row's own id, and answers
 * whether it was still there: an account added since under the same name
 * stands, even a provider's first, whose subject is always the user's own.
 */
export function deleteIntegrationAccount(
  account: Pick<IntegrationConnectionRow, "userId" | "connectionName" | "id">,
): IntegrationStoreEffect<boolean> {
  const { userId, connectionName, id } = account;
  return Effect.map(deleteHeld({ userId, connectionName, id }), (deleted) => deleted.length > 0);
}

const deleteUnfinished = SqlSchema.void({
  Request: CompleteSchema,
  execute: ({ state, ...account }) =>
    Database.use((db) =>
      db
        .delete(integrationConnection)
        .where(
          and(
            ofAccount(account),
            eq(integrationConnection.state, state),
            eq(integrationConnection.status, INTEGRATION_ROW_STATUS.PENDING),
          ),
        ),
    ),
});

const clearState = SqlSchema.void({
  Request: CompleteSchema,
  execute: ({ at, state, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ state: null, stateIssuedAt: null, updatedAt: at })
        .where(and(ofAccount(account), eq(integrationConnection.state, state))),
    ),
});

/**
 * Ends the sign-in begun under `state` without a grant, as a browser that
 * came back without one ends it: a first sign-in's row goes, so the account
 * stands disconnected, and a row that stood before it keeps its status and
 * loses only the state. A sign-in begun again since carries another state,
 * so it is left to run.
 */
export function endIntegrationSignIn(
  userId: string,
  connectionName: string,
  state: string,
): IntegrationStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.andThen(
      deleteUnfinished({ userId, connectionName, state, at }),
      clearState({ userId, connectionName, state, at }),
    ),
  );
}
