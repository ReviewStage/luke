import type * as HttpClient from "@effect/platform/HttpClient";
import type { SqlClient } from "@effect/sql";
import type { SqlError } from "@effect/sql/SqlError";
import { Effect, type Layer, type ParseResult } from "effect";
import type { ProviderSessionObservation } from "../core.js";
import {
  ACTION_KIND,
  advertisedActionFor,
  advertisedControls,
  type CloudAgentProviderId,
  normalizeSessionDetail,
  OBSERVE_QUERY,
  type ObserveAnswer,
  type ObservedSession,
  type ObservedSessionControl,
} from "../core.js";
import { providerReadsConversation } from "./action-execute.js";
import { errorResponse, HOSTED_API_ERROR, HOSTED_HTTP_STATUS, jsonResponse } from "./http.js";
import {
  keyedCloudProviderIds,
  type ObservationStore,
  observeAndSnapshot,
  storedRoster,
} from "./observation-pass.js";
import type { ObservedRoster } from "./observed-roster.js";
import { makeRateBrake } from "./rate-brake.js";
import type { HostedVaultRoute } from "./vault-route.js";

const OBSERVE_RATE_LIMIT = {
  WINDOW_MS: 60_000,
  MAX_REQUESTS_PER_WINDOW: 10,
  MAX_TRACKED_USERS: 10_000,
} as const;

const observeBrake = makeRateBrake({
  windowMs: OBSERVE_RATE_LIMIT.WINDOW_MS,
  maxRequestsPerWindow: OBSERVE_RATE_LIMIT.MAX_REQUESTS_PER_WINDOW,
  maxTrackedUsers: OBSERVE_RATE_LIMIT.MAX_TRACKED_USERS,
});

export interface ObserveOptions
  extends Pick<
    HostedVaultRoute,
    "request" | "resolveUserId" | "encryptionSecret" | "readVaultKeys"
  > {
  /** The store the snapshot is read from and, on a live pass, written to. */
  store: (secret: string) => ObservationStore;
  /** Injected in tests; production uses the platform's own fetch client. */
  httpClient?: Layer.Layer<HttpClient.HttpClient>;
  now?: () => number;
}

/**
 * The signed-in user's cloud roster: the snapshot the scheduled pass last
 * stored, mapped onto the bounded wire rows. A live pass runs only where the
 * caller asked for a fresh read — under the per-user brake, since a pass is
 * the whole provider fan-out — or where no snapshot stands yet or the one
 * standing was observed under keys since replaced, and either way it is the
 * same pass the schedule runs, stored the same way. A user with no cloud key
 * has no roster to read or store and is answered empty.
 */
export function handleObserve(
  options: ObserveOptions,
): Effect.Effect<Response, SqlError | ParseResult.ParseError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const { request, resolveUserId, encryptionSecret, readVaultKeys } = options;

    if (request.method !== "GET") {
      return errorResponse(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );
    }

    const userId = yield* Effect.promise(() => resolveUserId(request));
    if (!userId) {
      return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
    }

    const secret = (encryptionSecret ?? "").trim();
    if (!secret) {
      return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
    }

    const rows = yield* Effect.promise(() => readVaultKeys(userId));
    if (keyedCloudProviderIds(rows).length === 0) {
      return jsonResponse(HOSTED_HTTP_STATUS.OK, observeAnswer(undefined, undefined));
    }

    const store = options.store(secret);
    const fresh =
      new URL(request.url).searchParams.get(OBSERVE_QUERY.FRESH) === OBSERVE_QUERY.FRESH_VALUE;
    if (!fresh) {
      const stored = yield* storedRoster(store, userId, rows, secret);
      if (stored?.roster) {
        return jsonResponse(HOSTED_HTTP_STATUS.OK, observeAnswer(stored.roster, stored.observedAt));
      }
    }

    const now = (options.now ?? Date.now)();
    if (!(yield* observeBrake.check(userId))) {
      return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
    }

    const outcome = yield* observeAndSnapshot({
      userId,
      rows,
      secret,
      store,
      seams: options,
      now,
    });
    return jsonResponse(HOSTED_HTTP_STATUS.OK, observeAnswer(outcome.roster, outcome.observedAt));
  });
}

/** The roster as the wire carries it: every provider's observations as bounded rows, dated by the snapshot. */
function observeAnswer(
  roster: ObservedRoster | undefined,
  observedAt: number | undefined,
): ObserveAnswer {
  const sessions: ObservedSession[] = [];
  for (const provider of roster?.providers ?? []) {
    for (const observation of provider.observations) {
      sessions.push(observedSessionForResponse(provider.providerId, observation));
    }
  }
  return { sessions, ...(observedAt !== undefined ? { observedAt } : undefined) };
}

/**
 * The actions an observation advertised, written onto its wire row. Each is
 * presence-only where it can be: what a control targets, or which workspace a
 * rename lands on, never travels — the action endpoints admit against the
 * same stored snapshot's own advertisement and build every write from it.
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
