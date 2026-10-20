import {
  FAST_ACCESS,
  type FastAccess,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyKind,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@luke/features/provider-key-wire";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { accountProviderKey } from "../schemas/account-provider-key.js";
import { InstantColumnSchema } from "./columns.js";
import type { SealedProviderKey } from "./provider-key-seal.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * provider-key-store.ts -- the rows of an account's own provider keys, sealed as `provider-key-seal.ts` seals them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account reads, replaces, or removes another's key. What
 * goes in and out is sealed: this module never sees a key in the clear,
 * and a row read here is opened by its caller with the ring the
 * environment holds. A save replaces the provider's row whole, as a new
 * key added now and verified now, since a key is saved only once its
 * provider accepted it, with whether its organization may run fast mode as
 * the save's own fast request found it. A subscription credential is a row
 * of its own kind, saved unverified, since no provider is asked about it
 * before an agent runs on it. Until the primary key moves onto the kind, a
 * provider holds one row of either kind, and a save never replaces a row of
 * the other kind. A status is written against the sealed key a step
 * ran on, so a step on a key since replaced marks nothing of its successor.
 */

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
  createdAt: InstantColumnSchema,
});

/** One stored key as its row holds it: sealed, beside what the account is shown of it. */
export type ProviderKeyRow = typeof SealedRowSchema.Type;

const OwnedRowSchema = Schema.Struct({ userId: Schema.String, ...SealedRowSchema.fields });

/** One stored key with its account, for the rewrap that walks every row. */
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

const findEveryRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: OwnedRowSchema,
  execute: () =>
    Database.use((db) =>
      db
        .select({ userId: accountProviderKey.userId, ...ROW_COLUMNS })
        .from(accountProviderKey)
        .orderBy(asc(accountProviderKey.userId), asc(accountProviderKey.provider)),
    ),
});

/** The row written where the provider holds none or one of the same kind; nothing where it holds the other kind. */
const upsertRow = SqlSchema.findAll({
  Request: Schema.Struct({
    ...KindKeySchema.fields,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedKey: Schema.String,
    hint: Schema.String,
    fastAccess: Schema.NullOr(FastAccessSchema),
    now: Schema.Date,
  }),
  Result: Schema.Struct({ provider: ProviderSchema }),
  execute: (write) => {
    const row = {
      keyVersion: write.keyVersion,
      sealedDataKey: write.sealedDataKey,
      sealedKey: write.sealedKey,
      hint: write.hint,
      // An API key is kept only once its provider accepted it; a subscription credential is kept unasked.
      status:
        write.kind === PROVIDER_KEY_KIND.API_KEY
          ? PROVIDER_KEY_STATUS.VERIFIED
          : PROVIDER_KEY_STATUS.UNVERIFIED,
      statusAt: write.now,
      fastAccess: write.fastAccess,
      createdAt: write.now,
    };
    return Database.use((db) =>
      db
        .insert(accountProviderKey)
        .values({ userId: write.userId, provider: write.provider, kind: write.kind, ...row })
        .onConflictDoUpdate({
          target: [accountProviderKey.userId, accountProviderKey.provider],
          set: row,
          setWhere: eq(accountProviderKey.kind, write.kind),
        })
        .returning({ provider: accountProviderKey.provider }),
    );
  },
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
        .set({ status: write.status, statusAt: write.now })
        .where(
          and(
            eq(accountProviderKey.userId, write.userId),
            eq(accountProviderKey.provider, write.provider),
            eq(accountProviderKey.sealedKey, write.sealedKey),
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

/** The wrap moved only where the row still holds the seal it was read with, so a key replaced meanwhile keeps its own. */
const rewrapRow = SqlSchema.findAll({
  Request: Schema.Struct({
    ...KeySchema.fields,
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
            eq(accountProviderKey.keyVersion, write.fromVersion),
            eq(accountProviderKey.sealedKey, write.sealedKey),
          ),
        )
        .returning({ provider: accountProviderKey.provider }),
    ),
});

/** The account's stored keys of one kind, sealed, in the providers' order. */
export function listProviderKeyRows(
  userId: string,
  kind: ProviderKeyKind,
): TaskStoreEffect<readonly ProviderKeyRow[]> {
  return findRows({ userId, kind });
}

/**
 * Keeps the provider's credential of this kind for the account, replacing
 * the one of the kind it held, as added now: an API key verified, a
 * subscription credential unverified, with its fast access where the save
 * found it. Answers whether it kept it: not where the provider holds the
 * other kind, which it leaves as it is.
 */
export function saveProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
  sealed: SealedProviderKey,
  hint: string,
  fastAccess: FastAccess | null,
  now: Date,
): TaskStoreEffect<boolean> {
  return Effect.map(
    upsertRow({ userId, provider, kind, ...sealed, hint, fastAccess, now }),
    (kept) => kept.length > 0,
  );
}

/** Removes the provider's credential of this kind from the account; removing one it does not hold moves nothing. */
export function removeProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  kind: ProviderKeyKind,
): TaskStoreEffect<void> {
  return deleteRow({ userId, provider, kind });
}

/** Writes how the provider last answered the key a step ran on, where the row still holds that key. */
export function setProviderKeyStatus(
  userId: string,
  provider: ProviderKeyProvider,
  sealedKey: string,
  status: ProviderKeyStatus,
  now: Date,
): TaskStoreEffect<void> {
  return updateStatus({ userId, provider, sealedKey, status, now });
}

/** Writes what a fast call on the key a step ran on showed of its organization, where the row still holds that key. */
export function setProviderKeyFastAccess(
  userId: string,
  provider: ProviderKeyProvider,
  sealedKey: string,
  fastAccess: FastAccess,
): TaskStoreEffect<void> {
  return updateFastAccess({ userId, provider, sealedKey, fastAccess });
}

/** Every stored key of every account, sealed, for the rewrap alone. */
export function listEveryProviderKeyRow(): TaskStoreEffect<readonly OwnedProviderKeyRow[]> {
  return findEveryRow(undefined);
}

/**
 * Moves one row onto a new wrap of its data key, and answers whether it
 * did: not where the row was replaced or rewrapped since it was read.
 */
export function rewrapProviderKeyRow(
  row: OwnedProviderKeyRow,
  rewrapped: SealedProviderKey,
): TaskStoreEffect<boolean> {
  return Effect.map(
    rewrapRow({
      userId: row.userId,
      provider: row.provider,
      fromVersion: row.keyVersion,
      sealedKey: row.sealedKey,
      keyVersion: rewrapped.keyVersion,
      sealedDataKey: rewrapped.sealedDataKey,
    }),
    (moved) => moved.length > 0,
  );
}
