import {
  type CloudFetch,
  CONTEXT_ITEM_KIND,
  contextItemId,
  type ObservedSession,
  remoteRealtimeClientSecretRequest,
} from "../core.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { observedSessionForResponse } from "./observe.js";
import type { HostedSpend } from "./quota.js";
import { remoteSessionContextText } from "./remote-context.js";
import { observeProviders, readApiKeyFor } from "./vault-keys.js";
import type { HostedVaultRoute } from "./vault-route.js";
import { mintRealtimeConnection, voiceMintPreferences } from "./voice-mint.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in iPhone, on the
 * key this deployment holds. Unlike the desktop mint, this endpoint also runs
 * a cloud observe pass and pre-serializes the session roster as a context item
 * so the phone can be a thin terminal: it forwards the opaque string into the
 * Realtime conversation without re-implementing context serialization logic.
 *
 * The tool list is narrowed to the actions the remote action endpoints serve; the
 * server re-validates every action on its own fresh observation pass regardless,
 * so the phone's narrowed set is a first gate, not the last.
 */

export interface RemoteVoiceMintOptions
  extends Pick<
    HostedVaultRoute,
    "request" | "resolveUserId" | "encryptionSecret" | "readVaultKeys"
  > {
  apiKey: string | undefined;
  model?: string | undefined;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: CloudFetch | undefined;
  now?: (() => number) | undefined;
  timeoutMs?: number | undefined;
}

const MOBILE_MINT_STRICT_FIELDS: readonly string[] = ["voice", "speed"];

export async function handleRemoteVoiceMint(options: RemoteVoiceMintOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const apiKey = (options.apiKey ?? "").trim() || undefined;
  const model = (options.model ?? "").trim() || undefined;

  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const preferences = await voiceMintPreferences(request, MOBILE_MINT_STRICT_FIELDS);
  if (!preferences) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const spend = await options.spend(userId);
  if (!spend.allowed) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
      quota: spend.quota,
    });
  }

  const now = options.now ?? Date.now;

  // Ephemeral Realtime keys expire in 60 s. Cap the observe leg to 30 s so the
  // key still has plenty of time to connect even if a cloud pass runs long.
  // observe resolves to [] on timeout rather than failing the whole request.
  const OBSERVE_TIMEOUT_MS = 30_000;

  // Mint credential and observe sessions concurrently — neither depends on the
  // other, so there is no reason to serialize them.
  let observeTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const [minted, sessions] = await Promise.all([
    mintRealtimeConnection({
      apiKey,
      model,
      preferences,
      clientSecretRequest: remoteRealtimeClientSecretRequest,
      fetch: options.fetch,
      now: options.now,
      timeoutMs: options.timeoutMs,
    }),
    Promise.race([
      observeCloudSessions(userId, options),
      new Promise<ObservedSession[]>((resolve) => {
        observeTimeoutHandle = setTimeout(() => resolve([]), OBSERVE_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(observeTimeoutHandle)),
  ]);

  if ("failure" in minted) return minted.failure;

  const sessionItemId = contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 0);
  const contextText = remoteSessionContextText(sessions, now());
  // The label prefix matches the one `sessionContextEvents` in @sidecar/brain
  // applies, so the model reads remote and desktop context items identically.
  const sessionItemText = `[observed session status, sent automatically]\n${contextText}`;

  return jsonResponse(HOSTED_HTTP_STATUS.OK, {
    connection: minted.connection,
    quota: spend.quota,
    context: {
      sessions: {
        itemId: sessionItemId,
        text: sessionItemText,
      },
    },
  });
}

async function observeCloudSessions(
  userId: string,
  options: RemoteVoiceMintOptions,
): Promise<ObservedSession[]> {
  const secret = (options.encryptionSecret ?? "").trim();
  if (!secret) return [];

  const rows = await options.readVaultKeys(userId).catch(() => []);
  const passes = await observeProviders({
    readApiKey: readApiKeyFor(rows, secret),
    read: (adapter) => adapter.observe(),
    seams: options,
  });

  const sessions: ObservedSession[] = [];
  for (const pass of passes) {
    for (const observation of pass.answer ?? []) {
      sessions.push(observedSessionForResponse(pass.providerId, observation));
    }
  }
  return sessions;
}
