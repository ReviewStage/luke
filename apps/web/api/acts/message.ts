import { and, eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { isRecord, text, type UnparsedWireValue, type VaultProviderId } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import { type ActMessageExecuteResult, handleActMessage } from "../../server/hosted/act-message.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";

const CONDUCTOR_API_URL = "https://api.conductor.build";

/**
 * The two Conductor session statuses that accept a message. Matches
 * `CONDUCTOR_SESSION_STATUS` in `@sidecar/providers` — kept inline here so
 * this module carries no dependency on the providers package.
 */
const CONDUCTOR_ACCEPTS_MESSAGE = new Set(["idle", "working"]);

async function executeConductorMessage(
  sessionId: string,
  messageText: string,
  apiKey: string,
): Promise<ActMessageExecuteResult> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Re-observe the session's current status before writing — the same
  // discipline the desktop applies via its in-memory observation registry,
  // kept here as a fresh HTTP check against the provider's documented status
  // endpoint.
  let statusRes: Response;
  try {
    statusRes = await fetch(`${CONDUCTOR_API_URL}/v0/sessions/${sessionId}/status`, { headers });
  } catch {
    return { result: "rejected", reason: "Could not reach Conductor." };
  }

  if (statusRes.status === 401 || statusRes.status === 403) {
    return { result: "rejected", reason: "Conductor rejected the API key." };
  }
  if (statusRes.status === 404) {
    return { result: "rejected", reason: "Session not found." };
  }
  if (!statusRes.ok) {
    return { result: "rejected", reason: "Conductor returned an unexpected error." };
  }

  let statusBody: UnparsedWireValue;
  try {
    // SAFETY: json() returns unknown; isRecord below validates before field access.
    statusBody = (await statusRes.json()) as UnparsedWireValue;
  } catch {
    return { result: "rejected", reason: "Conductor returned an unreadable status." };
  }

  const sessionStatus = isRecord(statusBody) ? text(statusBody.status) : undefined;

  if (!sessionStatus || !CONDUCTOR_ACCEPTS_MESSAGE.has(sessionStatus)) {
    return {
      result: "rejected",
      reason: "Session is not currently accepting messages.",
    };
  }

  // The session is accepting messages; deliver the write.
  let msgRes: Response;
  try {
    msgRes = await fetch(`${CONDUCTOR_API_URL}/v0/sessions/${sessionId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: messageText }),
    });
  } catch {
    return { result: "rejected", reason: "Could not reach Conductor." };
  }

  if (msgRes.status === 401 || msgRes.status === 403) {
    return { result: "rejected", reason: "Conductor rejected the API key." };
  }
  if (msgRes.status === 404) {
    return { result: "rejected", reason: "Session not found." };
  }
  if (msgRes.status === 409) {
    return { result: "rejected", reason: "Session state conflict; the session may have closed." };
  }
  if (!msgRes.ok) {
    return { result: "rejected", reason: "Conductor refused the message." };
  }

  return { result: "accepted" };
}

function unsupportedProvider(providerId: VaultProviderId): ActMessageExecuteResult {
  return {
    result: "unsupported",
    reason: `Mobile message acts are not yet available for ${providerId}. Conductor is supported today; other providers will follow once the read path for each is established.`,
  };
}

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];

export default {
  async fetch(request: Request): Promise<Response> {
    return handleActMessage({
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
      executeMessage: async ({ providerId, providerSessionId, text, apiKey }) => {
        if (providerId === "conductor") {
          return executeConductorMessage(providerSessionId, text, apiKey);
        }
        return unsupportedProvider(providerId);
      },
    });
  },
};
