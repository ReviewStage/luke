import { BOARD_BOUNDS, boardSaveRequestSchema } from "@sidecar/hosted/board-wire";
import { readEither } from "@sidecar/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import {
  type HttpClient,
  HttpRouter,
  HttpServerRequest,
  type HttpServerResponse,
} from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import {
  planCreateRequestSchema,
  planUpdateRequestSchema,
  unparsedWire,
  wireUuidSchema,
} from "./core.js";
import { GitHubApp } from "./github/github-app.js";
import { githubUserReadOrRefusal } from "./github/github-refusal.js";
import { readBoard, writeScene } from "./hosted/board-store.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { createPlan, deletePlan, listPlans, readPlan, updatePlan } from "./hosted/plan-store.js";
import { readTranscript } from "./hosted/transcript-store.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * plans-app.ts -- the Mac Plans tab's named plans: list, start, open, change, and delete.
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
 * A plan may name the GitHub repository it is about, at its start or by a
 * later change, and null is a plan with none. A repository is kept only once
 * the Luke GitHub App confirms the account reaches it (`github/github-app.ts`),
 * read from GitHub on the account's own token before the row is written, so a
 * plan never names a repository its owner could not reach through the App at
 * the moment it was named: an account that must sign in with GitHub again, and
 * a repository the App reaches no installation of for the account, are each
 * refused by name, with nothing written.
 *
 * Starting a plan otherwise names nothing of the developer's Mac: the
 * planning model reads the repository in its own sandbox on the service
 * (`hosted/repository-shell.ts`), and no route here carries a command.
 */

const PLANS_PATH = {
  /** GET lists, POST starts. */
  COLLECTION: "/api/plans",
  /** GET opens, PATCH changes the name or the repository, DELETE deletes; the rewrite moves the path's id into the `id` query. */
  ONE: "/api/plans/plan",
  /** GET reads the plan's board, PUT writes it; the rewrite moves the path's id into the `id` query. */
  BOARD: "/api/plans/board",
  /** GET reads what was said on the plan's calls; the rewrite moves the path's id into the `id` query. */
  TRANSCRIPT: "/api/plans/transcript",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

const PLAN_ID_QUERY = "id";

/** A start or a change is a name and a repository's name at most, so a body past this is neither. */
const MAXIMUM_NAME_BODY_BYTES = 8_192;

/** A save is a scene at its byte bound and its image at its own, with room for the drawing's number around them. */
const MAXIMUM_BOARD_BODY_BYTES = BOARD_BOUNDS.MAX_BYTES + BOARD_BOUNDS.MAX_IMAGE_CHARS + 1_024;

export interface PlansAppSeams {
  resolveUserId: UserIdResolver;
}

/** What the routes may require of the function that stands them: the store, and GitHub through the App for a repository's check. */
export type PlansAppServices = SqlClient.SqlClient | GitHubApp | HttpClient.HttpClient;

type PlansServices = PlansAppServices | HttpServerRequest.HttpServerRequest;

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

/**
 * The repository as the row keeps it: null where none was named, or the
 * full name as GitHub spells it once the App confirms the account reaches
 * it. The refusal names which it was: the account's token, or the
 * repository.
 */
const reachableRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  repository: string | null | undefined,
): Effect.fn.Return<
  string | null,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | SqlClient.SqlClient
> {
  if (repository === undefined || repository === null) return null;
  const app = yield* GitHubApp;
  const reached = yield* githubUserReadOrRefusal(app.userRepository(userId, repository));
  if (Option.isNone(reached)) return yield* Effect.fail(HOSTED_REFUSAL.REPOSITORY_NOT_REACHABLE);
  return reached.value.fullName;
});

/** GET lists the account's plans; POST starts one with an empty document, and its repository confirmed first. */
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
  const repository = yield* reachableRepository(userId, started.success.repository);
  const plan = yield* hostedStoreOrUnavailable(
    createPlan(userId, { name: started.success.name, repository }),
  );
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { plan });
});

/**
 * PATCH: the plan's name, its repository, or both changed, answered with its
 * document. A repository is confirmed before the row is touched, so a
 * refused one leaves the name unchanged too.
 */
const updateEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  planId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const body = yield* readJsonBodyEffect(MAXIMUM_NAME_BODY_BYTES);
  const update = readEither(planUpdateRequestSchema)(body);
  if (Result.isFailure(update)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const changes = update.success;
  const repository =
    "repository" in changes ? yield* reachableRepository(userId, changes.repository) : undefined;
  const plan = yield* hostedStoreOrUnavailable(
    updatePlan(userId, planId, {
      ...("name" in changes ? { name: changes.name } : undefined),
      ...(repository === undefined ? undefined : { repository }),
    }),
  );
  if (Option.isNone(plan)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: plan.value });
});

const ONE_PLAN_METHODS: ReadonlySet<string> = new Set([
  HTTP_METHOD.GET,
  HTTP_METHOD.PATCH,
  HTTP_METHOD.DELETE,
]);

/** GET opens one plan with its saved document; PATCH changes it; DELETE deletes it. */
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
  if (incoming.method === HTTP_METHOD.PATCH) return yield* updateEndpoint(userId, planId);
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
    writeScene(
      userId,
      planId,
      save.success.elements,
      save.success.appliedDrawing,
      save.success.image,
    ),
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

/** The group: the plan paths, and the hosted vocabulary's own refusal for any other. */
export function plansApp(seams: PlansAppSeams): WebRoutes<PlansAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COLLECTION, hostedRefusing(collectionEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.ONE, hostedRefusing(oneEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.BOARD, hostedRefusing(boardEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.TRANSCRIPT, hostedRefusing(transcriptEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
