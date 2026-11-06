import { CHATGPT_DEVICE_LOGIN, type ChatGptDeviceSettled } from "@repo/features/provider-key-wire";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices } from "../core/query.js";
import { accountChatGptDeviceLogin } from "../schemas/account-provider-key.js";
import { InstantColumnSchema } from "./columns.js";
import type { DeviceLoginOwner } from "./provider-key-seal.js";
import type { TaskStoreEffect, TaskStoreFailure } from "./task-store.js";

/**
 * chatgpt-device-login-store.ts -- an account's pending connection of a ChatGPT plan through Codex's device-code login: begun, checked under its row's lock, settled, and dropped.
 *
 * An account holds at most one pending login, and a start replaces it
 * whole under a new login id, so a panel still polling the old one finds
 * it gone. Every read and write names the account and the login together,
 * so no account reaches another's login, and none reaches a login its own
 * newer start replaced. A check runs under the row's lock
 * (`withChatGptDeviceLoginLocked`), so two polls at once run one after the
 * other and the second reads how the first settled it. A settled login
 * keeps its outcome and leaves its sealed codes, so a poll after the one
 * that settled it answers the same. What goes in and out is sealed: this
 * module never sees a code in the clear. Every function is an effect over
 * the ambient `SqlClient`.
 */

const SettledSchema = Schema.Literals([
  CHATGPT_DEVICE_LOGIN.CONNECTED,
  CHATGPT_DEVICE_LOGIN.EXPIRED,
  CHATGPT_DEVICE_LOGIN.REFUSED,
]);

const OwnerSchema = Schema.Struct({ userId: Schema.String, loginId: Schema.String });

const LoginRowSchema = Schema.Struct({
  sealedCodes: Schema.NullOr(Schema.String),
  outcome: Schema.NullOr(SettledSchema),
  expiresAt: InstantColumnSchema,
});

/** A pending login as its row holds it: its codes sealed until it settles, how it settled, and when its code lapses. */
export type ChatGptDeviceLoginRow = typeof LoginRowSchema.Type;

/** The account's login of this id, where it is still the account's one. */
const ownLogin = (owner: DeviceLoginOwner) =>
  and(
    eq(accountChatGptDeviceLogin.userId, owner.userId),
    eq(accountChatGptDeviceLogin.loginId, owner.loginId),
  );

const upsertLogin = SqlSchema.void({
  Request: Schema.Struct({
    ...OwnerSchema.fields,
    sealedCodes: Schema.String,
    expiresAt: Schema.Date,
    now: Schema.Date,
  }),
  execute: (write) => {
    const row = {
      loginId: write.loginId,
      sealedCodes: write.sealedCodes,
      outcome: null,
      expiresAt: write.expiresAt,
      createdAt: write.now,
    };
    return Database.use((db) =>
      db
        .insert(accountChatGptDeviceLogin)
        .values({ userId: write.userId, ...row })
        .onConflictDoUpdate({ target: accountChatGptDeviceLogin.userId, set: row }),
    );
  },
});

const lockLogin = SqlSchema.findAll({
  Request: OwnerSchema,
  Result: LoginRowSchema,
  execute: (owner) =>
    Database.use((db) =>
      db
        .select({
          sealedCodes: accountChatGptDeviceLogin.sealedCodes,
          outcome: accountChatGptDeviceLogin.outcome,
          expiresAt: accountChatGptDeviceLogin.expiresAt,
        })
        .from(accountChatGptDeviceLogin)
        .where(ownLogin(owner))
        .for("update"),
    ),
});

const settleLogin = SqlSchema.void({
  Request: Schema.Struct({ ...OwnerSchema.fields, outcome: SettledSchema }),
  execute: ({ outcome, ...owner }) =>
    Database.use((db) =>
      db
        .update(accountChatGptDeviceLogin)
        .set({ outcome, sealedCodes: null })
        .where(ownLogin(owner)),
    ),
});

const deleteLogin = SqlSchema.void({
  Request: OwnerSchema,
  execute: (owner) =>
    Database.use((db) => db.delete(accountChatGptDeviceLogin).where(ownLogin(owner))),
});

/** Keeps the account's new pending login, its codes sealed, replacing whichever it held. */
export function beginChatGptDeviceLogin(
  owner: DeviceLoginOwner,
  sealedCodes: string,
  expiresAt: Date,
  now: Date,
): TaskStoreEffect<void> {
  return upsertLogin({ ...owner, sealedCodes, expiresAt, now });
}

/**
 * Runs `body` on the account's login of this id, or on none where it holds
 * none by that id, in one transaction with its row locked, so two checks of
 * one login run one after the other and the second reads how the first
 * settled it.
 */
export function withChatGptDeviceLoginLocked<A, E, R>(
  owner: DeviceLoginOwner,
  body: (row: Option.Option<ChatGptDeviceLoginRow>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | TaskStoreFailure, R | DatabaseServices> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.flatMap(lockLogin(owner), (rows) => body(Option.fromNullishOr(rows[0]))),
    ),
  );
}

/** Settles the account's login of this id at `outcome`, dropping its sealed codes. */
export function settleChatGptDeviceLogin(
  owner: DeviceLoginOwner,
  outcome: ChatGptDeviceSettled,
): TaskStoreEffect<void> {
  return settleLogin({ ...owner, outcome });
}

/** Drops the account's login of this id, where it still holds it. */
export function dropChatGptDeviceLogin(owner: DeviceLoginOwner): TaskStoreEffect<void> {
  return deleteLogin(owner);
}
