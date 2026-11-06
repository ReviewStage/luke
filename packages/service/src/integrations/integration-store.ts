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

const TXID = { txid: sql<string>`pg_current_xact_id()::text` };

const TxidSchema = Schema.Struct({ txid: Schema.String });

export type IntegrationStoreEffect<A> = Effect.Effect<
  A,
  QueryError | Schema.SchemaError,
  DatabaseServices
>;

export interface IntegrationConnectionRow {
  readonly id: string;
  readonly userId: string;
  readonly provider: IntegrationProvider;
  readonly connectSubject: string;
  readonly connectionName: string;
  readonly label: string | undefined;
  readonly status: IntegrationRowStatus;
  readonly state: string | undefined;
  readonly stateIssuedAt: Date | undefined;
  readonly connectedAt: Date | undefined;
}

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

export function readIntegrationConnection(
  userId: string,
  connectionName: string,
): IntegrationStoreEffect<IntegrationConnectionRow | undefined> {
  return Effect.map(
    findByAccount({ userId, connectionName }),
    Option.match({ onNone: () => undefined, onSome: rowOf }),
  );
}

function storedStatusWord(issuedSince: Date) {
  return sql<string>`case
    when ${eq(integrationConnection.status, INTEGRATION_ROW_STATUS.CONNECTED)} then ${INTEGRATION_STATUS.CONNECTED}
    when ${gte(integrationConnection.stateIssuedAt, issuedSince)} then ${INTEGRATION_STATUS.PENDING}
    when ${eq(integrationConnection.status, INTEGRATION_ROW_STATUS.EXPIRED)} then ${INTEGRATION_STATUS.EXPIRED}
    else ${INTEGRATION_STATUS.DISCONNECTED}
  end`;
}

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

export function readIntegrationConnections(
  userId: string,
): IntegrationStoreEffect<readonly IntegrationConnectionRow[]> {
  return Effect.map(findAllByUser(userId), (rows) => rows.map(rowOf));
}

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

const upsertSignIn = SqlSchema.findAll({
  Request: BeginSchema,
  Result: TxidSchema,
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
        .returning(TXID),
    ),
});

export function beginIntegrationSignIn(
  userId: string,
  account: IntegrationAccountKey,
  state: string,
): IntegrationStoreEffect<string | undefined> {
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
    return taken[0]?.txid;
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
          label: sql`coalesce(nullif(${integrationConnection.label}, ''), ${label})`,
          connectedAt: at,
          tools: null,
          toolsListedAt: null,
          updatedAt: at,
        })
        .where(and(ofAccount(account), eq(integrationConnection.state, state)))
        .returning({ userId: integrationConnection.userId }),
    ),
});

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
  Result: TxidSchema,
  execute: ({ at, label, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ label, updatedAt: at })
        .where(ofAccount(account))
        .returning(TXID),
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

export function fillIntegrationLabel(
  account: Pick<IntegrationConnectionRow, "userId" | "connectionName" | "connectSubject">,
  label: string,
): IntegrationStoreEffect<void> {
  const { userId, connectionName, connectSubject } = account;
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    updateUnlabeled({ userId, connectionName, connectSubject, label, at }),
  );
}

export function renameIntegrationConnection(
  userId: string,
  connectionName: string,
  label: string,
): IntegrationStoreEffect<string | undefined> {
  return Effect.flatMap(DateTime.nowAsDate, (at) =>
    Effect.map(updateLabel({ userId, connectionName, label, at }), (rows) => rows[0]?.txid),
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
  Result: TxidSchema,
  execute: ({ id, ...account }) =>
    Database.use((db) =>
      db
        .delete(integrationConnection)
        .where(and(ofAccount(account), eq(integrationConnection.id, id)))
        .returning(TXID),
    ),
});

export function deleteIntegrationAccount(
  account: Pick<IntegrationConnectionRow, "userId" | "connectionName" | "id">,
): IntegrationStoreEffect<string | undefined> {
  const { userId, connectionName, id } = account;
  return Effect.map(deleteHeld({ userId, connectionName, id }), (deleted) => deleted[0]?.txid);
}

const deleteUnfinished = SqlSchema.findAll({
  Request: CompleteSchema,
  Result: TxidSchema,
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
        )
        .returning(TXID),
    ),
});

const clearState = SqlSchema.findAll({
  Request: CompleteSchema,
  Result: TxidSchema,
  execute: ({ at, state, ...account }) =>
    Database.use((db) =>
      db
        .update(integrationConnection)
        .set({ state: null, stateIssuedAt: null, updatedAt: at })
        .where(and(ofAccount(account), eq(integrationConnection.state, state)))
        .returning(TXID),
    ),
});

export function endIntegrationSignIn(
  userId: string,
  connectionName: string,
  state: string,
): IntegrationStoreEffect<string | undefined> {
  return Effect.gen(function* () {
    const at = yield* DateTime.nowAsDate;
    const deleted = yield* deleteUnfinished({ userId, connectionName, state, at });
    const cleared = yield* clearState({ userId, connectionName, state, at });
    return (cleared[0] ?? deleted[0])?.txid;
  });
}
