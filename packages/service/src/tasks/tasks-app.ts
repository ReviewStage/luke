import type { DatabaseServices } from "@luke/database/core/query";

import {
  keepPlanAttachment,
  PLAN_ATTACHMENT_KEEP,
  readPlanAttachment,
} from "@luke/database/models/plan-attachments";

import { listPages, readPageVersion } from "@luke/database/models/plan-pages";
import type { WorkspaceSeams } from "@luke/database/models/workspace-seams";
import { pageVersionNumberSchema } from "@luke/features/page-wire";
import { PICTURE_BOUNDS, pictureOfDataUrl } from "@luke/features/picture-wire";
import {
  PLAN_ATTACHMENT_REFUSAL,
  planAttachmentRequestSchema,
} from "@luke/features/plan-attachment-wire";
import { type TaskFileRequest, taskFileRequestSchema } from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { EveReach } from "../agents/coder-host/stop.js";
import { unparsedWire, wireUuidSchema } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import type {
  IntegrationConnect,
  WorkspaceLinearConnect,
} from "../integrations/integration-connect.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { readTaskFile } from "./task-file.js";
import { readTaskSkills } from "./task-skills.js";
import { readTaskTree, treeRequestOf } from "./task-tree.js";
import { readTaskCode } from "./task-work-store.js";

/**
 * tasks-app.ts -- a plan's reads the hosted oRPC router does not answer yet: its code, its repository's files, its pages, and its pictures.
 *
 * The plans themselves, and each one's board, edit, history, transcript,
 * work, and Stop, are the router's (`tasks-procedures.ts`). Every endpoint
 * here resolves the bearer before it touches a row, and every row it touches
 * is one the bearer's account reaches: a plan id another account owns
 * answers exactly as one that names nothing, so nothing is learned about
 * plans the caller does not hold.
 *
 * `/api/plans/{id}/file` is a window of one file of the plan's repository
 * for the File tab, read from GitHub as it stands now, or at the commit an
 * inbox item's code reference pins, through the App, under the rule
 * `show_code` is held to (`packages/service/src/tasks/task-file.ts`), and
 * `/api/plans/{id}/tree` one folder of it for the tree beside that tab,
 * listed where and as the file is read (`packages/service/src/tasks/task-tree.ts`);
 * `/api/plans/{id}/skills` is the skills a developer may choose of that
 * repository, read where and as the file is
 * (`packages/service/src/tasks/task-skills.ts`). `/api/plans/{id}/pages` is
 * the pages agents wrote for the plan, each by its newest version, and
 * `/api/plans/{id}/pages/{page}/versions/{version}` one version's HTML,
 * answered inside JSON so no page is ever a document of this origin
 * (`@luke/database/models/plan-pages`).
 */

const TASKS_PATH = {
  /** GET reads every code Luke showed on the task; the rewrite moves the path's id into the `id` query. */
  CODE: "/api/plans/code",
  /** GET reads a window of one file of the task's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  FILE: "/api/plans/file",
  /** GET lists one folder of the task's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  TREE: "/api/plans/tree",
  /** GET reads the skills a developer may choose of the task's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  SKILLS: "/api/plans/skills",
  /** GET lists the task's pages; the rewrite moves the path's id into the `id` query. */
  PAGES: "/api/plans/pages",
  /** GET reads one version of one page; the rewrite moves the path's ids and number into the `id`, `page`, and `version` queries. */
  PAGE: "/api/plans/page",
  /** POST keeps one picture on the plan, answering the id its text names it by; the rewrite moves the path's id into the `id` query. */
  ATTACHMENTS: "/api/plans/attachments",
  /** GET serves one picture of the plan as its bytes; the rewrite moves the path's ids into the `id` and `attachment` queries. */
  ATTACHMENT: "/api/plans/attachment",
} as const;

const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
  PUT: "PUT",
  PATCH: "PATCH",
  DELETE: "DELETE",
} as const;

const TASK_ID_QUERY = "id";

/** The queries naming one version of one page: the page's id, and the version's number. */
const PAGE_QUERY = {
  PAGE: "page",
  VERSION: "version",
} as const;

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

/** The query naming one picture of the plan by its id. */
const ATTACHMENT_QUERY = "attachment";

/** An upload is one picture as a `data:` URL at its byte bound, base64 being four characters for every three bytes, with room for its type and key. */
const MAXIMUM_ATTACHMENT_BODY_BYTES = Math.ceil(PICTURE_BOUNDS.MAX_BYTES / 3) * 4 + 1_024;

export interface TasksAppSeams extends EveReach {
  resolveUserId: UserIdResolver;
  /** The plugin's write that makes an account's first workspace, the first time a start needs it. */
  workspaces: WorkspaceSeams;
}

/** What the routes may require of the function that stands them: the store, GitHub through the App for a repository's check, and the model catalog a brain worker's transcript prices its turns at. */
export type TasksAppServices =
  | DatabaseServices
  | GitHubApp
  | HttpClient.HttpClient
  | ModelCatalog
  | IntegrationConnect
  | WorkspaceLinearConnect;

type TasksServices = TasksAppServices | HttpServerRequest.HttpServerRequest;

/** The bearer's account, or the invalid-token refusal. */
const resolvedUserId = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TasksAppSeams,
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

/** GET reads every code Luke showed on the task, oldest first. */
const codeEndpoint = /* @__PURE__ */ Effect.fn("web/taskCodeEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const code = yield* hostedStoreOrUnavailable(readTaskCode(userId, taskId));
  if (Option.isNone(code)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, code.value);
});

/** The window of a file the queries name, each named once, or the invalid-request refusal. */
const fileRequestOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<TaskFileRequest, HostedRefusal> {
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
  const read = readEither(taskFileRequestSchema)(
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

/** GET reads a window of one file of the task's repository, or why it is not shown. */
const fileEndpoint = /* @__PURE__ */ Effect.fn("web/taskFileEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const window = yield* fileRequestOf(request);
  const file = yield* hostedStoreOrUnavailable(readTaskFile(userId, taskId, window));
  if (Option.isNone(file)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, file.value);
});

/** GET lists one folder of the task's repository, or why it is not listed. */
const treeEndpoint = /* @__PURE__ */ Effect.fn("web/taskTreeEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const folder = yield* treeRequestOf(request);
  const tree = yield* hostedStoreOrUnavailable(readTaskTree(userId, taskId, folder));
  if (Option.isNone(tree)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, tree.value);
});

/** GET reads the skills a developer may choose of the task's repository, or why they are not read. */
const skillsEndpoint = /* @__PURE__ */ Effect.fn("web/taskSkillsEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const skills = yield* hostedStoreOrUnavailable(readTaskSkills(userId, taskId));
  if (Option.isNone(skills)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, skills.value);
});

/** GET lists the task's pages, the most recently written first; a task id the account does not own answers none, as the history does. */
const pagesEndpoint = /* @__PURE__ */ Effect.fn("web/taskPagesEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const pages = yield* hostedStoreOrUnavailable(listPages(userId, taskId));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { pages });
});

/** The version number the path names, once; one that is not a whole number from one is refused as a request that does not read. */
const pageVersionOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<number, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(PAGE_QUERY.VERSION);
  const read = readEither(pageVersionNumberSchema)(unparsedWire(Number(named[0])));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return read.success;
});

/** GET reads one version of one page with its HTML, inside JSON. */
const pageEndpoint = /* @__PURE__ */ Effect.fn("web/taskPageEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const pageId = yield* idOf(request, PAGE_QUERY.PAGE);
  const version = yield* pageVersionOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const page = yield* hostedStoreOrUnavailable(readPageVersion(userId, taskId, pageId, version));
  if (Option.isNone(page)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { page: page.value });
});

/**
 * POST keeps one picture on the plan, pasted, dropped, or chosen into its
 * text by any member of its workspace, and answers the id the text then
 * names it by, or refuses in band where the plan holds its bound of
 * pictures. A plan the account does not reach, or an archived one, which no
 * editor is drawn on, keeps nothing and answers as not found.
 */
const attachmentsEndpoint = /* @__PURE__ */ Effect.fn("web/planAttachmentsEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_ATTACHMENT_BODY_BYTES);
  const upload = readEither(planAttachmentRequestSchema)(body);
  const picture = Result.isSuccess(upload) ? pictureOfDataUrl(upload.success.picture) : undefined;
  if (picture === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const kept = yield* hostedStoreOrUnavailable(keepPlanAttachment(userId, taskId, picture));
  switch (kept.status) {
    case PLAN_ATTACHMENT_KEEP.KEPT:
      return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, { id: kept.id });
    case PLAN_ATTACHMENT_KEEP.TOO_MANY:
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
        refused: PLAN_ATTACHMENT_REFUSAL.TOO_MANY,
      });
    case PLAN_ATTACHMENT_KEEP.NO_TASK:
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
});

/**
 * GET serves one picture of the plan as its bytes, under the media type the
 * service sniffed them to be as they were kept, to the members of the plan's
 * workspace alone: a picture of a plan the account does not reach, or of
 * another plan, is not found, as a plan is.
 */
const attachmentEndpoint = /* @__PURE__ */ Effect.fn("web/planAttachmentEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const attachmentId = yield* idOf(request, ATTACHMENT_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const found = yield* hostedStoreOrUnavailable(readPlanAttachment(userId, taskId, attachmentId));
  if (Option.isNone(found)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return HttpServerResponse.uint8Array(found.value.bytes, {
    status: HOSTED_HTTP_STATUS.OK,
    contentType: found.value.contentType,
    headers: HOSTED_BYTES_HEADERS,
  });
});

/** The group: the task paths, and the hosted vocabulary's own refusal for any other. */
export function tasksApp(seams: TasksAppSeams): WebRoutes<TasksAppServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, TASKS_PATH.CODE, hostedRefusing(codeEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.FILE, hostedRefusing(fileEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.TREE, hostedRefusing(treeEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.SKILLS, hostedRefusing(skillsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.PAGES, hostedRefusing(pagesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.PAGE, hostedRefusing(pageEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.ATTACHMENTS, hostedRefusing(attachmentsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.ATTACHMENT, hostedRefusing(attachmentEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
