import { and, eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";
import {
  handleVaultKeyDelete,
  handleVaultKeyStore,
  type VaultKeyDeleteOptions,
  type VaultKeyStoreOptions,
} from "../../server/hosted/vault.js";

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "DELETE") {
      const options: VaultKeyDeleteOptions = {
        request,
        resolveUserId,
        encryptionSecret,
        deleteKey: async (userId, providerId) => {
          const result = await getDatabase()
            .delete(providerKey)
            .where(and(eq(providerKey.userId, userId), eq(providerKey.providerId, providerId)))
            .returning({ userId: providerKey.userId });
          return result.length > 0;
        },
      };
      return handleVaultKeyDelete(options);
    }

    const options: VaultKeyStoreOptions = {
      request,
      resolveUserId,
      encryptionSecret,
      storeKey: async (userId, providerId, ciphertext, hint) => {
        await getDatabase()
          .insert(providerKey)
          .values({ userId, providerId, ciphertext, hint, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: [providerKey.userId, providerKey.providerId],
            set: { ciphertext, hint, updatedAt: new Date() },
          });
      },
    };
    return handleVaultKeyStore(options);
  },
};
