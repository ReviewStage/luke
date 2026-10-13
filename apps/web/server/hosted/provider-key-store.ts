import { db } from "@sidecar/database/core/query";
import { InstantColumnSchema } from "@sidecar/database/models/columns";
import { accountProviderKey } from "@sidecar/database/schemas/account-provider-key";
import {
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeyStatus,
} from "@sidecar/hosted/provider-key-wire";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/unstable/sql";
import type { PlanStoreEffect } from "./plan-store.js";
import type { SealedProviderKey } from "./provider-key-seal.js";

/**
 * provider-key-store.ts -- the rows of an account's own provider keys, sealed as `provider-key-seal.ts` seals them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account reads, replaces, or removes another's key. What
 * goes in and out is sealed: this module never sees a key in the clear,
 * and a row read here is opened by its caller with the ring the
 * environment holds. A save replaces the provider's row whole, as a new
 * key added now and verified now, since a key is saved only once its
 * provider accepted it. A status is written against the sealed key a step
 * ran on, so a step on a key since replaced marks nothing of its successor.
 */

const ProviderSchema = Schema.Literals(Object.values(PROVIDER_KEY_PROVIDER));

const SealedRowSchema = Schema.Struct({
  provider: ProviderSchema,
  keyVersion: Schema.Int,
  sealedDataKey: Schema.String,
  sealedKey: Schema.String,
  hint: Schema.String,
  status: Schema.Literals(Object.values(PROVIDER_KEY_STATUS)),
  statusAt: InstantColumnSchema,
  createdAt: InstantColumnSchema,
});

/** One stored key as its row holds it: sealed, beside what the account is shown of it. */
export type ProviderKeyRow = typeof SealedRowSchema.Type;

const OwnedRowSchema = Schema.Struct({ userId: Schema.String, ...SealedRowSchema.fields });

/** One stored key with its account, for the rewrap that walks every row. */
export type OwnedProviderKeyRow = typeof OwnedRowSchema.Type;

const KeySchema = Schema.Struct({ userId: Schema.String, provider: ProviderSchema });

const ROW_COLUMNS = {
  provider: accountProviderKey.provider,
  keyVersion: accountProviderKey.keyVersion,
  sealedDataKey: accountProviderKey.sealedDataKey,
  sealedKey: accountProviderKey.sealedKey,
  hint: accountProviderKey.hint,
  status: accountProviderKey.status,
  statusAt: accountProviderKey.statusAt,
  createdAt: accountProviderKey.createdAt,
} as const;

const findRows = SqlSchema.findAll({
  Request: Schema.String,
  Result: SealedRowSchema,
  execute: (userId) =>
    db
      .select(ROW_COLUMNS)
      .from(accountProviderKey)
      .where(eq(accountProviderKey.userId, userId))
      .orderBy(asc(accountProviderKey.provider)),
});

const findEveryRow = SqlSchema.findAll({
  Request: Schema.Void,
  Result: OwnedRowSchema,
  execute: () =>
    db
      .select({ userId: accountProviderKey.userId, ...ROW_COLUMNS })
      .from(accountProviderKey)
      .orderBy(asc(accountProviderKey.userId), asc(accountProviderKey.provider)),
});

const upsertRow = SqlSchema.void({
  Request: Schema.Struct({
    ...KeySchema.fields,
    keyVersion: Schema.Int,
    sealedDataKey: Schema.String,
    sealedKey: Schema.String,
    hint: Schema.String,
    now: Schema.Date,
  }),
  execute: (write) => {
    const row = {
      keyVersion: write.keyVersion,
      sealedDataKey: write.sealedDataKey,
      sealedKey: write.sealedKey,
      hint: write.hint,
      status: PROVIDER_KEY_STATUS.VERIFIED,
      statusAt: write.now,
      createdAt: write.now,
    };
    return db
      .insert(accountProviderKey)
      .values({ userId: write.userId, provider: write.provider, ...row })
      .onConflictDoUpdate({
        target: [accountProviderKey.userId, accountProviderKey.provider],
        set: row,
      });
  },
});

const deleteRow = SqlSchema.void({
  Request: KeySchema,
  execute: (key) =>
    db
      .delete(accountProviderKey)
      .where(
        and(
          eq(accountProviderKey.userId, key.userId),
          eq(accountProviderKey.provider, key.provider),
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
});

/** The account's stored keys, sealed, in the providers' order. */
export function listProviderKeyRows(userId: string): PlanStoreEffect<readonly ProviderKeyRow[]> {
  return findRows(userId);
}

/** Keeps the provider's key for the account, replacing the one it held, as added and verified now. */
export function saveProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
  sealed: SealedProviderKey,
  hint: string,
  now: Date,
): PlanStoreEffect<void> {
  return upsertRow({ userId, provider, ...sealed, hint, now });
}

/** Removes the provider's key from the account; removing one it does not hold moves nothing. */
export function removeProviderKey(
  userId: string,
  provider: ProviderKeyProvider,
): PlanStoreEffect<void> {
  return deleteRow({ userId, provider });
}

/** Writes how the provider last answered the key a step ran on, where the row still holds that key. */
export function setProviderKeyStatus(
  userId: string,
  provider: ProviderKeyProvider,
  sealedKey: string,
  status: ProviderKeyStatus,
  now: Date,
): PlanStoreEffect<void> {
  return updateStatus({ userId, provider, sealedKey, status, now });
}

/** Every stored key of every account, sealed, for the rewrap alone. */
export function listEveryProviderKeyRow(): PlanStoreEffect<readonly OwnedProviderKeyRow[]> {
  return findEveryRow(undefined);
}

/**
 * Moves one row onto a new wrap of its data key, and answers whether it
 * did: not where the row was replaced or rewrapped since it was read.
 */
export function rewrapProviderKeyRow(
  row: OwnedProviderKeyRow,
  rewrapped: SealedProviderKey,
): PlanStoreEffect<boolean> {
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
