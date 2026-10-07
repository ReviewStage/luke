import { BOARD_AUTHOR, BOARD_BOUNDS, boardSaveRequestSchema } from "@sidecar/hosted/board-wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import {
  PLAN_COMMAND_OUTPUT_MAX_CHARS,
  planCommandResultSchema,
  planCreateRequestSchema,
  unparsedWire,
  wireUuidSchema,
} from "./core.js";
import { BOARD_WRITE, readBoard, writeBoard } from "./hosted/board-store.js";
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
import { claimPlanCommand, settlePlanCommand } from "./hosted/repository-shell.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * plans-app.ts -- the Mac Plans tab's named plans: list, start, open, and delete, and the Mac's side of the planning model's folder reads.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one the bearer's account owns: a plan id another account
 * owns answers exactly as one that names nothing, so nothing is learned
 * about plans the caller does not hold. Nothing here writes a document; the
 * planning model's `update_plan` is the one writer (`update-plan-tool.ts`).
 * `GET /api/plans/{id}` is the window opening a plan, so it also moves the
 * plan to the head of the list.
 *
 * `/api/plans/{id}/board` is the plan's whiteboard: the Mac reads it, and
 * writes the developer's scene over the revision it was drawn on
 * (`hosted/board-store.ts`); a write over a board that moved answers 200 with
 * the board as it stands and `conflict`, so the Mac merges and writes again.
 *
 * Starting a plan names a folder on the developer's Mac and nothing more.
 * The two command paths are the Mac's side of `run_in_repository`
 * (`hosted/repository-shell.ts`): a held claim of the next command the
 * planning model asked for, and the result the Mac posts once it ran it.
 */

const PLANS_PATH = {
  /** GET lists, POST starts. */
  COLLECTION: "/api/plans",
  /** GET opens, DELETE deletes; the rewrite moves the path's id into the `id` query. */
  ONE: "/api/plans/plan",
  /** GET reads the plan's board, PUT writes it; the rewrite moves the path's id into the `id` query. */
  BOARD: "/api/plans/board",
  /** POST claims the plan's next command, held open until one arrives. */
  COMMAND_CLAIM: "/api/plans/commands/claim",
  /** POST settles one claimed command; the rewrite moves its id into the `command` query. */
  COMMAND: "/api/plans/commands/command",
} as const;

const COMMAND_ID_QUERY = "command";

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  DELETE: "DELETE",
} as const;

const PLAN_ID_QUERY = "id";

/** A start request is a name and a folder path, so a body past this is not one. */
const MAXIMUM_CREATE_BODY_BYTES = 8_192;

/** A save is a board's elements at their bound, with room for the revision around them. */
const MAXIMUM_BOARD_BODY_BYTES = BOARD_BOUNDS.MAX_BYTES + 1_024;

/** A result is two outputs of at most `PLAN_COMMAND_OUTPUT_MAX_CHARS` each, every character escaped at worst. */
const MAXIMUM_RESULT_BODY_BYTES = 2 * PLAN_COMMAND_OUTPUT_MAX_CHARS * 6 + 1_024;

export interface PlansAppSeams {
  resolveUserId: UserIdResolver;
}

type PlansServices = SqlClient.SqlClient | HttpServerRequest.HttpServerRequest;

/** What the routes may require of the function that stands them. */
export type PlansAppServices = SqlClient.SqlClient;

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
 * The one id the path named under `query`. Two would leave the path and the effect
 * disagreeing, so two is refused; an id that is not a UUID names no row, and
 * answers as none.
 */
const idOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  query: string,
): Effect.fn.Return<string, HostedRefusal> {
  const ids = new URL(request.url).searchParams.getAll(query);
  const [id] = ids;
  if (id === undefined || ids.length !== 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(wireUuidSchema)(unparsedWire(id));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return read.success;
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
  const plan = yield* hostedStoreOrUnavailable(createPlan(userId, started.success));
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
  const planId = yield* idOf(request, PLAN_ID_QUERY);
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

/** GET reads the plan's board; PUT writes the developer's scene over the revision it names. */
const boardEndpoint = /* @__PURE__ */ Effect.fn("web/planBoardEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.PUT) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.GET) {
    const board = yield* hostedStoreOrUnavailable(readBoard(userId, planId));
    if (Option.isNone(board)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { board: board.value });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_BOARD_BODY_BYTES);
  const save = readEither(boardSaveRequestSchema)(body);
  if (Result.isFailure(save)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const written = yield* hostedStoreOrUnavailable(
    writeBoard(
      userId,
      planId,
      save.success.baseRevision,
      save.success.elements,
      BOARD_AUTHOR.DEVELOPER,
    ),
  );
  if (written.outcome === BOARD_WRITE.NO_PLAN) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, written);
});

/** POST: the plan's next command, claimed for the caller's Mac, or null once the hold ran out. */
const commandClaimEndpoint = /* @__PURE__ */ Effect.fn("web/planCommandClaimEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const command = yield* hostedStoreOrUnavailable(claimPlanCommand(userId, planId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { command });
});

/** POST: what the caller's Mac answered for one command it claimed. */
const commandSettleEndpoint = /* @__PURE__ */ Effect.fn("web/planCommandSettleEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const commandId = yield* idOf(request, COMMAND_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_RESULT_BODY_BYTES);
  const result = readEither(planCommandResultSchema)(body);
  if (Result.isFailure(result)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const settled = yield* hostedStoreOrUnavailable(
    settlePlanCommand(userId, planId, commandId, result.success),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { settled });
});

/** An endpoint's refusal carried back onto the answer channel, the way the account group does. */
function refusing<R>(
  endpoint: Effect.Effect<HttpServerResponse.HttpServerResponse, HostedRefusal, R>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> {
  return Effect.catch(endpoint, (refusal) => Effect.succeed(hostedRefusalResponse(refusal)));
}

/** The group: the plan paths, and the hosted vocabulary's own refusal for any other. */
export function plansApp(seams: PlansAppSeams): WebRoutes<PlansAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COLLECTION, refusing(collectionEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.ONE, refusing(oneEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.BOARD, refusing(boardEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COMMAND_CLAIM, refusing(commandClaimEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COMMAND, refusing(commandSettleEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
