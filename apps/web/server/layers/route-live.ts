import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { providerKey, user } from "../db/schema.js";
import { AccountDeleteUser } from "../hosted/account-delete.js";
import { ObserveVaultKeys } from "../hosted/observe.js";
import { VaultKeyDelete, VaultKeyList, VaultKeyStore } from "../hosted/vault.js";
import { HostedDatabaseService } from "../services/tags.js";

export const ObserveRouteLive = Layer.effect(
  ObserveVaultKeys,
  Effect.gen(function* () {
    const database = yield* HostedDatabaseService;
    return {
      readVaultKeys: (userId) =>
        Effect.promise(() =>
          database
            .select({
              providerId: providerKey.providerId,
              ciphertext: providerKey.ciphertext,
            })
            .from(providerKey)
            .where(eq(providerKey.userId, userId)),
        ),
    };
  }),
);

export const VaultRouteLive = Layer.mergeAll(
  Layer.effect(
    VaultKeyStore,
    Effect.gen(function* () {
      const database = yield* HostedDatabaseService;
      return {
        storeKey: (userId, providerId, ciphertext) =>
          Effect.promise(() =>
            database
              .insert(providerKey)
              .values({ userId, providerId, ciphertext, updatedAt: new Date() })
              .onConflictDoUpdate({
                target: [providerKey.userId, providerKey.providerId],
                set: { ciphertext, updatedAt: new Date() },
              }),
          ),
      };
    }),
  ),
  Layer.effect(
    VaultKeyList,
    Effect.gen(function* () {
      const database = yield* HostedDatabaseService;
      return {
        listKeys: (userId) =>
          Effect.promise(() =>
            database
              .select({
                providerId: providerKey.providerId,
                updatedAt: providerKey.updatedAt,
              })
              .from(providerKey)
              .where(eq(providerKey.userId, userId)),
          ),
      };
    }),
  ),
  Layer.effect(
    VaultKeyDelete,
    Effect.gen(function* () {
      const database = yield* HostedDatabaseService;
      return {
        deleteKey: (userId, providerId) =>
          Effect.promise(async () => {
            const result = await database
              .delete(providerKey)
              .where(and(eq(providerKey.userId, userId), eq(providerKey.providerId, providerId)))
              .returning({ userId: providerKey.userId });
            return result.length > 0;
          }),
      };
    }),
  ),
);

export const AccountDeleteRouteLive = Layer.effect(
  AccountDeleteUser,
  Effect.gen(function* () {
    const database = yield* HostedDatabaseService;
    return {
      deleteUser: (userId) =>
        Effect.promise(() => database.delete(user).where(eq(user.id, userId))),
    };
  }),
);
