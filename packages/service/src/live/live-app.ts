import type { DatabaseServices } from "@luke/database/core/query";
import { ownFailedRunsLiveStatement } from "@luke/database/models/automation-store";
import { readTask } from "@luke/database/models/task-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { reachedAgent, resolvedUserId, uuidOf } from "../agents/agent-reach.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import {
  accountInboxLiveStatements,
  memberAgentInboxLiveStatements,
  type ScopeInboxLiveStatements,
  taskInboxLiveStatements,
} from "../inbox/inbox-store.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { type LiveSealer, LiveSealing } from "./realtime.js";

/**
 * live-app.ts -- the reads the desktop follows over Neon Realtime, sealed for the account the bearer names.
 *
 * `GET /api/live/inbox` answers what waits on the developer across the
 * account as sealed statements, one per part of the account inbox's answer,
 * and the address to subscribe at (`live-wire.ts`). It is Neon's "Exposing
 * an endpoint" step: the bearer is resolved first, each statement is built
 * with that account's id in it, as its held read's is, and sealed, so a
 * subscription reads that account's rows and no other's, and stays bound to
 * the same rule of who may read them as the rows change. A deployment whose
 * Realtime is misconfigured answers `unavailable`, and the desktop asks
 * again a moment later.
 *
 * `GET /api/live/task-inbox?id=` and `GET /api/live/agent-inbox?id=` answer
 * one plan's inbox, or one agent's, the same way: its open items and its
 * latest settled ones as one statement, after the plan or the agent is read as the account,
 * so one it does not reach is not found, as its held read answers.
 * Nothing else here reads a row: the store is read by Realtime.
 */

const HTTP_METHOD = { GET: "GET" } as const;

/** The query a scope's endpoint names its plan or agent under. */
const LIVE_QUERY = { ID: "id" } as const;

export interface LiveAppSeams {
  resolveUserId: UserIdResolver;
}

const accountInboxLiveEndpoint = /* @__PURE__ */ Effect.fn("web/accountInboxLiveEndpoint")(
  function* (
    seams: LiveAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest
  > {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const account = yield* seams.resolveUserId(request);
    if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
    const sealing = yield* LiveSealing;
    const statements = Option.zipWith(
      accountInboxLiveStatements(account.value),
      ownFailedRunsLiveStatement(account.value),
      (parts, failedRuns) => ({ ...parts, failedRuns }),
    );
    if (Option.isNone(sealing) || Option.isNone(statements)) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const { seal, url } = sealing.value;
    const queries = yield* Effect.all({
      items: seal(statements.value.items),
      planless: seal(statements.value.planless),
      plans: seal(statements.value.plans),
      automations: seal(statements.value.automations),
      failedRuns: seal(statements.value.failedRuns),
      chatAsks: seal(statements.value.chatAsks),
      chatNotices: seal(statements.value.chatNotices),
    }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url, queries });
  },
);

/** A scope's statements sealed, with the address to subscribe at; unavailable where they could not be. */
const sealedScope = (
  sealing: Option.Option<LiveSealer>,
  statements: Option.Option<ScopeInboxLiveStatements>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal> =>
  Effect.gen(function* () {
    if (Option.isNone(sealing) || Option.isNone(statements)) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const { seal, url } = sealing.value;
    const queries = yield* Effect.all({ items: seal(statements.value.items) }).pipe(
      Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url, queries });
  });

/** The GET a scope's endpoint takes, as the web request it is. */
const getRequest = Effect.gen(function* () {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  return yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
});

const taskInboxLiveEndpoint = /* @__PURE__ */ Effect.fn("web/taskInboxLiveEndpoint")(function* (
  seams: LiveAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const request = yield* getRequest;
  const taskId = yield* uuidOf(request, LIVE_QUERY.ID);
  const userId = yield* resolvedUserId(seams, request);
  const task = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return yield* sealedScope(yield* LiveSealing, taskInboxLiveStatements(userId, taskId));
});

const agentInboxLiveEndpoint = /* @__PURE__ */ Effect.fn("web/agentInboxLiveEndpoint")(function* (
  seams: LiveAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
> {
  const request = yield* getRequest;
  const { userId, agent } = yield* reachedAgent(seams, request);
  return yield* sealedScope(yield* LiveSealing, memberAgentInboxLiveStatements(userId, agent.id));
});

/** The group: each live read's path, and the hosted vocabulary's own refusal for any other. */
export function liveApp(seams: LiveAppSeams): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.LIVE_INBOX,
      hostedRefusing(accountInboxLiveEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.LIVE_TASK_INBOX,
      hostedRefusing(taskInboxLiveEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.LIVE_AGENT_INBOX,
      hostedRefusing(agentInboxLiveEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
