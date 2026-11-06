import { HTTP_METHOD, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  type AccountCallEffects,
  accountCall,
  type CallCredential,
  callAnswered,
  jsonOf,
} from "./account-call.js";
import { type BrowserTabsPlace, browserTabsPlaceId } from "./agent-browser-tab-wire.js";
import { startRefusedAs } from "./agent-client.js";
import type { AgentAgentAnswer } from "./agent-view.js";
import type { LocalAgentRefusal } from "./agent-wire.js";
import { GITHUB_REPOSITORY_TREE_RECURSIVE } from "./contract/github.js";
import { TASK_FILE_QUERY_FLAG } from "./contract/task-files.js";
import type { FailureFacts } from "./failure-facts.js";
import type {
  GitHubRepositoriesAnswer,
  GitHubRepositoryIssueAnswer,
  GitHubRepositoryPullRequestAnswer,
} from "./github-repositories-wire.js";
import {
  askHosted,
  askLive,
  HOSTED_DEADLINE,
  type HostedClient,
  type HostedFailure,
  hostedClient,
  hostedFailureFacts,
} from "./hosted-link.js";
import { imageBodyOf } from "./image-body.js";
import { WRITE_UNTAKEN, type WriteUntaken, writeUntakenOf } from "./keyed-write.js";
import {
  LIVE_POLL,
  LIVE_SIGNED_OUT,
  LIVE_USER_QUERY,
  type TaskBrowserTabsLiveAnswer,
  type TaskHistoryLiveAnswer,
  type TaskPagesLiveAnswer,
  type TaskRecordLiveAnswer,
} from "./live-wire.js";
import { type PagePlace, type PageVersion, pagePlaceId } from "./page-wire.js";
import {
  DESCRIPTION_ATTACHMENT_REFUSAL,
  descriptionAttachmentTypeSchema,
} from "./description-attachment-wire.js";
import type { TaskCommentsLiveAnswer } from "./description-comment-live.js";
import {
  type DescriptionCommentActionRequest,
  type DescriptionCommentStart,
  descriptionCommentActionRequestSchema,
  descriptionCommentStartRequestSchema,
} from "./description-comment-wire.js";
import {
  type DescriptionEditAnswer,
  type DescriptionEditRequest,
  descriptionEditRequestSchema,
} from "./description-edit.js";
import {
  descriptionAttachmentPath,
  type RepositoryPlace,
  type SkillsPlace,
} from "./service-paths.js";
import {
  HOSTED_API_ERROR,
  type HostedApiError,
  hostedErrorSchema,
  readServiceAnswer,
} from "./service-wire.js";
import type { SidebarLiveAnswer } from "./sidebar-live.js";
import type { TaskListLiveAnswer } from "./task-list-live.js";
import {
  type TaskSectionsWritten,
  type TaskSectionWrite,
  taskSectionWriteSchema,
} from "./task-section-wire.js";
import {
  type DescriptionRevisionAnswer,
  type DescriptionRevisionsAnswer,
  type RepositoryPinsWritten,
  repositoryPinRequestSchema,
  TASK_LIST_ARCHIVED,
  TASK_SKILLS_INSTALLED,
  type Task,
  type TaskBlockRequest,
  type TaskCreateRequest,
  type TaskFileAnswer,
  type TaskFileRequest,
  type TaskListAnswer,
  type TaskParentRequest,
  type TaskRelationChangeRequest,
  type TaskRenameRequest,
  type TaskSkillsAnswer,
  type TaskStanding,
  type TaskStartAnswer,
  type TaskTreeAnswer,
  type TaskTreeRequest,
  type TaskUpdateRequest,
  taskBlockRequestSchema,
  taskCreateRequestSchema,
  taskFileRequestSchema,
  taskParentRequestSchema,
  taskRelationChangeRequestSchema,
  taskRenameRequestSchema,
  taskTreeRequestSchema,
  taskUpdateRequestSchema,
} from "./task-wire.js";
import {
  type BlockCallFailure,
  BROWSER_TAB_OPEN_FAILURE,
  type BrowserTabOpenFailure,
  type ParentCallFailure,
  PICTURE_KEEP_FAILURE,
  DESCRIPTION_COMMENT_CALL_FAILURE,
  type RelationCallFailure,
  type RepositoryCallFailure,
  type RepositoryListFailure,
  type StartCallFailure,
  TASK_BLOCK_FAILURE,
  TASK_CALL_FAILURE,
  TASK_PARENT_FAILURE,
  type TaskCallFailure,
  type TasksBrowserTabOpenAnswer,
  type TasksBrowserTabOpenParams,
  type TasksCommentAnswer,
  type TasksCommentsFollow,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
} from "./tasks-view.js";

export interface TaskStarted {
  readonly task: Task;
  readonly agent?: AgentAgentAnswer;
  readonly txid?: string;
}

export interface TaskWritten {
  readonly task: Task;
  readonly txid?: string;
}

export type TaskCallResult<Answer, Failure> =
  | { readonly ok: true; readonly answer: Answer }
  | {
      readonly ok: false;
      readonly failure: Failure;
      readonly localAgentRefusal?: LocalAgentRefusal;
      readonly untaken?: WriteUntaken;
      readonly cause?: FailureFacts;
    };

export interface HostedTaskClientOptions {
  credential: CallCredential;
  serviceBaseUrl: string;
  requestTimeoutMs?: number;
}

const UNANSWERED = { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED } as const;

const KEEP_REFUSED = {
  [DESCRIPTION_ATTACHMENT_REFUSAL.TOO_MANY]: PICTURE_KEEP_FAILURE.TOO_MANY,
  [DESCRIPTION_ATTACHMENT_REFUSAL.TOO_MANY_VIDEOS]: PICTURE_KEEP_FAILURE.TOO_MANY_VIDEOS,
} as const satisfies Record<
  (typeof DESCRIPTION_ATTACHMENT_REFUSAL)[keyof typeof DESCRIPTION_ATTACHMENT_REFUSAL],
  (typeof PICTURE_KEEP_FAILURE)[keyof typeof PICTURE_KEEP_FAILURE]
>;

const COMMENT_UNANSWERED = { failure: DESCRIPTION_COMMENT_CALL_FAILURE.UNANSWERED } as const;

const COMMENT_NOT_FOUND = { failure: DESCRIPTION_COMMENT_CALL_FAILURE.NOT_FOUND } as const;

export type TaskMarks = Pick<TaskUpdateRequest, "pinned" | "pinPosition" | "readMark">;

function succeeded<Answer>(answer: Answer) {
  return { ok: true, answer } as const;
}

const REPOSITORY_REFUSALS = {
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
} as const;

const START_REFUSALS = {
  ...REPOSITORY_REFUSALS,
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: TASK_CALL_FAILURE.LOCAL_AGENT_REFUSED,
  [HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED]: TASK_PARENT_FAILURE.REPOSITORY_DIFFERS,
  [HOSTED_API_ERROR.TASK_PARENT_HELD]: TASK_PARENT_FAILURE.HELD,
} as const;

const MOVE_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
} as const;

const BLOCK_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.INVALID_REQUEST]: TASK_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.TASK_BLOCK_CYCLE]: TASK_BLOCK_FAILURE.CYCLE,
} as const;

const PARENT_REFUSALS = {
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
  [HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED]: TASK_PARENT_FAILURE.REPOSITORY_DIFFERS,
  [HOSTED_API_ERROR.TASK_PARENT_CYCLE]: TASK_PARENT_FAILURE.CYCLE,
} as const;

const RELATION_REFUSALS = { ...BLOCK_REFUSALS, ...PARENT_REFUSALS } as const;

const NOT_FOUND_REFUSAL = {
  [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
} as const;

const LIVE_REFUSALS = {
  ...NOT_FOUND_REFUSAL,
  [HOSTED_API_ERROR.INVALID_TOKEN]: LIVE_SIGNED_OUT.failure,
} as const;

function writtenOf(changed: { readonly plan: Task; readonly txid?: string }): TaskWritten {
  return changed.txid === undefined
    ? { task: changed.plan }
    : { task: changed.plan, txid: changed.txid };
}

function hostedRefusal<Failure extends string>(
  failed: HostedFailure,
  named: Readonly<Partial<Record<HostedApiError, Failure>>>,
) {
  const failure = failed._tag === "HostedRefused" ? named[failed.refusal] : undefined;
  if (failed._tag !== "HostedRefused" || failure === undefined) {
    return { ...UNANSWERED, cause: hostedFailureFacts(failed) };
  }
  const localAgentRefusal = failed.data?.localAgentRefusal;
  return localAgentRefusal === undefined
    ? ({ ok: false, failure } as const)
    : ({ ok: false, failure, localAgentRefusal } as const);
}

function hostedResult<Answer, Failure extends string>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
  named: Readonly<Partial<Record<HostedApiError, Failure>>>,
): Effect.Effect<
  TaskCallResult<Answer, Failure | typeof TASK_CALL_FAILURE.UNANSWERED>,
  never,
  HttpClient.HttpClient
> {
  return Effect.match(asked, {
    onSuccess: succeeded,
    onFailure: (failed) => hostedRefusal(failed, named),
  });
}

const BROWSER_TAB_OPEN_REFUSALS = new Map<HostedApiError, BrowserTabOpenFailure>([
  [HOSTED_API_ERROR.NOT_FOUND, BROWSER_TAB_OPEN_FAILURE.NOT_FOUND],
  [HOSTED_API_ERROR.NOT_PERMITTED, BROWSER_TAB_OPEN_FAILURE.NOT_PERMITTED],
  [HOSTED_API_ERROR.INVALID_REQUEST, BROWSER_TAB_OPEN_FAILURE.INVALID_ADDRESS],
  [HOSTED_API_ERROR.AGENT_NOT_READY, BROWSER_TAB_OPEN_FAILURE.NOT_READY],
  [HOSTED_API_ERROR.AGENT_RETIRED, BROWSER_TAB_OPEN_FAILURE.RETIRED],
  [HOSTED_API_ERROR.UPSTREAM_ERROR, BROWSER_TAB_OPEN_FAILURE.UNREACHABLE],
]);

function fileWindowQuery(window: TaskFileRequest):
  | {
      readonly path: string;
      readonly first: string;
      readonly last: string;
      readonly raw?: typeof TASK_FILE_QUERY_FLAG;
      readonly ref?: string;
    }
  | undefined {
  const admitted = Result.getOrUndefined(readEither(taskFileRequestSchema)(window));
  if (admitted === undefined) return undefined;
  return {
    path: admitted.path,
    first: String(admitted.firstLine),
    last: String(admitted.lastLine),
    ...(admitted.raw === true ? { raw: TASK_FILE_QUERY_FLAG } : undefined),
    ...(admitted.ref === undefined ? undefined : { ref: admitted.ref }),
  };
}

const UNTRAVELED = { ok: false, failure: WRITE_UNTAKEN.REFUSED } as const;

function keyedWrite<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<TaskCallResult<Answer, WriteUntaken>, never, HttpClient.HttpClient> {
  return Effect.match(asked, {
    onSuccess: succeeded,
    onFailure: (failed) => ({ ok: false, failure: writeUntakenOf(hostedFailureFacts(failed)) }),
  });
}

function orNothing<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<Answer | undefined, never, HttpClient.HttpClient> {
  return Effect.orElseSucceed(asked, () => undefined);
}

function refusedAs<Failure extends TaskCallFailure>(
  payload: UnparsedWireValue,
  named: Readonly<Partial<Record<HostedApiError, Failure>>>,
): TaskCallResult<never, Failure | typeof TASK_CALL_FAILURE.UNANSWERED> {
  const refusal = Result.getOrUndefined(readServiceAnswer(hostedErrorSchema)(payload));
  const failure = refusal === undefined ? undefined : named[refusal];
  return failure === undefined ? UNANSWERED : { ok: false, failure };
}

export class HostedTaskClient {
  readonly #call: AccountCallEffects;
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
  }

  startComment(
    planId: string,
    request: DescriptionCommentStart,
  ): Effect.Effect<TasksCommentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(descriptionCommentStartRequestSchema)(request),
    );
    if (admitted === undefined) return Effect.succeed(COMMENT_UNANSWERED);
    return commentAnswer(
      Effect.map(
        askHosted(this.#hosted.descriptionComments.start, {
          params: { id: planId },
          body: admitted,
        }),
        (started) => started.body,
      ),
    );
  }

  actOnComment(
    planId: string,
    threadId: string,
    request: DescriptionCommentActionRequest,
  ): Effect.Effect<TasksCommentAnswer, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(
      readEither(descriptionCommentActionRequestSchema)(request),
    );
    if (admitted === undefined) return Effect.succeed(COMMENT_UNANSWERED);
    return commentAnswer(
      askHosted(this.#hosted.descriptionComments.act, {
        params: { id: planId, thread: threadId },
        body: admitted,
      }),
    );
  }

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

  listLive(
    userId: string,
    sync: string | undefined,
  ): Effect.Effect<
    TaskCallResult<TaskListLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
    never,
    HttpClient.HttpClient
  > {
    const read = {
      [LIVE_USER_QUERY]: userId,
      ...(sync === undefined ? undefined : { [LIVE_POLL.SYNC]: sync }),
    };
    return hostedResult(
      askLive(this.#hosted.live.tasks, read, true, undefined, sync !== undefined && sync !== ""),
      LIVE_REFUSALS,
    );
  }

  find(
    workspace: string,
    number: number,
  ): Effect.Effect<string | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      Effect.map(
        askHosted(this.#hosted.plans.find, { workspace, number: String(number) }),
        (found) => found.taskId,
      ),
    );
  }

  open(
    taskId: string,
  ): Effect.Effect<TaskCallResult<Task, TaskCallFailure>, never, HttpClient.HttpClient> {
    return hostedResult(
      Effect.map(askHosted(this.#hosted.plans.open, { id: taskId }), (opened) => opened.plan),
      NOT_FOUND_REFUSAL,
    );
  }

  edit(
    taskId: string,
    edit: DescriptionEditRequest,
  ): Effect.Effect<
    TaskCallResult<
      DescriptionEditAnswer,
      typeof TASK_CALL_FAILURE.UNANSWERED | typeof TASK_CALL_FAILURE.NOT_FOUND
    >,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(readEither(descriptionEditRequestSchema)(edit));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      askHosted(this.#hosted.plans.editDescription, { params: { id: taskId }, body: admitted }),
      {
        [HOSTED_API_ERROR.NOT_FOUND]: TASK_CALL_FAILURE.NOT_FOUND,
      },
    );
  }

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

  setRepository(
    taskId: string,
    repository: string | null,
  ): Effect.Effect<
    TaskCallResult<TaskWritten, RepositoryCallFailure>,
    never,
    HttpClient.HttpClient
  > {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)({ repository }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(this.#update(taskId, admitted), REPOSITORY_REFUSALS);
  }

  move(
    taskId: string,
    workspaceId: string,
  ): Effect.Effect<TaskCallResult<TaskWritten, TaskCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)({ workspaceId }));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(this.#update(taskId, admitted), MOVE_REFUSALS);
  }

  block(
    taskId: string,
    block: TaskBlockRequest,
  ): Effect.Effect<TaskCallResult<TaskWritten, BlockCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskBlockRequestSchema)(block));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      Effect.map(
        askHosted(this.#hosted.plans.block, { params: { id: taskId }, body: admitted }),
        writtenOf,
      ),
      BLOCK_REFUSALS,
    );
  }

  setParent(
    taskId: string,
    parent: TaskParentRequest,
  ): Effect.Effect<TaskCallResult<TaskWritten, ParentCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskParentRequestSchema)(parent));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      Effect.map(
        askHosted(this.#hosted.plans.parent, { params: { id: taskId }, body: admitted }),
        writtenOf,
      ),
      PARENT_REFUSALS,
    );
  }

  changeRelation(
    taskId: string,
    relation: TaskRelationChangeRequest,
  ): Effect.Effect<TaskCallResult<TaskWritten, RelationCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskRelationChangeRequestSchema)(relation));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    return hostedResult(
      Effect.map(
        askHosted(this.#hosted.plans.relation, { params: { id: taskId }, body: admitted }),
        writtenOf,
      ),
      RELATION_REFUSALS,
    );
  }

  recordLive(
    taskId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    TaskCallResult<TaskRecordLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
    never,
    HttpClient.HttpClient
  > {
    return hostedResult(
      askLive(this.#hosted.live.taskRecord, { id: taskId, [LIVE_USER_QUERY]: userId }, poll, after),
      LIVE_REFUSALS,
    );
  }

  pagesLive(
    place: PagePlace,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    TaskCallResult<TaskPagesLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
    never,
    HttpClient.HttpClient
  > {
    const procedure =
      "taskId" in place ? this.#hosted.live.taskPages : this.#hosted.live.agentPages;
    return hostedResult(
      askLive(procedure, { id: pagePlaceId(place), [LIVE_USER_QUERY]: userId }, poll, after),
      LIVE_REFUSALS,
    );
  }

  browserTabsLive(
    place: BrowserTabsPlace,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    TaskCallResult<TaskBrowserTabsLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
    never,
    HttpClient.HttpClient
  > {
    return hostedResult(
      askLive(
        "taskId" in place ? this.#hosted.live.taskBrowserTabs : this.#hosted.live.agentBrowserTabs,
        { id: browserTabsPlaceId(place), [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
      LIVE_REFUSALS,
    );
  }

  commentsLive(
    subject: TasksCommentsFollow,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    TaskCallResult<TaskCommentsLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
    never,
    HttpClient.HttpClient
  > {
    const page = subject.pageId === undefined ? undefined : { page: subject.pageId };
    return hostedResult(
      askLive(
        this.#hosted.live.taskComments,
        { id: subject.taskId, ...page, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
      LIVE_REFUSALS,
    );
  }

  historyLive(
    taskId: string,
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    TaskCallResult<TaskHistoryLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
    never,
    HttpClient.HttpClient
  > {
    return hostedResult(
      askLive(
        this.#hosted.live.taskHistory,
        { id: taskId, [LIVE_USER_QUERY]: userId },
        poll,
        after,
      ),
      LIVE_REFUSALS,
    );
  }

  readFile(
    taskId: string,
    window: TaskFileRequest,
  ): Effect.Effect<TaskFileAnswer | undefined, never, HttpClient.HttpClient> {
    const query = fileWindowQuery(window);
    if (query === undefined) return Effect.succeed(undefined);
    return orNothing(askHosted(this.#hosted.taskFiles.file, { id: taskId, ...query }));
  }

  readRepositoryFile(
    place: RepositoryPlace,
    window: TaskFileRequest,
  ): Effect.Effect<TaskFileAnswer | undefined, never, HttpClient.HttpClient> {
    const query = fileWindowQuery(window);
    if (query === undefined) return Effect.succeed(undefined);
    return orNothing(askHosted(this.#hosted.github.repositoryFile, { ...place, ...query }));
  }

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

  readSkills(
    taskId: string,
  ): Effect.Effect<TaskSkillsAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.taskFiles.skills, { id: taskId, installed: TASK_SKILLS_INSTALLED }),
    );
  }

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

  readRepositorySkills(
    place: SkillsPlace,
  ): Effect.Effect<TaskSkillsAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.github.repositorySkills, {
        ...place,
        installed: TASK_SKILLS_INSTALLED,
      }),
    );
  }

  readRepositoryPullRequest(
    place: RepositoryPlace,
    number: number,
  ): Effect.Effect<GitHubRepositoryPullRequestAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.github.repositoryPullRequest, { ...place, number: String(number) }),
    );
  }

  readRepositoryIssue(
    place: RepositoryPlace,
    number: number,
  ): Effect.Effect<GitHubRepositoryIssueAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.github.repositoryIssue, { ...place, number: String(number) }),
    );
  }

  openBrowserTab(
    params: TasksBrowserTabOpenParams,
  ): Effect.Effect<TasksBrowserTabOpenAnswer, never, HttpClient.HttpClient> {
    const { agentId, address } = params;
    return Effect.match(
      askHosted(
        this.#hosted.agentBrowserTabs.agentOpen,
        { params: { id: agentId }, body: { address } },
        HOSTED_DEADLINE.BROWSER_OPEN,
      ),
      {
        onSuccess: (answer): TasksBrowserTabOpenAnswer => answer,
        onFailure: (failed): TasksBrowserTabOpenAnswer => ({
          failure:
            (failed._tag === "HostedRefused"
              ? BROWSER_TAB_OPEN_REFUSALS.get(failed.refusal)
              : undefined) ?? BROWSER_TAB_OPEN_FAILURE.UNANSWERED,
        }),
      },
    );
  }

  readRevisions(
    taskId: string,
    before?: number,
  ): Effect.Effect<DescriptionRevisionsAnswer | undefined, never, HttpClient.HttpClient> {
    return orNothing(
      askHosted(this.#hosted.plans.descriptionRevisions, {
        id: taskId,
        ...(before === undefined ? undefined : { before: String(before) }),
      }),
    );
  }

  readRevision(
    taskId: string,
    seq: number,
  ): Effect.Effect<
    DescriptionRevisionAnswer["revision"] | undefined,
    never,
    HttpClient.HttpClient
  > {
    return orNothing(
      Effect.map(
        askHosted(this.#hosted.plans.descriptionRevision, { id: taskId, seq: String(seq) }),
        (answer) => answer.revision,
      ),
    );
  }

  readPicture(
    taskId: string,
    attachmentId: string,
  ): Effect.Effect<TasksPictureAnswer, never, HttpClient.HttpClient> {
    const send = this.#call.send;
    return Effect.gen(function* () {
      const answer = yield* send({
        method: HTTP_METHOD.GET,
        path: descriptionAttachmentPath(taskId, attachmentId),
      });
      if (!callAnswered(answer)) return { failure: TASK_CALL_FAILURE.UNANSWERED };
      if (!answer.response.ok) {
        const refused = refusedAs(unparsedWire(yield* jsonOf(answer.response)), NOT_FOUND_REFUSAL);
        return { failure: refused.ok ? TASK_CALL_FAILURE.UNANSWERED : refused.failure };
      }
      const picture = yield* imageBodyOf(answer.response, descriptionAttachmentTypeSchema);
      return picture ?? { failure: TASK_CALL_FAILURE.UNANSWERED };
    });
  }

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
                failure: KEEP_REFUSED[kept.refused],
              },
      },
    );
  }

  readPageVersion(
    place: PagePlace,
    pageId: string,
    version: number,
  ): Effect.Effect<PageVersion | undefined, never, HttpClient.HttpClient> {
    const named = { page: pageId, version: String(version) };
    const asked =
      "taskId" in place
        ? askHosted(this.#hosted.taskFiles.page, { id: place.taskId, ...named })
        : askHosted(this.#hosted.agentPages.version, { id: place.agentId, ...named });
    return Effect.map(orNothing(asked), (answer) => answer?.page);
  }

  restore(
    taskId: string,
    seq: number,
  ): Effect.Effect<
    { readonly task: Task; readonly txid: string | undefined } | undefined,
    never,
    HttpClient.HttpClient
  > {
    return orNothing(
      Effect.map(
        askHosted(this.#hosted.plans.restoreDescription, { id: taskId, seq: String(seq) }),
        (answer) => ({ task: answer.plan, txid: answer.txid }),
      ),
    );
  }

  delete(
    taskId: string,
  ): Effect.Effect<{ readonly txid?: string } | undefined, never, HttpClient.HttpClient> {
    return Effect.match(askHosted(this.#hosted.plans.delete, { id: taskId }), {
      onFailure: () => undefined,
      onSuccess: (answer) => (answer.txid === undefined ? {} : { txid: answer.txid }),
    });
  }

  rename(
    taskId: string,
    request: TaskRenameRequest,
    key?: string,
  ): Effect.Effect<TaskCallResult<TaskWritten, WriteUntaken>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskRenameRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNTRAVELED);
    return keyedWrite(this.#update(taskId, admitted, key));
  }

  setStanding(
    taskId: string,
    standing: TaskStanding,
    key?: string,
  ): Effect.Effect<TaskCallResult<TaskWritten, WriteUntaken>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)(standing));
    if (admitted === undefined) return Effect.succeed(UNTRAVELED);
    return keyedWrite(this.#update(taskId, admitted, key));
  }

  mark(
    taskId: string,
    marks: TaskMarks,
    key?: string,
  ): Effect.Effect<TaskCallResult<TaskWritten, WriteUntaken>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskUpdateRequestSchema)(marks));
    if (admitted === undefined) return Effect.succeed(UNTRAVELED);
    return keyedWrite(this.#update(taskId, admitted, key));
  }

  #update(
    taskId: string,
    changes: TaskUpdateRequest,
    key?: string,
  ): Effect.Effect<TaskWritten, HostedFailure, HttpClient.HttpClient> {
    return Effect.map(
      askHosted(
        this.#hosted.plans.update,
        { params: { id: taskId }, body: changes },
        HOSTED_DEADLINE.USUAL,
        key,
      ),
      writtenOf,
    );
  }

  pinRepository(
    repository: string,
    pinned: boolean,
    key?: string,
  ): Effect.Effect<
    TaskCallResult<RepositoryPinsWritten, WriteUntaken>,
    never,
    HttpClient.HttpClient
  > {
    const asked = Result.getOrUndefined(
      readEither(repositoryPinRequestSchema)({ repository, pinned }),
    );
    if (asked === undefined) return Effect.succeed(UNTRAVELED);
    return keyedWrite(
      askHosted(this.#hosted.repositoryPins.set, asked, HOSTED_DEADLINE.USUAL, key),
    );
  }

  sidebarLive(
    userId: string,
    poll = false,
    after?: string,
  ): Effect.Effect<
    TaskCallResult<SidebarLiveAnswer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
    never,
    HttpClient.HttpClient
  > {
    return hostedResult(
      askLive(this.#hosted.live.sidebar, { [LIVE_USER_QUERY]: userId }, poll, after),
      LIVE_REFUSALS,
    );
  }

  writeTaskSection(
    write: TaskSectionWrite,
    key?: string,
  ): Effect.Effect<
    TaskCallResult<TaskSectionsWritten, WriteUntaken>,
    never,
    HttpClient.HttpClient
  > {
    const asked = Result.getOrUndefined(readEither(taskSectionWriteSchema)(write));
    if (asked === undefined) return Effect.succeed(UNTRAVELED);
    return keyedWrite(
      askHosted(this.#hosted.taskSections.write, asked, HOSTED_DEADLINE.USUAL, key),
    );
  }

  create(
    request: TaskCreateRequest,
    key?: string,
  ): Effect.Effect<TaskCallResult<TaskStarted, StartCallFailure>, never, HttpClient.HttpClient> {
    const admitted = Result.getOrUndefined(readEither(taskCreateRequestSchema)(request));
    if (admitted === undefined) return Effect.succeed(UNANSWERED);
    const deadline = admitted.agent === undefined ? HOSTED_DEADLINE.USUAL : HOSTED_DEADLINE.START;
    return Effect.match(askHosted(this.#hosted.plans.create, admitted, deadline, key), {
      onSuccess: (started) => succeeded(taskStartedOf(started.body)),
      onFailure: (failed) => ({
        ...hostedRefusal(failed, START_REFUSALS),
        untaken: writeUntakenOf(hostedFailureFacts(failed)),
      }),
    });
  }
}

function taskStartedOf(started: TaskStartAnswer): TaskStarted {
  const written = started.txid === undefined ? {} : { txid: started.txid };
  if (started.agent !== undefined) {
    return { task: started.plan, agent: { agent: started.agent }, ...written };
  }
  if (started.agentRefusal !== undefined) {
    return { task: started.plan, agent: startRefusedAs(started.agentRefusal), ...written };
  }
  return { task: started.plan, ...written };
}

function commentAnswer<Answer>(
  asked: Effect.Effect<Answer, HostedFailure, HttpClient.HttpClient>,
): Effect.Effect<
  Answer | typeof COMMENT_NOT_FOUND | typeof COMMENT_UNANSWERED,
  never,
  HttpClient.HttpClient
> {
  return Effect.catch(asked, (failed) =>
    Effect.succeed(
      failed._tag === "HostedRefused" && failed.refusal === HOSTED_API_ERROR.NOT_FOUND
        ? COMMENT_NOT_FOUND
        : COMMENT_UNANSWERED,
    ),
  );
}
