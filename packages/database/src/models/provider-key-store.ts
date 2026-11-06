import {
  FAST_ACCESS,
  type FastAccess,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@repo/features/provider-key-wire";
import { and, asc, eq, lte, ne } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices } from "../core/query.js";
import { accountProviderKey } from "../schemas/account-provider-key.js";
import { InstantColumnSchema } from "./columns.js";
import type { SealedProviderKey } from "./provider-key-seal.js";
import type { TaskStoreEffect, TaskStoreFailure } from "./task-store.js";

const ProviderSchema = Schema.Literals(Object.values(PROVIDER_KEY_PROVIDER));

const FastAccessSchema = Schema.Literals(Object.values(FAST_ACCESS));

const KindSchema = Schema.Literals(Object.values(PROVIDER_KEY_KIND));

const SealedRowSchema = Schema.Struct({
  provider: ProviderSchema,
  kind: KindSchema,
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedKey: Schema.String,
  hint: Schema.String,
  status: Schema.Literals(Object.values(PROVIDER_KEY_STATUS)),
  statusAt: InstantColumnSchema,
  fastAccess: Schema.NullOr(FastAccessSchema),
  accessExpiresAt: Schema.NullOr(InstantColumnSchema),
  forAgents: Schema.Boolean,
  limitResetsAt: Schema.NullOr(InstantColumnSchema),
  createdAt: InstantColumnSchema,
});

export type ProviderKeyRow = typeof SealedRowSchema.Type;

const OwnedRowSchema = Schema.Struct({ userId: Schema.String, ...SealedRowSchema.fields });

export type OwnedProviderKeyRow = typeof OwnedRowSchema.Type;

const KeySchema = Schema.Struct({ userId: Schema.String, provider: ProviderSchema });

const KindKeySchema = Schema.Struct({ ...KeySchema.fields, kind: KindSchema });

const ROW_COLUMNS = {
  provider: accountProviderKey.provider,
  kind: accountProviderKey.kind,
  keyVersion: accountProviderKey.keyVersion,
  sealedDataKey: accountProviderKey.sealedDataKey,
  sealedKey: accountProviderKey.sealedKey,
  hint: accountProviderKey.hint,
  status: accountProviderKey.status,
  statusAt: accountProviderKey.statusAt,
  fastAccess: accountProviderKey.fastAccess,
  accessExpiresAt: accountProviderKey.accessExpiresAt,
  forAgents: accountProviderKey.forAgents,
  limitResetsAt: accountProviderKey.limitResetsAt,
  createdAt: accountProviderKey.createdAt,
} as const;

const findRows = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, kind: KindSchema }),
  Result: SealedRowSchema,
  execute: (read) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(accountProviderKey)
        .where(
          and(eq(accountProviderKey.userId, read.userId), eq(accountProviderKey.kind, read.kind)),
        )
        .orderBy(asc(accountProviderKey.provider)),
    ),
});

const findAccountRows = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String }),
  Result: SealedRowSchema,
  execute: (read) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(accountProviderKey)
        .where(eq(accountProviderKey.userId, read.userId))
        .orderBy(asc(accountProviderKey.provider), asc(accountProviderKey.kind)),
    ),
});

const findEveryRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: OwnedRowSchema,
  execute: () =>
    Database.use((db) =>
      db
        .select({ userId: accountProviderKey.userId, ...ROW_COLUMNS })
        .from(accountProviderKey)
        .orderBy(
          asc(accountProviderKey.userId),
          asc(accountProviderKey.provider),
          asc(accountProviderKey.kind),
        ),
    ),
});

const upsertRow = SqlSchema.void({
  Request: Schema.Struct({
    ...KindKeySchema.fields,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedKey: Schema.String,
    hint: Schema.String,
    fastAccess: Schema.NullOr(FastAccessSchema),
    accessExpiresAt: Schema.NullOr(Schema.Date),
    now: Schema.Date,
  }),
  execute: (write) => {
    const row = {
      keyVersion: write.keyVersion,
      sealedDataKey: write.sealedDataKey,
      sealedKey: write.sealedKey,
      hint: write.hint,
      status:
        write.kind === PROVIDER_KEY_KIND.API_KEY
          ? PROVIDER_KEY_STATUS.VERIFIED
          : PROVIDER_KEY_STATUS.UNVERIFIED,
      statusAt: write.now,
      fastAccess: write.fastAccess,
      accessExpiresAt: write.accessExpiresAt,
      limitResetsAt: null,
      createdAt: write.now,
    };
    return Database.use((db) =>
      db
        .insert(accountProviderKey)
        .values({ userId: write.userId, provider: write.provider, kind: write.kind, ...row })
        .onConflictDoUpdate({
          target: [accountProviderKey.userId, accountProviderKey.provider, accountProviderKey.kind],
          set: row,
        }),
    );
  },
});

const lockRow = SqlSchema.findAll({
  Request: KindKeySchema,
  Result: SealedRowSchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .select(ROW_COLUMNS)
        .from(accountProviderKey)
        .where(
          and(
            eq(accountProviderKey.userId, key.userId),
            eq(accountProviderKey.provider, key.provider),
            eq(accountProviderKey.kind, key.kind),
          ),
        )
        .for("update"),
    ),
});

const resealRow = SqlSchema.findAll({
  Request: Schema.Struct({
    ...KindKeySchema.fields,
    fromSealedKey: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedKey: Schema.String,
    accessExpiresAt: Schema.NullOr(Schema.Date),
  }),
  Result: Schema.Struct({ provider: ProviderSchema }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({
          keyVersion: write.keyVersion,
          sealedDataKey: write.sealedDataKey,
          sealedKey: write.sealedKey,
          accessExpiresAt: write.accessExpiresAt,
        })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.kind, write.kind),
            eq(accountProviderKey.sealedKey, write.fromSealedKey),
          ),
        )
        .returning({ provider: accountProviderKey.provider }),
    ),
});

const deleteRow = SqlSchema.void({
  Request: KindKeySchema,
  execute: (key) =>
    Database.use((db) =>
      db
        .delete(accountProviderKey)
        .where(
          and(
            eq(accountProviderKey.userId, key.userId),
            eq(accountProviderKey.provider, key.provider),
            eq(accountProviderKey.kind, key.kind),
          ),
        ),
    ),
});

const updateStatus = SqlSchema.void({
  Request: Schema.Struct({
    ...KeySchema.fields,
    sealedKey: Schema.String,
    status: Schema.Literals(Object.values(PROVIDER_KEY_STATUS)),
    now: Schema.Date,
  }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ status: write.status, statusAt: write.now, limitResetsAt: null })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.sealedKey, write.sealedKey),
          ),
        ),
    ),
});

const PlanStatusSchema = Schema.Literals([
  PROVIDER_KEY_STATUS.VERIFIED,
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.LIMIT_REACHED,
  PROVIDER_KEY_STATUS.INELIGIBLE,
]);

const updatePlanStatus = SqlSchema.void({
  Request: Schema.Struct({
    ...KindKeySchema.fields,
    status: PlanStatusSchema,
    limitResetsAt: Schema.NullOr(Schema.Date),
    savedBy: Schema.Date,
    now: Schema.Date,
  }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ status: write.status, statusAt: write.now, limitResetsAt: write.limitResetsAt })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.kind, write.kind),
            ne(accountProviderKey.status, PROVIDER_KEY_STATUS.UNREADABLE),
            lte(accountProviderKey.createdAt, write.savedBy),
            ...(write.status === PROVIDER_KEY_STATUS.VERIFIED
              ? [
                  ne(accountProviderKey.status, PROVIDER_KEY_STATUS.VERIFIED),
                  ne(accountProviderKey.status, PROVIDER_KEY_STATUS.INVALID),
                ]
              : []),
          ),
        ),
    ),
});

const updateFastAccess = SqlSchema.void({
  Request: Schema.Struct({
    ...KeySchema.fields,
    sealedKey: Schema.String,
    fastAccess: FastAccessSchema,
  }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ fastAccess: write.fastAccess })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.sealedKey, write.sealedKey),
          ),
        ),
    ),
});

const updateForAgents = SqlSchema.findAll({
  Request: Schema.Struct({ ...KindKeySchema.fields, forAgents: Schema.Boolean }),
  Result: Schema.Struct({ provider: ProviderSchema }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ forAgents: write.forAgents })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.kind, write.kind),
          ),
        )
        .returning({ provider: accountProviderKey.provider }),
    ),
});

const rewrapRow = SqlSchema.findAll({
  Request: Schema.Struct({
    ...KindKeySchema.fields,
    fromVersion: Schema.Int,
    sealedKey: Schema.String,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
  }),
  Result: Schema.Struct({ provider: ProviderSchema }),
  execute: (write) =>
    Database.use((db) =>
      db
        .update(accountProviderKey)
        .set({ keyVersion: write.keyVersion, sealedDataKey: write.sealedDataKey })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.kind, write.kind),
            eq(accountProviderKey.keyVersion, write.fromVersion),
            eq(accountProviderKey.sealedKey, write.sealedKey),
          ),
        )
        .returning({ provider: accountProviderKey.provider }),
    ),
});

export function listProviderKeyRows(
  userId: string,
  kind: ProviderKeyKind,
): TaskStoreEffect<readonly ProviderKeyRow[]> {
  return findRows({ userId, kind });
}

export function listAccountProviderKeyRows(
  userId: string,
): TaskStoreEffect<readonly ProviderKeyRow[]> {
  return findAccountRows({ userId });
}

export function saveProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  sealed: SealedProviderKey,
  hint: string,
  fastAccess: FastAccess | null,
  now: Date,
  accessExpiresAt: Date | null = null,
): TaskStoreEffect<void> {
  return upsertRow({ userId, provider, kind, ...sealed, hint, fastAccess, accessExpiresAt, now });
}

export function withProviderKeyLocked<A, E, R>(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  body: (row: Option.Option<ProviderKeyRow>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TaskStoreFailure, R | DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.flatMap(lockRow({ userId, provider, kind }), (rows) =>
        body(Option.fromNullishOr(rows[0])),
      ),
    ),
  );
}

export function resealProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  fromSealedKey: string,
  sealed: SealedProviderKey,
  accessExpiresAt: Date | null,
): TaskStoreEffect<boolean> {
  return Effect.map(
    resealRow({ userId, provider, kind, fromSealedKey, ...sealed, accessExpiresAt }),
    (moved) => moved.length > 0,
  );
}

export function removeProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
): TaskStoreEffect<void> {
  return deleteRow({ userId, provider, kind });
}

export function setProviderKeyForAgents(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  forAgents: boolean,
): TaskStoreEffect<boolean> {
  return Effect.map(
    updateForAgents({ userId, provider, kind, forAgents }),
    (rows) => rows.length > 0,
  );
}

export function setProviderKeyStatus(
  userId: string,
  provider: ProviderKeyProvider,
  sealedKey: string,
  status: ProviderKeyStatus,
  now: Date,
): TaskStoreEffect<void> {
  return updateStatus({ userId, provider, sealedKey, status, now });
}

export type PlanStatus = typeof PlanStatusSchema.Type;

export function setPlanStatus(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  status: PlanStatus,
  limitResetsAt: Date | undefined,
  savedBy: Date,
  now: Date,
): TaskStoreEffect<void> {
  return updatePlanStatus({
    userId,
    provider,
    kind,
    status,
    limitResetsAt: status === PROVIDER_KEY_STATUS.LIMIT_REACHED ? (limitResetsAt ?? null) : null,
    savedBy,
    now,
  });
}

export function setProviderKeyFastAccess(
  userId: string,
  provider: ProviderKeyProvider,
  sealedKey: string,
  fastAccess: FastAccess,
): TaskStoreEffect<void> {
  return updateFastAccess({ userId, provider, sealedKey, fastAccess });
}

export function listEveryProviderKeyRow(): TaskStoreEffect<readonly OwnedProviderKeyRow[]> {
  return findEveryRow(undefined);
}

export function rewrapProviderKeyRow(
  row: OwnedProviderKeyRow,
  rewrapped: SealedProviderKey,
): TaskStoreEffect<boolean> {
  return Effect.map(
    rewrapRow({
      userId: row.userId,
      provider: row.provider,
      kind: row.kind,
      fromVersion: row.keyVersion,
      sealedKey: row.sealedKey,
      keyVersion: rewrapped.keyVersion,
      sealedDataKey: rewrapped.sealedDataKey,
    }),
    (moved) => moved.length > 0,
  );
}
