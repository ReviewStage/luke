import { ConductorSessionAdapter } from "../../../../packages/providers/src/conductor/adapter.js";
import { CopilotSessionAdapter } from "../../../../packages/providers/src/copilot/adapter.js";
import { CursorSessionAdapter } from "../../../../packages/providers/src/cursor/adapter.js";
import { DevinSessionAdapter } from "../../../../packages/providers/src/devin/adapter.js";
import { JulesSessionAdapter } from "../../../../packages/providers/src/jules/adapter.js";
import { ReplicasSessionAdapter } from "../../../../packages/providers/src/replicas/adapter.js";
import type { CloudFetch } from "../../../../packages/providers/src/shared/cloud-session-adapter.js";
import type { ProviderSessionObservation } from "../core.js";
import { type ObservedSession, VAULT_PROVIDER_ID, type VaultProviderId } from "../core.js";
import { decryptProviderKey } from "./encryption.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";

/** Stored vault key row as the API route supplies it. */
export interface VaultKeyRow {
  providerId: string;
  ciphertext: string;
}

export interface ObserveOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  /** The value of PROVIDER_KEY_ENCRYPTION_SECRET; undefined means the env var is absent. */
  encryptionSecret: string | undefined;
  /** Reads every vault key row the user has stored, for decryption here. */
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * Observe-on-demand: decrypts the caller's vault keys, runs each cloud
 * adapter once (minimumRefreshIntervalMs: 0 bypasses the refresh debounce),
 * and returns a bounded roster. Nothing is stored between requests.
 */
export async function handleObserve(options: ObserveOptions): Promise<Response> {
  const { request, resolveUserId, encryptionSecret, readVaultKeys } = options;

  if (request.method !== "GET") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const secret = (encryptionSecret ?? "").trim();
  if (!secret) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const rows = await readVaultKeys(userId);
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

  const baseOptions = {
    minimumRefreshIntervalMs: 0,
    ...(options.fetch ? { fetch: options.fetch } : undefined),
    ...(options.now ? { now: options.now } : undefined),
  };

  const providers: Array<{
    providerId: VaultProviderId;
    observe: () => Promise<readonly ProviderSessionObservation[]>;
  }> = [
    {
      providerId: VAULT_PROVIDER_ID.CONDUCTOR,
      observe: () =>
        new ConductorSessionAdapter({
          ...baseOptions,
          readApiKey: readApiKeyFor(VAULT_PROVIDER_ID.CONDUCTOR),
        }).observe(),
    },
    {
      providerId: VAULT_PROVIDER_ID.COPILOT,
      observe: () =>
        new CopilotSessionAdapter({
          ...baseOptions,
          readApiKey: readApiKeyFor(VAULT_PROVIDER_ID.COPILOT),
        }).observe(),
    },
    {
      providerId: VAULT_PROVIDER_ID.CURSOR,
      observe: () =>
        new CursorSessionAdapter({
          ...baseOptions,
          readApiKey: readApiKeyFor(VAULT_PROVIDER_ID.CURSOR),
        }).observe(),
    },
    {
      providerId: VAULT_PROVIDER_ID.DEVIN,
      observe: () =>
        new DevinSessionAdapter({
          ...baseOptions,
          readApiKey: readApiKeyFor(VAULT_PROVIDER_ID.DEVIN),
        }).observe(),
    },
    {
      providerId: VAULT_PROVIDER_ID.JULES,
      observe: () =>
        new JulesSessionAdapter({
          ...baseOptions,
          readApiKey: readApiKeyFor(VAULT_PROVIDER_ID.JULES),
        }).observe(),
    },
    {
      providerId: VAULT_PROVIDER_ID.REPLICAS,
      observe: () =>
        new ReplicasSessionAdapter({
          ...baseOptions,
          readApiKey: readApiKeyFor(VAULT_PROVIDER_ID.REPLICAS),
        }).observe(),
    },
  ];

  const results = await Promise.allSettled(providers.map(({ observe }) => observe()));

  const sessions: ObservedSession[] = [];
  for (const [i, { providerId }] of providers.entries()) {
    const result = results[i];
    if (result?.status !== "fulfilled") continue;
    for (const obs of result.value) {
      sessions.push(toWireSession(providerId, obs));
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { sessions });
}

function toWireSession(providerId: string, obs: ProviderSessionObservation): ObservedSession {
  const session: ObservedSession = {
    providerId,
    sessionId: obs.providerSessionId,
    title: obs.title,
    status: obs.status,
  };
  const workspace = obs.detail?.repository;
  if (workspace) session.workspace = workspace;
  const branch = obs.detail?.branch;
  if (branch) session.branch = branch;
  if (obs.recap) session.recap = obs.recap;
  const error = obs.detail?.error;
  if (error) session.error = error;
  return session;
}
