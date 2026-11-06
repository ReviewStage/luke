import { CHATGPT_DEVICE_LOGIN, type ChatGptDeviceSettled } from "@repo/features/provider-key-wire";
import { and, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices } from "../core/query.js";
import { accountChatGptDeviceLogin } from "../schemas/account-provider-key.js";
import { InstantColumnSchema } from "./columns.js";
import type { DeviceLoginOwner } from "./provider-key-seal.js";
import type { TaskStoreEffect, TaskStoreFailure } from "./task-store.js";

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

export type ChatGptDeviceLoginRow = typeof LoginRowSchema.Type;

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

export function beginChatGptDeviceLogin(
  owner: DeviceLoginOwner,
  sealedCodes: string,
  expiresAt: Date,
  now: Date,
): TaskStoreEffect<void> {
  return upsertLogin({ ...owner, sealedCodes, expiresAt, now });
}

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

export function settleChatGptDeviceLogin(
  owner: DeviceLoginOwner,
  outcome: ChatGptDeviceSettled,
): TaskStoreEffect<void> {
  return settleLogin({ ...owner, outcome });
}

export function dropChatGptDeviceLogin(owner: DeviceLoginOwner): TaskStoreEffect<void> {
  return deleteLogin(owner);
}
