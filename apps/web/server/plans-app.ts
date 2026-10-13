import { readBoard, writeScene } from "@sidecar/database/models/board-store";
import { listCodingAgents } from "@sidecar/database/models/coding-agent-store";
import { listRevisions, readRevision } from "@sidecar/database/models/plan-revisions";
import {
  createPlan,
  deletePlan,
  listPlans,
  readPlan,
  updatePlan,
} from "@sidecar/database/models/plan-store";
import { standingSessionsOf } from "@sidecar/database/models/recorded-session";
import { readTranscript } from "@sidecar/database/models/transcript-store";
import { type StoreWriter, storeWriter } from "@sidecar/database/models/writer";
import { BOARD_BOUNDS, boardSaveRequestSchema } from "@sidecar/hosted/board-wire";
import { PLAN_EDIT_REFUSAL, planEditRequestSchema } from "@sidecar/hosted/plan-edit";
import {
  PLAN_BOUNDS,
  type PlanFileRequest,
  type PlanTreeRequest,
  planFileRequestSchema,
  planRevisionSeqSchema,
  planTreeRequestSchema,
} from "@sidecar/hosted/plan-wire";
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
  PLAN_LIST_ARCHIVED,
  PLAN_LIST_QUERY,
  planCreateRequestSchema,
  planUpdateRequestSchema,
  unparsedWire,
  wireUuidSchema,
} from "./core.js";
import { GitHubApp } from "./github/github-app.js";
import { githubUserReadOrRefusal } from "./github/github-refusal.js";
import { type EveReach, eveFor, stoppedForGood } from "./hosted/coder-host/stop.js";
import { CODER_TOOL_SET } from "./hosted/coder-host/tool-set.js";
import { HOSTED_HTTP_STATUS } from "./hosted/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrArchived,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "./hosted/http-effect.js";
import { withPlanAgents } from "./hosted/plan-agents.js";
import { readPlanFile } from "./hosted/plan-file.js";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  restoreRevision,
  saveDeveloperEdit,
} from "./hosted/plan-notes.js";
import { readPlanTree } from "./hosted/plan-tree.js";
import { readPlanWork } from "./hosted/plan-work-store.js";
import { retireSessions } from "./hosted/retire-sessions.js";
import { ANY_METHOD, type WebRoutes } from "./route.js";

/**
 * plans-app.ts -- the Mac Plans tab's named plans: list, start, open, change, and delete.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one the bearer's account owns: a plan id another account
 * owns answers exactly as one that names nothing, so nothing is learned
 * about plans the caller does not hold. The developer writes a document in
 * two ways here, each through the plan's one write (`hosted/plan-notes.ts`)
 * that the notetaker and the coding agents save their notes through: `POST
 * /api/plans/{id}/edit` is their edit of one field, saved, or answered as a
 * conflict with what the field holds now where Luke wrote it meanwhile and
 * the edit no longer lands, with nothing saved; and a restore puts back an
 * earlier revision.
 * `GET /api/plans/{id}` is the window opening a plan, a read that moves
 * nothing: the list stands newest started first whatever is opened. Its
 * `DELETE` stops every coding agent of the plan first, through the one Stop
 * (`hosted/coder-host/stop.ts`), and only then deletes the plan. Each
 * row of the list carries what the plan's coding agents are doing and what
 * they published, in brief, where it has any (`hosted/plan-agents.ts`). A pin
 * and an archive are changes like a rename, and the list leaves the archived
 * plans out unless `archived=include` asks for them, so a build from before
 * archiving, which never asks, draws none of them rather than all of them.
 *
 * `/api/plans/{id}/board` is the plan's whiteboard: the Mac reads it, with
 * Luke's latest drawing, and writes the scene back whole, the last write
 * winning (`hosted/board-store.ts`). `/api/plans/{id}/transcript` is what was
 * said on the plan's calls, read and never written here
 * (`hosted/transcript-store.ts`). `/api/plans/{id}/work` is what Luke's
 * planning model wrote and ran on them, a page at a time, and every code he
 * showed, read back from the plan's conversation
 * (`hosted/plan-work-store.ts`). `/api/plans/{id}/file` is a window of one
 * file of the plan's repository for the File tab, read from GitHub as it
 * stands now, or at the commit an inbox item's code reference pins, through
 * the App, under the rule `show_code` is held to (`hosted/plan-file.ts`), and `/api/plans/{id}/tree` one folder of it for
 * the tree beside that tab, listed where and as the file is read
 * (`hosted/plan-tree.ts`). `/api/plans/{id}/revisions` is the plan's history
 * for the History tab, a page at a time; `/api/plans/{id}/revisions/{seq}`
 * one revision's content beside the one before it, both formatted under the
 * plan's name as it stands; and `/api/plans/{id}/revisions/{seq}/restore`
 * puts that content back as a revision of the developer's, answered with the
 * plan (`hosted/plan-revisions.ts`).
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
  /** GET lists, the archived plans too where `archived=include` asks; POST starts. */
  COLLECTION: "/api/plans",
  /** GET opens, PATCH changes the name, the repository, the pin, or the archive, DELETE deletes; the rewrite moves the path's id into the `id` query. */
  ONE: "/api/plans/plan",
  /** GET reads the plan's board, PUT writes it; the rewrite moves the path's id into the `id` query. */
  BOARD: "/api/plans/board",
  /** GET reads what was said on the plan's calls; the rewrite moves the path's id into the `id` query. */
  TRANSCRIPT: "/api/plans/transcript",
  /** GET reads a page of the plan's work, before the turn `before` names where it names one, and on the newest page every code shown on it; the rewrite moves the path's id into the `id` query. */
  WORK: "/api/plans/work",
  /** GET reads a window of one file of the plan's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  FILE: "/api/plans/file",
  /** GET lists one folder of the plan's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  TREE: "/api/plans/tree",
  /** GET reads a page of the plan's history, before the revision `before` names where it names one; the rewrite moves the path's id into the `id` query. */
  REVISIONS: "/api/plans/revisions",
  /** GET reads one revision's content and the one before it; the rewrite moves the path's id and number into the `id` and `seq` queries. */
  REVISION: "/api/plans/revision",
  /** POST restores one revision as the plan's content; the rewrite moves the path's id and number into the `id` and `seq` queries. */
  RESTORE: "/api/plans/restore",
  /** POST saves the developer's edit of one field; the rewrite moves the path's id into the `id` query. */
  EDIT: "/api/plans/edit",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

const PLAN_ID_QUERY = "id";

/** The query naming the turn an older page of a plan's work is read before, and the revision an older page of its history is. */
const BEFORE_TURN_QUERY = "before";

/** The query naming one revision of the plan by its number. */
const REVISION_SEQ_QUERY = "seq";

/** The queries naming a window of a file: its path, and its first and last line. */
const FILE_QUERY = {
  PATH: "path",
  FIRST_LINE: "first",
  LAST_LINE: "last",
  /** `1` asks the file's whole text, its lines uncut, in place of the window. */
  RAW: "raw",
  /** The commit the file is read at, its whole SHA; the default branch's head where it is absent. */
  REF: "ref",
} as const;

/** The query naming a folder of the repository from its root, the root itself where it is absent or empty. */
const TREE_PATH_QUERY = "path";

/** The query asking everything under the folder rather than its own entries, `1` where it asks. */
const TREE_RECURSIVE_QUERY = "recursive";

/** A start or a change is a name and a repository's name at most, so a body past this is neither. */
const MAXIMUM_NAME_BODY_BYTES = 8_192;

/** An edit is the plan's text twice, its base and its value, each at its bound with every character escaped. */
const MAXIMUM_EDIT_BODY_BYTES = PLAN_BOUNDS.MAX_BODY_CHARS * 2 * 6 + 1_024;

/** A save is a scene at its byte bound and its image at its own, with room for the drawing's number around them. */
const MAXIMUM_BOARD_BODY_BYTES = BOARD_BOUNDS.MAX_BYTES + BOARD_BOUNDS.MAX_IMAGE_CHARS + 1_024;

export interface PlansAppSeams extends EveReach {
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

/** Whether a list read asks for the archived plans too; a build from before archiving never does. */
function listsArchived(request: Request): boolean {
  const asked = new URL(request.url).searchParams.get(PLAN_LIST_QUERY.ARCHIVED);
  return asked === PLAN_LIST_ARCHIVED.INCLUDE;
}

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
    const plans = yield* hostedStoreOrUnavailable(
      Effect.flatMap(listPlans(userId, { includeArchived: listsArchived(request) }), (listed) =>
        withPlanAgents(userId, listed),
      ),
    );
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
 * PATCH: the plan's name, its repository, its pin, its archive, or any of
 * them changed, answered with its document. A repository is confirmed before
 * the row is touched, so a refused one leaves the rest unchanged too.
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
  const plan = yield* hostedStoreOrArchived(
    updatePlan(userId, planId, {
      ...("name" in changes ? { name: changes.name } : undefined),
      ...(repository === undefined ? undefined : { repository }),
      ...("pinned" in changes ? { pinned: changes.pinned } : undefined),
      ...("archived" in changes ? { archived: changes.archived } : undefined),
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

/**
 * DELETE: every coding agent of the plan stopped for good first, as a Stop
 * and an archive stop one, so none works on for a plan that is gone; then
 * the plan's eve sessions and its agents' retired (`retire-sessions.ts`);
 * then the plan. An eve that refuses a Stop, an agent with a turn still coming
 * that no Stop can name yet, or an agent started while the others were
 * stopped, leaves the plan standing and refused.
 */
const deleteEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: PlansAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  planId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const opened = yield* hostedStoreOrUnavailable(readPlan(userId, planId));
  if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const agents = yield* hostedStoreOrUnavailable(
    listCodingAgents(userId, planId, { includeArchived: true }),
  );
  yield* Effect.forEach(agents, (agent) => stoppedForGood(seams, writer, request, userId, agent), {
    discard: true,
  });
  // Note that the sessions are retired while their conversations still stand, because eve's door
  // admits no one to a cleared conversation's session. An agent started meanwhile refuses the
  // delete below, which leaves the plan standing with its stopped agents retired.
  const conversationIds = [
    ...(opened.value.conversationId === undefined ? [] : [opened.value.conversationId]),
    ...agents.map((agent) => agent.conversationId),
  ];
  const sessions = yield* hostedStoreOrUnavailable(standingSessionsOf(userId, conversationIds));
  yield* retireSessions((mount) => eveFor(seams, request, mount), sessions);
  const stopped = new Set(agents.map(({ id }) => id));
  const deleted = yield* hostedStoreOrUnavailable(
    deletePlan(userId, planId, stopped).pipe(
      Effect.catchTag("PlanAgentUnstopped", () => Effect.succeed(undefined)),
    ),
  );
  // An agent started while the others were stopped is one this delete has not stopped yet.
  if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  if (!deleted) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
});

/** GET opens one plan with its saved document; PATCH changes it; DELETE deletes it. */
const oneEndpoint = /* @__PURE__ */ Effect.fn("web/planEndpoint")(function* (
  seams: PlansAppSeams,
  writer: Effect.Effect<StoreWriter>,
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
  return yield* deleteEndpoint(seams, writer, request, userId, planId);
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
  const written = yield* hostedStoreOrArchived(
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

/**
 * The turn an older page is read before, or nothing for the newest page.
 * Two would leave the page ambiguous, and one that is not a UUID names no
 * turn, so each is refused as a request that does not read.
 */
const beforeTurnOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string | undefined, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(BEFORE_TURN_QUERY);
  const [turnId] = named;
  if (turnId === undefined) return undefined;
  const read = readEither(wireUuidSchema)(unparsedWire(turnId));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return read.success;
});

/** GET reads a page of the plan's work, and on the newest page every code shown on it. */
const workEndpoint = /* @__PURE__ */ Effect.fn("web/planWorkEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const before = yield* beforeTurnOf(request);
  const work = yield* hostedStoreOrUnavailable(readPlanWork(userId, planId, before));
  if (Option.isNone(work)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, work.value);
});

/** The window of a file the queries name, each named once, or the invalid-request refusal. */
const fileRequestOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<PlanFileRequest, HostedRefusal> {
  const query = new URL(request.url).searchParams;
  const once = (name: string) => {
    const named = query.getAll(name);
    return named.length === 1 ? named[0] : undefined;
  };
  const raw = query.getAll(FILE_QUERY.RAW);
  const ref = query.getAll(FILE_QUERY.REF);
  if (raw.length > 1 || (raw.length === 1 && raw[0] !== "1") || ref.length > 1) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const read = readEither(planFileRequestSchema)(
    unparsedWire({
      path: once(FILE_QUERY.PATH),
      firstLine: Number(once(FILE_QUERY.FIRST_LINE)),
      lastLine: Number(once(FILE_QUERY.LAST_LINE)),
      ...(raw.length === 1 ? { raw: true } : undefined),
      ...(ref.length === 1 ? { ref: ref[0] } : undefined),
    }),
  );
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return read.success;
});

/** GET reads a window of one file of the plan's repository, or why it is not shown. */
const fileEndpoint = /* @__PURE__ */ Effect.fn("web/planFileEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const window = yield* fileRequestOf(request);
  const file = yield* hostedStoreOrUnavailable(readPlanFile(userId, planId, window));
  if (Option.isNone(file)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, file.value);
});

/**
 * The folder the query names, named at most once, the root where it is not
 * named, and whether everything under it is asked, or the invalid-request
 * refusal.
 */
const treeRequestOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<PlanTreeRequest, HostedRefusal> {
  const query = new URL(request.url).searchParams;
  const named = query.getAll(TREE_PATH_QUERY);
  const recursive = query.getAll(TREE_RECURSIVE_QUERY);
  if (
    named.length > 1 ||
    recursive.length > 1 ||
    (recursive.length === 1 && recursive[0] !== "1")
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const folder = {
    path: named[0] ?? "",
    ...(recursive.length === 1 ? { recursive: true } : undefined),
  };
  const read = readEither(planTreeRequestSchema)(unparsedWire(folder));
  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return read.success;
});

/** GET lists one folder of the plan's repository, or why it is not listed. */
const treeEndpoint = /* @__PURE__ */ Effect.fn("web/planTreeEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const folder = yield* treeRequestOf(request);
  const tree = yield* hostedStoreOrUnavailable(readPlanTree(userId, planId, folder));
  if (Option.isNone(tree)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, tree.value);
});

/**
 * The revision number the query `name` holds, named once, or nothing where
 * it is absent. A number that is not a whole number from one names no
 * revision, and is refused as a request that does not read.
 */
const revisionSeqOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
  name: string,
): Effect.fn.Return<number | undefined, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(name);
  const [seq] = named;
  if (seq === undefined) return undefined;
  const read = readEither(planRevisionSeqSchema)(unparsedWire(Number(seq)));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return read.success;
});

/** The revision the path names, which a revision's routes cannot do without. */
const namedRevisionOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<number, HostedRefusal> {
  const seq = yield* revisionSeqOf(request, REVISION_SEQ_QUERY);
  if (seq === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  return seq;
});

/**
 * GET reads a page of the plan's history, the newest first. A plan with no
 * history yet answers an empty page, and so does a plan id the account does
 * not own, as `readTranscript` answers neither apart.
 */
const revisionsEndpoint = /* @__PURE__ */ Effect.fn("web/planRevisionsEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const before = yield* revisionSeqOf(request, BEFORE_TURN_QUERY);
  const page = yield* hostedStoreOrUnavailable(listRevisions(userId, planId, before));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads one revision's content and the content before it. */
const revisionEndpoint = /* @__PURE__ */ Effect.fn("web/planRevisionEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const seq = yield* namedRevisionOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const revision = yield* hostedStoreOrUnavailable(readRevision(userId, planId, seq));
  if (Option.isNone(revision)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { revision: revision.value });
});

/** What a restore that saved nothing answers, by why; the store out of reach is any other. */
const RESTORE_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_PLAN, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.NO_REVISION, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.TOO_LONG, HOSTED_REFUSAL.REQUEST_TOO_LARGE],
  [PLAN_SAVE_REFUSAL.ARCHIVED, HOSTED_REFUSAL.PLAN_ARCHIVED],
]);

/**
 * POST puts one revision's content back as the plan's, a revision of the
 * developer's naming it, and answers the plan as it now stands. It names
 * nothing in a body: the plan and the revision are the path's.
 */
const restoreEndpoint = /* @__PURE__ */ Effect.fn("web/planRestoreEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const seq = yield* namedRevisionOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const restored = yield* restoreRevision({ userId, planId }, seq);
  if (restored.status !== PLAN_SAVE_STATUS.SAVED) {
    return yield* Effect.fail(RESTORE_REFUSAL.get(restored.reason) ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: restored.plan });
});

/** What an edit that saved nothing answers, by why, where it is not answered in band; the store out of reach is any other. */
const EDIT_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_PLAN, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.ARCHIVED, HOSTED_REFUSAL.PLAN_ARCHIVED],
]);

/**
 * POST saves the developer's edit of one field, or of a document plan's
 * whole text: answered with the plan as saved, with the field or the text
 * as it now stands where the edit conflicts with it,
 * or as refused where the plan would be longer than a plan may be. An
 * archived plan is refused outright, as no plan is, since a desktop that
 * knows archiving draws no editor on one.
 */
const editEndpoint = /* @__PURE__ */ Effect.fn("web/planEditEndpoint")(function* (
  seams: PlansAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, PlansServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const planId = yield* idOf(request, PLAN_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_EDIT_BODY_BYTES);
  const edit = readEither(planEditRequestSchema)(body);
  if (Result.isFailure(edit)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const saved = yield* saveDeveloperEdit({ userId, planId }, edit.success);
  switch (saved.status) {
    case PLAN_SAVE_STATUS.SAVED:
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: saved.plan });
    case PLAN_SAVE_STATUS.CONFLICT:
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { conflict: { current: saved.current } });
    case PLAN_SAVE_STATUS.NOT_SAVED:
      if (saved.reason === PLAN_SAVE_REFUSAL.TOO_LONG) {
        return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { refused: PLAN_EDIT_REFUSAL.TOO_LONG });
      }
      return yield* Effect.fail(EDIT_REFUSAL.get(saved.reason) ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
});

/** The group: the plan paths, and the hosted vocabulary's own refusal for any other. */
export function plansApp(seams: PlansAppSeams): WebRoutes<PlansAppServices> {
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, PLANS_PATH.COLLECTION, hostedRefusing(collectionEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.ONE, hostedRefusing(oneEndpoint(seams, writer))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.BOARD, hostedRefusing(boardEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.TRANSCRIPT, hostedRefusing(transcriptEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.WORK, hostedRefusing(workEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.FILE, hostedRefusing(fileEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.TREE, hostedRefusing(treeEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.REVISIONS, hostedRefusing(revisionsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.REVISION, hostedRefusing(revisionEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.RESTORE, hostedRefusing(restoreEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, PLANS_PATH.EDIT, hostedRefusing(editEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
