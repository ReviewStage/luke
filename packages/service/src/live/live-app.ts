import type { LiveStatement } from "@luke/database/core/live-statement";
import type { DatabaseServices } from "@luke/database/core/query";
import { ownFailedRunsLiveStatement, readAutomation } from "@luke/database/models/automation-store";
import { readTask } from "@luke/database/models/task-store";
import { HOSTED_SERVICE_PATH } from "@luke/features";
import { Effect, Layer, Option } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/http";
import { reachedAgent, resolvedUserId, uuidOf } from "../agents/agent-reach.js";
import {
  automationRunsLiveStatements,
  automationsLiveStatements,
} from "../automations/automation-live.js";
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
import { taskListLiveStatements } from "../tasks/task-list-live.js";
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
 * the same rule of who may read them as the rows change. A deployment with
 * no Realtime answers `unavailable`, and the desktop holds its read open as
 * it did before.
 *
 * `GET /api/live/plan-inbox?id=` and `GET /api/live/agent-inbox?id=` answer
 * one plan's inbox, or one agent's, the same way: its open items and its
 * latest settled ones as one statement, after the plan or the agent is read as the account,
 * so one it does not reach is not found, as its held read answers.
 * `GET /api/live/plans` answers the plan list the same way: the plans the
 * account reaches and every agent of them and with no plan, as two sealed
 * statements built with the account's id (`task-list-live.ts`).
 * `GET /api/live/automations?workspaceId=` and
 * `GET /api/live/automation-runs?id=` answer a workspace's automations, and
 * one automation's runs once it is read as the account, on the same terms
 * (`automation-live.ts`).
 * Nothing else here reads a row: the store is read by Realtime.
 */

const HTTP_METHOD = { GET: "GET" } as const;

/** The query a scope's endpoint names its plan or agent under. */
const LIVE_QUERY = { ID: "id", WORKSPACE_ID: "workspaceId" } as const;

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

const taskListLiveEndpoint = /* @__PURE__ */ Effect.fn("web/taskListLiveEndpoint")(function* (
  seams: LiveAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  const request = yield* getRequest;
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const sealing = yield* LiveSealing;
  const statements = taskListLiveStatements(account.value);
  if (Option.isNone(sealing) || Option.isNone(statements)) {
    return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  }
  const { seal, url } = sealing.value;
  const queries = yield* Effect.all({
    plans: seal(statements.value.plans),
    agents: seal(statements.value.agents),
  }).pipe(Effect.mapError(() => HOSTED_REFUSAL.UNAVAILABLE));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url, queries });
});

/** One statement sealed, under its part's name, with the address to subscribe at; unavailable where it could not be. */
const sealedOne = <Part extends string>(
  sealing: Option.Option<LiveSealer>,
  part: Part,
  statement: Option.Option<LiveStatement>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal> =>
  Effect.gen(function* () {
    if (Option.isNone(sealing) || Option.isNone(statement)) {
      return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
    }
    const { seal, url } = sealing.value;
    const sealed = yield* Effect.mapError(seal(statement.value), () => HOSTED_REFUSAL.UNAVAILABLE);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { url, queries: { [part]: sealed } });
  });

const automationsLiveEndpoint = /* @__PURE__ */ Effect.fn("web/automationsLiveEndpoint")(function* (
  seams: LiveAppSeams,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest
> {
  const request = yield* getRequest;
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  const workspaceId = new URL(request.url).searchParams.get(LIVE_QUERY.WORKSPACE_ID) ?? "";
  if (workspaceId === "") return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const statements = automationsLiveStatements(account.value, workspaceId);
  return yield* sealedOne(
    yield* LiveSealing,
    "automations",
    Option.map(statements, ({ automations }) => automations),
  );
});

const automationRunsLiveEndpoint = /* @__PURE__ */ Effect.fn("web/automationRunsLiveEndpoint")(
  function* (
    seams: LiveAppSeams,
  ): Effect.fn.Return<
    HttpServerResponse.HttpServerResponse,
    HostedRefusal,
    HttpServerRequest.HttpServerRequest | DatabaseServices
  > {
    const request = yield* getRequest;
    const automationId = yield* uuidOf(request, LIVE_QUERY.ID);
    const userId = yield* resolvedUserId(seams, request);
    const automation = yield* hostedStoreOrUnavailable(readAutomation(userId, automationId));
    if (Option.isNone(automation)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const statements = automationRunsLiveStatements(userId, automationId);
    return yield* sealedOne(
      yield* LiveSealing,
      "runs",
      Option.map(statements, ({ runs }) => runs),
    );
  },
);

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
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.LIVE_TASKS,
      hostedRefusing(taskListLiveEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.LIVE_AUTOMATIONS,
      hostedRefusing(automationsLiveEndpoint(seams)),
    ),
    HttpRouter.add(
      ANY_METHOD,
      HOSTED_SERVICE_PATH.LIVE_AUTOMATION_RUNS,
      hostedRefusing(automationRunsLiveEndpoint(seams)),
    ),
    hostedNotFoundRoute,
  );
}
