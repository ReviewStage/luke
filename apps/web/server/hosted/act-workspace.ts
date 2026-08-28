import {
  HOSTED_ACT_RESULT,
  type HostedActResult,
  type HostedActWorkspaceAnswer,
  isRecord,
  sessionMessageText,
  text,
  type UnparsedWireValue,
  VAULT_PROVIDER_ID,
  type VaultProviderId,
  workspaceNameText,
} from "../core.js";
import { decryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

const VAULT_PROVIDER_ID_SET: ReadonlySet<string> = new Set(Object.values(VAULT_PROVIDER_ID));

function isVaultProviderId(value: string | undefined): value is VaultProviderId {
  return value !== undefined && VAULT_PROVIDER_ID_SET.has(value);
}

/** Maximum length accepted for a provider project id. */
const PROJECT_ID_MAX_LENGTH = 200;

function parseProviderProjectId(value: UnparsedWireValue): string | undefined {
  const s = text(value);
  if (!s || s.length > PROJECT_ID_MAX_LENGTH) return undefined;
  if (s.includes("\0")) return undefined;
  return s;
}

function trimmedSecretOrUnavailable(secret: string | undefined): { secret: string } | Response {
  const trimmed = secret?.trim();
  if (!trimmed) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  return { secret: trimmed };
}

export interface ActWorkspaceExecuteResult {
  result: HostedActResult;
  reason?: string;
  providerSessionId?: string;
}

export interface ActWorkspaceOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  readKey: (userId: string, providerId: string) => Promise<{ ciphertext: string } | undefined>;
  /**
   * Validates (via a fresh observation pass) and creates the workspace. The
   * implementation is provider-specific and injected by the route.
   */
  executeCreateWorkspace: (options: {
    providerId: VaultProviderId;
    providerProjectId: string;
    name: string | undefined;
    task: string | undefined;
    apiKey: string;
  }) => Promise<ActWorkspaceExecuteResult>;
}

/** Validates and creates a workspace in a cloud project on the user's behalf. */
export async function handleActWorkspace(options: ActWorkspaceOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, readKey, executeCreateWorkspace } = options;

  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secretResult = trimmedSecretOrUnavailable(encryptionSecret);
  if (secretResult instanceof Response) return secretResult;

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  let body: UnparsedWireValue;
  try {
    // SAFETY: request.json() returns unknown; isRecord below validates the shape.
    body = (await request.json()) as UnparsedWireValue;
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  if (!isRecord(body)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const providerId = text(body.providerId);
  if (!isVaultProviderId(providerId)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const providerProjectId = parseProviderProjectId(body.providerProjectId);
  if (!providerProjectId) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  // Bound name and task exactly as the desktop does before any network call.
  const rawName = text(body.name);
  const name = rawName !== undefined ? workspaceNameText(rawName) : undefined;
  if (rawName !== undefined && name === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const rawTask = text(body.task);
  const task = rawTask !== undefined ? sessionMessageText(rawTask) : undefined;
  if (rawTask !== undefined && task === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const keyRow = await readKey(userId, providerId);
  if (!keyRow) {
    const answer: HostedActWorkspaceAnswer = {
      result: HOSTED_ACT_RESULT.REJECTED,
      reason: "No provider key stored. Add a key for this provider in settings.",
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
  }

  let apiKey: string;
  try {
    apiKey = decryptProviderKey(keyRow.ciphertext, secretResult.secret);
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const executeResult = await executeCreateWorkspace({
    providerId,
    providerProjectId,
    name,
    task,
    apiKey,
  });

  const answer: HostedActWorkspaceAnswer = {
    result: executeResult.result,
    ...(executeResult.reason ? { reason: executeResult.reason } : undefined),
    ...(executeResult.providerSessionId
      ? { providerSessionId: executeResult.providerSessionId }
      : undefined),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
