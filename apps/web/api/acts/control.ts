import { and, eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { text } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import {
  actUnsupportedReason,
  executeControlAct,
  MOBILE_SESSION_ACT,
} from "../../server/hosted/act-execute.js";
import { handleSessionAct } from "../../server/hosted/act-session.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";

/**
 * Control ids are short build-fixed slugs on every provider (`cancel-turn`,
 * `archive-agent`, `approve-plan`); the bound refuses anything that could not
 * be one. Which ids exist is not decided here — the executor honours only a
 * control the fresh observation pass advertised for the session.
 */
const CONTROL_ID_MAX_LENGTH = 100;

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];

export default {
  async fetch(request: Request): Promise<Response> {
    return handleSessionAct<{ controlId: string }>({
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
        const controlId = text(body.controlId);
        if (!controlId || controlId.length > CONTROL_ID_MAX_LENGTH) return undefined;
        return { controlId };
      },
      unsupportedReason: (providerId) =>
        actUnsupportedReason(MOBILE_SESSION_ACT.CONTROL, providerId),
      execute: executeControlAct,
    });
  },
};
