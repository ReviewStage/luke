import { eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";
import { handleVaultKeysList, type VaultKeysListOptions } from "../../server/hosted/vault.js";

export default {
  fetch(request: Request): Promise<Response> {
    const options: VaultKeysListOptions = {
      request,
      resolveUserId: (incoming) =>
        hostedUserId(incoming, async (input) =>
          oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
        ),
      encryptionSecret: process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET],
      listKeys: async (userId) =>
        getDatabase()
          .select({
            providerId: providerKey.providerId,
            updatedAt: providerKey.updatedAt,
          })
          .from(providerKey)
          .where(eq(providerKey.userId, userId)),
    };
    return handleVaultKeysList(options);
  },
};
