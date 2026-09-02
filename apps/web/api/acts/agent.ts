import { and, eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { sessionMessageText, text, workspaceNameText } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import {
  actUnsupportedReason,
  executeAgentAct,
  REMOTE_SESSION_ACT,
} from "../../server/hosted/act-execute.js";
import { handleSessionAct } from "../../server/hosted/act-session.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";

/**
 * Agent kinds are short provider-fixed slugs (`claude`, `codex`, `opencode`);
 * the bound refuses anything that could not be one. Which kinds exist is not
 * decided here — the executor honours only a kind the fresh observation pass
 * listed as spawnable for the session's workspace.
 */
const AGENT_KIND_MAX_LENGTH = 100;

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];

export default {
  async fetch(request: Request): Promise<Response> {
    return handleSessionAct<{ agent: string; name: string | undefined; task: string | undefined }>({
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
        const agent = text(body.agent);
        if (!agent || agent.length > AGENT_KIND_MAX_LENGTH) return undefined;
        const rawName = text(body.name);
        const name = rawName !== undefined ? workspaceNameText(rawName) : undefined;
        if (rawName !== undefined && name === undefined) return undefined;
        const rawTask = text(body.task);
        const task = rawTask !== undefined ? sessionMessageText(rawTask) : undefined;
        if (rawTask !== undefined && task === undefined) return undefined;
        return { agent, name, task };
      },
      unsupportedReason: (providerId) => actUnsupportedReason(REMOTE_SESSION_ACT.AGENT, providerId),
      execute: executeAgentAct,
    });
  },
};
