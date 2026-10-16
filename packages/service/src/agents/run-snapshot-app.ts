import type { DatabaseServices } from "@luke/database/core/query";
import { standingSessionsOf } from "@luke/database/models/recorded-session";
import { RUN_SNAPSHOT_BOUNDS, type RunSnapshotAnswer } from "@luke/features/run-snapshot-wire";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { Effect, Layer, Option, Redacted, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { GitHubApp } from "../github/github-app.js";
import { githubReachOrRefusal } from "../github/github-refusal.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { type AccountResolving, reachedAgent } from "./agent-reach.js";
import { CODER } from "./coder-host/bounds.js";
import { AgentSandbox, SNAPSHOT_REFUSAL } from "./terminal/agent-sandbox.js";
import type { SandboxUnavailable } from "./vercel-sandbox-api.js";

/**
 * run-snapshot-app.ts -- a coding agent's working tree, taken for the Mac that runs it, with a token to fetch the commit it starts from.
 *
 * `POST /api/agents/<id>/run-snapshot`, under the account bearer, for an
 * agent the account reaches (`agent-reach.ts`). An archived agent is
 * retired, and one that has never run is not ready. A sandbox asleep is
 * woken, as its Terminal tab's Resume wakes it, and one starting is left to
 * start; either is answered as waking, so the Mac asks again. In a running sandbox the agent's checkout is read
 * without touching it (`agent-sandbox.ts`'s `snapshot`): the commit its work
 * starts from, its branch, and a gzipped binary patch of everything since,
 * answered with an installation token limited to the repository and to
 * contents read, which is what the Mac fetches the base commit with. A patch
 * past the bound is answered with its size alone. The answer is sent
 * `no-store`; nothing of the token reaches a log line.
 */

const HTTP_METHOD = { POST: "POST" } as const;

/** The answer carries a credential, so nothing between here and the Mac keeps it. */
const NO_STORE_HEADERS = { "cache-control": "private, no-store" } as const;

export const RUN_SNAPSHOT_PATH = "/api/agents/run-snapshot";

/** What the route may require of the function that stands it. */
export type RunSnapshotAppServices = DatabaseServices | GitHubApp | HttpClient.HttpClient;

export interface RunSnapshotAppSeams extends AccountResolving {
  /** The agent's sandbox as the route reaches it: Vercel's in production, a script's in a test. */
  readonly sandbox: Layer.Layer<AgentSandbox, never, HttpClient.HttpClient>;
}

/** A sandbox call that failed, as the upstream refusal, logged by its message alone. */
function sandboxOrUpstream<A, R>(
  effect: Effect.Effect<A, SandboxUnavailable, R>,
): Effect.Effect<A, HostedRefusal, R> {
  return Effect.catch(effect, (failure) =>
    Effect.andThen(
      Effect.logWarning(`a run snapshot's sandbox call failed: ${failure.message}`),
      Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR),
    ),
  );
}

/** The answer, sent as nothing between here and the Mac may keep. */
function answered(answer: RunSnapshotAnswer): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(answer, {
    status: HOSTED_HTTP_STATUS.OK,
    headers: NO_STORE_HEADERS,
  });
}

const runSnapshotEndpoint = /* @__PURE__ */ Effect.fn("web/runSnapshotEndpoint")(function* (
  seams: AccountResolving,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  RunSnapshotAppServices | AgentSandbox | HttpServerRequest.HttpServerRequest
> {
  const server = yield* HttpServerRequest.HttpServerRequest;
  if (server.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(server));
  const { agent } = yield* reachedAgent(seams, request);
  if (agent.archivedAt !== null) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_RETIRED);
  const [session] = yield* hostedStoreOrUnavailable(
    standingSessionsOf(agent.userId, [agent.conversationId]),
  );
  if (session === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  const app = yield* GitHubApp;
  const reading = yield* githubReachOrRefusal(
    app.repositoryReadToken(agent.organizationId, agent.repository),
  );
  if (Option.isNone(reading)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  const sandbox = yield* AgentSandbox;
  const taken = yield* sandboxOrUpstream(
    sandbox.snapshot(
      session.sessionId,
      CODER.CHECKOUT_PATH,
      reading.value.repository.defaultBranch,
      RUN_SNAPSHOT_BOUNDS.MAX_PATCH_BYTES,
    ),
  );
  if (Result.isFailure(taken)) {
    const refusal = taken.failure;
    if (refusal.kind === SNAPSHOT_REFUSAL.TOO_LARGE) return answered({ tooLarge: refusal.bytes });
    if (refusal.kind === SNAPSHOT_REFUSAL.NO_BASE) {
      return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);
    }
    // A sandbox asleep is woken, and one already starting left to start; either way the Mac asks again.
    if (refusal.sandbox !== SANDBOX_STATE.STARTING) {
      yield* sandboxOrUpstream(sandbox.resume(session.sessionId));
    }
    return answered({ waking: true });
  }
  return answered({
    repository: reading.value.repository.fullName,
    base: taken.success.base,
    branch: taken.success.branch,
    patch: taken.success.patch,
    token: Redacted.value(reading.value.token),
    expiresAt: reading.value.expiresAt,
  });
});

/** The group: the one path, over the agent's sandbox the seams hand, and the hosted vocabulary's own refusal for any other. */
export function runSnapshotApp(seams: RunSnapshotAppSeams): WebRoutes<RunSnapshotAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      RUN_SNAPSHOT_PATH,
      hostedRefusing(runSnapshotEndpoint(seams)).pipe(Effect.provide(seams.sandbox)),
    ),
    hostedNotFoundRoute,
  );
}
