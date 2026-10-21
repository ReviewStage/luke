import {
  type HostedGitHubConnectionClient,
  type HostedTaskClient,
  type HostedWorkspaceClient,
  type TaskActivityFrame,
  type TaskCallResult,
  type TaskMarks,
  WORKSPACE_CALL_FAILURE,
  type WorkspaceCallFailure,
  type WorkspaceCallResult,
} from "@luke/features";
import {
  LIVE_SIGNED_OUT,
  pagesOfLiveRows,
  revisionsOfLiveRows,
  taskHistoryLiveRowsSchema,
  taskPagesLiveRowsSchema,
} from "@luke/features/live-wire";
import { issueTagOf, type TaskIssueTag } from "@luke/features/task-issue-wire";
import type { Task } from "@luke/features/task-wire";
import {
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskCallFailure,
  type TaskCodeShowing,
  type TaskShownCode,
  type TasksBrowserTabsAnswer,
  type TasksCommentAnswer,
  type TasksCommentsAnswer,
  type TasksDocument,
  type TasksEditAnswer,
  type TasksFileAnswer,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubIssuesAnswer,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksIssueLinkAnswer,
  type TasksIssueLinksAnswer,
  type TasksIssueRelateAnswer,
  type TasksIssueUnlinkAnswer,
  type TasksLinearIssuesAnswer,
  type TasksMoveAnswer,
  type TasksPageAnswer,
  type TasksPagesAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPullRequestAnswer,
  type TasksRepositoriesAnswer,
  type TasksRevisionAnswer,
  type TasksRevisionsAnswer,
  type TasksSetRepositoryAnswer,
  type TasksSkillsAnswer,
  type TasksStartAnswer,
  type TasksTreeAnswer,
  type TasksView,
  type TasksWorkspaceAnswer,
  type TasksWorkspaceGitHubConnectAnswer,
  type TasksWorkspaceInvitationAnswer,
  type TasksWorkspaceInvitationsAnswer,
  type TasksWorkspaceLeaveAnswer,
  type TasksWorkspaceMembersAnswer,
  type TasksWorkspacePhotoAnswer,
  type TasksWorkspaceTokenRepositoriesAnswer,
  taskHistoryFollowSchema,
  taskPagesFollowSchema,
  tasksArchiveParamsSchema,
  tasksBoardSaveParamsSchema,
  tasksBrowserTabsParamsSchema,
  tasksCommentActParamsSchema,
  tasksCommentStartParamsSchema,
  tasksCommentsParamsSchema,
  tasksEditParamsSchema,
  tasksFileParamsSchema,
  tasksGitHubIssuesParamsSchema,
  tasksIssueLinkParamsSchema,
  tasksIssueLinksParamsSchema,
  tasksIssueParamsSchema,
  tasksIssueRelateParamsSchema,
  tasksIssueUnlinkParamsSchema,
  tasksLinearIssuesParamsSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPagesParamsSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksPullRequestParamsSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesParamsSchema,
  tasksRevisionParamsSchema,
  tasksRevisionsParamsSchema,
  tasksSetRepositoryParamsSchema,
  tasksSetStandingParamsSchema,
  tasksSkillsParamsSchema,
  tasksStartRequestSchema,
  tasksTreeParamsSchema,
  tasksWorkspaceCreateParamsSchema,
  tasksWorkspaceInvitationCancelParamsSchema,
  tasksWorkspaceInviteParamsSchema,
  tasksWorkspaceLeaveParamsSchema,
  tasksWorkspaceMemberRemoveParamsSchema,
  tasksWorkspaceMemberRoleParamsSchema,
  tasksWorkspaceMembersParamsSchema,
  tasksWorkspaceParamsSchema,
  tasksWorkspacePhotoParamsSchema,
  tasksWorkspacePhotoSetParamsSchema,
  tasksWorkspaceRenameParamsSchema,
  tasksWorkspaceTokenRepositoriesParamsSchema,
  tasksWorkspaceTokenRepositorySetParamsSchema,
  tasksWorkspaceTransferParamsSchema,
  tasksWriteSectionParamsSchema,
  workspacePeopleFollowSchema,
} from "@luke/features/tasks-view";
import type { Workspace } from "@luke/features/workspace-wire";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodTable,
  invalid,
} from "@luke/gateway";
import { catchAllButInterrupt } from "@luke/runtime/effect";
import { keepIdentity, unparsedWire } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import {
  Cache,
  Cause,
  Clock,
  Data,
  Duration,
  Effect,
  Exit,
  FiberHandle,
  FiberMap,
  Option,
  Queue,
  Result,
  Schedule,
  Schema,
  type Scope,
  Semaphore,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { boardMoves } from "./board-follow.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import type { HostKernel } from "./host-kernel.js";
import {
  confirmWrite,
  LIVE_GONE,
  type LiveBroken,
  type LiveClient,
  openRealtimeClient,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";
import { pushLive } from "./live-push.js";
import type { RunMode } from "./run-mode.js";
import { codeExcerpt } from "./task-code-excerpt.js";
import { followTaskList } from "./task-list-follow.js";
import { TASK_RECORD_PART, type TaskRecordPart, taskRecordMoves } from "./task-record-follow.js";
import {
  invitationsMoves,
  type LiveReadDependencies,
  peopleMoves,
  sidebarMoves,
  workspacesMoves,
} from "./workspaces-follow.js";

/**
 * compose-tasks.ts -- the panel's named tasks, read from the service: the list, the one active task, and its document.
 *
 * Nothing here writes a document but a restore the developer asks for: the
 * task's coding agents are its writers, on the service. The list and the
 * open task are read when the Tasks tab shows, when a task opens, and when
 * one starts, and never on a clock. The list itself is followed over Neon
 * Realtime from the first refresh until a sign-out (`task-list-follow.ts`),
 * and is read by none of those asks. The open task's whiteboard is read with
 * its document, and again whenever its mark moves on the Neon Realtime
 * subscription the host holds while the task stands open
 * (`board-follow.ts`); the panel saves the board's scene through here and
 * the view takes the board as the service answered it. The code an agent
 * puts on screen during a call arrives on the call's socket with its lines,
 * read by the service from the agent's checkout, and is cut to what its card draws here
 * (`task-code-excerpt.ts`) and drawn in place; nothing of the repository is read on
 * this Mac. Every code the task's agents showed is read from the service
 * with the document, and again as the record's code part moves, so a task
 * opened after a restart or a switch shows it; each code a call shows lands
 * over that read and stays past the call's end. The repositories the account reaches, and a task's repository
 * given or taken away, are the service's too, asked through here, as are a
 * task pinned or archived: the list holds the archived tasks beside the
 * rest, each flagged, and which the window draws where is the window's. A
 * plan's history is read for the version history that asks and held nowhere
 * here; a revision restored is the one write this concern carries to the
 * service on the developer's word, and the view takes the task it answers.
 * The pages agents wrote for the open task are listed with its document, by
 * title and newest version alone, and again whenever the call's activity
 * says a page just settled; a page's HTML is answered to the frame that
 * draws it and held nowhere here.
 *
 * The workspaces the account is a member of are carried on the view beside
 * the tasks and followed apart from them over Neon Realtime, so the tasks
 * never wait on them: from the first refresh after a launch or a sign-in
 * until a sign-out, each change drawn as it lands, a teammate's and the
 * browser's among them. Whether the account's GitHub is connected is read
 * once beside them, and again when the panel comes forward, at most once a
 * minute, since it is measured against the clock and cannot be followed. A
 * workspace made, renamed, or given a photo, a GitHub
 * organization connected or disconnected, a removal of a member, a
 * member's role changed, a handover, and a leave are carried to the
 * service on the developer's word, and a workspace's members and a
 * connection's install address are answered to the caller that asked and
 * held nowhere here.
 */

/** A task's pin, where it stands, and its archive as the list carries them, each only where it stands. */
type TaskMarkStamps = Pick<Task, "pinnedAt" | "pinPosition" | "archivedAt">;

/**
 * How long a read of whether the account's GitHub is connected stands
 * before a refresh or the panel coming forward reads it again. Note that a
 * connection made in the browser reaches this Mac only on a read, and a
 * panel brought forward over and over is not a reason to read each time.
 */
const GITHUB_READ_EVERY = Duration.minutes(1);

/** A GitHub page asked behind a closed gate, or of a service that did not answer, which opens nothing. */
const GITHUB_PAGE_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/**
 * How long the answer to a link's read of one pull request or issue is kept
 * for every window that asks it again: an answer briefly, so a merge or a
 * new title shows within a minute, and no answer, a refusal or a GitHub that
 * failed, for longer, so a service turned away is not asked again by every
 * link redrawn meanwhile. Note that every link in every window reads through
 * these, because each card asks on its own mount and a transcript or an
 * inbox can draw dozens of cards for one pull request at once; each read
 * spends the installation's GitHub rate limit, which also reads agents' own
 * pull requests.
 */
const LINK_READ_KEPT = {
  CAPACITY: 512,
  ANSWERED: Duration.minutes(1),
  UNANSWERED: Duration.minutes(2),
} as const;

/** One GitHub page a link reads, by the workspace whose installation reaches it, its repository, and its number. */
class LinkReadKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}> {}

/** The key a link's read is kept under, of the place and number it asked. */
function linkReadKey(asked: {
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}): LinkReadKey {
  return new LinkReadKey({
    workspaceId: asked.workspaceId,
    repository: asked.repository,
    number: asked.number,
  });
}

/** How long a link's read is kept: `LINK_READ_KEPT.ANSWERED` where the service answered, `UNANSWERED` where it did not. */
function linkReadKept(exit: Exit.Exit<unknown>): Duration.Duration {
  return Exit.isSuccess(exit) && exit.value !== undefined
    ? LINK_READ_KEPT.ANSWERED
    : LINK_READ_KEPT.UNANSWERED;
}

/** A call on a task's linked issues behind a closed gate, or of a service that did not answer. */
const TASK_ISSUES_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** A workspace call behind a closed gate, which never reaches the service. */
const WORKSPACE_UNANSWERED = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

/** Opening or deleting a task names it and nothing else. */
const tasksOpenParamsSchema = Schema.Struct({ taskId: Schema.NonEmptyString });

/** The service's side of the tasks, and the workspaces they live in, as this concern asks it. */
export type TasksClient = Pick<
  HostedTaskClient,
  | "listLive"
  | "open"
  | "create"
  | "delete"
  | "rename"
  | "mark"
  | "pinRepository"
  | "sidebarLive"
  | "writeTaskSection"
  | "readBoard"
  | "boardLive"
  | "recordLive"
  | "pagesLive"
  | "historyLive"
  | "saveBoard"
  | "readCode"
  | "readFile"
  | "readTree"
  | "readSkills"
  | "readRepositoryTree"
  | "readRepositorySkills"
  | "readRepositoryPullRequest"
  | "readRepositoryIssue"
  | "readRepositoryIssues"
  | "readIssueLinks"
  | "readBrowserTabs"
  | "linkIssue"
  | "relateIssue"
  | "unlinkIssue"
  | "readRevisions"
  | "readRevision"
  | "readPages"
  | "readPageVersion"
  | "readPicture"
  | "keepPicture"
  | "comments"
  | "startComment"
  | "actOnComment"
  | "restore"
  | "repositories"
  | "setRepository"
  | "setStanding"
  | "move"
  | "edit"
> & {
  /** The account's workspaces, the ones it may join, and their members. */
  workspaces: Pick<
    HostedWorkspaceClient,
    | "live"
    | "create"
    | "rename"
    | "setPhoto"
    | "githubConnect"
    | "githubDisconnect"
    | "linearConnect"
    | "linearDisconnect"
    | "linearIssues"
    | "people"
    | "peopleLive"
    | "invitationsLive"
    | "photo"
    | "removeMember"
    | "tokenRepositories"
    | "setTokenRepository"
    | "changeRole"
    | "transfer"
    | "leave"
    | "invite"
    | "invitations"
    | "cancelInvitation"
  >;
  /** Whether the account has GitHub connected, and the pages that connect and disconnect it. */
  github: Pick<HostedGitHubConnectionClient, "status" | "connect" | "disconnect">;
};

export interface TasksDependencies {
  kernel: Pick<HostKernel, "emit" | "report" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: TasksClient;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** Realtime's client at an address, which the open task's board, its record, and the task list are followed over; Realtime's own outside a test. */
  openLive?: (url: string) => LiveClient | PromiseLike<LiveClient>;
  /**
   * Ends the call standing about `taskId`, or whatever it is about
   * where none is named, and waits for it to end. A call about another task
   * is left standing.
   */
  endTaskCall: (taskId: string | undefined) => Effect.Effect<void>;
}

export interface TasksComposer extends Composer {
  /** The view as this Mac holds it now. */
  snapshot: () => TasksView;
  /** The one active task, which a voice session binds to; nothing while the panel has none open. */
  activeTaskId: () => string | undefined;
  /** Drops everything held, for a sign-out, and tells every client the panel has nothing. */
  reset: Effect.Effect<void>;
  /**
   * Shows what each part of the call is doing about the open task,
   * as the service last said it; a word about any other task is dropped.
   * Leaving or switching tasks clears it, and the call's end says nothing
   * doing.
   */
  showActivity: (activity: TaskActivityFrame) => void;
  /**
   * Puts code on screen as the agent named it on the open task's call, with the
   * lines the service read from the task's repository: coloured here and
   * drawn after every code shown before it, where it stays past the call's
   * end. Code about any other task, or of a call already held, is dropped.
   */
  showCode: (taskId: string, shown: TaskShownCode) => void;
  /** The call about `taskId` ended: what it was doing is no longer drawn. */
  callEnded: (taskId: string) => void;
}

/**
 * How long the board's follow waits before sealing again after a seal the
 * service did not answer, or a follow that stopped: the first wait, doubling
 * on each that fails again, up to the longest.
 */
const BOARD_RESEAL = { FIRST: Duration.seconds(2), LONGEST: Duration.minutes(1) } as const;

const BOARD_BACKOFF = Schedule.exponential(BOARD_RESEAL.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, BOARD_RESEAL.LONGEST)),
  ),
);

/** Why a live follow is not sealed again: the task is no longer the open one, or the gate closed. */
const BOARD_FOLLOW_ENDED = "ended";

/** A live read the service did not seal, `gone` where the task is no longer the account's. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

/** Whether a seal is one the service did not answer. */
function isUnsealed<Answer extends object>(sealed: Answer | Unsealed): sealed is Unsealed {
  return "failure" in sealed;
}

/**
 * The panel's tasks as one concern. The view is told to every client whole
 * whenever it moves, and exactly one task is active at a time: opening or
 * starting one replaces whichever was, and a read still out for the replaced
 * task is dropped when it lands. Only one task is ever the spoken
 * conversation, so opening another task, starting one, leaving the open task,
 * or a sign-out ends the call about the task that was open before anything
 * else moves. The Tasks tab showing reads the list and the open task again,
 * while the open task and its call stand through the tab hiding. Behind a
 * closed account gate, or on a run that sends nothing, nothing is read.
 *
 * The open task's board is followed over Neon Realtime
 * (`board-follow.ts`): the host subscribes while the task stands open and
 * reads the board again once its mark moves, and on each seal's first
 * delivery. Opening another task replaces the follow, and leaving the task
 * or a sign-out stops it.
 */
export const composeTasks = /* @__PURE__ */ Effect.fn("host/composeTasks")(function* (
  dependencies: TasksDependencies,
): Effect.fn.Return<TasksComposer, never, Scope.Scope | HttpClient.HttpClient> {
  const { kernel, account, client, endTaskCall } = dependencies;
  const http = yield* HttpClient.HttpClient;
  /** One ask of the service, over the host's own HTTP client. */
  const served = <Answer, Failure>(call: Effect.Effect<Answer, Failure, HttpClient.HttpClient>) =>
    Effect.provideService(call, HttpClient.HttpClient, http);
  const idleView = (): TasksView => IDLE_TASKS_VIEW;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

  /** The link reads kept for every window (`LINK_READ_KEPT`); a read already out is joined, never asked twice. */
  const pullRequestReads = yield* Cache.makeWith(
    (key: LinkReadKey) =>
      served(
        client.readRepositoryPullRequest(
          { workspaceId: key.workspaceId, repository: key.repository },
          key.number,
        ),
      ),
    { capacity: LINK_READ_KEPT.CAPACITY, timeToLive: linkReadKept },
  );
  const issueReads = yield* Cache.makeWith(
    (key: LinkReadKey) =>
      served(
        client.readRepositoryIssue(
          { workspaceId: key.workspaceId, repository: key.repository },
          key.number,
        ),
      ),
    { capacity: LINK_READ_KEPT.CAPACITY, timeToLive: linkReadKept },
  );

  /**
   * One read of the service at a time, whichever ask made it. Note that the
   * answers are applied in the order the reads were made, because a list
   * that left before a task started, or a document read that left before a
   * newer one, would otherwise land last and roll the view back.
   */
  const serial = (yield* Semaphore.make(1)).withPermits(1);

  let view: TasksView = idleView();
  let published: TasksView = view;

  function publish(): void {
    // Note that the view keeps the identity of what it shares with the one
    // last told, so a view that says nothing new is that one, and what is
    // told shares every part that did not move with what was told before.
    view = keepIdentity(published, view);
    if (view === published) return;
    published = view;
    kernel.emit(GATEWAY_EVENT.TASKS_CHANGED, carried(view));
  }

  function write(next: Partial<TasksView>): void {
    view = { ...view, ...next };
    publish();
  }

  /** The view with no activity, no board, no code, and no pages read or told, as a task left behind leaves it. */
  function withoutActivity({
    activity: _activity,
    board: _board,
    shownCode: _shownCode,
    codeStatus: _codeStatus,
    pages: _pages,
    ...rest
  }: TasksView): TasksView {
    return rest;
  }

  /** The one live follow of the open task's board; running another interrupts it. */
  const boardFollow = yield* FiberHandle.make<void>();

  /** The open task's board follow's wait on a save's transaction, while it stands over Realtime; none while polled or let go. */
  let boardWait: { readonly taskId: string; readonly wait: TxWait } | undefined;
  /** The tasks whose board's mark moved, read one at a time by the loop below. */
  const boardReads = yield* Queue.sliding<string>(1);

  /** The one live follow of the open task's pages and calls; running another interrupts it. */
  const recordFollow = yield* FiberHandle.make<void>();

  /** The tasks whose pages' mark moved, read one at a time by the loop below. */
  const pageReads = yield* Queue.sliding<string>(1);

  /** The tasks whose agents' answered `show_code` calls moved, whose code is read once by the loop below. */
  const codeReads = yield* Queue.sliding<string>(1);

  /** The code a call showed, coloured and drawn in the order shown by the loop below. */
  const codeShows = yield* Queue.unbounded<{ taskId: string; shown: TaskShownCode }>();

  /** The newest page of each task's history a window's version history follows, by the task. */
  const historyFollows = yield* FiberMap.make<string>();
  const decodeHistory = Schema.decodeUnknownOption(taskHistoryLiveRowsSchema);

  /** Follows `taskId`'s newest page of history live until let go, each change emitted as `TASKS_HISTORY_CHANGED`. */
  function followHistory(taskId: string) {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    return pushLive({
      seal: (poll, after) =>
        gate() && userId !== undefined
          ? Effect.map(served(client.historyLive(taskId, userId, poll, after)), (sealed) =>
              sealed.ok
                ? sealed.answer
                : {
                    failure: sealed.failure,
                    gone:
                      sealed.failure === TASK_CALL_FAILURE.NOT_FOUND ||
                      sealed.failure === LIVE_SIGNED_OUT.failure,
                  },
            )
          : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
      decode: (rows) => Option.map(decodeHistory(rows), revisionsOfLiveRows),
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: kernel.now,
      publish: (page) =>
        kernel.emit(
          GATEWAY_EVENT.TASKS_HISTORY_CHANGED,
          carried({ taskId, view: page ?? { failure: TASK_CALL_FAILURE.UNANSWERED } }),
        ),
    });
  }

  /** The pages of each task a window's Inbox follows, by the task. */
  const pagesFollows = yield* FiberMap.make<string>();
  const decodePages = Schema.decodeUnknownOption(taskPagesLiveRowsSchema);

  /** Follows `taskId`'s pages live until let go, each change emitted as `TASKS_PAGES_CHANGED`. */
  function followPages(taskId: string) {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    return pushLive({
      seal: (poll, after) =>
        gate() && userId !== undefined
          ? Effect.map(served(client.pagesLive(taskId, userId, poll, after)), (sealed) =>
              sealed.ok
                ? sealed.answer
                : {
                    failure: sealed.failure,
                    gone:
                      sealed.failure === TASK_CALL_FAILURE.NOT_FOUND ||
                      sealed.failure === LIVE_SIGNED_OUT.failure,
                  },
            )
          : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
      decode: (rows) => Option.map(decodePages(rows), pagesOfLiveRows),
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: kernel.now,
      publish: (pages) =>
        kernel.emit(
          GATEWAY_EVENT.TASKS_PAGES_CHANGED,
          carried({
            taskId,
            view: pages === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { pages },
          }),
        ),
    });
  }

  /** The document of `taskId` as held now, if the held one is that task's. */
  function heldTaskOf(taskId: string): TasksDocument["task"] {
    const held = view.document.task;
    return held?.id === taskId ? held : undefined;
  }

  /** A task's row of the list: everything but its document and what is written of it. */
  /** A task's row or document without the assignee it stood with. */
  function withoutAssignee<T extends { readonly assignee?: unknown }>(
    standing: T,
  ): Omit<T, "assignee"> {
    const { assignee: _assignee, ...rest } = standing;
    return rest;
  }

  function summaryOf({
    document: _document,
    agentEdits: _agentEdits,
    lastEdit: _lastEdit,
    ...summary
  }: Task): TasksView["tasks"][number] {
    return summary;
  }

  /** The one follow of the list, started on the first refresh and stopped by a sign-out. */
  const listFollow = yield* FiberHandle.make<void>();

  const followList = Effect.suspend(() => {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out and ends.
    const userId = dependencies.accountId();
    return followTaskList({
      live: (poll, after) =>
        userId === undefined
          ? Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true })
          : Effect.map(served(client.listLive(userId, poll, after)), (sealed) =>
              sealed.ok
                ? sealed.answer
                : { failure: sealed.failure, gone: sealed.failure === LIVE_SIGNED_OUT.failure },
            ),
      openLive: dependencies.openLive ?? openRealtimeClient,
      now: kernel.now,
      publish: ({ list, taskAgents }) => {
        write({
          tasks: list.plans,
          tasklessAgents: list.planlessAgents ?? [],
          taskAgents,
          listStatus: TASKS_READ.READY,
        });
        // A name the service gave the open task reaches its document as the list carries it.
        if (view.activeTaskId !== undefined) nameHeldAsListed(view.activeTaskId);
      },
      // A list that could not be read says so beside the tasks it already drew rather than emptying them.
      failed: () => write({ listStatus: TASKS_READ.FAILED }),
    });
  });

  /** The one follow of the account's workspaces, from the first refresh after a launch or a sign-in until a sign-out. */
  const workspacesFollow = yield* FiberHandle.make<void>();
  /** How many times the follow or a write's answer has moved each workspace, so an answer that lands after a newer move of it is not drawn over it. */
  const workspaceMoves = new Map<string, number>();

  /**
   * Follows the account's workspaces over Realtime where nothing follows
   * them yet (`workspaces-follow.ts`), polled while Realtime fails them, and
   * draws each change as it lands, a teammate's and the browser's among
   * them. Note that there is no other read of them: a seal the service did
   * not answer, or a follow that stopped, is sealed again on the board's
   * backoff while the gate stands open, and what was drawn stays meanwhile.
   */
  const followWorkspaces = Effect.gen(function* () {
    if (view.workspacesStatus !== TASKS_READ.READY) {
      write({ workspacesStatus: TASKS_READ.READING });
    }
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    const seal = (poll: boolean, after?: string) =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : Effect.map(served(client.workspaces.live(userId, poll, after)), (sealed) =>
            "ok" in sealed ? (sealed.ok ? sealed.answer : { failure: sealed.failure }) : sealed,
          );
    /** One seal followed until it stops, which fails it so the backoff seals it again. */
    const attempt = Effect.gen(function* () {
      const sealed = yield* seal(false);
      if ("failure" in sealed) return yield* Effect.fail(sealed.failure);
      const moves = workspacesMoves(
        {
          seal: () => seal(false),
          poll: (after) => seal(true, after),
          openLive: dependencies.openLive ?? openRealtimeClient,
          now: kernel.now,
        },
        sealed,
      );
      // A follow gone mid-way was refused as signed out by a renewal or a poll, which no seal mends either.
      const gone = yield* Stream.runForEach(moves, (workspaces) =>
        Effect.sync(() => {
          const drawn = new Map(view.workspaces.map((each) => [each.id, JSON.stringify(each)]));
          for (const each of workspaces) {
            if (drawn.get(each.id) === JSON.stringify(each)) continue;
            workspaceMoves.set(each.id, (workspaceMoves.get(each.id) ?? 0) + 1);
          }
          write({ workspaces, workspacesStatus: TASKS_READ.READY });
        }),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      return yield* Effect.fail(gone ? LIVE_SIGNED_OUT.failure : WORKSPACE_CALL_FAILURE.UNANSWERED);
    });
    // A session that is no longer the account's is signed out, which no seal mends.
    const followed = attempt.pipe(
      Effect.retry({
        schedule: BOARD_BACKOFF,
        while: (why) => why !== LIVE_SIGNED_OUT.failure && gate(),
      }),
      Effect.ignore,
    );
    yield* FiberHandle.run(workspacesFollow, followed, { onlyIfMissing: true });
  });

  /** The workspaces whose people, and whose invitations, a window follows, each followed while any window does. */
  const peopleFollows = yield* FiberMap.make<string, void>();
  const invitationFollows = yield* FiberMap.make<string, void>();

  /**
   * One workspace's followed read over Realtime (`workspaces-follow.ts`),
   * polled while Realtime fails it, each change told by `told`. A seal the
   * service did not answer, or a follow that stopped, is sealed again on the
   * board's backoff without a word, so the window keeps what it holds; a
   * workspace the account no longer reaches as the read asks is told so
   * once, and not asked again; a session that is another account's stops it
   * quietly.
   */
  function followWorkspaceRead<Answer extends SealedRead<string>, View>(
    seal: (
      userId: string,
      poll: boolean,
      after: string | undefined,
    ) => Effect.Effect<
      WorkspaceCallResult<Answer> | typeof LIVE_SIGNED_OUT,
      never,
      HttpClient.HttpClient
    >,
    moves: (
      dependencies: LiveReadDependencies<Answer>,
      first: Answer,
    ) => Stream.Stream<View, LiveBroken>,
    told: (view: View | { readonly failure: WorkspaceCallFailure }) => Effect.Effect<void>,
  ): Effect.Effect<void> {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    const sealed = (poll: boolean, after?: string) =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : Effect.map(served(seal(userId, poll, after)), (answer) => {
            if (!("ok" in answer)) return answer;
            if (answer.ok) return answer.answer;
            return {
              failure: answer.failure,
              gone:
                answer.failure === WORKSPACE_CALL_FAILURE.NOT_FOUND ||
                answer.failure === WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
            };
          });
    /** One seal followed until it stops, which fails it so the backoff seals it again. */
    const attempt = Effect.gen(function* () {
      const first = yield* sealed(false);
      if ("failure" in first) {
        if (
          first.failure === WORKSPACE_CALL_FAILURE.NOT_FOUND ||
          first.failure === WORKSPACE_CALL_FAILURE.NOT_PERMITTED
        ) {
          yield* told({ failure: first.failure });
        }
        return yield* Effect.fail(first.failure);
      }
      const changes = moves(
        {
          seal: () => sealed(false),
          poll: (after) => sealed(true, after),
          openLive: dependencies.openLive ?? openRealtimeClient,
          now: kernel.now,
        },
        first,
      );
      yield* Stream.runForEach(changes, told).pipe(Effect.ignore);
      return yield* Effect.fail(WORKSPACE_CALL_FAILURE.UNANSWERED);
    });
    return attempt.pipe(
      Effect.retry({
        schedule: BOARD_BACKOFF,
        while: (why) =>
          why !== WORKSPACE_CALL_FAILURE.NOT_FOUND &&
          why !== WORKSPACE_CALL_FAILURE.NOT_PERMITTED &&
          why !== LIVE_SIGNED_OUT.failure &&
          gate(),
      }),
      Effect.ignore,
    );
  }

  /** One workspace's people followed, each change told as `WORKSPACE_PEOPLE_CHANGED`. */
  function followPeople(workspaceId: string): Effect.Effect<void> {
    return followWorkspaceRead(
      (userId, poll, after) => client.workspaces.peopleLive(workspaceId, userId, poll, after),
      peopleMoves,
      (view) =>
        Effect.sync(() =>
          kernel.emit(GATEWAY_EVENT.WORKSPACE_PEOPLE_CHANGED, carried({ workspaceId, view })),
        ),
    );
  }

  /** One workspace's pending invitations followed, each change told as `WORKSPACE_INVITATIONS_CHANGED`. */
  function followInvitations(workspaceId: string): Effect.Effect<void> {
    return followWorkspaceRead(
      (userId, poll, after) => client.workspaces.invitationsLive(workspaceId, userId, poll, after),
      invitationsMoves,
      (view) =>
        Effect.sync(() =>
          kernel.emit(GATEWAY_EVENT.WORKSPACE_INVITATIONS_CHANGED, carried({ workspaceId, view })),
        ),
    );
  }

  /**
   * When whether GitHub is connected was last asked, none since a sign-out;
   * and the latest read started, which a sign-out and a disconnection also
   * move past, so a read that answers after either is dropped.
   */
  let githubAskedAt: number | undefined;
  let githubRead = 0;

  /** Reads whether the account's GitHub is connected; a failed read keeps what it last read. */
  const readGithub = Effect.gen(function* () {
    githubRead += 1;
    const read = githubRead;
    githubAskedAt = yield* Clock.currentTimeMillis;
    const status = yield* served(client.github.status());
    if (read === githubRead && status.ok) write({ github: status.answer });
  });

  /** Reads the connection where none was asked for since a sign-out, or the last ask is older than its bound. */
  const readGithubWhenStale = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const fresh =
      githubAskedAt !== undefined && now - githubAskedAt < Duration.toMillis(GITHUB_READ_EVERY);
    if (!fresh) yield* readGithub;
  });

  /** The one follow of the account's sidebar sections and pinned repositories, from the first refresh after a launch or a sign-in until a sign-out. */
  const sidebarFollow = yield* FiberHandle.make<void>();

  /**
   * Follows the account's sidebar over Realtime where nothing follows it
   * yet (`workspaces-follow.ts`), polled while Realtime fails it, drawing
   * each change as it lands, a section or a pin made on another Mac among
   * them; nothing else reads it. A seal the service did not answer, or a
   * follow that stopped, is sealed again on the board's backoff, and what was
   * drawn stays meanwhile.
   */
  const followSidebar = Effect.gen(function* () {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    const seal = (poll: boolean, after?: string) =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : Effect.map(served(client.sidebarLive(userId, poll, after)), (sealed) =>
            sealed.ok ? sealed.answer : { failure: sealed.failure },
          );
    /** One seal followed until it stops, which fails it so the backoff seals it again. */
    const attempt = Effect.gen(function* () {
      const sealed = yield* seal(false);
      if ("failure" in sealed) return yield* Effect.fail(sealed.failure);
      const moves = sidebarMoves(
        {
          seal: () => seal(false),
          poll: (after) => seal(true, after),
          openLive: dependencies.openLive ?? openRealtimeClient,
          now: kernel.now,
        },
        sealed,
      );
      yield* Stream.runForEach(moves, (read) => Effect.sync(() => write(read))).pipe(Effect.ignore);
      return yield* Effect.fail(TASK_CALL_FAILURE.UNANSWERED);
    });
    const followed = attempt.pipe(
      Effect.retry({
        schedule: BOARD_BACKOFF,
        while: (why) => why !== LIVE_SIGNED_OUT.failure && gate(),
      }),
      Effect.ignore,
    );
    yield* FiberHandle.run(sidebarFollow, followed, { onlyIfMissing: true });
  });

  /**
   * Reads the active task's document. A copy of the same task already held
   * stays drawn while the read is out, and stays drawn through a read that
   * failed, so a save redraws in place and a moment offline blanks nothing;
   * with no copy held, the failure is what the panel draws.
   */
  function readDocument(taskId: string) {
    return Effect.gen(function* () {
      const held = heldTaskOf(taskId);
      if (held === undefined) write({ document: { status: TASKS_READ.READING } });
      const opened = yield* served(client.open(taskId));
      // Another task opened while this read was out: its answer is not the panel's any more.
      if (view.activeTaskId !== taskId) return;
      if (opened.ok) {
        write({ document: { status: TASKS_READ.READY, task: opened.answer } });
        return;
      }
      if (opened.failure === TASK_CALL_FAILURE.NOT_FOUND) {
        write({ document: { status: TASKS_READ.MISSING } });
        return;
      }
      write({
        document:
          held === undefined
            ? { status: TASKS_READ.FAILED }
            : { status: TASKS_READ.READY, task: held },
      });
    });
  }

  /** Reads the active task's board; a failed read keeps the board drawn. */
  function readBoard(taskId: string) {
    return Effect.gen(function* () {
      const board = yield* served(client.readBoard(taskId));
      if (board === undefined || view.activeTaskId !== taskId) return;
      write({ board });
    });
  }

  /** A code shown as the Code tab's card draws it: the lines around those pointed at, which the window colours. */
  function showingOf({ code, ...shown }: TaskShownCode): TaskCodeShowing {
    return { ...shown, code: codeExcerpt(code) };
  }

  /**
   * The code the record holds, oldest first, then each a call showed that
   * the record does not hold yet: one `show_code` call, told live and read
   * back, is one showing, matched by the call's id. Note that a showing
   * already held is kept as it is, bar the agent the record names it under,
   * so a refresh hands the Code tab the same showings and it draws none of
   * them again.
   */
  function withShownCode(recorded: readonly TaskShownCode[]): TaskCodeShowing[] {
    const byCall = new Map((view.shownCode ?? []).map((showing) => [showing.callId, showing]));
    const read = recorded.map((shown) => {
      const held = byCall.get(shown.callId);
      if (held === undefined) return showingOf(shown);
      // Note that a call's frame names no agent, so the record's copy lends the held showing its own.
      return shown.agentId === held.agentId || shown.agentId === undefined
        ? held
        : { ...held, agentId: shown.agentId };
    });
    const recordedCalls = new Set(recorded.map((shown) => shown.callId));
    const held = view.shownCode ?? [];
    return [...read, ...held.filter((showing) => !recordedCalls.has(showing.callId))];
  }

  /**
   * Reads the active task's pages, each by its newest version. A failed read
   * keeps the pages held, as a failed board read keeps the board.
   */
  function readPages(taskId: string) {
    return Effect.gen(function* () {
      const pages = yield* served(client.readPages(taskId));
      if (pages === undefined || view.activeTaskId !== taskId) return;
      const { pages: _held, ...rest } = view;
      view = pages.length === 0 ? rest : { ...rest, pages };
      publish();
    });
  }

  /**
   * Reads every code the active task's agents showed as the service keeps
   * it, typed turns' and calls' alike, laid with what a call showed. A
   * failed read keeps whatever is held, and says so; the read says it is
   * reading only after none or a failed one, as the workspaces' does.
   */
  function readShownCode(taskId: string) {
    return Effect.gen(function* () {
      if (view.activeTaskId === taskId && view.codeStatus !== TASKS_READ.READY) {
        write({ codeStatus: TASKS_READ.READING });
      }
      const stored = yield* served(client.readCode(taskId));
      if (view.activeTaskId !== taskId) return;
      if (stored === undefined) {
        write({ codeStatus: TASKS_READ.FAILED });
        return;
      }
      // Note that code is written even where none was shown, because none read is what the Code tab says and none unread is what it waits on.
      write({ shownCode: withShownCode(stored.code), codeStatus: TASKS_READ.READY });
    });
  }

  /**
   * Follows one of `taskId`'s live reads while it is the open task, each
   * move handed to `moved`, the first delivery among them. A seal the
   * service did not answer, or a follow that stops before it delivered, is
   * sealed again on `BOARD_BACKOFF`; a follow that delivered and then
   * stopped is sealed again after `BOARD_RESEAL.FIRST`, its backoff started
   * over. A task the service no longer holds, or a gate that closed, ends it.
   */
  function followLive<Answer extends object, Moved>(
    taskId: string,
    read: {
      readonly seal: (
        userId: string,
        poll: boolean,
        after: string | undefined,
      ) => Effect.Effect<
        TaskCallResult<Answer, TaskCallFailure | typeof LIVE_SIGNED_OUT.failure>,
        never,
        HttpClient.HttpClient
      >;
      readonly moves: (
        sealing: {
          readonly seal: () => Effect.Effect<Answer | Unsealed>;
          readonly poll: (after: string | undefined) => Effect.Effect<Answer | Unsealed>;
          readonly openLive: (url: string) => LiveClient | PromiseLike<LiveClient>;
          readonly now: () => number;
        },
        first: Answer,
      ) => Stream.Stream<Moved, LiveBroken>;
      readonly moved: (moved: Moved) => void;
      /** Hears the follow's wait on a write's transaction while it stands over Realtime (`liveRows`). */
      readonly onTxWait?: (wait: TxWait | undefined) => void;
    },
  ) {
    const following = () => gate() && view.activeTaskId === taskId;
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    const seal = (poll = false, after?: string): Effect.Effect<Answer | Unsealed> =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : Effect.map(served(read.seal(userId, poll, after)), (sealed) =>
            sealed.ok ? sealed.answer : { failure: sealed.failure },
          );
    // A task the account no longer reaches, or one no longer open, stops the follow rather than renewing or polling it.
    const sealedFor = (poll: boolean, after?: string): Effect.Effect<Answer | Unsealed> =>
      following()
        ? Effect.map(seal(poll, after), (renewed) =>
            isUnsealed(renewed) && renewed.failure === TASK_CALL_FAILURE.NOT_FOUND
              ? { ...renewed, gone: true }
              : renewed,
          )
        : Effect.succeed({ failure: BOARD_FOLLOW_ENDED, gone: true });
    /** One seal followed until it stops: whether it delivered, or why it never did. */
    const attempt = Effect.gen(function* () {
      if (!following()) return yield* Effect.fail(BOARD_FOLLOW_ENDED);
      const sealed = yield* seal();
      if (isUnsealed(sealed)) return yield* Effect.fail(sealed.failure);
      let delivered = false;
      const moves = read.moves(
        {
          seal: () => sealedFor(false),
          poll: (after) => sealedFor(true, after),
          openLive: dependencies.openLive ?? openRealtimeClient,
          now: kernel.now,
          ...(read.onTxWait === undefined ? undefined : { onTxWait: read.onTxWait }),
        },
        sealed,
      );
      yield* Stream.runForEach(moves, (moved) =>
        Effect.sync(() => {
          delivered = true;
          if (view.activeTaskId === taskId) read.moved(moved);
        }),
      ).pipe(Effect.ignore);
      if (!delivered) return yield* Effect.fail(TASK_CALL_FAILURE.UNANSWERED);
      return true;
    });
    const followed = attempt.pipe(
      Effect.retry({
        schedule: BOARD_BACKOFF,
        while: (why) =>
          why !== TASK_CALL_FAILURE.NOT_FOUND &&
          why !== LIVE_SIGNED_OUT.failure &&
          why !== BOARD_FOLLOW_ENDED &&
          following(),
      }),
      Effect.option,
    );
    return Effect.asVoid(
      Effect.repeat(followed, {
        schedule: Schedule.spaced(BOARD_RESEAL.FIRST),
        while: (delivered) => Option.isSome(delivered) && following(),
      }),
    );
  }

  /** Follows `taskId`'s board live while it is the open task: the board read again once its mark moves, and on each seal's first delivery. */
  function followBoard(taskId: string) {
    // The wait this follow handed out, so a follow let go clears only its own.
    let handed: TxWait | undefined;
    return followLive(taskId, {
      seal: (userId, poll, after) => client.boardLive(taskId, userId, poll, after),
      moves: boardMoves,
      moved: () => Queue.offerUnsafe(boardReads, taskId),
      onTxWait: (wait) => {
        if (wait !== undefined) {
          handed = wait;
          boardWait = { taskId, wait };
        } else if (boardWait !== undefined && boardWait.wait === handed) {
          boardWait = undefined;
        }
      },
    });
  }

  /**
   * Follows `taskId`'s pages and agents' code live while it is the open
   * task: the pages read again once theirs move, and the code once the
   * `show_code` calls its agents answered do, each on each seal's first
   * delivery.
   */
  function followRecord(taskId: string) {
    return followLive(taskId, {
      seal: (userId, poll, after) => client.recordLive(taskId, userId, poll, after),
      moves: taskRecordMoves,
      moved: (parts: readonly TaskRecordPart[]) => {
        if (parts.includes(TASK_RECORD_PART.PAGES)) Queue.offerUnsafe(pageReads, taskId);
        if (parts.includes(TASK_RECORD_PART.CODE)) Queue.offerUnsafe(codeReads, taskId);
      },
    });
  }

  /** Follows `taskId`'s pages and calls live, in place of any follow standing; with `standing`, only where none stands. */
  function openRecord(taskId: string, standing?: { readonly onlyIfMissing: true }) {
    return Effect.asVoid(FiberHandle.run(recordFollow, followRecord(taskId), standing));
  }

  /** Follows `taskId`'s board live, in place of any follow standing; with `standing`, only where none stands. */
  function openBoard(taskId: string, standing?: { readonly onlyIfMissing: true }) {
    return Effect.asVoid(FiberHandle.run(boardFollow, followBoard(taskId), standing));
  }

  /** Shows the call's activity; the board and the pages are read as their marks move (`followBoard`, `followRecord`). */
  function showActivity({ type: _type, planId: taskId, ...activity }: TaskActivityFrame): void {
    // The call's own copy is kept whatever task is open, for the floating
    // call window; the panel's is the active task's alone.
    if (view.activeTaskId !== taskId) {
      write({ callActivity: activity });
      return;
    }
    write({ activity, callActivity: activity });
  }

  /** Whether code shown about a task is still for the screen: the task is open and the call's code is not drawn already, since a call's code told again is the showing already drawn. */
  function showsCode(taskId: string, shown: TaskShownCode): boolean {
    if (view.activeTaskId !== taskId) return false;
    return !(view.shownCode ?? []).some((showing) => showing.callId === shown.callId);
  }

  function showCode(taskId: string, shown: TaskShownCode): void {
    if (showsCode(taskId, shown)) Queue.offerUnsafe(codeShows, { taskId, shown });
  }

  /** Draws a code shown after the rest, where it is still for the screen as the loop takes it. */
  function drawShownCode({ taskId, shown }: { taskId: string; shown: TaskShownCode }) {
    return Effect.sync(() => {
      if (showsCode(taskId, shown)) {
        write({ shownCode: [...(view.shownCode ?? []), showingOf(shown)] });
      }
    });
  }

  function callEnded(_taskId: string): void {
    const { callActivity: _ended, ...rest } = view;
    view = rest;
    publish();
  }

  /** The open document of `taskId` given the name its row of the list now reads, where the two differ. */
  function nameHeldAsListed(taskId: string): void {
    const held = heldTaskOf(taskId);
    const listed = view.tasks.find((row) => row.id === taskId);
    if (held === undefined || listed === undefined || listed.name === held.name) return;
    write({ document: { status: TASKS_READ.READY, task: { ...held, name: listed.name } } });
  }

  /**
   * Draws `task` as the service answered it, in the list's row and in the
   * open document where it is the one held. Note that the assignee standing
   * is dropped first, because an answer names one only where the task has
   * one, so an answer that names none is a task assigned to no one.
   */
  function takeAnswered(task: Task): void {
    const tasks = view.tasks.map((row) =>
      row.id === task.id ? { ...withoutAssignee(row), ...summaryOf(task) } : row,
    );
    const held = heldTaskOf(task.id);
    write(
      held === undefined
        ? { tasks }
        : {
            tasks,
            document: { status: TASKS_READ.READY, task: { ...withoutAssignee(held), ...task } },
          },
    );
  }

  /**
   * The list's row of `taskId` with the issues it links changed as the
   * service answered a change of them, so the Board's tags follow the task
   * page without a read of the whole list; a row left linking none names
   * none, as the list answers it. Note that it runs as a read of the
   * service does, one at a time, and each change is one a second time
   * changes no further, because a list read out when the change was made
   * may land before it and hold it already.
   */
  const retag = (
    taskId: string,
    change: (tags: readonly TaskIssueTag[]) => readonly TaskIssueTag[],
  ): Effect.Effect<void> =>
    serial(
      Effect.sync(() => {
        // A task the list does not hold, as one archived out of it, has no row to change.
        if (!view.tasks.some((row) => row.id === taskId)) return;
        const tasks = view.tasks.map((row) => {
          if (row.id !== taskId) return row;
          const { issues: before, ...rest } = row;
          const issues = change(before ?? []);
          return issues.length === 0 ? rest : { ...rest, issues };
        });
        write({ tasks });
      }),
    );

  /** The pin and the archive a task answered carries, each only where it stands. */
  function marksOf(task: Task): TaskMarkStamps {
    return {
      ...(task.pinnedAt === undefined ? undefined : { pinnedAt: task.pinnedAt }),
      ...(task.pinPosition === undefined ? undefined : { pinPosition: task.pinPosition }),
      ...(task.archivedAt === undefined ? undefined : { archivedAt: task.archivedAt }),
    };
  }

  /**
   * Draws the pin and the archive `task` was answered with on its row of the
   * list, and on the open document where it is the one held. Note that the
   * row keeps what the list said of the task's coding agents, which only the
   * list answers, and the held document keeps everything else it holds,
   * because a draft drawn during a call may be ahead of the copy the service
   * answered.
   */
  function takeMarks(task: Task): void {
    const tasks = view.tasks.map((row) =>
      row.id !== task.id
        ? row
        : {
            ...summaryOf(task),
            ...(row.agents === undefined ? undefined : { agents: row.agents }),
          },
    );
    const held = heldTaskOf(task.id);
    if (held === undefined) {
      write({ tasks });
      return;
    }
    const { pinnedAt: _pinned, pinPosition: _position, archivedAt: _archived, ...kept } = held;
    write({
      tasks,
      document: { status: TASKS_READ.READY, task: { ...kept, ...marksOf(task) } },
    });
  }

  /** Pins or archives one task on the service, or undoes either, and draws what it answered. */
  function markTask(taskId: string, marks: TaskMarks) {
    return serial(
      Effect.gen(function* () {
        const marked = yield* served(client.mark(taskId, marks));
        if (marked === undefined) return { changed: false };
        takeMarks(marked.task);
        return { changed: true };
      }),
    );
  }

  /**
   * One workspace call. The workspaces it moved arrive over the follow, and
   * the tasks a leave takes out of the list move with the followed list.
   */
  function workspaceCall<Answer>(
    call: Effect.Effect<WorkspaceCallResult<Answer>, never, HttpClient.HttpClient>,
  ): Effect.Effect<WorkspaceCallResult<Answer>> {
    return served(call);
  }

  /**
   * A write whose answer is the workspace as it then stands, drawn at once
   * unless the follow or another write's answer moved that workspace while
   * the write was out, since the view may then already hold a newer change, a
   * teammate's or a later edit's; the follow carries this write's change a
   * moment later either way.
   */
  function workspaceWrite(
    call: Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient>,
  ): Effect.Effect<TasksWorkspaceAnswer> {
    return Effect.gen(function* () {
      const movedBefore = new Map(workspaceMoves);
      const written = yield* served(call);
      if (!written.ok) return { failure: written.failure };
      const answered = written.answer;
      if (workspaceMoves.get(answered.id) === movedBefore.get(answered.id)) {
        workspaceMoves.set(answered.id, (workspaceMoves.get(answered.id) ?? 0) + 1);
        write({
          workspaces: view.workspaces.map((each) => (each.id === answered.id ? answered : each)),
        });
      }
      return { workspace: answered };
    });
  }

  const methods: GatewayMethodTable = {
    // The workspaces are followed beside the tasks rather than read before
    // them, from the first refresh after a launch or a sign-in; GitHub's
    // connection is read beside them where the last read is stale.
    [GATEWAY_METHOD.TASKS_REFRESH]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        if (view.listStatus === TASKS_READ.IDLE) write({ listStatus: TASKS_READ.READING });
        yield* FiberHandle.run(listFollow, followList, { onlyIfMissing: true });
        const open = view.activeTaskId;
        if (open !== undefined) yield* openBoard(open, { onlyIfMissing: true });
        if (open !== undefined) yield* openRecord(open, { onlyIfMissing: true });
        const tasks = serial(
          Effect.gen(function* () {
            const taskId = view.activeTaskId;
            if (taskId !== undefined) yield* readDocument(taskId);
            if (taskId !== undefined) yield* readBoard(taskId);
            if (taskId !== undefined) yield* readShownCode(taskId);
            if (taskId !== undefined) yield* readPages(taskId);
          }),
        );
        yield* followWorkspaces;
        yield* followSidebar;
        yield* Effect.all([tasks, readGithubWhenStale], { concurrency: "unbounded" });
        return {};
      }),
    // The panel coming forward, which may follow GitHub connected in the
    // browser, reads the connection no oftener than the bound allows; the
    // workspaces are followed and need no read.
    [GATEWAY_METHOD.WORKSPACES_REFRESH]: () =>
      Effect.gen(function* () {
        if (gate()) yield* readGithubWhenStale;
        return {};
      }),
    [GATEWAY_METHOD.TASKS_OPEN]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("opening a task names one task");
        if (!gate()) return { opened: false };
        const { taskId } = read.success;
        // Note that a call about the task left behind goes on standing,
        // because the call outlives the task on screen: moving it to this
        // task is this task's own Talk press.
        if (view.activeTaskId !== taskId) {
          view = {
            ...withoutActivity(view),
            activeTaskId: taskId,
            document: { status: TASKS_READ.READING },
          };
          publish();
        }
        yield* openBoard(taskId);
        yield* openRecord(taskId);
        yield* serial(
          Effect.gen(function* () {
            yield* readDocument(taskId);
            yield* readBoard(taskId);
            yield* readShownCode(taskId);
            yield* readPages(taskId);
          }),
        );
        return { opened: true };
      }),
    [GATEWAY_METHOD.TASKS_FILE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksFileParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a file names a task, a path, and a window of its lines");
        }
        if (!gate()) return carried<TasksFileAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, ...window } = read.success;
        const answer = yield* served(client.readFile(taskId, window));
        if (answer === undefined) {
          return carried<TasksFileAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        return carried<TasksFileAnswer>(answer);
      }),
    // A folder's listing is answered to the tree that asked and held nowhere:
    // the tree keeps the folders it has opened.
    [GATEWAY_METHOD.TASKS_TREE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksTreeParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "listing a folder names a task, or a workspace and its repository, and the folder's path",
          );
        }
        if (!gate()) return carried<TasksTreeAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const asked = read.success;
        const folder = {
          path: asked.path,
          ...(asked.recursive === undefined ? undefined : { recursive: asked.recursive }),
        };
        const answer = yield* served(
          "planId" in asked
            ? client.readTree(asked.planId, folder)
            : client.readRepositoryTree(asked, folder),
        );
        return carried<TasksTreeAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // The repository's skills are answered to the window that asked and held
    // nowhere: a skill added on GitHub is chosen on the next read.
    [GATEWAY_METHOD.TASKS_SKILLS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksSkillsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a repository's skills names the task, or a workspace and its repository",
          );
        }
        if (!gate()) {
          return carried<TasksSkillsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const asked = read.success;
        const answer = yield* served(
          "planId" in asked ? client.readSkills(asked.planId) : client.readRepositorySkills(asked),
        );
        return carried<TasksSkillsAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A pull request is answered to the link that asked, and kept for every
    // link asking it again for as long as `LINK_READ_KEPT` says.
    [GATEWAY_METHOD.TASKS_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPullRequestParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a pull request names a workspace, its repository, and the pull request's number",
          );
        }
        if (!gate()) {
          return carried<TasksPullRequestAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const answer = yield* Cache.get(pullRequestReads, linkReadKey(read.success));
        return carried<TasksPullRequestAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // An issue is answered as a pull request is: to the link that asked, and kept as it is.
    [GATEWAY_METHOD.TASKS_ISSUE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksIssueParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading an issue names a workspace, its repository, and the issue's number",
          );
        }
        if (!gate()) {
          return carried<TasksIssueAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const answer = yield* Cache.get(issueReads, linkReadKey(read.success));
        return carried<TasksIssueAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A repository's issues are answered as an issue is: to the picker that asked, and held nowhere.
    [GATEWAY_METHOD.TASKS_GITHUB_ISSUES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksGitHubIssuesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a repository's issues names a workspace, its repository, and words or a number where it asks for some",
          );
        }
        if (!gate()) {
          return carried<TasksGitHubIssuesAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { workspaceId, repository, query, number } = read.success;
        const ask = number !== undefined ? { number } : query !== undefined ? { query } : {};
        const answer = yield* served(client.readRepositoryIssues({ workspaceId, repository }, ask));
        return carried<TasksGitHubIssuesAnswer>(
          answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED },
        );
      }),
    // A task's linked issues, and each change of them, are answered to the
    // page that asked and held nowhere: the page draws what it was answered,
    // and reads again after each change.
    [GATEWAY_METHOD.TASKS_ISSUE_LINKS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksIssueLinksParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading a task's issues names the task");
        if (!gate()) return carried<TasksIssueLinksAnswer>(TASK_ISSUES_UNANSWERED);
        return carried<TasksIssueLinksAnswer>(
          yield* served(client.readIssueLinks(read.success.taskId)),
        );
      }),
    // A task's agents' Browser tabs are answered to the side panel that
    // asked and held nowhere, since each carries a page's address and title:
    // the panel draws what it was answered, and reads again while it stands.
    [GATEWAY_METHOD.TASKS_BROWSER_TABS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksBrowserTabsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a task's Browser tabs names the task");
        if (!gate()) return carried<TasksBrowserTabsAnswer>(TASK_ISSUES_UNANSWERED);
        return carried<TasksBrowserTabsAnswer>(
          yield* served(client.readBrowserTabs(read.success.taskId)),
        );
      }),
    [GATEWAY_METHOD.TASKS_ISSUE_LINK]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksIssueLinkParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("linking an issue names the task and the issue");
        }
        if (!gate()) return carried<TasksIssueLinkAnswer>(TASK_ISSUES_UNANSWERED);
        const { taskId, issue } = read.success;
        const answer = yield* served(client.linkIssue(taskId, issue));
        if ("issue" in answer) {
          const tag = issueTagOf(answer.issue);
          yield* retag(taskId, (tags) =>
            tags.some((each) => each.id === tag.id) ? tags : [...tags, tag],
          );
        }
        return carried<TasksIssueLinkAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_ISSUE_RELATE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksIssueRelateParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("relating an issue names the task, the link, and its keyword");
        }
        if (!gate()) return carried<TasksIssueRelateAnswer>(TASK_ISSUES_UNANSWERED);
        const { taskId, linkId, relation } = read.success;
        const answer = yield* served(client.relateIssue(taskId, linkId, relation));
        if ("issue" in answer) {
          const tag = issueTagOf(answer.issue);
          yield* retag(taskId, (tags) => tags.map((each) => (each.id === tag.id ? tag : each)));
        }
        return carried<TasksIssueRelateAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_ISSUE_UNLINK]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksIssueUnlinkParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("unlinking an issue names the task and the link");
        }
        if (!gate()) return carried<TasksIssueUnlinkAnswer>(TASK_ISSUES_UNANSWERED);
        const { taskId, linkId } = read.success;
        const answer = yield* served(client.unlinkIssue(taskId, linkId));
        if ("unlinked" in answer) {
          yield* retag(taskId, (tags) => tags.filter((each) => each.id !== linkId));
        }
        return carried<TasksIssueUnlinkAnswer>(answer);
      }),
    // A page of the history, and a revision beside the one before it, are
    // answered to the version history that asked and held nowhere: it keeps
    // what it read, and reads again as the task moves on.
    [GATEWAY_METHOD.TASKS_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "reading a plan's history names the task, and where an older page is read from",
          );
        }
        if (!gate()) {
          return carried<TasksRevisionsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, before } = read.success;
        const page = yield* served(client.readRevisions(taskId, before));
        return carried<TasksRevisionsAnswer>(page ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    [GATEWAY_METHOD.TASKS_REVISION]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a revision names a task and its number");
        if (!gate()) {
          return carried<TasksRevisionAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const revision = yield* served(client.readRevision(read.success.taskId, read.success.seq));
        return carried<TasksRevisionAnswer>(
          revision === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { revision },
        );
      }),
    // A page's version is answered to the frame that asked and held nowhere,
    // so its HTML never enters the view every window is told.
    [GATEWAY_METHOD.TASKS_PAGE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPageParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a page names a task, the page, and its version");
        }
        if (!gate()) return carried<TasksPageAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, pageId, version } = read.success;
        const page = yield* served(client.readPageVersion(taskId, pageId, version));
        return carried<TasksPageAnswer>(
          page === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { page },
        );
      }),
    // A plan's pages are answered to the Inbox that asked and held nowhere,
    // since the view holds the active plan's alone.
    // A plan's newest page of history is followed for its version history
    // while it stands, and told only as `TASKS_HISTORY_CHANGED`; a follow of
    // what is already followed does nothing.
    [GATEWAY_METHOD.TASKS_HISTORY_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(taskHistoryFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("following a task's history names the task");
        }
        if (!gate()) return {};
        const { taskId } = read.success;
        yield* FiberMap.run(historyFollows, taskId, followHistory(taskId), { onlyIfMissing: true });
        return {};
      }),
    [GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(taskHistoryFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("letting a task's history go names the task");
        }
        yield* FiberMap.remove(historyFollows, read.success.taskId);
        return {};
      }),
    // A plan's pages are followed for a window's Inbox while it draws an item
    // of that plan, and told only as `TASKS_PAGES_CHANGED`; a follow of what
    // is already followed does nothing.
    [GATEWAY_METHOD.TASKS_PAGES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(taskPagesFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("following a task's pages names the task");
        if (!gate()) return {};
        const { taskId } = read.success;
        yield* FiberMap.run(pagesFollows, taskId, followPages(taskId), { onlyIfMissing: true });
        return {};
      }),
    [GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(taskPagesFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("letting a task's pages go names the task");
        yield* FiberMap.remove(pagesFollows, read.success.taskId);
        return {};
      }),
    [GATEWAY_METHOD.TASKS_PAGES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPagesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading a task's pages names the task");
        if (!gate()) return carried<TasksPagesAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const pages = yield* served(client.readPages(read.success.taskId));
        return carried<TasksPagesAnswer>(
          pages === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { pages },
        );
      }),
    // A picture's bytes are answered to the window that asked and held
    // nowhere, so they never enter the view every window is told.
    [GATEWAY_METHOD.TASKS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPictureParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a picture names a task and the picture");
        if (!gate()) {
          return carried<TasksPictureAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const picture = yield* served(
          client.readPicture(read.success.planId, read.success.attachmentId),
        );
        return carried<TasksPictureAnswer>(picture);
      }),
    // A plan's comments are read past the window's cursor, held by the service while nothing changed.
    [GATEWAY_METHOD.TASKS_COMMENTS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksCommentsParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading a plan's comments names the plan and a cursor");
        if (!gate()) return carried<TasksCommentsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(client.comments(read.success.planId, read.success.after));
        return carried<TasksCommentsAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_COMMENT_START]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksCommentStartParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("starting a comment names a plan and the thread");
        if (!gate()) return carried<TasksCommentAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(client.startComment(read.success.planId, read.success.start));
        return carried<TasksCommentAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_COMMENT_ACT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksCommentActParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("changing a comment names a plan, a thread, and what to do");
        if (!gate()) return carried<TasksCommentAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(
          client.actOnComment(read.success.planId, read.success.threadId, read.success.action),
        );
        return carried<TasksCommentAnswer>(answer);
      }),
    // The picture is kept and its id answered to the editor that took it;
    // the plan's text names it once the editor lays its address in.
    [GATEWAY_METHOD.TASKS_PICTURE_KEEP]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPictureKeepParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("keeping a picture names a task and the picture");
        if (!gate()) {
          return carried<TasksPictureKeepAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const kept = yield* served(client.keepPicture(read.success.planId, read.success.picture));
        return carried<TasksPictureKeepAnswer>(kept);
      }),
    // The service answers the task as restored, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_RESTORE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRevisionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("restoring a revision names a task and its number");
        if (!gate()) return { restored: false };
        const { taskId, seq } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const restored = yield* served(client.restore(taskId, seq));
            if (restored === undefined) return { restored: false };
            takeAnswered(restored);
            return { restored: true };
          }),
        );
      }),
    // Leaving the task returns to the list, which was read when the tab
    // showed, and leaves its call standing, as opening another task does.
    [GATEWAY_METHOD.TASKS_CLOSE]: () =>
      Effect.gen(function* () {
        yield* FiberHandle.clear(boardFollow);
        yield* FiberHandle.clear(recordFollow);
        yield* serial(
          Effect.sync(() => {
            const { activeTaskId: _closed, ...rest } = withoutActivity(view);
            view = { ...rest, document: { status: TASKS_READ.IDLE } };
            publish();
          }),
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_START]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksStartRequestSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("starting a task names it, and its repository where it has one");
        }
        if (!gate()) return carried<TasksStartAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const request = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const started = yield* served(client.create(request));
            if (!started.ok) return carried<TasksStartAnswer>({ failure: started.failure });
            const { task, agent } = started.answer;
            // A task just started has had no call. A call about another task
            // is left to the start's own Talk press, which moves it here.
            view = {
              ...withoutActivity(view),
              activeTaskId: task.id,
              document: { status: TASKS_READ.READY, task },
            };
            publish();
            yield* openBoard(task.id);
            yield* openRecord(task.id);
            return carried<TasksStartAnswer>({
              planId: task.id,
              ...(agent === undefined ? undefined : { agentStart: agent }),
            });
          }),
        );
      }),
    // Note that the task's call ends before the task is deleted, open or not,
    // because a call still standing would go on writing a document that is gone.
    [GATEWAY_METHOD.TASKS_DELETE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksOpenParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("deleting a task names one task");
        if (!gate()) return { deleted: false };
        const { taskId } = read.success;
        yield* endTaskCall(taskId);
        return yield* serial(
          Effect.gen(function* () {
            const deleted = yield* served(client.delete(taskId));
            if (deleted === undefined) return { deleted: false };
            const tasks = view.tasks.filter((task) => task.id !== taskId);
            if (view.activeTaskId === taskId) {
              yield* FiberHandle.clear(boardFollow);
              yield* FiberHandle.clear(recordFollow);
              const { activeTaskId: _deleted, ...rest } = withoutActivity(view);
              view = { ...rest, document: { status: TASKS_READ.IDLE } };
            }
            write({ tasks });
            return { deleted: true };
          }),
        );
      }),
    // The service answers the task as renamed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRenameParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("renaming a task names it and its name");
        if (!gate()) return { renamed: false };
        const { taskId, name } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const written = yield* served(client.rename(taskId, { name }));
            if (written === undefined) return { renamed: false };
            const renamed = written.task;
            const tasks = view.tasks.map((task) =>
              task.id === taskId ? { ...task, name: renamed.name } : task,
            );
            const held = heldTaskOf(taskId);
            write(
              held === undefined
                ? { tasks }
                : {
                    tasks,
                    document: {
                      status: TASKS_READ.READY,
                      task: { ...held, name: renamed.name, document: renamed.document },
                    },
                  },
            );
            return { renamed: true };
          }),
        );
      }),
    // The service answers the task as changed, so the list's row and the open
    // document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_SET_STANDING]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksSetStandingParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "setting where a task stands names it and its status, priority, or assignee",
          );
        }
        if (!gate()) return { changed: false };
        const { taskId, ...standing } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const changed = yield* served(client.setStanding(taskId, standing));
            if (changed === undefined) return { changed: false };
            takeAnswered(changed.task);
            return { changed: true };
          }),
        );
      }),
    [GATEWAY_METHOD.TASKS_PIN]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPinParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("pinning a task names it and whether it is pinned");
        }
        if (!gate()) return { changed: false };
        const { taskId, pinned, position } = read.success;
        return yield* markTask(
          taskId,
          position === undefined ? { pinned } : { pinned, pinPosition: position },
        );
      }),
    // The service answers the pins as they then stand, so the view takes its
    // word rather than the window's guess.
    [GATEWAY_METHOD.TASKS_PIN_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksPinRepositoryParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("pinning a repository names it and whether it is pinned");
        }
        if (!gate()) return { changed: false };
        const { repository, pinned } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const answer = yield* served(client.pinRepository(repository, pinned));
            if (answer === undefined) return { changed: false };
            write({ repositoryPins: answer.pins });
            return { changed: true };
          }),
        );
      }),
    // The service answers the sections as they then stand, as it does the pins.
    [GATEWAY_METHOD.TASKS_WRITE_SECTION]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWriteSectionParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("a change to a section names what it changes");
        }
        if (!gate()) return { changed: false };
        const asked = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const written = yield* served(client.writeTaskSection(asked));
            if (written === undefined) return { changed: false };
            const { txid: _txid, ...sections } = written;
            write({ taskSections: sections });
            return { changed: true };
          }),
        );
      }),
    // Note that an archived task stays open where it is the open one: leaving
    // it is the window's to ask, as it is for any task.
    [GATEWAY_METHOD.TASKS_ARCHIVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksArchiveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("archiving a task names it and whether it is archived");
        }
        if (!gate()) return { changed: false };
        return yield* markTask(read.success.taskId, { archived: read.success.archived });
      }),
    // The list is the service's answer whole, read now and held nowhere: the
    // panel asks again whenever its chip opens, so an App installed meanwhile
    // shows on the next opening.
    [GATEWAY_METHOD.TASKS_REPOSITORIES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksRepositoriesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("listing repositories names the workspace they are for, or none");
        }
        if (!gate()) {
          return carried<TasksRepositoriesAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const listed = yield* served(client.repositories(read.success.workspaceId));
        return carried<TasksRepositoriesAnswer>(
          listed.ok ? { repositories: listed.answer } : { failure: listed.failure },
        );
      }),
    // The service answers the task as changed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_SET_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksSetRepositoryParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("giving a task its repository names the task and the repository");
        }
        if (!gate()) {
          return carried<TasksSetRepositoryAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, repository } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const changed = yield* served(client.setRepository(taskId, repository));
            if (!changed.ok) return carried<TasksSetRepositoryAnswer>({ failure: changed.failure });
            takeAnswered(changed.answer.task);
            return carried<TasksSetRepositoryAnswer>({
              repository: changed.answer.task.repository,
            });
          }),
        );
      }),
    // The service answers the task as moved, so the list's row and the open
    // document take its workspace in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_MOVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksMoveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("moving a task names the task and the workspace");
        }
        if (!gate()) {
          return carried<TasksMoveAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, workspaceId } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const moved = yield* served(client.move(taskId, workspaceId));
            if (!moved.ok) return carried<TasksMoveAnswer>({ failure: moved.failure });
            takeAnswered(moved.answer.task);
            return carried<TasksMoveAnswer>({ workspaceId: moved.answer.task.workspaceId });
          }),
        );
      }),
    // The task the service answered is drawn in place, so the edit stands on
    // the document at once and the notetaker's drafts drawn before it drop.
    [GATEWAY_METHOD.TASKS_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksEditParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("an edit names a task, and its document's base and value");
        }
        if (!gate()) return carried<TasksEditAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, edit } = read.success;
        return yield* serial(
          Effect.gen(function* () {
            const edited = yield* served(client.edit(taskId, edit));
            if (!edited.ok) return carried<TasksEditAnswer>({ failure: edited.failure });
            const answer = edited.answer;
            if ("conflict" in answer)
              return carried<TasksEditAnswer>({ conflict: answer.conflict });
            if ("refused" in answer) return carried<TasksEditAnswer>({ failure: answer.refused });
            takeAnswered(answer.plan);
            return carried<TasksEditAnswer>({ saved: true });
          }),
        );
      }),
    // The browser connects or disconnects GitHub, so the panel coming
    // forward again reads the connection whatever the bound says.
    [GATEWAY_METHOD.GITHUB_CONNECT]: () =>
      Effect.gen(function* () {
        if (!gate()) return carried<TasksGitHubPageAnswer>(GITHUB_PAGE_UNANSWERED);
        const page = yield* served(client.github.connect());
        githubAskedAt = undefined;
        return carried<TasksGitHubPageAnswer>(
          page.ok ? { url: page.answer.url } : GITHUB_PAGE_UNANSWERED,
        );
      }),
    // The view takes the connection the service answers at once, so Settings
    // reads disconnected without waiting for the next read of it.
    [GATEWAY_METHOD.GITHUB_DISCONNECT]: () =>
      Effect.gen(function* () {
        if (!gate()) return carried<TasksGitHubDisconnectAnswer>(GITHUB_PAGE_UNANSWERED);
        const disconnected = yield* served(client.github.disconnect());
        githubAskedAt = undefined;
        if (!disconnected.ok) {
          return carried<TasksGitHubDisconnectAnswer>({ failure: disconnected.failure });
        }
        // Note that a read started before the answer is made stale, because
        // the status it read may predate the unlink.
        githubRead += 1;
        write({ github: disconnected.answer });
        return carried<TasksGitHubDisconnectAnswer>({ connection: disconnected.answer });
      }),
    [GATEWAY_METHOD.WORKSPACES_CREATE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceCreateParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("making a workspace names it");
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const made = yield* workspaceCall(client.workspaces.create(read.success.name));
        return carried<TasksWorkspaceAnswer>(
          made.ok ? { workspace: made.answer } : { failure: made.failure },
        );
      }),
    // A rename moves no task: the answered workspace lands at once, and the
    // follow carries the same name a moment later.
    [GATEWAY_METHOD.WORKSPACES_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceRenameParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("renaming a workspace names it and its new name");
        }
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, name } = read.success;
        return carried<TasksWorkspaceAnswer>(
          yield* workspaceWrite(client.workspaces.rename(workspaceId, name)),
        );
      }),
    // A photo moves no task either, so it is a rename's twin: the answered
    // workspace, its photo's new version or none, lands; the window's tiles
    // read the photo by it.
    [GATEWAY_METHOD.WORKSPACES_PHOTO_SET]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspacePhotoSetParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("setting a workspace's photo names it and a photo or none");
        }
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, photo } = read.success;
        return carried<TasksWorkspaceAnswer>(
          yield* workspaceWrite(client.workspaces.setPhoto(workspaceId, photo)),
        );
      }),
    // The install address is answered to the caller that opens it and held
    // nowhere: the connection lands in the browser, and the follow carries
    // the organization.
    [GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("connecting GitHub names a workspace");
        if (!gate()) return carried<TasksWorkspaceGitHubConnectAnswer>(WORKSPACE_UNANSWERED);
        const begun = yield* served(client.workspaces.githubConnect(read.success.workspaceId));
        return carried<TasksWorkspaceGitHubConnectAnswer>(
          begun.ok ? { url: begun.answer } : { failure: begun.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("disconnecting GitHub names a workspace");
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const disconnected = yield* workspaceCall(
          client.workspaces.githubDisconnect(read.success.workspaceId),
        );
        return carried<TasksWorkspaceAnswer>(
          disconnected.ok ? { workspace: disconnected.answer } : { failure: disconnected.failure },
        );
      }),
    // Vercel Connect's address is answered to the caller that opens it and
    // held nowhere: the grant lands in the browser, and the follow carries
    // the connection.
    [GATEWAY_METHOD.WORKSPACES_LINEAR_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("connecting Linear names a workspace");
        if (!gate()) return carried<TasksWorkspaceGitHubConnectAnswer>(WORKSPACE_UNANSWERED);
        const begun = yield* served(client.workspaces.linearConnect(read.success.workspaceId));
        return carried<TasksWorkspaceGitHubConnectAnswer>(
          begun.ok ? { url: begun.answer } : { failure: begun.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_LINEAR_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("disconnecting Linear names a workspace");
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const disconnected = yield* workspaceCall(
          client.workspaces.linearDisconnect(read.success.workspaceId),
        );
        return carried<TasksWorkspaceAnswer>(
          disconnected.ok ? { workspace: disconnected.answer } : { failure: disconnected.failure },
        );
      }),
    // The issues are answered to the window that asked and held nowhere: a
    // picker reads them as it opens and as its search changes.
    [GATEWAY_METHOD.WORKSPACES_LINEAR_ISSUES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksLinearIssuesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("reading Linear issues names a workspace");
        if (!gate()) return carried<TasksLinearIssuesAnswer>(WORKSPACE_UNANSWERED);
        const listed = yield* served(client.workspaces.linearIssues(read.success));
        return carried<TasksLinearIssuesAnswer>(
          listed.ok ? { issues: listed.answer } : { failure: listed.failure },
        );
      }),
    // The members, and who the workspace's work names but left, are answered to the window that asked and held nowhere:
    // it keeps what it read, and reads again as it opens. A read moves
    // nothing, so nothing else is read with it.
    // A window follows a workspace's people while it draws them; following
    // again starts over, so a window that follows later hears where they
    // stand, and letting them go ends it.
    [GATEWAY_METHOD.WORKSPACES_PEOPLE_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(workspacePeopleFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("a follow names a workspace");
        if (!gate()) return {};
        const { workspaceId } = read.success;
        yield* FiberMap.run(peopleFollows, workspaceId, followPeople(workspaceId));
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_PEOPLE_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(workspacePeopleFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("a follow names a workspace");
        yield* FiberMap.remove(peopleFollows, read.success.workspaceId);
        return {};
      }),
    // An owner's or an admin's window follows a workspace's invitations as
    // it follows its people.
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(workspacePeopleFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("a follow names a workspace");
        if (!gate()) return {};
        const { workspaceId } = read.success;
        yield* FiberMap.run(invitationFollows, workspaceId, followInvitations(workspaceId));
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = readEither(workspacePeopleFollowSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("a follow names a workspace");
        yield* FiberMap.remove(invitationFollows, read.success.workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_MEMBERS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceMembersParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading members names a workspace");
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const people = yield* served(client.workspaces.people(read.success.workspaceId));
        return carried<TasksWorkspaceMembersAnswer>(
          !people.ok
            ? { failure: people.failure }
            : people.answer.former.length === 0
              ? { members: people.answer.members }
              : { members: people.answer.members, former: people.answer.former },
        );
      }),
    // A photo is answered to the window that asked and held nowhere, as
    // the members are: the window keeps it under the version the list
    // named, and the list itself never carries its bytes.
    [GATEWAY_METHOD.WORKSPACES_PHOTO]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspacePhotoParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading a photo names a workspace");
        if (!gate()) return carried<TasksWorkspacePhotoAnswer>(WORKSPACE_UNANSWERED);
        const photo = yield* served(client.workspaces.photo(read.success.workspaceId));
        return carried<TasksWorkspacePhotoAnswer>(
          photo.ok ? photo.answer : { failure: photo.failure },
        );
      }),
    // A workspace's token repositories, and each change of them, are
    // answered to the page that asked and held nowhere, as the members are:
    // they move no task and no workspace the view holds.
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceTokenRepositoriesParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("reading a workspace's token repositories names the workspace");
        }
        if (!gate()) return carried<TasksWorkspaceTokenRepositoriesAnswer>(WORKSPACE_UNANSWERED);
        const listed = yield* served(client.workspaces.tokenRepositories(read.success.workspaceId));
        return carried<TasksWorkspaceTokenRepositoriesAnswer>(
          listed.ok ? { repositories: listed.answer } : { failure: listed.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORY_SET]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceTokenRepositorySetParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid(
            "adding or removing a token repository names the workspace, the repository, and which",
          );
        }
        if (!gate()) return carried<TasksWorkspaceTokenRepositoriesAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, repository, added } = read.success;
        const changed = yield* served(
          client.workspaces.setTokenRepository(workspaceId, repository, added),
        );
        return carried<TasksWorkspaceTokenRepositoriesAnswer>(
          changed.ok ? { repositories: changed.answer } : { failure: changed.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceMemberRemoveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("removing a member names the workspace and the member");
        }
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId } = read.success;
        const remaining = yield* workspaceCall(client.workspaces.removeMember(workspaceId, userId));
        return carried<TasksWorkspaceMembersAnswer>(
          remaining.ok ? { members: remaining.answer } : { failure: remaining.failure },
        );
      }),
    // A role changed moves no task; the follow carries it, as a removal's.
    [GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceMemberRoleParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("changing a role names the workspace, the member, and the role");
        }
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId, role } = read.success;
        const changed = yield* workspaceCall(
          client.workspaces.changeRole(workspaceId, userId, role),
        );
        return carried<TasksWorkspaceMembersAnswer>(
          changed.ok ? { members: changed.answer } : { failure: changed.failure },
        );
      }),
    // Note that a handover changes the account's own role in the workspace,
    // which the view's workspaces carry and every owner's and admin's act is
    // drawn from, and which the follow carries; it moves no task.
    [GATEWAY_METHOD.WORKSPACES_TRANSFER]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceTransferParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("handing a workspace over names it and the admin");
        }
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId } = read.success;
        const handedOver = yield* workspaceCall(client.workspaces.transfer(workspaceId, userId));
        return carried<TasksWorkspaceMembersAnswer>(
          handedOver.ok ? { members: handedOver.answer } : { failure: handedOver.failure },
        );
      }),
    // Note that a leave ends a call about any task of the workspace left,
    // the open one or one closed since, and closes the open task where it is
    // that workspace's, as a delete of it does, because the account can no
    // longer read or write a task of a workspace it left; a refused leave
    // ends and closes nothing.
    [GATEWAY_METHOD.WORKSPACES_LEAVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceLeaveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("leaving a workspace names it");
        if (!gate()) return carried<TasksWorkspaceLeaveAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId } = read.success;
        const openTaskId = view.activeTaskId;
        const openWorkspaceId = view.tasks.find((task) => task.id === openTaskId)?.workspaceId;
        const departedTaskIds = view.tasks
          .filter((task) => task.workspaceId === workspaceId)
          .map((task) => task.id);
        // A standing call is ended only by its own task's id, so each task left is named.
        const endDepartedCalls = Effect.forEach(departedTaskIds, (taskId) => endTaskCall(taskId), {
          discard: true,
        });
        const closeOpenTask = Effect.gen(function* () {
          yield* serial(
            Effect.gen(function* () {
              if (view.activeTaskId !== openTaskId) return;
              yield* FiberHandle.clear(boardFollow);
              yield* FiberHandle.clear(recordFollow);
              const { activeTaskId: _left, ...rest } = withoutActivity(view);
              view = { ...rest, document: { status: TASKS_READ.IDLE } };
              publish();
            }),
          );
        });
        const leave = Effect.tap(client.workspaces.leave(workspaceId), (answer) =>
          answer.ok
            ? Effect.andThen(
                endDepartedCalls,
                openWorkspaceId === workspaceId ? closeOpenTask : Effect.void,
              )
            : Effect.void,
        );
        const left = yield* workspaceCall(leave);
        return carried<TasksWorkspaceLeaveAnswer>(
          left.ok ? { left: true } : { failure: left.failure },
        );
      }),
    // An invitation is answered to the window that asked and held nowhere,
    // and moves no workspace or task, so nothing else is read with it.
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) return yield* invalid("reading invitations names a workspace");
        if (!gate()) return carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED);
        const pending = yield* served(client.workspaces.invitations(read.success.workspaceId));
        return carried<TasksWorkspaceInvitationsAnswer>(
          pending.ok ? { invitations: pending.answer } : { failure: pending.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceInviteParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("an invitation names a workspace, an address, and a role");
        }
        if (!gate()) return carried<TasksWorkspaceInvitationAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, email, role } = read.success;
        const made = yield* served(client.workspaces.invite(workspaceId, email, role));
        return carried<TasksWorkspaceInvitationAnswer>(
          made.ok ? { invitation: made.answer } : { failure: made.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksWorkspaceInvitationCancelParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read)) {
          return yield* invalid("canceling an invitation names the workspace and the invitation");
        }
        if (!gate()) return carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, invitationId } = read.success;
        const pending = yield* served(
          client.workspaces.cancelInvitation(workspaceId, invitationId),
        );
        return carried<TasksWorkspaceInvitationsAnswer>(
          pending.ok ? { invitations: pending.answer } : { failure: pending.failure },
        );
      }),
    // A save of another task than the open one is dropped: its board is not drawn.
    [GATEWAY_METHOD.TASKS_BOARD_SAVE]: (params) =>
      Effect.gen(function* () {
        const read = readEither(tasksBoardSaveParamsSchema)(unparsedWire(params));
        if (Result.isFailure(read))
          return yield* invalid("saving a board names a task and its scene");
        const { taskId, elements, appliedDrawing, image } = read.success;
        if (!gate() || view.activeTaskId !== taskId) return { saved: false };
        const saved = yield* serial(
          Effect.gen(function* () {
            const answer = yield* served(client.saveBoard(taskId, elements, appliedDrawing, image));
            if (answer !== undefined && view.activeTaskId === taskId)
              write({ board: answer.board });
            return answer;
          }),
        );
        if (saved === undefined) return { saved: false };
        // Note that the save is answered once the board's follow has seen its transaction, outside `serial` so the wait holds up nothing else.
        yield* confirmWrite(boardWait?.taskId === taskId ? boardWait.wait : undefined, saved.txid);
        return { saved: true };
      }),
  };

  return {
    methods,
    snapshot: () => view,
    activeTaskId: () => view.activeTaskId,
    showActivity,
    showCode,
    callEnded,
    reset: Effect.gen(function* () {
      yield* endTaskCall(undefined);
      yield* Cache.invalidateAll(pullRequestReads);
      yield* Cache.invalidateAll(issueReads);
      yield* FiberHandle.clear(boardFollow);
      yield* FiberMap.clear(pagesFollows);
      yield* FiberMap.clear(historyFollows);
      yield* FiberHandle.clear(recordFollow);
      yield* FiberHandle.clear(listFollow);
      yield* FiberHandle.clear(workspacesFollow);
      yield* FiberHandle.clear(sidebarFollow);
      yield* FiberMap.clear(peopleFollows);
      yield* FiberMap.clear(invitationFollows);
      yield* serial(
        Effect.sync(() => {
          githubAskedAt = undefined;
          githubRead += 1;
          view = idleView();
          publish();
        }),
      );
    }),
    // The code a call shows, coloured in turn, and the board, page, and code
    // reads their followed marks ask for; every other read of the tasks is an
    // ask's.
    lifetime: Effect.gen(function* () {
      yield* Effect.forkScoped(
        // A showing that dies is reported and dropped, and the next is still drawn.
        Effect.forever(
          Effect.flatMap(Queue.take(codeShows), (show) =>
            catchAllButInterrupt(drawShownCode(show), (cause) =>
              Effect.sync(() => {
                kernel.report(`Drawing code a call showed failed: ${Cause.pretty(cause)}`);
              }),
            ),
          ),
        ),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(boardReads), (taskId) =>
            gate() ? serial(readBoard(taskId)) : Effect.void,
          ),
        ),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(pageReads), (taskId) =>
            gate() ? serial(readPages(taskId)) : Effect.void,
          ),
        ),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(codeReads), (taskId) =>
            Effect.suspend(() =>
              gate() && view.activeTaskId === taskId ? serial(readShownCode(taskId)) : Effect.void,
            ),
          ),
        ),
      );
    }),
  };
});
