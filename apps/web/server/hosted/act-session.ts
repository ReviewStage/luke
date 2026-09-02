import {
  HOSTED_ACT_RESULT,
  type HostedActWorkspaceAnswer,
  isRecord,
  text,
  type UnparsedWireValue,
  VAULT_PROVIDER_ID,
  type VaultProviderId,
  type WireRecord,
} from "../core.js";
import type { ActExecutionAnswer } from "./act-execute.js";
import { decryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/** Maximum length accepted for a provider session id in a URL segment. */
const SESSION_ID_MAX_LENGTH = 200;

/**
 * A provider session id safe to embed in a URL segment: non-empty, no path
 * separators, under the length ceiling. The provider's API returns 404 for
 * an id that does not exist, so format validation here is minimal. The
 * conversation read holds its message-id cursor to the same shape, since a
 * cursor rides a request exactly the way a session id does.
 */
export function parseProviderSessionId(value: UnparsedWireValue): string | undefined {
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

/**
 * One session-scoped act request: every act a mobile row asks of an observed
 * session shares these gates — bearer auth, a vault provider id, a bounded
 * session id, the act's own bounded fields, the unsupported answer before a
 * key is required, and the stored key decrypted only for a request that
 * passed everything else. Only the fields and the executor differ per act,
 * so they are the seams.
 */
export interface SessionActOptions<Fields extends Record<string, string | undefined>> {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  /** Reads the encrypted key row for this user and provider, or undefined if none stored. */
  readKey: (userId: string, providerId: string) => Promise<{ ciphertext: string } | undefined>;
  /**
   * Parses and bounds the act's own fields from the validated body; undefined
   * is an invalid request, exactly as an unbounded message text is.
   */
  parseFields: (body: WireRecord) => Fields | undefined;
  /**
   * The reason this provider cannot take this act, or undefined for one that
   * can. Checked before the vault key is required, so an unsupported provider
   * answers "unsupported" whether or not a key is stored — storing a key
   * would not enable the act.
   */
  unsupportedReason: (providerId: VaultProviderId) => string | undefined;
  /**
   * Validates (via a fresh observation pass) and delivers the act. The
   * implementation is provider-specific and injected by the route; the
   * handler enforces bounds and auth before calling it.
   */
  execute: (
    options: { providerId: VaultProviderId; providerSessionId: string; apiKey: string } & Fields,
  ) => Promise<ActExecutionAnswer>;
}

/** Validates and delivers one act aimed at a cloud session on the user's behalf. */
export async function handleSessionAct<Fields extends Record<string, string | undefined>>(
  options: SessionActOptions<Fields>,
): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, readKey, parseFields, unsupportedReason } =
    options;

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

  // Bound the act's own fields exactly as the desktop does before any network call.
  const fields = parseFields(body);
  if (!fields) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const unsupported = unsupportedReason(providerId);
  if (unsupported) {
    const answer: HostedActWorkspaceAnswer = {
      result: HOSTED_ACT_RESULT.UNSUPPORTED,
      reason: unsupported,
    };
    return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
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

  const executeResult = await options.execute({ providerId, providerSessionId, apiKey, ...fields });

  const answer: HostedActWorkspaceAnswer = {
    result: executeResult.result,
    ...(executeResult.reason ? { reason: executeResult.reason } : undefined),
    ...(executeResult.providerSessionId
      ? { providerSessionId: executeResult.providerSessionId }
      : undefined),
  };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
