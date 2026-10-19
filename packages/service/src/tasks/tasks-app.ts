import type { DatabaseServices } from "@luke/database/core/query";
import { askRecord } from "@luke/database/models/asks";
import { readBoard, writeScene } from "@luke/database/models/board-store";
import { childTitlesOf } from "@luke/database/models/child-titles";
import { listCodingAgents, readCodingAgentByKey } from "@luke/database/models/coding-agent-store";
import { hostedStore } from "@luke/database/models/hosted-store";
import { childConversationId } from "@luke/database/models/ids";
import { readIssue } from "@luke/database/models/issue-store";
import {
  keepPlanAttachment,
  PLAN_ATTACHMENT_KEEP,
  readPlanAttachment,
} from "@luke/database/models/plan-attachments";
import { listPages, readPageVersion } from "@luke/database/models/plan-pages";
import { listRevisions, readRevision } from "@luke/database/models/plan-revisions";
import { conversationOwnerOf, standingSessionsNamed } from "@luke/database/models/recorded-session";
import {
  createTask,
  deleteTask,
  listTasks,
  readTask,
  type StoredTask,
  updateTask,
} from "@luke/database/models/task-store";
import { readTranscript } from "@luke/database/models/transcript-store";
import type { WorkspaceSeams } from "@luke/database/models/workspace-seams";
import { ensurePersonalWorkspace, isWorkspaceMember } from "@luke/database/models/workspace-store";
import { type StoreWriter, storeWriter } from "@luke/database/models/writer";
import { BOARD_BOUNDS, boardSaveRequestSchema } from "@luke/features/board-wire";
import {
  CODING_AGENT_CURSOR_START,
  CODING_AGENT_STATUS,
  codingAgentCallIdSchema,
  codingAgentCursorSchema,
} from "@luke/features/coding-agent-wire";
import { pageVersionNumberSchema } from "@luke/features/page-wire";
import { PICTURE_BOUNDS, pictureOfDataUrl } from "@luke/features/picture-wire";
import {
  PLAN_ATTACHMENT_REFUSAL,
  planAttachmentRequestSchema,
} from "@luke/features/plan-attachment-wire";
import { PLAN_EDIT_REFUSAL, planEditRequestSchema } from "@luke/features/plan-edit";
import {
  planRevisionSeqSchema,
  TASK_BOUNDS,
  type Task,
  type TaskAgentStart,
  type TaskAnswer,
  type TaskFileRequest,
  type TaskStartAnswer,
  taskFileRequestSchema,
} from "@luke/features/task-wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Data, Effect, Layer, Option, Result } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { STOP_REFUSAL, stopConversation } from "../agents/brain-host/brain-ask.js";
import { EVE_MOUNT } from "../agents/brain-host/eve-sessions.js";
import { MAXIMUM_START_BODY_BYTES, startRequestedAgent } from "../agents/coder-host/start.js";
import {
  type EveReach,
  eveFor,
  standsStopped,
  stoppedForGood,
  stopsForGood,
  summaryOf,
} from "../agents/coder-host/stop.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  CURSOR_START,
  cursorOfWire,
  cursorToWire,
  type TranscriptPage,
  transcriptPast,
} from "../agents/coder-host/transcript.js";
import { retireSessions } from "../agents/retire-sessions.js";
import { listTasklessAgents, withTaskAgents } from "../agents/task-agents.js";
import {
  TASK_LIST_ARCHIVED,
  TASK_LIST_QUERY,
  taskCreateRequestSchema,
  taskUpdateRequestSchema,
  unparsedWire,
  wireUuidSchema,
} from "../core.js";
import { recordServerEvent, SERVER_EVENT, SERVER_TASK_SOURCE } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { workspaceRepository } from "../github/workspace-repository.js";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  HOSTED_BYTES_HEADERS,
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedBearerOnly,
  hostedJsonResponse,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrArchived,
  hostedStoreOrUnavailable,
  readJsonBodyEffect,
  type UserIdResolver,
} from "../http/http-effect.js";
import type {
  IntegrationConnect,
  WorkspaceLinearConnect,
} from "../integrations/integration-connect.js";
import {
  linearIssue,
  linearOrRefused,
  throughWorkspaceLinear,
} from "../integrations/linear-issues.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { ANY_METHOD, type WebRoutes } from "../route.js";
import { HOSTED_TOOL_SET } from "./brain-tool-set.js";
import {
  BRAIN_POLL,
  type BrainPage,
  brainPagePast,
  brainStatusNow,
  brainTitleAwaited,
  brainTurnsPage,
  brainWorkerSession,
} from "./brain-transcript.js";
import {
  PLAN_SAVE_REFUSAL,
  PLAN_SAVE_STATUS,
  restoreRevision,
  saveDeveloperEdit,
} from "./plan-notes.js";
import { readTaskFile } from "./task-file.js";
import { readTaskSkills } from "./task-skills.js";
import { readTaskTree, treeRequestOf } from "./task-tree.js";
import { readTaskCode, readTaskWork } from "./task-work-store.js";

/**
 * tasks-app.ts -- the Mac Tasks tab's named tasks: list, start, open, change, and delete.
 *
 * Every endpoint resolves the bearer before it touches a row, and every row
 * it touches is one the bearer's account owns: a task id another account
 * owns answers exactly as one that names nothing, so nothing is learned
 * about tasks the caller does not hold. The developer writes a document in
 * two ways here, each through the plan's one write (`packages/service/src/tasks/plan-notes.ts`)
 * that the notetaker and the coding agents save their notes through: `POST
 * /api/plans/{id}/edit` is their edit of the document, saved, or answered as
 * a conflict with the text as it stands now where Luke wrote it meanwhile and
 * the edit no longer lands, with nothing saved; and a restore puts back an
 * earlier revision.
 * `GET /api/plans/{id}` is the window opening a task, a read that moves
 * nothing: the list stands newest started first whatever is opened. Its
 * `DELETE` stops every coding agent of the task first, through the one Stop
 * (`packages/service/src/agents/coder-host/stop.ts`), and only then deletes the task, as
 * its archive stops them before it archives them with the task. Each
 * row of the list carries what the task's coding agents are doing and what
 * they published, in brief, where it has any (`packages/service/src/agents/task-agents.ts`). A pin
 * and an archive are changes like a rename, though a pin is the asking
 * member's own and reads pinned for no one else, and the list leaves the archived
 * tasks out unless `archived=include` asks for them, so a build from before
 * archiving, which never asks, draws none of them rather than all of them.
 *
 * `/api/plans/{id}/board` is the task's whiteboard: the Mac reads it, with
 * Luke's latest drawing, and writes the scene back whole, the last write
 * winning (`@luke/database/models/board-store`). `/api/plans/{id}/transcript` is what was
 * said on the task's calls, read and never written here
 * (`@luke/database/models/transcript-store`). `/api/plans/{id}/work` is what Luke's
 * brain wrote and ran on them, a page at a time, and every code he
 * showed, read back from the task's conversation
 * (`tasks/task-work-store.ts`). `/api/plans/{id}/file` is a window of one
 * file of the task's repository for the File tab, read from GitHub as it
 * stands now, or at the commit an inbox item's code reference pins, through
 * the App, under the rule `show_code` is held to (`packages/service/src/tasks/task-file.ts`), and `/api/plans/{id}/tree` one folder of it for
 * the tree beside that tab, listed where and as the file is read
 * (`packages/service/src/tasks/task-tree.ts`); `/api/plans/{id}/skills` is the skills a
 * developer may choose of that repository, read where and as the file is
 * (`packages/service/src/tasks/task-skills.ts`). `/api/plans/{id}/revisions` is the plan's history
 * for the History tab, a page at a time; `/api/plans/{id}/revisions/{seq}`
 * one revision's content beside the one before it, both formatted under the
 * task's name as it stands; and `/api/plans/{id}/revisions/{seq}/restore`
 * puts that content back as a revision of the developer's, answered with the
 * plan (`@luke/database/models/plan-revisions`). `/api/plans/{id}/pages`
 * is the pages agents wrote for the task, each by its newest version, and
 * `/api/plans/{id}/pages/{page}/versions/{version}` one version's HTML,
 * answered inside JSON so no page is ever a document of this origin
 * (`@luke/database/models/plan-pages`).
 *
 * A task may name the GitHub repository it is about, at its start or by a
 * later change, and null is a task with none. A repository is kept only once
 * the Luke GitHub App confirms the account reaches it (`github/github-app.ts`),
 * read from GitHub on the account's own token before the row is written, so a
 * task never names a repository its owner could not reach through the App at
 * the moment it was named: an account that must sign in with GitHub again, and
 * a repository the App reaches no installation of for the account, are each
 * refused by name, with nothing written. A task in the workspace of a GitHub
 * App installation may name only a repository of that installation, and a
 * task in a workspace with nothing connected names none.
 *
 * A task starts in the workspace the request names, which the account must be
 * a member of, or in the account's first workspace where it names none;
 * either way the task belongs to that workspace from then on, and its row in
 * the list names it.
 *
 * Starting a task otherwise names nothing of the developer's Mac: the
 * brain reads the repository in its own sandbox on the service
 * (`packages/service/src/agents/repository-shell.ts`), and no route here carries a command.
 */

const TASKS_PATH = {
  /** GET lists, the archived tasks too where `archived=include` asks; POST starts. */
  COLLECTION: "/api/plans",
  /** GET opens, PATCH changes the name, the repository, the pin, or the archive, DELETE deletes; the rewrite moves the path's id into the `id` query. */
  ONE: "/api/plans/plan",
  /** GET reads the task's board, PUT writes it; the rewrite moves the path's id into the `id` query. */
  BOARD: "/api/plans/board",
  /** GET reads what was said on the task's calls; the rewrite moves the path's id into the `id` query. */
  TRANSCRIPT: "/api/plans/transcript",
  /** GET reads a page of the task's work, before the turn `before` names where it names one, and on the newest page every code shown on it; the rewrite moves the path's id into the `id` query. */
  WORK: "/api/plans/work",
  /** GET reads the task's brain conversation as a coding agent's transcript is read: past the cursor `after` names, held while a turn or a worker runs; its newest turns where it names none; the turns before the one `before` names. The rewrite moves the path's id into the `id` query. */
  MESSAGES: "/api/plans/messages",
  /** GET reads one brain worker's session past the cursor, held while it runs; the rewrite moves the path's id and the call that started the worker into the `id` and `call` queries. */
  SUBAGENT_MESSAGES: "/api/plans/subagent-messages",
  /** GET reads every code Luke showed on the task; the rewrite moves the path's id into the `id` query. */
  CODE: "/api/plans/code",
  /** GET reads a window of one file of the task's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  FILE: "/api/plans/file",
  /** GET lists one folder of the task's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  TREE: "/api/plans/tree",
  /** GET reads the skills a developer may choose of the task's repository as GitHub holds it now; the rewrite moves the path's id into the `id` query. */
  SKILLS: "/api/plans/skills",
  /** GET reads a page of the plan's history, before the revision `before` names where it names one; the rewrite moves the path's id into the `id` query. */
  REVISIONS: "/api/plans/revisions",
  /** GET reads one revision's content and the one before it; the rewrite moves the path's id and number into the `id` and `seq` queries. */
  REVISION: "/api/plans/revision",
  /** POST restores one revision as the plan's content; the rewrite moves the path's id and number into the `id` and `seq` queries. */
  RESTORE: "/api/plans/restore",
  /** POST saves the developer's edit of the document; the rewrite moves the path's id into the `id` query. */
  EDIT: "/api/plans/edit",
  /** POST stops everything Luke has running or waiting on the task; the rewrite moves the path's id into the `id` query. */
  STOP: "/api/plans/stop",
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

/** The query naming the turn an older page of a task's work is read before, and the revision an older page of its history is. */
const BEFORE_TURN_QUERY = "before";

/** The queries of a transcript read: the cursor it reads past, and the call that started the worker whose session it is. */
const TRANSCRIPT_QUERY = {
  AFTER: "after",
  CALL: "call",
} as const;

/** The query naming one revision of the plan by its number. */
const REVISION_SEQ_QUERY = "seq";

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

/** A change is a name and a repository's name at most, so a body past this is none. */
const MAXIMUM_NAME_BODY_BYTES = 8_192;

/** A brief at its bound with every character escaped. */
const MAXIMUM_BRIEF_BYTES = TASK_BOUNDS.MAX_BRIEF_CHARS * 6;

/** A start is a change's few fields, a brief where it names one, and an agent's Start beside them where it names one. */
const MAXIMUM_TASK_START_BODY_BYTES =
  MAXIMUM_NAME_BODY_BYTES + MAXIMUM_BRIEF_BYTES + MAXIMUM_START_BODY_BYTES;

/** An edit is the plan's text twice, its base and its value, each at its bound with every character escaped. */
const MAXIMUM_EDIT_BODY_BYTES = TASK_BOUNDS.MAX_BODY_CHARS * 2 * 6 + 1_024;

/** An upload is one picture as a `data:` URL at its byte bound, base64 being four characters for every three bytes, with room for its type and key. */
const MAXIMUM_ATTACHMENT_BODY_BYTES = Math.ceil(PICTURE_BOUNDS.MAX_BYTES / 3) * 4 + 1_024;

/** A save is a scene at its byte bound and its image at its own, with room for the drawing's number around them. */
const MAXIMUM_BOARD_BODY_BYTES = BOARD_BOUNDS.MAX_BYTES + BOARD_BOUNDS.MAX_IMAGE_CHARS + 1_024;

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

/**
 * The repository as the row keeps it: null where none was named, or the
 * full name as GitHub spells it once the App confirms the workspace's
 * installation reaches it (`packages/service/src/github/workspace-repository.ts`). The workspace
 * is read only where a repository is named.
 */
const reachableRepository = /* @__PURE__ */ Effect.fnUntraced(function* (
  workspace: Effect.Effect<string, HostedRefusal, DatabaseServices>,
  repository: string | null | undefined,
): Effect.fn.Return<
  string | null,
  HostedRefusal,
  GitHubApp | HttpClient.HttpClient | DatabaseServices
> {
  if (repository === undefined || repository === null) return null;
  const organizationId = yield* workspace;
  const reached = yield* workspaceRepository(organizationId, repository);
  return reached.fullName;
});

/** The account's task, or not found for a task it does not reach. */
const reachedTask = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  taskId: string,
): Effect.fn.Return<StoredTask, HostedRefusal, DatabaseServices> {
  const opened = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return opened.value;
});

/** A move the workspace's GitHub refused under the task's lock, carried out of the store's change as the route's refusal. */
class MoveRefused extends Data.TaggedError("MoveRefused")<{ readonly refusal: HostedRefusal }> {}

/**
 * The workspace a task moves to, confirmed: the task is the account's own,
 * since a teammate's task moved out of a shared workspace would leave the
 * teammates who wrote it behind, and the account is a member of the
 * workspace, which answers as none where it is not. That the workspace's
 * GitHub reaches the task's repository is confirmed under the task's lock
 * (`movedRepositoryReached`), so a move never strands one.
 */
const movedToWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  stored: StoredTask,
  workspaceId: string,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  if (stored.ownerId !== userId) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
  if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return workspaceId;
});

/** The move's guard: the workspace's GitHub reaches the repository the task names under its lock, where it names one. */
const movedRepositoryReached =
  (workspaceId: string) =>
  (
    repository: string | null,
  ): Effect.Effect<void, MoveRefused, GitHubApp | HttpClient.HttpClient | DatabaseServices> =>
    repository === null
      ? Effect.void
      : workspaceRepository(workspaceId, repository).pipe(
          Effect.asVoid,
          Effect.mapError((refusal) => new MoveRefused({ refusal })),
        );

/**
 * The workspace a start lands in: the one the request named, where the
 * account is a member of it, or the account's first workspace, made the
 * first time it is needed, where it named none. A workspace the account is
 * not in answers as one that names nothing. The plugin refusing to make the
 * first workspace is the service unable to start the task, written down
 * without the plugin's message, which may quote what it refused.
 */
const startingWorkspace = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TasksAppSeams,
  userId: string,
  workspaceId: string | undefined,
): Effect.fn.Return<string, HostedRefusal, DatabaseServices> {
  if (workspaceId !== undefined) {
    const member = yield* hostedStoreOrUnavailable(isWorkspaceMember(userId, workspaceId));
    if (!member) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return workspaceId;
  }
  const first = yield* hostedStoreOrUnavailable(
    ensurePersonalWorkspace(userId, seams.workspaces).pipe(
      Effect.catchTag("UnknownError", () =>
        Effect.as(
          Effect.logWarning("First workspace not made: the plugin refused"),
          Option.none<string>(),
        ),
      ),
    ),
  );
  // Note that an account gone between its bearer and here has no workspace to start in.
  if (Option.isNone(first)) return yield* Effect.fail(HOSTED_REFUSAL.UNAVAILABLE);
  return first.value;
});

/**
 * The Linear issue a plan starts from, read through the workspace's own
 * Linear connection whatever team it is in, or the Linear refusal: the
 * workspace has none connected, its grant is refused, or the issue is none
 * it reaches. Nothing is written before it is read, so a refusal starts no
 * plan.
 */
const startingLinearIssue = (organizationId: string, issueId: string) =>
  linearOrRefused(
    throughWorkspaceLinear(organizationId, (token) => linearIssue(token, issueId)),
    "Linear gave no issue to start a task from",
  );

/**
 * The workspace's own issue a plan starts from, where the account reads it
 * and it is an issue of the workspace the plan starts in; refused as not
 * found otherwise, before anything is written.
 */
const startingIssue = Effect.fnUntraced(function* (
  userId: string,
  organizationId: string,
  issueId: string,
) {
  const read = yield* hostedStoreOrUnavailable(readIssue(userId, issueId));
  if (Option.isNone(read) || read.value.workspaceId !== organizationId) {
    return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  }
  return read.value.id;
});

/** Whether a list read asks for the archived tasks too; a build from before archiving never does. */
function listsArchived(request: Request): boolean {
  const asked = new URL(request.url).searchParams.get(TASK_LIST_QUERY.ARCHIVED);
  return asked === TASK_LIST_ARCHIVED.INCLUDE;
}

/**
 * The task and the agent a start's earlier request made under the agent's
 * key: a retry after a lost answer is answered with them rather than with a
 * second task. A key already spent on an agent anywhere else, on another
 * workspace's task, on no task, or on a task the account no longer reaches,
 * is no retry of this start, and is refused as invalid with nothing written.
 */
const startedBefore = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  idempotencyKey: string,
  organizationId: string,
): Effect.fn.Return<Option.Option<TaskStartAnswer>, HostedRefusal, DatabaseServices> {
  const made = yield* hostedStoreOrUnavailable(readCodingAgentByKey(userId, idempotencyKey));
  if (Option.isNone(made)) return Option.none();
  const task =
    made.value.taskId === null
      ? Option.none()
      : yield* hostedStoreOrUnavailable(readTask(userId, made.value.taskId));
  if (Option.isNone(task) || task.value.task.workspaceId !== organizationId) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return Option.some({ plan: task.value.task, agent: yield* summaryOf(userId, made.value) });
});

/**
 * The agent the key names on the task, where the Start made one before it
 * failed: a store write or read after eve took the session failed the
 * Start, though the agent works on. Nothing where it made none, or where it
 * could not be read either.
 */
const agentMadeOn = (userId: string, taskId: string, idempotencyKey: string) =>
  Effect.gen(function* () {
    const made = yield* readCodingAgentByKey(userId, idempotencyKey);
    if (Option.isNone(made) || made.value.taskId !== taskId) return Option.none();
    return Option.some(yield* summaryOf(userId, made.value));
  }).pipe(Effect.orElseSucceed(() => Option.none()));

/**
 * The agent a start asks for, started on the task it just made through the
 * agent's own Start (`startRequestedAgent`), reaching eve as the developer;
 * a refusal is answered beside the task rather than in its place, since the
 * task stands either way and the developer's words are theirs to try again.
 * A Start that failed after its agent was made answers that agent, since it
 * works all the same.
 */
const startedAgentOn = (
  seams: TasksAppSeams,
  request: Request,
  userId: string,
  task: Task,
  agent: TaskAgentStart,
): Effect.Effect<TaskStartAnswer, never, TasksServices> =>
  startRequestedAgent(eveFor(seams, request), userId, task.id, agent).pipe(
    Effect.map((started): TaskStartAnswer => ({ plan: task, agent: started.agent })),
    Effect.catch((refusal) =>
      Effect.gen(function* () {
        const made = yield* agentMadeOn(userId, task.id, agent.idempotencyKey);
        if (Option.isSome(made)) return { plan: task, agent: made.value } satisfies TaskStartAnswer;
        yield* Effect.logWarning(
          `the agent a task's start asked for was refused: ${refusal.error}`,
        );
        return { plan: task, agentRefusal: { error: refusal.error } } satisfies TaskStartAnswer;
      }),
    ),
  );

/**
 * GET lists the account's plans, and beside them the agents with no plan in
 * its workspaces; POST starts one with an empty document, its repository
 * confirmed and its Linear issue and its own issue read first, and, where it
 * names an agent, starts that agent on it: a start naming an agent and no
 * repository is refused as an agent's Start on such a task is, and one
 * carrying no bearer, which the agent's session is opened over, as
 * unauthenticated, both before anything is written; one whose agent's key
 * already started an agent in the workspace answers that agent's task and
 * the agent (`startedBefore`).
 */
const collectionEndpoint = /* @__PURE__ */ Effect.fn("web/plansCollectionEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.GET) {
    const includeArchived = listsArchived(request);
    const tasks = yield* hostedStoreOrUnavailable(
      Effect.flatMap(listTasks(userId, { includeArchived }), (listed) =>
        withTaskAgents(userId, listed),
      ),
    );
    const tasklessAgents = yield* hostedStoreOrUnavailable(
      listTasklessAgents(userId, { includeArchived }),
    );
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      plans: tasks,
      planlessAgents: tasklessAgents,
    });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_TASK_START_BODY_BYTES);
  const started = readEither(taskCreateRequestSchema)(body);
  if (Result.isFailure(started)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const { agent } = started.success;
  if (agent !== undefined) {
    // Note that the agent's session is opened over the developer's bearer, so a cookie's start is refused before anything is written.
    yield* hostedBearerOnly(request);
    if (started.success.repository === undefined || started.success.repository === null) {
      return yield* Effect.fail(HOSTED_REFUSAL.NO_REPOSITORY);
    }
  }
  const organizationId = yield* startingWorkspace(seams, userId, started.success.workspaceId);
  const before =
    agent === undefined
      ? Option.none()
      : yield* startedBefore(userId, agent.idempotencyKey, organizationId);
  if (Option.isSome(before)) return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, before.value);
  const repository = yield* reachableRepository(
    Effect.succeed(organizationId),
    started.success.repository,
  );
  const issue =
    started.success.linearIssueId === undefined
      ? undefined
      : yield* startingLinearIssue(organizationId, started.success.linearIssueId);
  const issueId =
    started.success.issueId === undefined
      ? undefined
      : yield* startingIssue(userId, organizationId, started.success.issueId);
  // An agent is the start, so its task opens with no planning phase.
  const planning = agent === undefined ? started.success.planning : false;
  const task = yield* hostedStoreOrUnavailable(
    createTask(userId, {
      organizationId,
      ...(started.success.name === undefined ? undefined : { name: started.success.name }),
      repository,
      ...(issue === undefined ? undefined : { linearIssue: issue }),
      ...(issueId === undefined ? undefined : { issueId }),
      ...(planning === undefined ? undefined : { planning }),
      ...(started.success.brief === undefined ? undefined : { brief: started.success.brief }),
    }),
  );
  yield* recordServerEvent(SERVER_EVENT.TASK_CREATE, userId, {
    source: SERVER_TASK_SOURCE.SIDEBAR,
    has_issue: issue !== undefined || issueId !== undefined,
  });
  const answer: TaskStartAnswer =
    agent === undefined
      ? { plan: task }
      : yield* startedAgentOn(seams, request, userId, task, agent);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.CREATED, answer);
});

/**
 * PATCH: the task's name, its repository, its pin, its archive, its
 * workspace, or any of them changed, answered with its document. A
 * repository and a move are confirmed before the row is touched, so a
 * refused one leaves the rest unchanged too; a repository named beside a
 * move is confirmed in the workspace the task moves to, and a move confirms
 * the repository the row names under its lock, so one changed meanwhile is
 * the one confirmed.
 *
 * An archive stops every coding agent of the plan first, as a Stop and an
 * agent's own archive stop one, then archives them with the plan under its
 * lock (`updateTask`), each read again under its conversation's lock. An
 * eve that refuses a Stop, an agent still coming up or with a message
 * awaiting its turn, which no Stop can name yet, or one handed a message
 * after it was stopped, leaves the plan and every agent standing and the
 * archive refused as not ready, so it is asked again a moment later.
 */
const updateEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TasksAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  taskId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const body = yield* readJsonBodyEffect(MAXIMUM_NAME_BODY_BYTES);
  const update = readEither(taskUpdateRequestSchema)(body);
  if (Result.isFailure(update)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const changes = update.success;
  const organizationId =
    changes.workspaceId === undefined
      ? undefined
      : yield* movedToWorkspace(userId, yield* reachedTask(userId, taskId), changes.workspaceId);
  const workspace =
    organizationId === undefined
      ? Effect.map(reachedTask(userId, taskId), (stored) => stored.task.workspaceId)
      : Effect.succeed(organizationId);
  const repository =
    "repository" in changes ? yield* reachableRepository(workspace, changes.repository) : undefined;
  const archiving = changes.archived === true;
  if (archiving) {
    const agents = yield* hostedStoreOrUnavailable(listCodingAgents(userId, taskId));
    // Every agent is read before any is stopped, so an archive refused as not ready cancels no one's work.
    const ready = yield* Effect.forEach(agents, stopsForGood);
    if (ready.includes(false)) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
    yield* Effect.forEach(agents, (agent) => stoppedForGood(seams, writer, request, agent), {
      discard: true,
    });
  }
  const task = yield* updateTask(
    userId,
    taskId,
    {
      ...("name" in changes ? { name: changes.name } : undefined),
      ...(organizationId === undefined ? undefined : { organizationId }),
      ...(repository === undefined ? undefined : { repository }),
      ...("pinned" in changes ? { pinned: changes.pinned } : undefined),
      ...("pinPosition" in changes ? { pinPosition: changes.pinPosition } : undefined),
      ...("archived" in changes ? { archived: changes.archived } : undefined),
    },
    organizationId === undefined ? undefined : movedRepositoryReached(organizationId),
    archiving ? standsStopped : undefined,
  ).pipe(
    Effect.catch((failure) =>
      failure._tag === "MoveRefused"
        ? Effect.fail(failure.refusal)
        : failure._tag === "TaskAgentUnstopped"
          ? Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY)
          : hostedStoreOrArchived(Effect.fail(failure)),
    ),
  );
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: task.value } satisfies TaskAnswer);
});

const ONE_TASK_METHODS: ReadonlySet<string> = new Set([
  HTTP_METHOD.GET,
  HTTP_METHOD.PATCH,
  HTTP_METHOD.DELETE,
]);

/**
 * DELETE: every coding agent of the task stopped for good first, as a Stop
 * and an archive stop one, so none works on for a task that is gone; then
 * the task's eve sessions and its agents' retired (`retire-sessions.ts`);
 * then the task. An eve that refuses a Stop, an agent with a turn still coming
 * that no Stop can name yet, or an agent started while the others were
 * stopped, leaves the task standing and refused.
 *
 * It takes the developer's bearer alone (`hostedBearerOnly`), because the
 * Stops and the retires reach eve over it: a browser's session cookie
 * carries none eve takes, so a cookie's delete of an idle task would go on
 * with every session of it left standing.
 */
const deleteEndpoint = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: TasksAppSeams,
  writer: Effect.Effect<StoreWriter>,
  request: Request,
  userId: string,
  taskId: string,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  yield* hostedBearerOnly(request);
  const agents = yield* hostedStoreOrUnavailable(
    listCodingAgents(userId, taskId, { includeArchived: true }),
  );
  yield* Effect.forEach(agents, (agent) => stoppedForGood(seams, writer, request, agent), {
    discard: true,
  });
  const stopped = new Set(agents.map(({ id }) => id));
  const deleted = yield* hostedStoreOrUnavailable(
    deleteTask(userId, taskId, {
      stoppedAgentIds: stopped,
      // Note that the sessions are retired under the task's lock and before its conversations are
      // cleared: eve's door admits no one to a cleared conversation's session, and a delete an
      // agent started meanwhile refuses retires nothing.
      beforeDelete: (conversationIds) =>
        Effect.flatMap(standingSessionsNamed(conversationIds), (sessions) =>
          retireSessions((mount) => eveFor(seams, request, mount), sessions),
        ),
    }).pipe(Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(undefined))),
  );
  // An agent started while the others were stopped is one this delete has not stopped yet.
  if (deleted === undefined) return yield* Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY);
  if (!deleted) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { deleted: true });
});

/** GET opens one task with its saved document; PATCH changes it; DELETE deletes it. */
const oneEndpoint = /* @__PURE__ */ Effect.fn("web/taskEndpoint")(function* (
  seams: TasksAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (!ONE_TASK_METHODS.has(incoming.method)) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.GET) {
    const opened = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
    if (Option.isNone(opened)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
      plan: opened.value.task,
    } satisfies TaskAnswer);
  }
  if (incoming.method === HTTP_METHOD.PATCH) {
    return yield* updateEndpoint(seams, writer, request, userId, taskId);
  }
  return yield* deleteEndpoint(seams, writer, request, userId, taskId);
});

/** GET reads the task's board; PUT writes the Mac's scene whole. */
const boardEndpoint = /* @__PURE__ */ Effect.fn("web/taskBoardEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET && incoming.method !== HTTP_METHOD.PUT) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  if (incoming.method === HTTP_METHOD.GET) {
    const board = yield* hostedStoreOrUnavailable(readBoard(userId, taskId));
    if (Option.isNone(board)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { board: board.value });
  }
  const body = yield* readJsonBodyEffect(MAXIMUM_BOARD_BODY_BYTES);
  const save = readEither(boardSaveRequestSchema)(body);
  if (Result.isFailure(save)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const written = yield* hostedStoreOrArchived(
    writeScene(
      userId,
      taskId,
      save.success.elements,
      save.success.appliedDrawing,
      save.success.image,
    ),
  );
  if (Option.isNone(written)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { board: written.value });
});

/** GET reads what was said on the task's calls. */
const transcriptEndpoint = /* @__PURE__ */ Effect.fn("web/taskTranscriptEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const transcript = yield* hostedStoreOrUnavailable(readTranscript(userId, taskId));
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

/** GET reads a page of the task's work, and on the newest page every code shown on it. */
const workEndpoint = /* @__PURE__ */ Effect.fn("web/taskWorkEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const before = yield* beforeTurnOf(request);
  const work = yield* hostedStoreOrUnavailable(readTaskWork(userId, taskId, before));
  if (Option.isNone(work)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, work.value);
});

/** The cursor a transcript read names, at most once, or none; refused where it names something else. */
const cursorQueryOf = /* @__PURE__ */ Effect.fnUntraced(function* (
  request: Request,
): Effect.fn.Return<string | undefined, HostedRefusal> {
  const named = new URL(request.url).searchParams.getAll(TRANSCRIPT_QUERY.AFTER);
  const [after] = named;
  if (after === undefined) return undefined;
  const read = readEither(codingAgentCursorSchema)(unparsedWire(after));
  if (named.length !== 1 || Result.isFailure(read)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  return read.success;
});

/** A page of a transcript as the wire answers it, the agent transcript's own shape, every field the page holds carried as it is; a brain conversation is named by its task, so it carries no title. */
function transcriptAnswer(
  page: BrainPage | TranscriptPage,
  title: string | null,
): HttpServerResponse.HttpServerResponse {
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {
    ...page,
    cursor: cursorToWire(page.cursor),
    title,
  });
}

/**
 * GET reads the task's brain conversation as a coding agent's transcript
 * is read: past the cursor, held while a turn or a worker runs; with no
 * cursor, its newest turns, or with `before` the turns queued before that
 * one. A task never planned on reads as an empty conversation.
 */
const messagesEndpoint = /* @__PURE__ */ Effect.fn("web/taskMessagesEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const after = yield* cursorQueryOf(request);
  const before = yield* beforeTurnOf(request);
  if (after !== undefined && before !== undefined) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }
  const task = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
  if (Option.isNone(task)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  const { conversationId } = task.value;
  if (conversationId === undefined) {
    return transcriptAnswer(
      { messages: [], cursor: CURSOR_START, status: CODING_AGENT_STATUS.COMPLETED },
      null,
    );
  }
  const target = { userId, conversationId };
  const page = yield* hostedStoreOrUnavailable(
    after === undefined
      ? brainTurnsPage(target, before)
      : brainPagePast(target, cursorOfWire(after)),
  );
  return transcriptAnswer(page, null);
});

/**
 * GET reads one brain worker's session past the cursor, as an agent's
 * worker's is read and on the same answer: the child conversation of the
 * task's conversation under the call that started the worker, held while it
 * runs, with its title once one landed. A worker whose session has written
 * nothing yet reads as starting, held for, so a tab opened the moment its
 * call was made keeps reading.
 */
const subagentMessagesEndpoint = /* @__PURE__ */ Effect.fn("web/taskSubagentMessagesEndpoint")(
  function* (
    seams: TasksAppSeams,
  ): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
    const incoming = yield* HttpServerRequest.HttpServerRequest;
    if (incoming.method !== HTTP_METHOD.GET) {
      return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
    }
    const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
    const taskId = yield* idOf(request, TASK_ID_QUERY);
    const call = readEither(codingAgentCallIdSchema)(
      unparsedWire(new URL(request.url).searchParams.get(TRANSCRIPT_QUERY.CALL) ?? ""),
    );
    if (Result.isFailure(call)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    const userId = yield* resolvedUserId(seams, request);
    const after = (yield* cursorQueryOf(request)) ?? CODING_AGENT_CURSOR_START;
    const task = yield* hostedStoreOrUnavailable(readTask(userId, taskId));
    if (Option.isNone(task) || task.value.conversationId === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    }
    const parent = { userId, conversationId: task.value.conversationId };
    const session = yield* hostedStoreOrUnavailable(brainWorkerSession(parent, call.success));
    if (session === undefined) {
      // A tab opens the moment its call is made, a step before the journal holds the call; past the turn, none is none for good.
      const status = yield* hostedStoreOrUnavailable(brainStatusNow(parent));
      if (status !== CODING_AGENT_STATUS.RUNNING)
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return transcriptAnswer(
        { messages: [], cursor: cursorOfWire(after), status: CODING_AGENT_STATUS.STARTING },
        null,
      );
    }
    const child = childConversationId(parent.conversationId, session);
    const createdAt = new Date(yield* Clock.currentTimeMillis);
    const page = yield* hostedStoreOrUnavailable(
      transcriptPast(
        { userId, conversationId: child },
        HOSTED_TOOL_SET,
        cursorOfWire(after),
        { createdAt },
        undefined,
        brainTitleAwaited(parent, child),
        BRAIN_POLL,
      ),
    );
    // The title is read after the page, since it lands beside the worker's start, which a held read may span.
    const titles = yield* hostedStoreOrUnavailable(childTitlesOf(parent, [child]));
    return transcriptAnswer(page, titles.get(child) ?? null);
  },
);

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
 * GET reads a page of the plan's history, the newest first. A task with no
 * history yet answers an empty page, and so does a task id the account does
 * not own, as `readTranscript` answers neither apart.
 */
const revisionsEndpoint = /* @__PURE__ */ Effect.fn("web/planRevisionsEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const before = yield* revisionSeqOf(request, BEFORE_TURN_QUERY);
  const page = yield* hostedStoreOrUnavailable(listRevisions(userId, taskId, before));
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, page);
});

/** GET reads one revision's content and the content before it. */
const revisionEndpoint = /* @__PURE__ */ Effect.fn("web/planRevisionEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.GET) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const seq = yield* namedRevisionOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const revision = yield* hostedStoreOrUnavailable(readRevision(userId, taskId, seq));
  if (Option.isNone(revision)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { revision: revision.value });
});

/** What a restore that saved nothing answers, by why; the store out of reach is any other. */
const RESTORE_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.NO_REVISION, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.TOO_LONG, HOSTED_REFUSAL.REQUEST_TOO_LARGE],
  [PLAN_SAVE_REFUSAL.ARCHIVED, HOSTED_REFUSAL.TASK_ARCHIVED],
]);

/**
 * POST puts one revision's content back as the plan's, a revision of the
 * developer's naming it, and answers the plan as it now stands. It names
 * nothing in a body: the task and the revision are the path's.
 */
const restoreEndpoint = /* @__PURE__ */ Effect.fn("web/taskRestoreEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const seq = yield* namedRevisionOf(request);
  const userId = yield* resolvedUserId(seams, request);
  const restored = yield* restoreRevision({ userId, taskId }, seq);
  if (restored.status !== PLAN_SAVE_STATUS.SAVED) {
    return yield* Effect.fail(RESTORE_REFUSAL.get(restored.reason) ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: restored.task } satisfies TaskAnswer);
});

/** What an edit that saved nothing answers, by why, where it is not answered in band; the store out of reach is any other. */
const EDIT_REFUSAL: ReadonlyMap<string, HostedRefusal> = new Map<string, HostedRefusal>([
  [PLAN_SAVE_REFUSAL.NO_TASK, HOSTED_REFUSAL.NOT_FOUND],
  [PLAN_SAVE_REFUSAL.ARCHIVED, HOSTED_REFUSAL.TASK_ARCHIVED],
]);

/**
 * POST saves the developer's edit of the task's document: answered with the
 * plan as saved, with the text as it now stands where the edit conflicts with it,
 * or as refused where the plan would be longer than a plan may be. An
 * archived task is refused outright, as no task is, since a desktop that
 * knows archiving draws no editor on one.
 */
const editEndpoint = /* @__PURE__ */ Effect.fn("web/planEditEndpoint")(function* (
  seams: TasksAppSeams,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const userId = yield* resolvedUserId(seams, request);
  const body = yield* readJsonBodyEffect(MAXIMUM_EDIT_BODY_BYTES);
  const edit = readEither(planEditRequestSchema)(body);
  if (Result.isFailure(edit)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const saved = yield* saveDeveloperEdit({ userId, taskId }, edit.success);
  switch (saved.status) {
    case PLAN_SAVE_STATUS.SAVED:
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { plan: saved.task } satisfies TaskAnswer);
    case PLAN_SAVE_STATUS.CONFLICT:
      return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { conflict: { current: saved.current } });
    case PLAN_SAVE_STATUS.NOT_SAVED:
      if (saved.reason === PLAN_SAVE_REFUSAL.TOO_LONG) {
        return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, { refused: PLAN_EDIT_REFUSAL.TOO_LONG });
      }
      return yield* Effect.fail(EDIT_REFUSAL.get(saved.reason) ?? HOSTED_REFUSAL.UNAVAILABLE);
  }
});

/** POST stops the turn Luke is running on the task, call or no call, under its conversation's owner, through eve on the developer's own bearer. */
const stopEndpoint = /* @__PURE__ */ Effect.fn("web/planStopEndpoint")(function* (
  seams: TasksAppSeams,
  writer: Effect.Effect<StoreWriter>,
): Effect.fn.Return<HttpServerResponse.HttpServerResponse, HostedRefusal, TasksServices> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST)
    return yield* Effect.fail(HOSTED_REFUSAL.METHOD_NOT_ALLOWED);
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const taskId = yield* idOf(request, TASK_ID_QUERY);
  const { conversationId } = yield* reachedTask(yield* resolvedUserId(seams, request), taskId);
  const owner = Option.getOrUndefined(
    conversationId === undefined
      ? Option.none()
      : yield* hostedStoreOrUnavailable(conversationOwnerOf(conversationId)),
  );
  if (conversationId === undefined || owner === undefined)
    return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {});
  const eve = yield* eveFor(seams, request, EVE_MOUNT.TASKS);
  const stopSeams = { store: hostedStore(), asks: askRecord(), writer: yield* writer, eve };
  const stopped = yield* hostedStoreOrUnavailable(
    stopConversation(stopSeams, owner, conversationId),
  );
  const refused =
    stopped !== undefined &&
    Result.isFailure(stopped) &&
    stopped.failure.refusal === STOP_REFUSAL.UPSTREAM;
  if (refused) return yield* Effect.fail(HOSTED_REFUSAL.UPSTREAM_ERROR);
  return hostedJsonResponse(HOSTED_HTTP_STATUS.OK, {});
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
  const writer = storeWriter({ tools: CODER_TOOL_SET });
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, TASKS_PATH.COLLECTION, hostedRefusing(collectionEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.ONE, hostedRefusing(oneEndpoint(seams, writer))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.BOARD, hostedRefusing(boardEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.TRANSCRIPT, hostedRefusing(transcriptEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.WORK, hostedRefusing(workEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.MESSAGES, hostedRefusing(messagesEndpoint(seams))),
    HttpRouter.add(
      ANY_METHOD,
      TASKS_PATH.SUBAGENT_MESSAGES,
      hostedRefusing(subagentMessagesEndpoint(seams)),
    ),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.CODE, hostedRefusing(codeEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.FILE, hostedRefusing(fileEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.TREE, hostedRefusing(treeEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.SKILLS, hostedRefusing(skillsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.REVISIONS, hostedRefusing(revisionsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.REVISION, hostedRefusing(revisionEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.RESTORE, hostedRefusing(restoreEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.EDIT, hostedRefusing(editEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.STOP, hostedRefusing(stopEndpoint(seams, writer))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.PAGES, hostedRefusing(pagesEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.PAGE, hostedRefusing(pageEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.ATTACHMENTS, hostedRefusing(attachmentsEndpoint(seams))),
    HttpRouter.add(ANY_METHOD, TASKS_PATH.ATTACHMENT, hostedRefusing(attachmentEndpoint(seams))),
    hostedNotFoundRoute,
  );
}
