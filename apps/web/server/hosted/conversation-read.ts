import { type HostedConversationAnswer, isVaultProviderId, type VaultProviderId } from "../core.js";
import type { ConversationReadRefusal } from "./act-execute.js";
import { providerReadsConversation } from "./act-execute.js";
import { parseProviderSessionId } from "./act-session.js";
import { decryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { createRateBrake } from "./rate-brake.js";

/**
 * Wider than the observe brake because one opened screen is several requests
 * by design — the catch-up reads while the provider says more remain, then
 * the poll behind the `after` cursor — and each is as bounded as one observe.
 */
const CONVERSATION_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 30,
  MAX_TRACKED_USERS: 10_000,
} as const;

const conversationRateLimited = createRateBrake({
  windowMs: CONVERSATION_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: CONVERSATION_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: CONVERSATION_RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface ConversationReadOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var is absent. */
  encryptionSecret: string | undefined;
  /** Reads the encrypted key row for this user and provider, or undefined if none stored. */
  readKey: (userId: string, providerId: string) => Promise<{ ciphertext: string } | undefined>;
  /**
   * Validates (via a fresh observation pass) and makes the read. The
   * implementation is provider-specific and injected by the route; the
   * handler enforces bounds and auth before calling it.
   */
  execute: (options: {
    providerId: VaultProviderId;
    providerSessionId: string;
    afterMessageId?: string;
    beforeOffset?: number;
    apiKey: string;
  }) => Promise<HostedConversationAnswer | ConversationReadRefusal>;
  now?: () => number;
}

/**
 * The widest history position a request may name: past this the number is not
 * an offset an earlier answer could have reported, so the request is refused
 * before it can steer a read.
 */
const MAXIMUM_BEFORE_OFFSET = 100_000_000;

/** A history position exactly as an earlier answer reported one, or nothing. */
function parseBeforeOffset(value: string): number | undefined {
  if (!/^\d{1,9}$/.test(value)) return undefined;
  const offset = Number(value);
  return offset <= MAXIMUM_BEFORE_OFFSET ? offset : undefined;
}

/**
 * Read-a-conversation-on-demand: one GET per ask from an opened conversation
 * screen, sharing the act endpoints' gates — bearer auth, a vault provider
 * id, a bounded session id and cursor, and the stored key decrypted only for
 * a request that passed everything else. The executor re-observes before
 * reading, exactly as a write would, and the server stores nothing after
 * serving the response. Only the client asks; no observation pass ever
 * issues this read.
 */
export async function handleConversationRead(options: ConversationReadOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, readKey } = options;

  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const secret = (encryptionSecret ?? "").trim();
  if (!secret) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const now = (options.now ?? Date.now)();
  if (conversationRateLimited(userId, now)) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }

  const query = new URL(request.url).searchParams;
  const providerId = query.get("providerId") ?? undefined;
  if (!isVaultProviderId(providerId) || !providerReadsConversation(providerId)) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const providerSessionId = parseProviderSessionId(query.get("providerSessionId") ?? undefined);
  if (!providerSessionId) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  // Both positions are optional — absent, the read answers the latest page —
  // but one that arrives must hold the shape an earlier answer handed back,
  // and a poll and a history read are different asks, never combined.
  const afterParameter = query.get("after");
  const afterMessageId =
    afterParameter === null ? undefined : parseProviderSessionId(afterParameter);
  if (afterParameter !== null && !afterMessageId) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  const beforeParameter = query.get("beforeOffset");
  const beforeOffset = beforeParameter === null ? undefined : parseBeforeOffset(beforeParameter);
  if (beforeParameter !== null && beforeOffset === undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }
  if (afterMessageId !== undefined && beforeOffset !== undefined) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const keyRow = await readKey(userId, providerId);
  if (!keyRow) {
    // A roster that advertised this read had a key behind it; a request with
    // none stored is not one that screen could have made.
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  let apiKey: string;
  try {
    apiKey = decryptProviderKey(keyRow.ciphertext, secret);
  } catch {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const outcome = await options.execute({
    providerId,
    providerSessionId,
    ...(afterMessageId ? { afterMessageId } : undefined),
    ...(beforeOffset !== undefined ? { beforeOffset } : undefined),
    apiKey,
  });
  if ("refused" in outcome) {
    // The screen behind this request draws its empty state either way; the
    // status says only that the provider side, not the request, refused.
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
  }
  return jsonResponse(HOSTED_HTTP_STATUS.OK, outcome);
}
