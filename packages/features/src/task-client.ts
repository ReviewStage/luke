import {
  HTTP_METHOD,
  type UnparsedWireValue,
  unparsedWire,
  type WireBoundaryInput,
} from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  callAnswered,
} from "./account-call.js";
import type { Board, BoardElement } from "./board-wire.js";
import { startRefusedAs } from "./coding-agent-client.js";
import type { CodingAgentAgentAnswer } from "./coding-agent-view.js";
import { GITHUB_REPOSITORY_TREE_RECURSIVE } from "./contract/github.js";
import { TASK_FILE_QUERY_FLAG } from "./contract/task-files.js";
import type {
  GitHubRepositoriesAnswer,
  GitHubRepositoryIssueAnswer,
  GitHubRepositoryPullRequestAnswer,
} from "./github-repositories-wire.js";
import {
  askHosted,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  hostedClient,
} from "./hosted-link.js";
import { imageBodyOf } from "./image-body.js";
import type { PageLine, PageVersion } from "./page-wire.js";
import { pictureTypeSchema } from "./picture-wire.js";
import { PLAN_ATTACHMENT_REFUSAL } from "./plan-attachment-wire.js";
import {
  type PlanCommentActionRequest,
  type PlanCommentStartRequest,
  planCommentActionRequestSchema,
  planCommentStartRequestSchema,
  planCommentsAnswerSchema,
  planCommentThreadAnswerSchema,
} from "./plan-comment-wire.js";
import { type PlanEditAnswer, type PlanEditRequest, planEditRequestSchema } from "./plan-edit.js";
import {
  planAttachmentPath,
  planCommentsPath,
  planCommentThreadPath,
  type RepositoryPlace,
} from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import {
  type TaskSections,
  type TaskSectionWrite,
  taskSectionWriteSchema,
} from "./task-section-wire.js";
import {
  type PlanRevisionAnswer,
  type PlanRevisionsAnswer,
  type RepositoryPin,
  repositoryPinRequestSchema,
  TASK_LIST_ARCHIVED,
  type Task,
  type TaskCreateRequest,
  type TaskFileAnswer,
  type TaskFileRequest,
  type TaskListAnswer,
  type TaskRenameRequest,
  type TaskSkillsAnswer,
  type TaskStanding,
  type TaskStartAnswer,
  type TaskTreeAnswer,
  type TaskTreeRequest,
  type TaskUpdateRequest,
  taskCreateRequestSchema,
  taskFileRequestSchema,
  taskRenameRequestSchema,
  taskTreeRequestSchema,
  taskUpdateRequestSchema,
} from "./task-wire.js";
import {
  PICTURE_KEEP_FAILURE,
  PLAN_COMMENT_CALL_FAILURE,
  type RepositoryCallFailure,
  type RepositoryListFailure,
  type StartCallFailure,
  TASK_CALL_FAILURE,
  type TaskCallFailure,
  type TaskCodeAnswer,
  type TasksCommentAnswer,
  type TasksCommentsAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TaskWorkAnswer,
} from "./tasks-view.js";
import type { TaskTranscript } from "./transcript-wire.js";

/**
 * task-client.ts -- the Tasks tab's side of the named tasks, as the host asks the service for them.
 *
 * Every call is the one account call, so the bearer is read fresh per attempt
 * and a 401 is renewed and retried once. What the window has to say about a
 * call that did not answer is one of a few reasons: the service never
 * answered, the task is gone, or, on a call that names a repository, GitHub's
 * reach refused it.
 */

/** A started task, and, where the start named an agent, the agent started on it or why it was not, as an agent's Start answers. */
export interface TaskStarted {
  readonly task: Task;
  readonly agent?: CodingAgentAgentAnswer;
}

/** One call's answer, or why there is none. */
export type TaskCallResult<Answer, Failure> =
  | { readonly ok: true; readonly answer: Answer }
  | { readonly ok: false; readonly failure: Failure };

export interface HostedTaskClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** How long a held read may stand: the service's hold, and room for the answer to travel after it. */
const HELD_READ_TIMEOUT_MS = 35_000;

/** A comment call that answered nothing to draw. */
const COMMENT_UNANSWERED = { failure: PLAN_COMMENT_CALL_FAILURE.UNANSWERED } as const;

/** A comment call refused because the plan is not the account's to read or write. */
const COMMENT_NOT_FOUND = { failure: PLAN_COMMENT_CALL_FAILURE.NOT_FOUND } as const;

/** What a task's pin and archive change names: pinned or not, where the pin stands, archived or not, or both. */
export type TaskMarks = Pick<TaskUpdateRequest, "pinned" | "pinPosition" | "archived">;

function succeeded<Answer>(answer: Answer) {
  return { ok: true, answer } as const;
}

/** The refusals a call that names a repository can answer with, by the service's own word for each. */
const REPOSITORY_REFUSALS = {
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
} as const;

/** The refusals a start can answer with: a repository out of reach, or the Linear issue it was to start from unread. */
const START_REFUSALS = {
  ...REPOSITORY_REFUSALS,
  [HOSTED_API_ERROR.LINEAR_UNAVAILABLE]: TASK_CALL_FAILURE.LINEAR_UNAVAILABLE,
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
} as const;

/** The refusals a move can answer with: the task or the workspace not the account's, the task archived, or the workspace not reaching its repository. */
const MOVE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.TASK_ARCHIVED]: TASK_CALL_FAILURE.TASK_ARCHIVED,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
} as const;

/** The refusal a read of one of the plan's own rows can answer with: the plan or the row not the account's. */
const NOT_FOUND_REFUSAL = {
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
} as const;

/** A procedure's answer as a result: its refusal where it is one the caller names, unanswered for everything else. */
function hostedResult<Answer, Failure extends TaskCallFailure>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  named: Readonly<Partial<Record<HostedApiError, Failure>>>,
): Effect.Effect<
  TaskCallResult<Answer, Failure | typeof TASK_CALL_FAILURE.UNANSWERED>,
  never,
  HttpClient.HttpClient
> {
  return Effect.match(asked, {
    onSuccess: succeeded,
    onFailure: (failed) => {
      const failure = failed._tag === "HostedRefused" ? named[failed.refusal] : undefined;
      return failure === undefined ? UNANSWERED : ({ ok: false, failure } as const);
    },
  });
}

/** A procedure's answer, or nothing where it reached none. */
function orNothing<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | undefined, never, HttpClient.HttpClient> {
  return Effect.orElseSucceed(asked, () => undefined);
}

/** The refusal a refused answer carries, where it is one the caller names; unanswered otherwise. */
function refusedAs<Failure extends TaskCallFailure>(
  payload: UnparsedWireValue,
  named: Readonly<Partial<Record<HostedApiError, Failure>>>,
): TaskCallResult<never, Failure | typeof TASK_CALL_FAILURE.UNANSWERED> {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

/**
 * The Tasks tab's reads and its writes of the service: the list of tasks,
 * one task opened with its document, the repositories the account reaches,
 * and a task started, renamed, given its repository, pinned, archived, or deleted. Each
 * resolves to a result rather than failing, because every caller does the
 * same thing with a failure: draws why, and offers to try again.
 */
export class HostedTaskClient {
  readonly #call: AccountCallEffects;
  readonly #held: AccountCallEffects;
  readonly #hosted: HostedClient;

  constructor(options: HostedTaskClientOptions) {
    const { credential } = options;
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#call = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#held = accountCall({
      baseUrl: options.serviceBaseUrl,
      credential,
      requestTimeoutMs: HELD_READ_TIMEOUT_MS,
    });
  }

  /** The plan's comment threads past the cursor, held by the service while nothing changed; not found where the plan is not the account's. */
  comments(
    planId: string,
    after: string,
  ): Effect.Effect<TasksCommentsAnswer, never, HttpClient.HttpClient> {
    const send = this.#held.send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.GET,
        path: planCommentsPath(planId, after),
      });
      if (!callAnswered(answer)) return COMMENT_UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) return commentRefusal(payload);
      return (
        Result.getOrUndefined(readServiceAnswer(planCommentsAnswerSchema)(payload)) ??
        COMMENT_UNANSWERED
      );
    });
  }

  /** A thread started on the plan with its first comment, answered as it stands, or why not; a request the service would refuse by shape travels nowhere. */
  startComment(
    planId: string,
    request: PlanCommentStartRequest,
  ): Effect.Effect<TasksCommentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planCommentStartRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(COMMENT_UNANSWERED);
    return this.#commentWrite(planCommentsPath(planId), admitted);
  }

  /** One thing done to one thread of the plan, answered with the thread as it stands, its deletion, or why not. */
  actOnComment(
    planId: string,
    threadId: string,
    request: PlanCommentActionRequest,
  ): Effect.Effect<TasksCommentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(planCommentActionRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(COMMENT_UNANSWERED);
    return this.#commentWrite(planCommentThreadPath(planId, threadId), admitted);
  }

  /** A write to the plan's comments, its answer read as the thread answer's wire has it. */
  #commentWrite(
    path: string,
    body: PlanCommentStartRequest | PlanCommentActionRequest,
  ): Effect.Effect<TasksCommentAnswer, never, HttpClient.HttpClient> {
    const send = this.#call.send;
    return Effect.gen(function* () {
      const answer = yield* send({ method: HTTP_METHOD.POST, path, body: JSON.stringify(body) });
      if (!callAnswered(answer)) return COMMENT_UNANSWERED;
      const payload = unparsedWire(yield* jsonOf(answer.response));
      if (!answer.response.ok) return commentRefusal(payload);
      return (
        Result.getOrUndefined(readServiceAnswer(planCommentThreadAnswerSchema)(payload)) ??
        COMMENT_UNANSWERED
      );
    });
  }

  /** Every plan the account owns, newest started first, and every agent with no plan in its workspaces, the archived ones of each among them. */
  list(): Effect.Effect<
    TaskCallResult<TaskListAnswer, typeof TASK_CALL_FAILURE.UNANSWERED>,
    never,
    HttpClient.HttpClient
  > {
    return hostedResult(
      askHosted(this.#hosted.plans.list, { archived: TASK_LIST_ARCHIVED.INCLUDE }),
      {},
    );
  }

  /** One task with its saved document; opening it moves no row of the list. */
  open(
    taskId: string,
  ): Effect.Effect<TaskCallResult<Task, TaskCallFailure>, never, HttpClient.HttpClient> {
    return hostedResult(
      Effect.map(askHosted(this.#hosted.plans.open, { id: taskId }), (opened) => opened.plan),
      NOT_FOUND_REFUSAL,
    );
  }

  /**
   * Saves the developer's edit of the document, answering the task as saved,
   * the text as it now stands where the edit no longer lands in it, or why
   * it was refused; or why there is no answer: the service did not answer,
   * the task is gone, or it is archived. An edit the service would refuse by shape is
   * refused here without traveling at all.
   */
  edit(
    taskId: string,
    edit: PlanEditRequest,
  ): Effect.Effect<
    TaskCallResult<
      PlanEditAnswer,
      | typeof TASK_CALL_FAILURE.UNANSWERED
      | typeof TASK_CALL_FAILURE.NOT_FOUND
      | typeof TASK_CALL_FAILURE.TASK_ARCHIVED
    >,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(readEither(planEditRequestSchema)(edit));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.plans.edit, { params: { id: taskId }, body: admitted }),
      {
        [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
        [HOSTED_API_ERROR.TASK_ARCHIVED]: TASK_CALL_FAILURE.TASK_ARCHIVED,
      },
    );
  }

  /**
   * The repositories the account reaches through the Luke GitHub App, or
   * only those of the installation the workspace given stands for, with
   * whether the App is installed anywhere for it and where to install it;
   * or why there is none: the service did not answer.
   */
  repositories(
    workspaceId?: string,
  ): Effect.Effect<
    TaskCallResult<GitHubRepositoriesAnswer, RepositoryListFailure>,
    never,
    HttpClient.HttpClient
  > {
    return Effect.match(
      askHosted(this.#hosted.github.repositories, workspaceId === undefined ? {} : { workspaceId }),
      { onSuccess: succeeded, onFailure: () => UNANSWERED },
    );
  }

  /**
   * Gives one task its repository, or takes it away with null, answering
   * the task as changed; or why it is unchanged: the service did not answer,
   * or the App does not reach that repository for the account. A name the service would refuse by shape
   * is refused here without traveling at all.
   */
  setRepository(
    taskId: string,
    repository: string | null,
  ): Effect.Effect<TaskCallResult<Task, RepositoryCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)({ repository }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(this.#update(taskId, admitted), REPOSITORY_REFUSALS);
  }

  /**
   * Moves one task to another of the account's workspaces, answering the
   * task as moved; or why it stands where it was: the service did not
   * answer, the task or the workspace is not the account's to move it to,
   * the task is archived, or the workspace does not reach its repository.
   */
  move(
    taskId: string,
    workspaceId: string,
  ): Effect.Effect<TaskCallResult<Task, TaskCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)({ workspaceId }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(this.#update(taskId, admitted), MOVE_REFUSALS);
  }

  /** One task's whiteboard as it stands; nothing where the service did not answer one. */
  readBoard(taskId: string): Effect.Effect<Board | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      Effect.map(askHosted(this.#hosted.plans.readBoard, { id: taskId }), (answer) => answer.board),
    );
  }

  /** What was said on one task's calls; nothing where the service did not answer it. */
  readTranscript(
    taskId: string,
  ): Effect.Effect<TaskTranscript | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      Effect.map(
        askHosted(this.#hosted.plans.transcript, { id: taskId }),
        (answer) => answer.transcript,
      ),
    );
  }

  /** A page of one task's work as the service keeps it, the newest or the one before a turn, with every code shown on the newest; nothing where the service did not answer it. */
  readWork(
    taskId: string,
    before?: string,
  ): Effect.Effect<TaskWorkAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.plans.work, {
        id: taskId,
        ...(before === undefined ? undefined : { before }),
      }),
    );
  }

  /** Every code Luke showed on one task, oldest first; nothing where the service did not answer it. */
  readCode(
    taskId: string,
  ): Effect.Effect<TaskCodeAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(askHosted(this.#hosted.taskFiles.code, { id: taskId }));
  }

  /**
   * One window of a file of the task's repository as GitHub holds it now,
   * or why it is not shown; nothing where the service did not answer, or
   * where the window asked is not one the wire admits.
   */
  readFile(
    taskId: string,
    window: TaskFileRequest,
  ): Effect.Effect<TaskFileAnswer | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskFileRequestSchema)(window));
    if (admitted === undefined) return Effect.succeed(undefined);
    return orNothing(
      askHosted(this.#hosted.taskFiles.file, {
        id: taskId,
        path: admitted.path,
        first: String(admitted.firstLine),
        last: String(admitted.lastLine),
        ...(admitted.raw === true ? { raw: TASK_FILE_QUERY_FLAG } : undefined),
        ...(admitted.ref === undefined ? undefined : { ref: admitted.ref }),
      }),
    );
  }

  /**
   * One folder of the task's repository as GitHub holds it now, or why it
   * is not listed; nothing where the service did not answer, or where the
   * folder asked is not one the wire admits.
   */
  readTree(
    taskId: string,
    folder: TaskTreeRequest,
  ): Effect.Effect<TaskTreeAnswer | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskTreeRequestSchema)(folder));
    if (admitted === undefined) return Effect.succeed(undefined);
    return orNothing(
      askHosted(this.#hosted.taskFiles.tree, {
        id: taskId,
        ...(admitted.path === "" ? undefined : { path: admitted.path }),
        ...(admitted.recursive === true ? { recursive: TASK_FILE_QUERY_FLAG } : undefined),
      }),
    );
  }

  /** The skills a developer may choose of the task's repository as GitHub holds it now, or why they are not read; nothing where the service did not answer. */
  readSkills(
    taskId: string,
  ): Effect.Effect<TaskSkillsAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(askHosted(this.#hosted.taskFiles.skills, { id: taskId }));
  }

  /**
   * One folder of a repository the workspace's installation reaches, as
   * `readTree` reads a plan's, for a place with no plan to name it by;
   * nothing where the service did not answer, or where the folder asked is
   * not one the wire admits.
   */
  readRepositoryTree(
    place: RepositoryPlace,
    folder: TaskTreeRequest,
  ): Effect.Effect<TaskTreeAnswer | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskTreeRequestSchema)(folder));
    if (admitted === undefined) return Effect.succeed(undefined);
    return orNothing(
      askHosted(this.#hosted.github.repositoryTree, {
        ...place,
        ...(admitted.path === "" ? undefined : { path: admitted.path }),
        ...(admitted.recursive === true
          ? { recursive: GITHUB_REPOSITORY_TREE_RECURSIVE }
          : undefined),
      }),
    );
  }

  /** The skills a developer may choose of a repository the workspace's installation reaches, as `readSkills` reads a plan's; nothing where the service did not answer. */
  readRepositorySkills(
    place: RepositoryPlace,
  ): Effect.Effect<TaskSkillsAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(askHosted(this.#hosted.github.repositorySkills, { ...place }));
  }

  /** One pull request of a repository the workspace's installation reaches, by its number, or null where there is none to draw; nothing where the service did not answer. */
  readRepositoryPullRequest(
    place: RepositoryPlace,
    number: number,
  ): Effect.Effect<GitHubRepositoryPullRequestAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.github.repositoryPullRequest, { ...place, number: String(number) }),
    );
  }

  /** One issue of a repository the workspace's installation reaches, by its number, or null where there is none to draw; nothing where the service did not answer. */
  readRepositoryIssue(
    place: RepositoryPlace,
    number: number,
  ): Effect.Effect<GitHubRepositoryIssueAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.github.repositoryIssue, { ...place, number: String(number) }),
    );
  }

  /** A page of one plan's history, the newest or the one before a revision; nothing where the service did not answer it. */
  readRevisions(
    taskId: string,
    before?: number,
  ): Effect.Effect<PlanRevisionsAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.plans.revisions, {
        id: taskId,
        ...(before === undefined ? undefined : { before: String(before) }),
      }),
    );
  }

  /** One revision of one plan beside the one before it; nothing where the service did not answer it, or holds no such revision. */
  readRevision(
    taskId: string,
    seq: number,
  ): Effect.Effect<PlanRevisionAnswer["revision"] | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      Effect.map(
        askHosted(this.#hosted.plans.revision, { id: taskId, seq: String(seq) }),
        (answer) => answer.revision,
      ),
    );
  }

  /**
   * One picture of one plan, fetched under the account: its bytes in base64
   * under its media type, where the service answered with a type a picture
   * may be; not found where the plan is not one the account reaches or holds
   * no such picture; unanswered for anything else, another media type
   * included, so nothing a window draws is a type it did not expect.
   */
  readPicture(
    taskId: string,
    attachmentId: string,
  ): Effect.Effect<TasksPictureAnswer, never, HttpClient.HttpClient> {
    const send = this.#call.send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.GET,
        path: planAttachmentPath(taskId, attachmentId),
      });
      if (!callAnswered(answer)) return { failure: TASK_CALL_FAILURE.UNANSWERED };
      if (!answer.response.ok) {
        const refused = refusedAs(unparsedWire(yield* jsonOf(answer.response)), NOT_FOUND_REFUSAL);
        return { failure: refused.ok ? TASK_CALL_FAILURE.UNANSWERED : refused.failure };
      }
      const picture = yield* imageBodyOf(answer.response, pictureTypeSchema);
      return picture ?? { failure: TASK_CALL_FAILURE.UNANSWERED };
    });
  }

  /**
   * One picture kept on one plan, sent as the `data:` URL the Mac made of
   * it: the id the plan's text then names it by; too many where the plan
   * holds its bound; not found where the plan is not one the account may
   * write, an archived one among them; unanswered for anything else.
   */
  keepPicture(
    taskId: string,
    picture: string,
  ): Effect.Effect<TasksPictureKeepAnswer, never, HttpClient.HttpClient> {
    return Effect.match(
      askHosted(this.#hosted.taskFiles.keepPicture, {
        params: { id: taskId },
        body: { picture },
      }),
      {
        onFailure: (failed): TasksPictureKeepAnswer =>
          failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.NOT_FOUND
            ? { failure: TASK_CALL_FAILURE.NOT_FOUND }
            : { failure: PICTURE_KEEP_FAILURE.UNANSWERED },
        onSuccess: ({ body: kept }): TasksPictureKeepAnswer =>
          "id" in kept
            ? { id: kept.id }
            : {
                failure:
                  kept.refused === PLAN_ATTACHMENT_REFUSAL.TOO_MANY
                    ? PICTURE_KEEP_FAILURE.TOO_MANY
                    : PICTURE_KEEP_FAILURE.UNANSWERED,
              },
      },
    );
  }

  /** One plan's pages, each by its newest version; nothing where the service did not answer them. */
  readPages(
    taskId: string,
  ): Effect.Effect<readonly PageLine[] | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      orNothing(askHosted(this.#hosted.taskFiles.pages, { id: taskId })),
      (answer) => answer?.pages,
    );
  }

  /** One version of one page of one plan, with its HTML; nothing where the service did not answer it, or holds no such version. */
  readPageVersion(
    taskId: string,
    pageId: string,
    version: number,
  ): Effect.Effect<PageVersion | undefined, never, HttpClient.HttpClient> {
    return Effect.map(
      orNothing(
        askHosted(this.#hosted.taskFiles.page, {
          id: taskId,
          page: pageId,
          version: String(version),
        }),
      ),
      (answer) => answer?.page,
    );
  }

  /** Stops the turn Luke is running on a task. */
  stopWork(taskId: string): Effect.Effect<void, never, HttpClient.HttpClient> {
    return Effect.ignore(askHosted(this.#hosted.plans.stop, { id: taskId }));
  }

  /** Puts one revision of a plan back as its content, answering the task as it now stands, or nothing where the service did not restore it. */
  restore(
    taskId: string,
    seq: number,
  ): Effect.Effect<Task | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      Effect.map(
        askHosted(this.#hosted.plans.restore, { id: taskId, seq: String(seq) }),
        (answer) => answer.plan,
      ),
    );
  }

  /** The board's scene written whole, with the number of Luke's drawing it holds and, when it is the first to hold it, the scene's image; the board as written, or nothing where the service did not answer. */
  saveBoard(
    taskId: string,
    elements: readonly BoardElement[],
    appliedDrawing: number,
    image?: string,
  ): Effect.Effect<Board | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      Effect.map(
        askHosted(this.#hosted.plans.saveBoard, {
          params: { id: taskId },
          body: { elements, appliedDrawing, ...(image === undefined ? undefined : { image }) },
        }),
        (answer) => answer.board,
      ),
    );
  }

  /** Deletes one task with its document and its conversation; whether the service deleted it. */
  delete(taskId: string): Effect.Effect<boolean, never, HttpClient.HttpClient> {
    return Effect.match(askHosted(this.#hosted.plans.delete, { id: taskId }), {
      onFailure: () => false,
      onSuccess: (answer) => answer.deleted,
    });
  }

  /**
   * Renames one task, answering it as renamed with its document, or nothing
   * where the service did not rename it; a name the service would refuse by
   * shape is refused here without traveling at all.
   */
  rename(
    taskId: string,
    request: TaskRenameRequest,
  ): Effect.Effect<Task | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(undefined);
    return orNothing(this.#update(taskId, admitted));
  }

  /**
   * Sets where one task stands, how much it matters, or both, answering it as
   * changed with its document, or nothing where the service did not change
   * it; a change that names neither never travels.
   */
  setStanding(
    taskId: string,
    standing: TaskStanding,
  ): Effect.Effect<Task | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)(standing));
    if (admitted === undefined) return Effect.succeed(undefined);
    return orNothing(this.#update(taskId, admitted));
  }

  /**
   * Pins or unpins one task, archives it or brings it back, answering it as
   * changed with its document, or nothing where the service did not change
   * it; a change that names neither never travels.
   */
  mark(
    taskId: string,
    marks: TaskMarks,
  ): Effect.Effect<Task | undefined, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)(marks));
    if (admitted === undefined) return Effect.succeed(undefined);
    return orNothing(this.#update(taskId, admitted));
  }

  /** One plan changed as the request names, answered as changed. */
  #update(
    taskId: string,
    changes: TaskUpdateRequest,
  ): Effect.Effect<Task, HostedFailure, HttpClient.HttpClient> {
    return Effect.map(
      askHosted(this.#hosted.plans.update, { params: { id: taskId }, body: changes }),
      (changed) => changed.plan,
    );
  }

  /** The repositories the account pinned in the sidebar, newest pinned first; nothing where the service did not answer. */
  repositoryPins(): Effect.Effect<
    readonly RepositoryPin[] | undefined,
    never,
    HttpClient.HttpClient
  > {
    return Effect.map(
      orNothing(askHosted(this.#hosted.repositoryPins.list, undefined)),
      (answer) => answer?.pins,
    );
  }

  /**
   * Pins one repository or unpins it, answering the account's pins as they
   * then stand; nothing where the service refused or did not answer. A
   * repository the wire would refuse by shape never travels.
   */
  pinRepository(
    repository: string,
    pinned: boolean,
  ): Effect.Effect<readonly RepositoryPin[] | undefined, never, HttpClient.HttpClient> {
    const asked = Result.getOrUndefined(
      readEither(repositoryPinRequestSchema)({ repository, pinned }),
    );
    if (asked === undefined) return Effect.succeed(undefined);
    return Effect.map(
      orNothing(askHosted(this.#hosted.repositoryPins.set, asked)),
      (answer) => answer?.pins,
    );
  }

  /** The sections the account made in its sidebars and the tasks in them; nothing where the service did not answer. */
  taskSections(): Effect.Effect<TaskSections | undefined, never, HttpClient.HttpClient> {
    return orNothing(askHosted(this.#hosted.taskSections.list, undefined));
  }

  /**
   * Writes one change to the account's sections, answering them all as they
   * then stand; nothing where the service refused or did not answer. A
   * write the wire would refuse by shape never travels.
   */
  writeTaskSection(
    write: TaskSectionWrite,
  ): Effect.Effect<TaskSections | undefined, never, HttpClient.HttpClient> {
    const asked = Result.getOrUndefined(readEither(taskSectionWriteSchema)(write));
    if (asked === undefined) return Effect.succeed(undefined);
    return orNothing(askHosted(this.#hosted.taskSections.write, asked));
  }

  /**
   * Starts a task from the account's template, on the repository the
   * request names where it names one, and the agent it names on it where it
   * names one; a request the service would refuse by shape is refused here
   * without traveling at all, and a repository the service refused is
   * answered as the refusal it was. An agent the service refused beside the
   * task it made is answered with the task, as a refused Start reads.
   */
  create(
    request: TaskCreateRequest,
  ): Effect.Effect<TaskCallResult<TaskStarted, StartCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskCreateRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    // Note that a start naming an agent waits as an agent's Start does, since it opens the agent's session too.
    const deadline = admitted.agent === undefined ? HOSTED_DEADLINE.USUAL : HOSTED_DEADLINE.START;
    return hostedResult(
      Effect.map(askHosted(this.#hosted.plans.create, admitted, deadline), (started) =>
        taskStartedOf(started.body),
      ),
      START_REFUSALS,
    );
  }
}

/** A started task as the service answered it, with the agent started on it, or why it was not, where one was asked for. */
function taskStartedOf(started: TaskStartAnswer): TaskStarted {
  if (started.agent !== undefined) return { task: started.plan, agent: { agent: started.agent } };
  if (started.agentRefusal !== undefined) {
    return { task: started.plan, agent: startRefusedAs(started.agentRefusal) };
  }
  return { task: started.plan };
}

/** A refused comment call: not found where the service said so, unanswered for anything else. */
function commentRefusal(payload: UnparsedWireValue) {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  return refusal === HOSTED_API_ERROR.NOT_FOUND ? COMMENT_NOT_FOUND : COMMENT_UNANSWERED;
}

/** A response's body as JSON, or nothing where it is not JSON at all. */
function jsonOf(response: Response): Effect.Effect<WireBoundaryInput> {
  return Effect.promise((): Promise<WireBoundaryInput> => response.json().catch(() => undefined));
}
