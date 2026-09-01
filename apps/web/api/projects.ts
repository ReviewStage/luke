import { eq } from "drizzle-orm";
import { auth } from "../server/auth.js";
import { getDatabase } from "../server/db/index.js";
import { providerKey } from "../server/db/schema.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../server/hosted/encryption.js";
import { handleProjects } from "../server/hosted/projects.js";

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];

export default {
  async fetch(request: Request): Promise<Response> {
    return handleProjects({
      request,
      resolveUserId,
      encryptionSecret,
      readVaultKeys: async (userId) => {
        return getDatabase()
          .select({ providerId: providerKey.providerId, ciphertext: providerKey.ciphertext })
          .from(providerKey)
          .where(eq(providerKey.userId, userId));
      },
    });
  },
};
