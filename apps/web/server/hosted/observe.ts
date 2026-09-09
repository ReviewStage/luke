import type { CloudFetch, ProviderSessionObservation } from "../core.js";
import {
  ACTION_KIND,
  advertisedActionFor,
  advertisedControls,
  type CloudAgentProviderId,
  normalizeSessionDetail,
  type ObservedSession,
  type ObservedSessionControl,
} from "../core.js";
import { providerReadsConversation } from "./action-execute.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import { createRateBrake } from "./rate-brake.js";
import { observeProviders, readApiKeyFor } from "./vault-keys.js";
import type { HostedVaultRoute } from "./vault-route.js";

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

export interface ObserveOptions
  extends Pick<
    HostedVaultRoute,
    "request" | "resolveUserId" | "encryptionSecret" | "readVaultKeys"
  > {
  /** Injected in tests; production uses the global fetch. */
  fetch?: CloudFetch;
  now?: () => number;
}

/**
 * Observe-on-demand: decrypts the caller's vault keys, runs each cloud
 * adapter once (minimumPassIntervalMs: 0 bypasses the pass debounce),
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

  const rows = await readVaultKeys(userId);
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

  return jsonResponse(HOSTED_HTTP_STATUS.OK, { sessions });
}

/**
 * The actions an observation advertised, written onto its wire row. Each is
 * presence-only where it can be: what a control targets, or which workspace a
 * rename lands on, never travels — the action endpoints re-observe and rebuild
 * every write from their own fresh advertisement.
 */
function writeAdvertisedActions(
  session: ObservedSession,
  observation: Pick<ProviderSessionObservation, "advertises">,
): void {
  if (advertisedActionFor(observation, ACTION_KIND.MESSAGE)) session.canReceiveMessage = true;
  const controls = advertisedControls(observation)
    .map((control): ObservedSessionControl => {
      const wireControl: ObservedSessionControl = { id: control.id, label: control.label };
      if (control.controlKind) wireControl.kind = control.controlKind;
      return wireControl;
    })
    .filter((control) => control.id && control.label);
  if (controls.length > 0) session.controls = controls;
  const spawnableAgents = advertisedActionFor(observation, ACTION_KIND.ADD_AGENT)?.agents.filter(
    (agent) => agent.length > 0,
  );
  if (spawnableAgents && spawnableAgents.length > 0) {
    session.spawnableAgents = [...spawnableAgents];
  }
  if (advertisedActionFor(observation, ACTION_KIND.RENAME_SESSION)) session.canRename = true;
  if (advertisedActionFor(observation, ACTION_KIND.RENAME_WORKSPACE))
    session.canRenameWorkspace = true;
}

export function observedSessionForResponse(
  providerId: CloudAgentProviderId,
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
  writeAdvertisedActions(session, obs);
  // A capability of the provider's documented transcript read, advertised so
  // a screen offers the fetch only where the messages endpoint could answer.
  if (providerReadsConversation(providerId)) session.canReadConversation = true;
  return session;
}
