import {
  BOARD_BOUNDS,
  BOARD_LOOK_BOUNDS,
  boardLookResultSchema,
  boardSaveRequestSchema,
} from "@sidecar/hosted/board-wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { HttpRouter, HttpServerRequest, type HttpServerResponse } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import {
  PLAN_COMMAND_OUTPUT_MAX_CHARS,
  planCommandResultSchema,
  planCreateRequestSchema,
  planRenameRequestSchema,
  unparsedWire,
  wireUuidSchema,
} from "./core.js";
import { claimBoardLook, settleBoardLook } from "./hosted/board-look.js";
import { readBoard, writeScene } from "./hosted/board-store.js";
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
import { createPlan, deletePlan, listPlans, readPlan, renamePlan } from "./hosted/plan-store.js";
import { claimPlanCommand, settlePlanCommand } from "./hosted/repository-shell.js";
import { readTranscript } from "./hosted/transcript-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * plans-app.ts -- the Mac Plans tab's named plans: list, start, open, rename, and delete, and the Mac's side of the planning model's folder reads.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one the bearer's account owns: a plan id another account
 * owns answers exactly as one that names nothing, so nothing is learned
 * about plans the caller does not hold. Nothing here writes a document; the
 * planning call's notetaker is the one writer (`hosted/plan-notes.ts`).
 * `GET /api/plans/{id}` is the window opening a plan, a read that moves
 * nothing: the list stands newest started first whatever is opened.
 *
 * `/api/plans/{id}/board` is the plan's whiteboard: the Mac reads it, with
 * Luke's latest drawing, and writes the scene back whole, the last write
 * winning (`hosted/board-store.ts`). `/api/plans/{id}/transcript` is what was
 * said on the plan's calls, read and never written here
 * (`hosted/transcript-store.ts`).
 *
 * Starting a plan names a folder on the developer's Mac and nothing more.
 * The two command paths are the Mac's side of `run_in_repository`
 * (`hosted/repository-shell.ts`): a held claim of the next command the
 * planning model asked for, and the result the Mac posts once it ran it.
 * The two look paths are the same for `look_at_board`
 * (`hosted/board-look.ts`): a held claim of the next look at the board, and
 * the image the Mac posts once it drew it.
 */

const PLANS_PATH = {
  /** GET lists, POST starts. */
  COLLECTION: "/api/plans",
  /** GET opens, PATCH renames, DELETE deletes; the rewrite moves the path's id into the `id` query. */
  ONE: "/api/plans/plan",
  /** GET reads the plan's board, PUT writes it; the rewrite moves the path's id into the `id` query. */
  BOARD: "/api/plans/board",
  /** GET reads what was said on the plan's calls; the rewrite moves the path's id into the `id` query. */
  TRANSCRIPT: "/api/plans/transcript",
  /** POST claims the plan's next command, held open until one arrives. */
  COMMAND_CLAIM: "/api/plans/commands/claim",
  /** POST settles one claimed command; the rewrite moves its id into the `command` query. */
  COMMAND: "/api/plans/commands/command",
  /** POST claims the plan's next look at its board, held open until one arrives. */
  LOOK_CLAIM: "/api/plans/looks/claim",
  /** POST settles one claimed look; the rewrite moves its id into the `look` query. */
  LOOK: "/api/plans/looks/look",
} as const;

const COMMAND_ID_QUERY = "command";
const LOOK_ID_QUERY = "look";

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

const PLAN_ID_QUERY = "id";

/** A start or a rename is a name, so a body past this is not one. */
const MAXIMUM_NAME_BODY_BYTES = 8_192;

/** A save is a scene at its byte bound, with room for the drawing's number around it. */
const MAXIMUM_BOARD_BODY_BYTES = BOARD_BOUNDS.MAX_BYTES + 1_024;

/** A result is two outputs of at most `PLAN_COMMAND_OUTPUT_MAX_CHARS` each, every character escaped at worst. */
const MAXIMUM_RESULT_BODY_BYTES = 2 * PLAN_COMMAND_OUTPUT_MAX_CHARS * 6 + 1_024;

/** A look's image is base64, one byte a character, beside a little JSON. */
const MAXIMUM_LOOK_BODY_BYTES = BOARD_LOOK_BOUNDS.MAX_IMAGE_CHARS + 1_024;

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
  const body = yield* readJsonBodyEffect(MAXIMUM_NAME_BODY_BYTES);
  const started = readEither(planCreateRequestSchema)(body);
  if (Result.isFailure(started)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const plan = yield* hostedStoreOrUnavailable(createPlan(userId, started.success));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { plan });
});

/** PATCH: the plan renamed under the start's name rules, answered with its document. */
const renameEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  planId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const body = yield* readJsonBodyEffect(MAXIMUM_NAME_BODY_BYTES);
  const renamed = readEither(planRenameRequestSchema)(body);
  if (Result.isFailure(renamed)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const plan = yield* hostedStoreOrUnavailable(renamePlan(userId, planId, renamed.success.name));
  if (Option.isNone(plan)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: plan.value });
});

const ONE_PLAN_METHODS: ReadonlySet<string> = new Set([
  HTTP_METHOD.GET,
  HTTP_METHOD.PATCH,
  HTTP_METHOD.DELETE,
]);

/** GET opens one plan with its saved document; PATCH renames it; DELETE deletes it. */
const oneEndpoint = /* @__PURE__ */ Effect.fn("web/planEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (!ONE_PLAN_METHODS.has(incoming.method)) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.GET) {
    const opened = yield* hostedStoreOrUnavailable(readPlan(userId, planId));
    if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: opened.value.plan });
  }
  if (incoming.method === HTTP_METHOD.PATCH) return yield* renameEndpoint(userId, planId);
  const deleted = yield* hostedStoreOrUnavailable(deletePlan(userId, planId));
  if (!deleted) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
});

/** GET reads the plan's board; PUT writes the Mac's scene whole. */
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
    writeScene(userId, planId, save.success.elements, save.success.appliedDrawing),
  );
  if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { board: written.value });
});

/** GET reads what was said on the plan's calls. */
const transcriptEndpoint = /* @__PURE__ */ Effect.fn("web/planTranscriptEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const transcript = yield* hostedStoreOrUnavailable(readTranscript(userId, planId));
  if (Option.isNone(transcript)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { transcript: transcript.value });
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

/** POST: the plan's next look at its board, claimed for the caller's Mac, or null once the hold ran out. */
const lookClaimEndpoint = /* @__PURE__ */ Effect.fn("web/planLookClaimEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const look = yield* hostedStoreOrUnavailable(claimBoardLook(userId, planId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { look });
});

/** POST: the board the caller's Mac drew for one look it claimed. */
const lookSettleEndpoint = /* @__PURE__ */ Effect.fn("web/planLookSettleEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const lookId = yield* idOf(request, LOOK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_LOOK_BODY_BYTES);
  const result = readEither(boardLookResultSchema)(body);
  if (Result.isFailure(result)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const settled = yield* hostedStoreOrUnavailable(
    settleBoardLook(userId, planId, lookId, result.success),
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
    HttpRouter.add(ANY_METHOD, PLANS_PATH.TRANSCRIPT, refusing(transcriptEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COMMAND_CLAIM, refusing(commandClaimEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COMMAND, refusing(commandSettleEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.LOOK_CLAIM, refusing(lookClaimEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.LOOK, refusing(lookSettleEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
