import {
  CONTEXT_ITEM_KIND,
  contextItemId,
  type ObservedSession,
  type ObservedSessionControl,
  remoteRealtimeClientSecretRequest,
  VAULT_PROVIDER_ID,
  type VaultProviderId,
} from "../core.js";
import { cloudSessionAdapterFor } from "./cloud-adapters.js";
import { decryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import type { VaultKeyRow } from "./observe.js";
import type { FetchLike } from "./openai.js";
import type { HostedSpend } from "./quota.js";
import { remoteSessionContextText } from "./remote-context.js";
import { mintRealtimeConnection, voiceMintPreferences } from "./voice-mint.js";

/**
 * Mints one ephemeral Realtime credential for the signed-in iPhone, on the
 * key this deployment holds. Unlike the desktop mint, this endpoint also runs
 * a cloud observe pass and pre-serializes the session roster as a context item
 * so the phone can be a thin terminal: it forwards the opaque string into the
 * Realtime conversation without re-implementing context serialization logic.
 *
 * The tool list is narrowed to the acts the remote act endpoints serve; the
 * server re-validates every act on its own fresh observation pass regardless,
 * so the phone's narrowed set is a first gate, not the last.
 */

export interface RemoteVoiceMintOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  encryptionSecret: string | undefined;
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
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
      new Promise<ObservedSession[]>((resolve) =>
        setTimeout(() => resolve([]), OBSERVE_TIMEOUT_MS),
      ),
    ]),
  ]);

  if ("failure" in minted) return minted.failure;

  const sessionItemId = contextItemId(CONTEXT_ITEM_KIND.SESSIONS, 0);
  const contextText = remoteSessionContextText(sessions, now());
  // The label prefix matches the one `sessionContextEvents` in @sidecar/realtime
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
  const ciphertextByProviderId = new Map<string, string>(
    rows.map((row) => [row.providerId, row.ciphertext]),
  );

  function readApiKeyFor(providerId: string): () => Promise<string | undefined> {
    return async () => {
      const ciphertext = ciphertextByProviderId.get(providerId);
      if (!ciphertext) return undefined;
      try {
        return decryptProviderKey(ciphertext, secret);
      } catch {
        return undefined;
      }
    };
  }

  const vaultProviders = Object.values(VAULT_PROVIDER_ID);
  const results = await Promise.allSettled(
    vaultProviders.map((providerId: VaultProviderId) =>
      cloudSessionAdapterFor(providerId, {
        readApiKey: readApiKeyFor(providerId),
        ...(options.fetch ? { fetch: options.fetch } : undefined),
        ...(options.now ? { now: options.now } : undefined),
      }).observe(),
    ),
  );

  const sessions: ObservedSession[] = [];
  for (const [i, providerId] of vaultProviders.entries()) {
    const result = results[i];
    if (result?.status !== "fulfilled") continue;
    for (const obs of result.value) {
      const session: ObservedSession = {
        providerId,
        sessionId: obs.providerSessionId,
        title: obs.title,
        status: obs.status,
      };
      if (obs.detail?.repository) session.workspace = obs.detail.repository;
      if (obs.detail?.branch) session.branch = obs.detail.branch;
      if (obs.recap) session.recap = obs.recap;
      if (obs.detail?.error) session.error = obs.detail.error;
      if (obs.observedAt !== undefined) session.observedAt = obs.observedAt;
      if (obs.canReceiveMessage) session.canReceiveMessage = true;
      const controls = obs.controls
        ?.map((c): ObservedSessionControl => {
          const control: ObservedSessionControl = { id: c.id, label: c.label };
          if (c.kind) control.kind = c.kind;
          return control;
        })
        .filter((c) => c.id && c.label);
      if (controls && controls.length > 0) session.controls = controls;
      const spawnableAgents = obs.spawnableAgents?.filter((a) => a.length > 0);
      if (spawnableAgents && spawnableAgents.length > 0) {
        session.spawnableAgents = [...spawnableAgents];
      }
      if (obs.canRename) session.canRename = true;
      if (obs.renameTarget) session.canRenameWorkspace = true;
      sessions.push(session);
    }
  }
  return sessions;
}
