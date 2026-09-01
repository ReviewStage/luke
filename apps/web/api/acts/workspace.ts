import { and, eq } from "drizzle-orm";
import { auth } from "../../server/auth.js";
import { isRecord, text, type UnparsedWireValue, type VaultProviderId } from "../../server/core.js";
import { getDatabase } from "../../server/db/index.js";
import { providerKey } from "../../server/db/schema.js";
import {
  type ActWorkspaceExecuteResult,
  handleActWorkspace,
} from "../../server/hosted/act-workspace.js";
import { hostedUserId, oauthUserInfoFromAuthAnswer } from "../../server/hosted/bearer.js";
import { VAULT_ENCRYPTION_ENVIRONMENT } from "../../server/hosted/encryption.js";

const CONDUCTOR_API_URL = "https://api.conductor.build";

async function executeConductorCreateWorkspace(
  providerProjectId: string,
  name: string | undefined,
  task: string | undefined,
  apiKey: string,
): Promise<ActWorkspaceExecuteResult> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  // Create the workspace. Conductor validates the project id server-side and
  // returns 4xx if the project does not exist or is not accessible. The task
  // is delivered as a follow-up message to the session Conductor creates,
  // matching the desktop adapter's own two-step write.
  let createRes: Response;
  try {
    createRes = await fetch(`${CONDUCTOR_API_URL}/v0/workspaces`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        projectId: providerProjectId,
        ...(name ? { name } : undefined),
      }),
    });
  } catch {
    return { result: "rejected", reason: "Could not reach Conductor." };
  }

  if (createRes.status === 401 || createRes.status === 403) {
    return { result: "rejected", reason: "Conductor rejected the API key." };
  }
  if (createRes.status === 404) {
    return { result: "rejected", reason: "Project not found." };
  }
  if (!createRes.ok) {
    return { result: "rejected", reason: "Conductor refused the workspace creation." };
  }

  let createBody: UnparsedWireValue;
  try {
    // SAFETY: json() returns unknown; isRecord below validates before field access.
    createBody = (await createRes.json()) as UnparsedWireValue;
  } catch {
    createBody = undefined;
  }

  const sessionId = isRecord(createBody) ? text(createBody.sessionId) : undefined;

  if (!task) {
    return { result: "accepted", ...(sessionId ? { providerSessionId: sessionId } : undefined) };
  }

  // The developer asked for an opening task, so from here an undelivered task
  // is a rejection — the same verdict the desktop adapter gives — carrying the
  // created session id so the caller still knows the workspace exists.
  if (!sessionId) {
    return {
      result: "rejected",
      reason:
        "Workspace was created, but Conductor did not identify its session, so the opening task could not be delivered.",
    };
  }

  // Deliver the opening task as a message to the created session, exactly as
  // the desktop adapter's workspaceTaskRoute does.
  let taskRes: Response;
  try {
    taskRes = await fetch(`${CONDUCTOR_API_URL}/v0/sessions/${sessionId}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message: task }),
    });
  } catch {
    return {
      result: "rejected",
      providerSessionId: sessionId,
      reason: "Workspace was created, but the opening task could not be delivered.",
    };
  }

  if (!taskRes.ok) {
    return {
      result: "rejected",
      providerSessionId: sessionId,
      reason: "Workspace was created, but Conductor refused the opening task.",
    };
  }

  return { result: "accepted", providerSessionId: sessionId };
}

function unsupportedReason(providerId: VaultProviderId): string | undefined {
  if (providerId === "conductor") return undefined;
  return `Mobile workspace creation is not yet available for ${providerId}. Conductor is supported today.`;
}

function resolveUserId(request: Request) {
  return hostedUserId(request, async (input) =>
    oauthUserInfoFromAuthAnswer(await auth.api.oauth2UserInfo(input)),
  );
}

const encryptionSecret = process.env[VAULT_ENCRYPTION_ENVIRONMENT.SECRET];

export default {
  async fetch(request: Request): Promise<Response> {
    return handleActWorkspace({
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
      unsupportedReason,
      executeCreateWorkspace: async ({ providerId, providerProjectId, name, task, apiKey }) => {
        // The handler already answers unsupported providers before the key is
        // read; this guard keeps the Conductor call locally impossible to
        // reach with another provider's key regardless of that ordering.
        const reason = unsupportedReason(providerId);
        if (reason) return { result: "unsupported", reason };
        return executeConductorCreateWorkspace(providerProjectId, name, task, apiKey);
      },
    });
  },
};
