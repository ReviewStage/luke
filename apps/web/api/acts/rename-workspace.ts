import { and, eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { text, workspaceNameText } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import {
  actUnsupportedReason,
  executeRenameWorkspaceAct,
  REMOTE_SESSION_ACT,
} from "../../server/hosted/act-execute.js";
import { handleSessionAct } from "../../server/hosted/act-session.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];

export default {
  async fetch(request: Request): Promise<Response> {
    return handleSessionAct<{ name: string }>({
      request,
      resolveUserId,
      encryptionSecret,
      readKey: async (userId, providerId) => {
        const rows = await getDatabase()
          .select({ ciphertext: providerKey.ciphertext })
          .from(providerKey)
          .where(and(eq(providerKey.userId, userId), eq(providerKey.providerId, providerId)))
          .limit(1);
        return rows[0];
      },
      parseFields: (body) => {
        const rawName = text(body.name);
        const name = rawName !== undefined ? workspaceNameText(rawName) : undefined;
        return name ? { name } : undefined;
      },
      unsupportedReason: (providerId) =>
        actUnsupportedReason(REMOTE_SESSION_ACT.RENAME_WORKSPACE, providerId),
      execute: executeRenameWorkspaceAct,
    });
  },
};
