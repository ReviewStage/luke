import {
  HOSTED_ACT_RESULT,
  type HostedActAnswer,
  type HostedActResult,
  isRecord,
  sessionMessageText,
  text,
  type UnparsedWireValue,
  VAULT_PROVIDER_ID,
  type VaultProviderId,
} from "../core.js";
import { decryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/** Maximum length accepted for a provider session id in a URL segment. */
const SESSION_ID_MAX_LENGTH = 200;

/**
 * A provider session id safe to embed in a URL segment: non-empty, no path
 * separators, under the length ceiling. The provider's API returns 404 for
 * an id that does not exist, so format validation here is minimal.
 */
function parseProviderSessionId(value: UnparsedWireValue): string | undefined {
  const s = text(value);
  if (!s || s.length > SESSION_ID_MAX_LENGTH) return undefined;
  if (s.includes("/") || s.includes("\\") || s.includes("\0")) return undefined;
  return s;
}

const VAULT_PROVIDER_ID_SET: ReadonlySet<string> = new Set(Object.values(VAULT_PROVIDER_ID));

function isVaultProviderId(value: string | undefined): value is VaultProviderId {
  return value !== undefined && VAULT_PROVIDER_ID_SET.has(value);
}

function trimmedSecretOrUnavailable(secret: string | undefined): { secret: string } | Response {
  const trimmed = secret?.trim();
  if (!trimmed) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }
  return { secret: trimmed };
}

export interface ActMessageExecuteResult {
  result: HostedActResult;
  reason?: string;
}

export interface ActMessageOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  /** Reads the encrypted key row for this user and provider, or undefined if none stored. */
  readKey: (userId: string, providerId: string) => Promise<{ ciphertext: string } | undefined>;
  /**
   * Validates (via a fresh observation pass) and delivers the message. The
   * implementation is provider-specific and injected by the route; the handler
   * enforces text bounds and auth before calling it.
   */
  executeMessage: (options: {
    providerId: VaultProviderId;
    providerSessionId: string;
    text: string;
    apiKey: string;
  }) => Promise<ActMessageExecuteResult>;
}

/** Validates and delivers a message to a cloud session on the user's behalf. */
export async function handleActMessage(options: ActMessageOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, readKey, executeMessage } = options;

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

  const providerSessionId = parseProviderSessionId(body.providerSessionId);
  if (!providerSessionId) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  // Bound the text exactly as the desktop does before any network call.
  const messageText = sessionMessageText(body.text);
  if (!messageText) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const keyRow = await readKey(userId, providerId);
  if (!keyRow) {
    const answer: HostedActAnswer = {
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

  const executeResult = await executeMessage({
    providerId,
    providerSessionId,
    text: messageText,
    apiKey,
  });

  const answer: HostedActAnswer = {
    result: executeResult.result,
    ...(executeResult.reason ? { reason: executeResult.reason } : undefined),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
