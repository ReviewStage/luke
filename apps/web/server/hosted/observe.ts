import { Context, Effect } from "effect";
import { ConductorSessionAdapter } from "../../../../packages/providers/src/conductor/adapter.js";
import { CopilotSessionAdapter } from "../../../../packages/providers/src/copilot/adapter.js";
import { CursorSessionAdapter } from "../../../../packages/providers/src/cursor/adapter.js";
import { DevinSessionAdapter } from "../../../../packages/providers/src/devin/adapter.js";
import { JulesSessionAdapter } from "../../../../packages/providers/src/jules/adapter.js";
import { ReplicasSessionAdapter } from "../../../../packages/providers/src/replicas/adapter.js";
import type { CloudFetch } from "../../../../packages/providers/src/shared/cloud-session-adapter.js";
import type { ProviderSessionObservation } from "../core.js";
import { type ObservedSession, VAULT_PROVIDER_ID, type VaultProviderId } from "../core.js";
import { HostedAuth, HostedClock, HostedEncryption } from "../services/tags.js";
import { decryptProviderKey } from "./encryption.js";
import {
  HOSTED_HTTP_STATUS,
  jsonResponseEffect,
  methodNotAllowed,
  quotaExhausted,
  unauthorized,
  unavailable,
} from "./http-effect.js";

/**
 * Per-user in-memory brake, keyed on the resolved account rather than the
 * network address: the token already names who is asking, so rotating IPs
 * cannot route around it. The counter lives in the function instance, which
 * makes it a per-instance brake rather than a cluster-wide guarantee —
 * platform-level rules are the real backstop — but it turns a hammering
 * client into a trickle and limits amplification against provider quotas.
 */
const OBSERVE_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 10,
  /** The map is bounded; past this it forgets the oldest window rather than growing. */
  MAX_TRACKED_USERS: 10_000,
} as const;

const observeRecentUsers = new Map<string, { windowStart: number; count: number }>();

function observeRateLimited(userId: string, now: number): boolean {
  const held = observeRecentUsers.get(userId);
  if (!held || now - held.windowStart >= OBSERVE_RATE_LIMIT.WINDOW_MS) {
    if (observeRecentUsers.size >= OBSERVE_RATE_LIMIT.MAX_TRACKED_USERS) {
      observeRecentUsers.clear();
    }
    observeRecentUsers.set(userId, { windowStart: now, count: 1 });
    return false;
  }
  held.count += 1;
  return held.count > OBSERVE_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW;
}

/** Stored vault key row as the API route supplies it. */
export interface VaultKeyRow {
  providerId: string;
  ciphertext: string;
}

export class ObserveVaultKeys extends Context.Tag("@luke/web/ObserveVaultKeys")<
  ObserveVaultKeys,
  {
    readonly readVaultKeys: (userId: string) => Effect.Effect<readonly VaultKeyRow[]>;
  }
>() {}

export class ObserveCloudFetch extends Context.Tag("@luke/web/ObserveCloudFetch")<
  ObserveCloudFetch,
  { readonly fetch?: CloudFetch }
>() {}

export const handleObserve = Effect.fn("handleObserve")(function* (request: Request) {
  if (request.method !== "GET") {
    return methodNotAllowed();
  }

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const encryption = yield* HostedEncryption;
  const secret = (encryption.secret ?? "").trim();
  if (!secret) {
    return unavailable();
  }

  const clock = yield* HostedClock;
  const now = clock.now();
  if (observeRateLimited(userId, now)) {
    return quotaExhausted();
  }

  const vault = yield* ObserveVaultKeys;
  const rows = yield* vault.readVaultKeys(userId);
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

  const cloudFetch = yield* ObserveCloudFetch;
  const baseOptions = {
    minimumRefreshIntervalMs: 0,
    ...(cloudFetch.fetch ? { fetch: cloudFetch.fetch } : undefined),
    now: () => clock.now(),
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
          skipBackgroundFetches: true,
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

  const results = yield* Effect.promise(() =>
    Promise.allSettled(providers.map(({ observe }) => observe())),
  );

  const sessions: ObservedSession[] = [];
  for (const [i, { providerId }] of providers.entries()) {
    const result = results[i];
    if (result?.status !== "fulfilled") continue;
    for (const obs of result.value) {
      sessions.push(toWireSession(providerId, obs));
    }
  }

  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, { sessions });
});

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
  session.observedAt = obs.observedAt;
  return session;
}

/** @deprecated Tests use hosted-runner shims. */
export interface ObserveOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  fetch?: CloudFetch;
  now?: () => number;
}
