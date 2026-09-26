import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import { planCreateRequestSchema, unparsedWire, wireUuidSchema } from "./core.js";
import { githubFailureResponse } from "./github-app.js";
import { GitHubAccess, resolveRepository } from "./hosted/github-source.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusalResponse,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { createPlan, deletePlan, listPlans, openPlan } from "./hosted/plan-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * plans-app.ts -- the planning window's named plans: list, start, open, and delete.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one the bearer's account owns: a plan id another account
 * owns answers exactly as one that names nothing, so nothing is learned
 * about plans the caller does not hold. Nothing here writes a document; the
 * planning model's `update_plan` is the one writer (`update-plan-tool.ts`).
 * `GET /api/plans/{id}` is the window opening a plan, so it also moves the
 * plan to the head of the list.
 *
 * Starting a plan names a repository and nothing more: the service resolves
 * its default branch to one commit through the account's own GitHub
 * connection, so the commit a plan reads for its whole life is one GitHub
 * answered to this account, never one a client asserted. A repository the
 * connection cannot read starts no plan, and answers why
 * (`GITHUB_UNAVAILABLE_ERROR` with a `GITHUB_FAILURE` reason) so the window
 * can say what to do.
 */

const PLANS_PATH = {
  /** GET lists, POST starts. */
  COLLECTION: "/api/plans",
  /** GET opens, DELETE deletes; the rewrite moves the path's id into the `id` query. */
  ONE: "/api/plans/plan",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  DELETE: "DELETE",
} as const;

const PLAN_ID_QUERY = "id";

/** A start request is a name and a repository, so a body past this is not one. */
const MAXIMUM_CREATE_BODY_BYTES = 8_192;

export interface PlansAppSeams {
  resolveUserId: UserIdResolver;
}

type PlansServices =
  | SqlClient.SqlClient
  | HttpClient.HttpClient
  | GitHubAccess
  | HttpServerRequest.HttpServerRequest;

/** What the routes may require of the function that stands them. */
export type PlansAppServices = SqlClient.SqlClient | HttpClient.HttpClient | GitHubAccess;

/** The bearer's account, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlansAppSeams,
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const account = yield* seams.resolveUserId(request);
  if (Option.isNone(account)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_TOKEN);
  return account.value;
});

/**
 * The one plan id the path named. Two would leave the path and the effect
 * disagreeing, so two is refused; an id that is not a UUID names no row, and
 * answers as none.
 */
const planIdOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(PLAN_ID_QUERY);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const planId = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(planId)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return planId.success;
});

/** GET lists the account's plans; POST starts one with an empty document. */
const collectionEndpoint = /* @__PURE__ */ Effect.fn("web/plansCollectionEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.GET) {
    const plans = yield* hostedStoreOrUnavailable(listPlans(userId));
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plans });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_CREATE_BODY_BYTES);
  const started = readEither(planCreateRequestSchema)(body);
  if (Result.isFailure(started)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const github = yield* GitHubAccess;
  const resolved = yield* github.token(userId).pipe(
    Effect.flatMap((token) =>
      resolveRepository(token, started.success.repository.owner, started.success.repository.name),
    ),
    Effect.result,
  );
  if (Result.isFailure(resolved)) return githubFailureResponse(resolved.failure);
  const plan = yield* hostedStoreOrUnavailable(
    createPlan(userId, { name: started.success.name, repository: resolved.success }),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { plan });
});

/** GET opens one plan with its saved document; DELETE deletes it. */
const oneEndpoint = /* @__PURE__ */ Effect.fn("web/planEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.DELETE) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* planIdOf(request);
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.GET) {
    const opened = yield* hostedStoreOrUnavailable(openPlan(userId, planId));
    if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: opened.value });
  }
  const deleted = yield* hostedStoreOrUnavailable(deletePlan(userId, planId));
  if (!deleted) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
});

/** An endpoint's refusal carried back onto the answer channel, the way the account group does. */
function refusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/** The group: the two plan paths, and the hosted vocabulary's own refusal for any other. */
export function plansApp(seams: PlansAppSeams): WebRoutes<PlansAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COLLECTION, refusing(collectionEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.ONE, refusing(oneEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
