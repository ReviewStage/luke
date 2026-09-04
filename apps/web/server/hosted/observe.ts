import type { CloudFetch } from "../../../../packages/providers/src/shared/cloud-session-adapter.js";
import type { ProviderSessionObservation } from "../core.js";
import {
  normalizeSessionDetail,
  type ObservedSession,
  type ObservedSessionControl,
  type VaultProviderId,
} from "../core.js";
import { providerReadsConversation } from "./act-execute.js";
import { observeCloudProviders, type VaultKeyRow } from "./cloud-observe.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { createRateBrake } from "./rate-brake.js";

const OBSERVE_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 10,
  MAX_TRACKED_USERS: 10_000,
} as const;

const observeRateLimited = createRateBrake({
  windowMs: OBSERVE_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: OBSERVE_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: OBSERVE_RATE_LIMIT.MAX_TRACKED_USERS,
});

export type { VaultKeyRow } from "./cloud-observe.js";

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

  const now = (options.now ?? Date.now)();
  if (observeRateLimited(userId, now)) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  }

  const observed = await observeCloudProviders(await readVaultKeys(userId), secret, {
    ...(options.fetch ? { fetch: options.fetch } : undefined),
    ...(options.now ? { now: options.now } : undefined),
  });

  const sessions: ObservedSession[] = [];
  for (const { providerId, observations } of observed) {
    for (const obs of observations) {
      sessions.push(observedSessionForResponse(providerId, obs));
    }
  }

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { sessions });
}

export function observedSessionForResponse(
  providerId: VaultProviderId,
  obs: ProviderSessionObservation,
): ObservedSession {
  const session: ObservedSession = {
    providerId,
    sessionId: obs.providerSessionId,
    title: obs.title,
    status: obs.status,
  };
  const detail = normalizeSessionDetail(obs.detail);
  const workspace = detail.repository;
  if (workspace) session.workspace = workspace;
  const branch = detail.branch;
  if (branch) session.branch = branch;
  const change = detail.change;
  if (change) session.change = change;
  const link = detail.link;
  if (link) session.link = link;
  const error = detail.error;
  if (error) session.error = error;
  session.lastActivityAt = obs.lastActivityAt;
  session.observedAt = obs.lastActivityAt;
  // The act advertisements, so a row can offer only what the observation
  // promised. Each is presence-only where it can be: what a control targets,
  // or which workspace a rename lands on, never travels — the act endpoints
  // re-observe and rebuild every write from their own fresh advertisement.
  if (obs.canReceiveMessage) session.canReceiveMessage = true;
  const controls = obs.controls
    ?.map((control): ObservedSessionControl => {
      const wireControl: ObservedSessionControl = { id: control.id, label: control.label };
      if (control.kind) wireControl.kind = control.kind;
      return wireControl;
    })
    .filter((control) => control.id && control.label);
  if (controls && controls.length > 0) session.controls = controls;
  const spawnableAgents = obs.spawnableAgents?.filter((agent) => agent.length > 0);
  if (spawnableAgents && spawnableAgents.length > 0) {
    session.spawnableAgents = [...spawnableAgents];
  }
  if (obs.canRename) session.canRename = true;
  if (obs.renameTarget) session.canRenameWorkspace = true;
  // A capability of the provider's documented transcript read, advertised so
  // a screen offers the fetch only where the messages endpoint could answer.
  if (providerReadsConversation(providerId)) session.canReadConversation = true;
  return session;
}
