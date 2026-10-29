import {
  type HostedAdminClient,
  type HostedGitHubConnectionClient,
  type HostedTaskClient,
  type HostedWorkspaceClient,
  type TaskCallResult,
  type TaskMarks,
  WORKSPACE_CALL_FAILURE,
  type WorkspaceCallFailure,
  type WorkspaceCallResult,
} from "@luke/features";
import {
  ADMIN_UNANSWERED,
  type AdminReadAnswer,
  adminFavoriteParamsSchema,
  adminReadParamsSchema,
} from "@luke/features/admin-wire";
import { type BrowserTabsPlace, browserTabsPlaceId } from "@luke/features/agent-browser-tab-wire";
import {
  browserTabsOfLiveRows,
  LIVE_SIGNED_OUT,
  nextBrowserTabLapse,
  pagesOfLiveRows,
  revisionsOfLiveRows,
  taskBrowserTabsLiveRowsSchema,
  taskHistoryLiveRowsSchema,
  taskPagesLiveRowsSchema,
} from "@luke/features/live-wire";
import { type PagePlace, pagePlaceId } from "@luke/features/page-wire";
import { TASK_STATUS, type Task } from "@luke/features/task-wire";
import {
  HOST_LIVE,
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskCallFailure,
  type TasksBrowserTabOpenAnswer,
  type TasksBrowserTabsAnswer,
  type TasksCommentAnswer,
  type TasksCommentsAnswer,
  type TasksDocument,
  type TasksEditAnswer,
  type TasksFileAnswer,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
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
  type TasksWorkspaceSentryAnswer,
  type TasksWorkspaceTokenRepositoriesAnswer,
  taskBrowserTabsFollowSchema,
  taskHistoryFollowSchema,
  taskPagesFollowSchema,
  tasksBrowserTabOpenParamsSchema,
  tasksBrowserTabsParamsSchema,
  tasksCommentActParamsSchema,
  tasksCommentStartParamsSchema,
  tasksCommentsParamsSchema,
  tasksEditParamsSchema,
  tasksFileParamsSchema,
  tasksIssueParamsSchema,
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
  tasksWorkspaceSentryDisconnectParamsSchema,
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
  readParams,
} from "@luke/gateway";
import { keepIdentity } from "@luke/wire";
import {
  Cache,
  Clock,
  Data,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberHandle,
  FiberMap,
  Option,
  Queue,
  Schedule,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { fixturePage } from "./fixture-stage.js";
import type { HostKernel } from "./host-kernel.js";
import { ROW_GONE, type RowWrite } from "./live-collection.js";
import {
  confirmWrite,
  LIVE_GONE,
  type LiveBroken,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";
import { pushLive } from "./live-push.js";
import type { RunMode } from "./run-mode.js";
import { sidebarCollections } from "./sidebar-collections.js";
import { type AgentRow, type PlanRow, taskListCollections } from "./task-list-collections.js";
import { followTaskList } from "./task-list-follow.js";
import { TASK_RECORD_PART, type TaskRecordMove, taskRecordMoves } from "./task-record-follow.js";
import {
  followSidebarRows,
  invitationsMoves,
  type LiveReadDependencies,
  peopleMoves,
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
 * and is read by none of those asks. The repositories the account reaches, and a task's repository
 * given or taken away, are the service's too, asked through here, as is a
 * task pinned. A
 * plan's history is read for the version history that asks and held nowhere
 * here; a revision restored is the one write this concern carries to the
 * service on the developer's word, and the view takes the task it answers.
 * The pages agents wrote for the open task are listed with its document, by
 * title and newest version alone, and again whenever their mark moves; a
 * page's HTML is answered to the frame that draws it and held nowhere here.
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

/** A task's pin and where it stands as the list carries them, each only where it stands. */
type TaskMarkStamps = Pick<Task, "pinnedAt" | "pinPosition">;

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

/** A call on a task's Browser tabs behind a closed gate, or of a service that did not answer. */
const BROWSER_TABS_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

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
  | "recordLive"
  | "pagesLive"
  | "historyLive"
  | "browserTabsLive"
  | "readFile"
  | "readTree"
  | "readSkills"
  | "readRepositoryFile"
  | "readRepositoryTree"
  | "readRepositorySkills"
  | "readRepositoryPullRequest"
  | "readRepositoryIssue"
  | "readBrowserTabs"
  | "openBrowserTab"
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
    | "sentryInstallations"
    | "sentryInstall"
    | "sentryDisconnect"
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
  /** The admin dashboard's reads and its star, under the account's session; the service's gate decides each. */
  admin: Pick<HostedAdminClient, "read" | "favorite">;
};

export interface TasksDependencies {
  kernel: Pick<HostKernel, "emit" | "now"> & { runMode: Pick<RunMode, "sendsNetwork"> };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: TasksClient;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
}

export interface TasksComposer extends Composer {
  /** The view as this Mac holds it now. */
  snapshot: () => TasksView;
  /** Drops everything held, for a sign-out, and tells every client the panel has nothing. */
  reset: Effect.Effect<void>;
  /**
   * Waits for a write's transaction to arrive on the task list followed
   * live, which holds every task and agent row, so a write is confirmed once
   * the list carries it; no txid, or a list not followed over Realtime,
   * waits for nothing.
   */
  listed: (txid: string | undefined) => Effect.Effect<void>;
  /**
   * A change to an agent's row of the list, drawn at once and standing
   * while `written` writes it: kept once the followed list carries its
   * transaction, taken back where the service refused it, so the coding
   * agents' own writes draw as the list's do (`task-list-collections.ts`).
   */
  writeAgent: RowWrite<AgentRow>;
}

/** The statuses a task stands finished in, which the service stamps `completedAt` as it enters. */
const FINISHED: ReadonlySet<string> = new Set([TASK_STATUS.DONE, TASK_STATUS.CANCELED]);

/**
 * How long a live follow waits before sealing again after a seal the
 * service did not answer, or a follow that stopped: the first wait, doubling
 * on each that fails again, up to the longest.
 */
const FOLLOW_RESEAL = { FIRST: Duration.seconds(2), LONGEST: Duration.minutes(1) } as const;

const FOLLOW_BACKOFF = Schedule.exponential(FOLLOW_RESEAL.FIRST).pipe(
  Schedule.modifyDelay(({ duration }) =>
    Effect.succeed(Duration.min(duration, FOLLOW_RESEAL.LONGEST)),
  ),
);

/**
 * How long after a resync another is let pass, so a wake that lands as
 * several events at once (resume, then unlock) seals the list again once.
 */
const RESYNC_SETTLE = Duration.seconds(10);

/** Why a live follow is not sealed again: the task is no longer the open one, or the gate closed. */
const FOLLOW_ENDED = "ended";

/** A live read the service did not seal, `gone` where the task is no longer the account's. */
type Unsealed = { readonly failure: string; readonly gone?: boolean };

/** Whether a seal is one the service did not answer. */
function isUnsealed<Answer extends object>(sealed: Answer | Unsealed): sealed is Unsealed {
  return "failure" in sealed;
}

/** The parts of an open task read apart from its document, each laid over the view as it lands, then the document itself and its pin. */
const OPENED_PART = {
  PAGES: "pages",
  DOCUMENT: "document",
  MARKS: "marks",
} as const;

type OpenedPart = (typeof OPENED_PART)[keyof typeof OPENED_PART];

/**
 * The panel's tasks as one concern. The view is told to every client whole
 * whenever it moves, and exactly one task is active at a time: opening or
 * starting one replaces whichever was, and a read still out for the replaced
 * task is dropped when it lands. The Tasks tab showing reads the list and the
 * open task again, while the open task stands through the tab hiding. Behind a
 * closed account gate, or on a run that sends nothing, nothing is read.
 */
export const composeTasks = /* @__PURE__ */ Effect.fn("host/composeTasks")(function* (
  dependencies: TasksDependencies,
): Effect.fn.Return<TasksComposer, never, Scope.Scope | HttpClient.HttpClient> {
  const { kernel, account, client } = dependencies;
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
   * that left before a task started would otherwise land last and roll the
   * view back. The open task's document and parts are read outside it,
   * ordered by their own numbers instead (`partReads`).
   */
  const serial = (yield* Semaphore.make(1)).withPermits(1);

  let view: TasksView = idleView();
  let published: TasksView = view;
  /**
   * Every ask to change the task on screen, an open, a close, or a start
   * that opens its task, counted as it arrives. Note that a start opens its
   * task only while it is still the newest of them, because one answered
   * after the developer went to another task would turn the window back.
   */
  let screenAsks = 0;

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

  /** The view with no pages read or told, as a task left behind leaves it. */
  function withoutPages({ pages: _pages, ...rest }: TasksView): TasksView {
    return rest;
  }

  /** The one live follow of the open task's plan and pages; running another interrupts it. */
  const recordFollow = yield* FiberHandle.make<void>();

  /** The tasks whose pages' mark moved, read one at a time by the loop below. */
  const pageReads = yield* Queue.sliding<string>(1);

  /** The tasks whose plan was saved past the copy held, read one at a time by the loop below. */
  const planReads = yield* Queue.sliding<string>(1);

  /** When the open task's plan was last saved, as its record's follow last delivered it. */
  let planSaved: { readonly taskId: string; readonly at: number } | undefined;

  /** The newest page of each task's history a window's version history follows, by the task. */
  const historyFollows = yield* FiberMap.make<string>();
  const decodeHistory = Schema.decodeUnknownOption(taskHistoryLiveRowsSchema);
  /** How to wait for a write's transaction on each task's followed history, while it is live. */
  const historyTxWaits = new Map<string, TxWait>();

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
      publish: (page) =>
        kernel.emit(
          GATEWAY_EVENT.TASKS_HISTORY_CHANGED,
          carried({ taskId, view: page ?? { failure: TASK_CALL_FAILURE.UNANSWERED } }),
        ),
      onTxWait: (wait) => {
        if (wait === undefined) historyTxWaits.delete(taskId);
        else historyTxWaits.set(taskId, wait);
      },
    });
  }

  /** The Browser tabs of each agent or task a window's side panel follows, by the agent's or the task's id, which never collide. */
  const browserTabsFollows = yield* FiberMap.make<string>();
  const decodeBrowserTabs = Schema.decodeUnknownOption(taskBrowserTabsLiveRowsSchema);

  /**
   * Follows the Browser tabs of `place`, one agent's or a task's agents',
   * live until let go, each change emitted as
   * `TASKS_BROWSER_TABS_CHANGED`. A takeover lapses with no row moving, so
   * the rows last delivered are told again at each instant one lapses, until
   * the next delivery takes their place.
   */
  function followBrowserTabs(place: BrowserTabsPlace) {
    type Rows = typeof taskBrowserTabsLiveRowsSchema.Type;
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    const tell = (rows: Rows | undefined, now: number) =>
      kernel.emit(
        GATEWAY_EVENT.TASKS_BROWSER_TABS_CHANGED,
        carried({
          ...place,
          view:
            rows === undefined
              ? { failure: TASK_CALL_FAILURE.UNANSWERED }
              : { tabs: browserTabsOfLiveRows(rows, now) },
        }),
      );
    // The rows told as they arrive, then again at each takeover's lapse in turn.
    const toldUntilMoved = (rows: Rows | undefined) =>
      Effect.gen(function* () {
        let now = yield* Clock.currentTimeMillis;
        tell(rows, now);
        if (rows === undefined) return;
        let lapse = nextBrowserTabLapse(rows, now);
        while (lapse !== undefined) {
          yield* Effect.sleep(Duration.millis(lapse - now));
          now = Math.max(lapse, yield* Clock.currentTimeMillis);
          tell(rows, now);
          lapse = nextBrowserTabLapse(rows, now);
        }
      });
    return Effect.scoped(
      Effect.gen(function* () {
        const delivered = yield* Queue.sliding<Rows | undefined>(1);
        yield* Effect.forkScoped(
          Stream.runDrain(
            Stream.switchMap(Stream.fromQueue(delivered), (rows) =>
              Stream.fromEffect(toldUntilMoved(rows)),
            ),
          ),
        );
        return yield* pushLive({
          seal: (poll, after) =>
            gate() && userId !== undefined
              ? Effect.map(served(client.browserTabsLive(place, userId, poll, after)), (sealed) =>
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
          decode: decodeBrowserTabs,
          publish: (rows) => {
            Queue.offerUnsafe(delivered, rows);
          },
        });
      }),
    );
  }

  /** The pages of each task a window's Inbox follows, and of each agent on no task whose page a window draws, by the task's or the agent's id, which never collide. */
  const pagesFollows = yield* FiberMap.make<string>();
  const decodePages = Schema.decodeUnknownOption(taskPagesLiveRowsSchema);

  /** Follows the pages of `place`, a task or an agent on no task, live until let go, each change emitted as `TASKS_PAGES_CHANGED`. */
  function followPages(place: PagePlace) {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    return pushLive({
      seal: (poll, after) =>
        gate() && userId !== undefined
          ? Effect.map(served(client.pagesLive(place, userId, poll, after)), (sealed) =>
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
      publish: (pages) =>
        kernel.emit(
          GATEWAY_EVENT.TASKS_PAGES_CHANGED,
          carried({
            ...place,
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

  /** A task's row or document without the assignee it stood with. */
  function withoutAssignee<T extends { readonly assignee?: unknown }>(
    standing: T,
  ): Omit<T, "assignee"> {
    const { assignee: _assignee, ...rest } = standing;
    return rest;
  }

  /** The one follow of the list, started on the first refresh and stopped by a sign-out. */
  const listFollow = yield* FiberHandle.make<void>();

  /** The list's wait for a write's transaction, while every part of it is followed over Realtime. */
  let listWait: TxWait | undefined;

  /** When the list was last sealed again for a resync, by the host's clock; none before the first. */
  let resyncedAt: number | undefined;

  const listed = (txid: string | undefined): Effect.Effect<void> =>
    Effect.suspend(() => confirmWrite(listWait, txid));

  /**
   * The account's task list in collections (`task-list-collections.ts`),
   * from a launch or a sign-in until a sign-out closes their scope, so a
   * write still out for the account signed out draws on nothing the next
   * account sees. Each draw lays the list in the view, and what the service
   * holds of the open task, its name, pin, status, assignee, and repository,
   * reaches its document as the list carries it.
   */
  const openTaskList = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const collections = yield* Scope.provide(scope)(
      taskListCollections({
        draw: ({ list, taskAgents, taskPullRequests, taskAgentPins, pendingTasks }) => {
          const { pendingTasks: _held, ...rest } = view;
          view = pendingTasks.length === 0 ? rest : { ...rest, pendingTasks };
          write({
            tasks: list.plans,
            tasklessAgents: list.planlessAgents ?? [],
            taskAgents,
            taskPullRequests,
            taskAgentPins,
          });
          if (view.activeTaskId !== undefined) heldAsListed(view.activeTaskId);
        },
        txWait: () => listWait,
      }),
    );
    return { scope, collections };
  });
  let taskList = yield* openTaskList;
  yield* Effect.addFinalizer(() => Scope.close(taskList.scope, Exit.void));

  /**
   * A task write run under the serial lock, its answer drawn there, then
   * confirmed once its transaction reaches the followed list, outside the
   * lock, so no other read or write waits on Realtime, and a newer row the
   * list publishes meanwhile is drawn over the answer rather than under it.
   */
  const writtenThenListed = <
    Written extends readonly [
      answer: unknown,
      txid: string | undefined,
      held?: { readonly taskId: string; readonly fields: Partial<PlanRow> | typeof ROW_GONE },
    ],
    E,
    R,
  >(
    write: Effect.Effect<Written, E, R>,
  ): Effect.Effect<Written[0], E, R> =>
    Effect.flatMap(serial(write), ([answer, txid, held]) =>
      Effect.as(
        held === undefined ? listed(txid) : heldOverList(held.taskId, held.fields, txid),
        answer,
      ),
    );

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
      // Note that an answer's read standing rides the list it draws, so a window is told both at once.
      take: (rows) =>
        Effect.suspend(() => {
          view = { ...view, listStatus: TASKS_READ.READY, live: HOST_LIVE.LIVE };
          return taskList.collections.answer(rows);
        }),
      // A list that could not be read says so beside the tasks it already drew rather than emptying them.
      failed: () => write({ listStatus: TASKS_READ.FAILED, live: HOST_LIVE.OFFLINE }),
      // A list that may be behind keeps drawing what it had, and says it is catching up until the next lands.
      behind: () => write({ live: HOST_LIVE.CATCHING_UP }),
      onTxWait: (wait) => {
        listWait = wait;
      },
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
   * not answer, or a follow that stopped, is sealed again on
   * `FOLLOW_BACKOFF` while the gate stands open, and what was drawn stays meanwhile.
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
        { poll: (after) => seal(true, after), now: kernel.now },
        sealed,
      );
      // A follow gone mid-way was refused as signed out by a poll, which no read mends either.
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
        schedule: FOLLOW_BACKOFF,
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
   * `FOLLOW_BACKOFF` without a word, so the window keeps what it holds; a
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
      const changes = moves({ poll: (after) => sealed(true, after), now: kernel.now }, first);
      yield* Stream.runForEach(changes, told).pipe(Effect.ignore);
      return yield* Effect.fail(WORKSPACE_CALL_FAILURE.UNANSWERED);
    });
    return attempt.pipe(
      Effect.retry({
        schedule: FOLLOW_BACKOFF,
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
  /** The sidebar follow's wait for a write's transaction once Luke Sync woke it; none while it polls or is let go. */
  let sidebarTxWait: TxWait | undefined;

  /**
   * The account's sidebar in collections (`sidebar-collections.ts`), from a
   * launch or a sign-in until a sign-out closes their scope, so a pin or a
   * section still written for the account signed out draws on nothing the
   * next account sees.
   */
  const openSidebar = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const collections = yield* Scope.provide(scope)(
      sidebarCollections({ draw: write, now: kernel.now, txWait: () => sidebarTxWait }),
    );
    return { scope, collections };
  });
  let sidebar = yield* openSidebar;
  yield* Effect.addFinalizer(() => Scope.close(sidebar.scope, Exit.void));

  /**
   * Follows the account's sidebar where nothing follows it yet
   * (`workspaces-follow.ts`), each answer taken into its collections as it
   * lands, a section or a pin made on another Mac among them; nothing else
   * reads it. A seal the service did not answer, or a follow that stopped,
   * is sealed again on `FOLLOW_BACKOFF`, and what was drawn stays meanwhile.
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
      yield* followSidebarRows(
        {
          poll: (after) => seal(true, after),
          now: kernel.now,
          onTxWait: (wait) => {
            sidebarTxWait = wait;
          },
        },
        sealed,
        (rows) => sidebar.collections.answer(rows),
      ).pipe(Effect.ignore);
      return yield* Effect.fail(TASK_CALL_FAILURE.UNANSWERED);
    });
    const followed = attempt.pipe(
      Effect.retry({
        schedule: FOLLOW_BACKOFF,
        while: (why) => why !== LIVE_SIGNED_OUT.failure && gate(),
      }),
      Effect.ignore,
    );
    yield* FiberHandle.run(sidebarFollow, followed, { onlyIfMissing: true });
  });

  /**
   * The active task's document as a read of it left it. A copy of the same
   * task already `held` stays drawn through a read that failed, so a moment
   * offline blanks nothing; with no copy held, the failure is what the panel
   * draws.
   */
  function documentAfter(
    opened: Effect.Success<ReturnType<typeof client.open>>,
    held: Task | undefined,
  ): TasksView["document"] {
    if (opened.ok) return { status: TASKS_READ.READY, task: opened.answer };
    if (opened.failure === TASK_CALL_FAILURE.NOT_FOUND) return { status: TASKS_READ.MISSING };
    return held === undefined
      ? { status: TASKS_READ.FAILED }
      : { status: TASKS_READ.READY, task: held };
  }

  /** The view with the task's pages as a read answered them; a failed read keeps the pages held. */
  function withPagesRead(
    was: TasksView,
    pages: Effect.Success<ReturnType<typeof client.readPages>>,
  ): TasksView {
    if (pages === undefined) return was;
    const { pages: _held, ...rest } = was;
    return pages.length === 0 ? rest : { ...rest, pages };
  }

  /**
   * Each of the open task's parts, its document among them, by the number
   * of reads of it started and of the newest laid over the view, so a read
   * that left before a newer one, or before a write of the part, never
   * lands over it (`laidNow`).
   */
  const partReads: Record<OpenedPart, { started: number; laid: number }> = {
    [OPENED_PART.PAGES]: { started: 0, laid: 0 },
    [OPENED_PART.DOCUMENT]: { started: 0, laid: 0 },
    [OPENED_PART.MARKS]: { started: 0, laid: 0 },
  };

  /** Numbers a read of the part as it starts. */
  function partReadStarted(part: OpenedPart): number {
    partReads[part].started += 1;
    return partReads[part].started;
  }

  /** Whether the read numbered `read` is still the newest of the part to land, which it then is; false where a newer one, or a write, landed first. */
  function laidNow(part: OpenedPart, read: number): boolean {
    if (read < partReads[part].laid) return false;
    partReads[part].laid = read;
    return true;
  }

  /** Marks a write of the part, which every read that left before it is older than. */
  function partWritten(part: OpenedPart): void {
    laidNow(part, partReadStarted(part));
  }

  /**
   * The open task's document as its read `opened` left it, taking the pin
   * its row of the list carries, or the copy held where the list has no row
   * of it yet, where a pin was answered after the read numbered `marksRead`
   * left, since the read's is then the older.
   */
  function openedDocument(
    taskId: string,
    opened: Effect.Success<ReturnType<typeof client.open>>,
    marksRead: number,
  ): TasksView["document"] {
    const held = heldTaskOf(taskId);
    const marked = view.tasks.find((each) => each.id === taskId) ?? held;
    const pinStands = laidNow(OPENED_PART.MARKS, marksRead);
    if (!opened.ok || marked === undefined || pinStands) return documentAfter(opened, held);
    return { status: TASKS_READ.READY, task: withMarksOf(opened.answer, marked) };
  }

  /** The open's part reads still out, one per part, a newer open's taking the place of the last. */
  const openedParts = yield* FiberMap.make<OpenedPart, void>();

  /** The read an open asked for, which a newer open's interrupts. */
  const openedRead = yield* FiberHandle.make<void>();

  /**
   * Reads what the active task's page draws, its document and pages, all
   * at once, and tells the window the document with every part
   * that answered before it in one view, so the page lands whole rather than
   * a part at a time, each reflowing what the one before laid out. A part
   * answering after the document is laid over the view as it lands, on its
   * own, so neither the document nor another part waits for it. No read
   * holds the lock (`serial`): the document is laid where it is still the
   * newest of its reads and no write of it landed since it left (`laidNow`),
   * so an open never queues behind another's reads or a write's answer. A
   * copy of the same task already held stays drawn while the reads are out
   * and through a document read that failed, so a save redraws in place; a
   * failed pages read keeps what is held of them,
   * as their own read does. The document says it is reading
   * only where nothing of it is held, which a switch has already told
   * (`TASKS_OPEN`).
   */
  function readOpened(taskId: string) {
    return Effect.gen(function* () {
      const documentRead = partReadStarted(OPENED_PART.DOCUMENT);
      const marksRead = partReadStarted(OPENED_PART.MARKS);
      if (heldTaskOf(taskId) === undefined) write({ document: { status: TASKS_READ.READING } });
      /** The parts that answered before the document, each laid with it where still the newest of its part. */
      const early: { part: OpenedPart; read: number; lay: (was: TasksView) => TasksView }[] = [];
      let documentLanded = false;
      const readPart = <A, E>(
        part: OpenedPart,
        ask: Effect.Effect<A, E, HttpClient.HttpClient>,
        lay: (was: TasksView, answer: A) => TasksView,
      ) => {
        const read = partReadStarted(part);
        // Note that a part landing before the document waits for it, which holds the lock as it is read,
        // and one landing after takes the lock only to lay itself over the view, never for its read.
        const landed = (answer: A) =>
          Effect.suspend(() =>
            documentLanded
              ? serial(
                  Effect.sync(() => {
                    if (view.activeTaskId !== taskId || !laidNow(part, read)) return;
                    view = lay(view, answer);
                    publish();
                  }),
                )
              : Effect.sync(() => {
                  early.push({ part, read, lay: (was) => lay(was, answer) });
                }),
          );
        return FiberMap.run(openedParts, part, Effect.ignore(Effect.flatMap(served(ask), landed)));
      };
      yield* readPart(OPENED_PART.PAGES, client.readPages({ taskId }), withPagesRead);
      // Note that the document is read beside the parts, a fiber of its own, so a part as quick as it lands with it.
      const opened = yield* Fiber.join(yield* Effect.forkChild(served(client.open(taskId))));
      // Another task opened while these reads were out: their answers are not the panel's any more.
      if (view.activeTaskId !== taskId) return;
      // Note that a document an answer wrote after this read left stands, since it is the newer.
      let read: TasksView = laidNow(OPENED_PART.DOCUMENT, documentRead)
        ? { ...view, document: openedDocument(taskId, opened, marksRead) }
        : view;
      for (const part of early.splice(0)) {
        if (laidNow(part.part, part.read)) read = part.lay(read);
      }
      documentLanded = true;
      view = read;
      publish();
      readPlanWhereSaved();
    });
  }

  /** Whether the open task's plan was saved past the copy held, as its follow last delivered it. */
  function savedPastHeld(taskId: string): boolean {
    const held = heldTaskOf(taskId);
    return (
      view.activeTaskId === taskId &&
      planSaved?.taskId === taskId &&
      held !== undefined &&
      planSaved.at > held.updatedAt
    );
  }

  /**
   * Reads the open task's plan again where its follow delivered a save newer
   * than the copy held, so a teammate's or an agent's edit reaches the
   * window without anything else asking. Note that it waits for a copy to
   * stand, since an open still reading asks again once it lands, and that
   * only a newer save asks, so a read that answered ahead of the follow does
   * not ask again until the follow catches up.
   */
  function readPlanWhereSaved(): void {
    const taskId = view.activeTaskId;
    if (taskId !== undefined && savedPastHeld(taskId)) Queue.offerUnsafe(planReads, taskId);
  }

  /**
   * Reads the open task's document again, as an open does, for a save
   * someone else made. A read that left before a write of the document, or
   * a newer read, lands nothing. Note that a failed read is asked again on
   * `FOLLOW_BACKOFF` for as long as the save stands newer than the copy held,
   * because the follow delivers no other move for a mark that stood still.
   */
  function readPlan(taskId: string) {
    const wanted = () => gate() && savedPastHeld(taskId);
    const once = Effect.gen(function* () {
      if (!wanted()) return;
      const documentRead = partReadStarted(OPENED_PART.DOCUMENT);
      const marksRead = partReadStarted(OPENED_PART.MARKS);
      const opened = yield* served(client.open(taskId));
      if (view.activeTaskId !== taskId) return;
      if (!opened.ok) {
        if (opened.failure === TASK_CALL_FAILURE.NOT_FOUND) return;
        return yield* Effect.fail(opened.failure);
      }
      if (!laidNow(OPENED_PART.DOCUMENT, documentRead)) return;
      write({ document: openedDocument(taskId, opened, marksRead) });
    });
    return Effect.ignore(Effect.retry(once, { schedule: FOLLOW_BACKOFF, while: wanted }));
  }

  /**
   * Reads the active task's pages, each by its newest version. A failed read
   * keeps the pages held, as a failed code read keeps the code.
   */
  function readPages(taskId: string) {
    return Effect.gen(function* () {
      if (view.activeTaskId !== taskId) return;
      const read = partReadStarted(OPENED_PART.PAGES);
      const pages = yield* served(client.readPages({ taskId }));
      if (view.activeTaskId !== taskId || !laidNow(OPENED_PART.PAGES, read)) return;
      view = withPagesRead(view, pages);
      publish();
    });
  }

  /**
   * Follows one of `taskId`'s live reads while it is the open task, each
   * move handed to `moved`, the first delivery among them. A seal the
   * service did not answer, or a follow that stops before it delivered, is
   * sealed again on `FOLLOW_BACKOFF`; a follow that delivered and then
   * stopped is sealed again after `FOLLOW_RESEAL.FIRST`, its backoff started
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
        following: {
          readonly poll: (after: string | undefined) => Effect.Effect<Answer | Unsealed>;
        },
        first: Answer,
      ) => Stream.Stream<Moved, LiveBroken>;
      readonly moved: (moved: Moved) => void;
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
        : Effect.succeed({ failure: FOLLOW_ENDED, gone: true });
    /** One seal followed until it stops: whether it delivered, or why it never did. */
    const attempt = Effect.gen(function* () {
      if (!following()) return yield* Effect.fail(FOLLOW_ENDED);
      const sealed = yield* seal();
      if (isUnsealed(sealed)) return yield* Effect.fail(sealed.failure);
      let delivered = false;
      const moves = read.moves({ poll: (after) => sealedFor(true, after) }, sealed);
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
        schedule: FOLLOW_BACKOFF,
        while: (why) =>
          why !== TASK_CALL_FAILURE.NOT_FOUND &&
          why !== LIVE_SIGNED_OUT.failure &&
          why !== FOLLOW_ENDED &&
          following(),
      }),
      Effect.option,
    );
    return Effect.asVoid(
      Effect.repeat(followed, {
        schedule: Schedule.spaced(FOLLOW_RESEAL.FIRST),
        while: (delivered) => Option.isSome(delivered) && following(),
      }),
    );
  }

  /**
   * Follows `taskId`'s plan and pages live while it is the open task: the
   * plan read again once a save newer than the copy held lands, and the
   * pages once theirs move, each on each seal's first delivery.
   */
  function followRecord(taskId: string) {
    return followLive(taskId, {
      seal: (userId, poll, after) => client.recordLive(taskId, userId, poll, after),
      moves: taskRecordMoves,
      moved: ({ parts, planSavedAt }: TaskRecordMove) => {
        if (parts.includes(TASK_RECORD_PART.PLAN) && planSavedAt !== undefined) {
          planSaved = { taskId, at: planSavedAt };
          readPlanWhereSaved();
        }
        if (parts.includes(TASK_RECORD_PART.PAGES)) Queue.offerUnsafe(pageReads, taskId);
      },
    });
  }

  /** Follows `taskId`'s plan and pages live, in place of any follow standing; with `standing`, only where none stands. */
  function openRecord(taskId: string, standing?: { readonly onlyIfMissing: true }) {
    return Effect.asVoid(FiberHandle.run(recordFollow, followRecord(taskId), standing));
  }

  /**
   * The open document of `taskId` given everything its row of the list now
   * reads, its name, status, assignee, and repository among them, so a
   * change a teammate or an agent made reaches the open task as it reaches
   * the list. Note that the row is the whole of what the task carries but
   * its document, so a field the row leaves out is one the task no longer
   * has, and that the last save is the document's own, kept with its body.
   */
  function heldAsListed(taskId: string): void {
    const held = heldTaskOf(taskId);
    const listed = view.tasks.find((row) => row.id === taskId);
    if (held === undefined || listed === undefined) return;
    const { agents: _agents, ...row } = listed;
    const { updatedAt, document, agentEdits, lastEdit, sectionEdits } = held;
    const task: Task = {
      ...row,
      updatedAt,
      document,
      ...(agentEdits === undefined ? undefined : { agentEdits }),
      ...(lastEdit === undefined ? undefined : { lastEdit }),
      ...(sectionEdits === undefined ? undefined : { sectionEdits }),
    };
    write({ document: { ...view.document, task } });
  }

  /** The fields of a task's row of the list as the service answered the task. */
  function planFieldsOf(task: Task): Partial<PlanRow> {
    return {
      workspaceId: task.workspaceId,
      name: task.name,
      repository: task.repository,
      updatedAt: task.updatedAt,
      ...(task.status === undefined ? undefined : { status: task.status }),
      ...(task.priority === undefined ? undefined : { priority: task.priority }),
      ...(task.number === undefined ? undefined : { number: task.number }),
      assigneeId: task.assignee?.userId ?? null,
      assigneeName: task.assignee?.name ?? null,
      pinnedAt: task.pinnedAt ?? null,
      pinPosition: task.pinPosition ?? null,
      completedAt: task.completedAt ?? null,
    };
  }

  /**
   * Holds what a write's answer says of a task's row, or that it is gone,
   * over the list until the list carries its transaction
   * (`task-list-collections.ts`), so no draw meanwhile puts back the row as
   * the list last answered it; outside the serial lock, as a list's wait is.
   */
  function heldOverList(
    taskId: string,
    fields: Partial<PlanRow> | typeof ROW_GONE,
    txid: string | undefined,
  ): Effect.Effect<void> {
    return Effect.suspend(() =>
      taskList.collections.writePlan(
        taskId,
        () => fields,
        Effect.succeed({ answer: undefined, txid, fields }),
      ),
    );
  }

  /**
   * Draws `task` as the service answered it on the open document where it
   * is the one held, and answers what it says of the task's row of the list,
   * which the caller holds over the list (`heldOverList`). Note that the
   * assignee standing is dropped first, because an answer names one only
   * where the task has one, so an answer that names none is a task assigned
   * to no one.
   */
  function takeAnswered(task: Task): {
    readonly taskId: string;
    readonly fields: Partial<PlanRow>;
  } {
    write({
      ...documentTook(task.id, task, (held) => ({ ...withoutAssignee(held), ...task })),
    });
    return { taskId: task.id, fields: planFieldsOf(task) };
  }

  /**
   * The open document as `answered`, a write's answer about `taskId`, leaves
   * it, laid over the copy held by `lay`, so no read that left before the
   * answer lands over it; an open still reading takes the answer whole. A
   * task not open has no document to take it.
   */
  function documentTook(
    taskId: string,
    answered: Task,
    lay: (held: Task) => Task,
  ): Pick<TasksView, "document"> | undefined {
    if (view.activeTaskId !== taskId) return undefined;
    partWritten(OPENED_PART.DOCUMENT);
    const held = heldTaskOf(taskId);
    return {
      document: { status: TASKS_READ.READY, task: held === undefined ? answered : lay(held) },
    };
  }

  /** The pin a task answered carries, and where it stands, each only where it stands. */
  function marksOf(task: Pick<Task, "pinnedAt" | "pinPosition">): TaskMarkStamps {
    return {
      ...(task.pinnedAt === undefined ? undefined : { pinnedAt: task.pinnedAt }),
      ...(task.pinPosition === undefined ? undefined : { pinPosition: task.pinPosition }),
    };
  }

  /** `task` with the pin `marked` carries in place of its own. */
  function withMarksOf(task: Task, marked: Pick<Task, "pinnedAt" | "pinPosition">): Task {
    const { pinnedAt: _pinned, pinPosition: _position, ...kept } = task;
    return { ...kept, ...marksOf(marked) };
  }

  /**
   * Draws the pin `task` was answered with on the open document where it is
   * the one held, which keeps everything else it holds, because a draft
   * drawn meanwhile may be ahead of the copy the service answered.
   */
  function takeMarks(task: Task): void {
    // Note that an open still reading takes the pin from the row once its read lands (`openedDocument`).
    if (view.activeTaskId === task.id) partWritten(OPENED_PART.MARKS);
    const held = heldTaskOf(task.id);
    if (held !== undefined) {
      write({ document: { status: TASKS_READ.READY, task: withMarksOf(held, task) } });
    }
  }

  /**
   * Pins or unpins one task, drawn on its row at once, a pin newest pinned
   * and standing where it was dragged, and kept once the list carries it
   * (`task-list-collections.ts`); the open document takes the service's answer.
   */
  function markTask(taskId: string, marks: TaskMarks) {
    const pinned = (row: PlanRow): Partial<PlanRow> =>
      marks.pinned
        ? {
            pinnedAt: row.pinnedAt ?? kernel.now(),
            pinPosition: marks.pinPosition ?? (row.pinnedAt === null ? null : row.pinPosition),
          }
        : { pinnedAt: null, pinPosition: null };
    return taskList.collections.writePlan(
      taskId,
      pinned,
      serial(
        Effect.gen(function* () {
          const marked = yield* served(client.mark(taskId, marks));
          if (marked === undefined) return { refused: { changed: false } };
          takeMarks(marked.task);
          return {
            answer: { changed: true },
            txid: marked.txid,
            fields: planFieldsOf(marked.task),
          };
        }),
      ),
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
        if (open !== undefined) yield* openRecord(open, { onlyIfMissing: true });
        const tasks = Effect.suspend(() => {
          const taskId = view.activeTaskId;
          return taskId === undefined ? Effect.void : readOpened(taskId);
        });
        yield* followWorkspaces;
        yield* followSidebar;
        yield* Effect.all([tasks, readGithubWhenStale], { concurrency: "unbounded" });
        return {};
      }),
    // A follow may have died in a sleep or a lost network without a word,
    // and one waiting out a pause need not wait on: a list already followed
    // is sealed again now, once for a wake's several events.
    [GATEWAY_METHOD.TASKS_RESYNC]: () =>
      Effect.gen(function* () {
        if (!gate() || Option.isNone(yield* FiberHandle.get(listFollow))) return {};
        const at = yield* Clock.currentTimeMillis;
        if (resyncedAt !== undefined && at - resyncedAt < Duration.toMillis(RESYNC_SETTLE)) {
          return {};
        }
        resyncedAt = at;
        write({ live: HOST_LIVE.CATCHING_UP });
        yield* FiberHandle.run(listFollow, followList);
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
        const read = yield* readParams(
          tasksOpenParamsSchema,
          params,
          "opening a task names one task",
        );
        if (!gate()) return { opened: false };
        const { taskId } = read;
        screenAsks += 1;
        // A press on the task already open, drawn or being read, asks nothing again.
        const status = view.document.status;
        if (
          view.activeTaskId === taskId &&
          (status === TASKS_READ.READY || status === TASKS_READ.READING)
        ) {
          yield* openRecord(taskId, { onlyIfMissing: true });
          return { opened: true };
        }
        if (view.activeTaskId !== taskId) {
          // Note that the page is told twice in all: that it is reading, then what it read.
          view = {
            ...withoutPages(view),
            activeTaskId: taskId,
            document: { status: TASKS_READ.READING },
          };
          publish();
        }
        yield* openRecord(taskId);
        // Note that the open answers once the page is drawn, its read left running, so nothing waits on the network.
        yield* FiberHandle.run(openedRead, readOpened(taskId));
        return { opened: true };
      }),
    [GATEWAY_METHOD.TASKS_FILE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksFileParamsSchema,
          params,
          "reading a file names a task, or a workspace and its repository, a path, and a window of its lines",
        );
        if (!gate()) return carried<TasksFileAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { path, firstLine, lastLine, raw, ref } = read;
        const window = {
          path,
          firstLine,
          lastLine,
          ...(raw === undefined ? undefined : { raw }),
          ...(ref === undefined ? undefined : { ref }),
        };
        const answer = yield* served(
          "taskId" in read
            ? client.readFile(read.taskId, window)
            : client.readRepositoryFile(read, window),
        );
        return carried<TasksFileAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A folder's listing is answered to the tree that asked and held nowhere:
    // the tree keeps the folders it has opened.
    [GATEWAY_METHOD.TASKS_TREE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksTreeParamsSchema,
          params,
          "listing a folder names a task, or a workspace and its repository, and the folder's path",
        );
        if (!gate()) return carried<TasksTreeAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const asked = read;
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
        const read = yield* readParams(
          tasksSkillsParamsSchema,
          params,
          "reading a repository's skills names the task, or a workspace and its repository",
        );
        if (!gate()) {
          return carried<TasksSkillsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const asked = read;
        const answer = yield* served(
          "planId" in asked ? client.readSkills(asked.planId) : client.readRepositorySkills(asked),
        );
        return carried<TasksSkillsAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // A pull request is answered to the link that asked, and kept for every
    // link asking it again for as long as `LINK_READ_KEPT` says.
    [GATEWAY_METHOD.TASKS_PULL_REQUEST]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPullRequestParamsSchema,
          params,
          "reading a pull request names a workspace, its repository, and the pull request's number",
        );
        if (!gate()) {
          return carried<TasksPullRequestAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const answer = yield* Cache.get(pullRequestReads, linkReadKey(read));
        return carried<TasksPullRequestAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // An issue is answered as a pull request is: to the link that asked, and kept as it is.
    [GATEWAY_METHOD.TASKS_ISSUE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksIssueParamsSchema,
          params,
          "reading an issue names a workspace, its repository, and the issue's number",
        );
        if (!gate()) {
          return carried<TasksIssueAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const answer = yield* Cache.get(issueReads, linkReadKey(read));
        return carried<TasksIssueAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    // An agent's or a task's agents' Browser tabs are answered to the side
    // panel that asked and held nowhere, since each carries a page's address and title:
    // the panel draws what it was answered, and reads again while it stands.
    [GATEWAY_METHOD.TASKS_BROWSER_TABS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksBrowserTabsParamsSchema,
          params,
          "reading Browser tabs names the agent or the task",
        );
        if (!gate()) return carried<TasksBrowserTabsAnswer>(BROWSER_TABS_UNANSWERED);
        return carried<TasksBrowserTabsAnswer>(yield* served(client.readBrowserTabs(read)));
      }),
    // A tab a member opens in an agent's browser is answered to the panel
    // that asked and held nowhere, as the task's tabs are.
    [GATEWAY_METHOD.TASKS_BROWSER_TAB_OPEN]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksBrowserTabOpenParamsSchema,
          params,
          "opening a Browser tab names the agent and the address",
        );
        if (!gate()) return carried<TasksBrowserTabOpenAnswer>(BROWSER_TABS_UNANSWERED);
        return carried<TasksBrowserTabOpenAnswer>(yield* served(client.openBrowserTab(read)));
      }),
    // A page of the history, and a revision beside the one before it, are
    // answered to the version history that asked and held nowhere: it keeps
    // what it read, and reads again as the task moves on.
    [GATEWAY_METHOD.TASKS_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksRevisionsParamsSchema,
          params,
          "reading a plan's history names the task, and where an older page is read from",
        );
        if (!gate()) {
          return carried<TasksRevisionsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, before } = read;
        const page = yield* served(client.readRevisions(taskId, before));
        return carried<TasksRevisionsAnswer>(page ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    [GATEWAY_METHOD.TASKS_REVISION]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksRevisionParamsSchema,
          params,
          "reading a revision names a task and its number",
        );
        if (!gate()) {
          return carried<TasksRevisionAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const revision = yield* served(client.readRevision(read.taskId, read.seq));
        return carried<TasksRevisionAnswer>(
          revision === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { revision },
        );
      }),
    // A page's version is answered to the frame that asked and held nowhere,
    // so its HTML never enters the view every window is told.
    [GATEWAY_METHOD.TASKS_PAGE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPageParamsSchema,
          params,
          "reading a page names a task or an agent, the page, and its version",
        );
        // A run that sends nothing reads the page its fixture stages, frame and source alike.
        if (!kernel.runMode.sendsNetwork) return carried<TasksPageAnswer>(fixturePage(read));
        if (!gate()) return carried<TasksPageAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { pageId, version } = read;
        const place = "taskId" in read ? { taskId: read.taskId } : { agentId: read.agentId };
        const page = yield* served(client.readPageVersion(place, pageId, version));
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
        const read = yield* readParams(
          taskHistoryFollowSchema,
          params,
          "following a task's history names the task",
        );
        if (!gate()) return {};
        const { taskId } = read;
        yield* FiberMap.run(historyFollows, taskId, followHistory(taskId), { onlyIfMissing: true });
        return {};
      }),
    [GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskHistoryFollowSchema,
          params,
          "letting a task's history go names the task",
        );
        yield* FiberMap.remove(historyFollows, read.taskId);
        return {};
      }),
    // An agent's or a task's Browser tabs are followed for a window's side
    // panel while it lists them, and told only as `TASKS_BROWSER_TABS_CHANGED`; a follow of
    // what is already followed does nothing.
    [GATEWAY_METHOD.TASKS_BROWSER_TABS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskBrowserTabsFollowSchema,
          params,
          "following Browser tabs names the agent or the task",
        );
        if (!gate()) return {};
        yield* FiberMap.run(browserTabsFollows, browserTabsPlaceId(read), followBrowserTabs(read), {
          onlyIfMissing: true,
        });
        return {};
      }),
    [GATEWAY_METHOD.TASKS_BROWSER_TABS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskBrowserTabsFollowSchema,
          params,
          "letting Browser tabs go names the agent or the task",
        );
        yield* FiberMap.remove(browserTabsFollows, browserTabsPlaceId(read));
        return {};
      }),
    // A plan's pages are followed for a window's Inbox while it draws an item
    // of that plan, and an agent's on no task while its page is drawn, and
    // told only as `TASKS_PAGES_CHANGED`; a follow of what is already
    // followed does nothing.
    [GATEWAY_METHOD.TASKS_PAGES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskPagesFollowSchema,
          params,
          "following pages names the task or the agent",
        );
        if (!gate()) return {};
        yield* FiberMap.run(pagesFollows, pagePlaceId(read), followPages(read), {
          onlyIfMissing: true,
        });
        return {};
      }),
    [GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskPagesFollowSchema,
          params,
          "letting pages go names the task or the agent",
        );
        yield* FiberMap.remove(pagesFollows, pagePlaceId(read));
        return {};
      }),
    [GATEWAY_METHOD.TASKS_PAGES]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPagesParamsSchema,
          params,
          "reading pages names the task or the agent",
        );
        if (!gate()) return carried<TasksPagesAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const pages = yield* served(client.readPages(read));
        return carried<TasksPagesAnswer>(
          pages === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { pages },
        );
      }),
    // A picture's bytes are answered to the window that asked and held
    // nowhere, so they never enter the view every window is told.
    [GATEWAY_METHOD.TASKS_PICTURE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPictureParamsSchema,
          params,
          "reading a picture names a task and the picture",
        );
        if (!gate()) {
          return carried<TasksPictureAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const picture = yield* served(client.readPicture(read.planId, read.attachmentId));
        return carried<TasksPictureAnswer>(picture);
      }),
    // A plan's comments are read past the window's cursor, held by the service while nothing changed.
    [GATEWAY_METHOD.TASKS_COMMENTS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksCommentsParamsSchema,
          params,
          "reading a plan's comments names the plan and a cursor",
        );
        if (!gate()) return carried<TasksCommentsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(client.comments(read.planId, read.after));
        return carried<TasksCommentsAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_COMMENT_START]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksCommentStartParamsSchema,
          params,
          "starting a comment names a plan and the thread",
        );
        if (!gate()) return carried<TasksCommentAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(client.startComment(read.planId, read.start));
        return carried<TasksCommentAnswer>(answer);
      }),
    [GATEWAY_METHOD.TASKS_COMMENT_ACT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksCommentActParamsSchema,
          params,
          "changing a comment names a plan, a thread, and what to do",
        );
        if (!gate()) return carried<TasksCommentAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const answer = yield* served(client.actOnComment(read.planId, read.threadId, read.action));
        return carried<TasksCommentAnswer>(answer);
      }),
    // The picture is kept and its id answered to the editor that took it;
    // the plan's text names it once the editor lays its address in.
    [GATEWAY_METHOD.TASKS_PICTURE_KEEP]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPictureKeepParamsSchema,
          params,
          "keeping a picture names a task and the picture",
        );
        if (!gate()) {
          return carried<TasksPictureKeepAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const kept = yield* served(client.keepPicture(read.planId, read.picture));
        return carried<TasksPictureKeepAnswer>(kept);
      }),
    // The service answers the task as restored, so the list's row and the
    // open document take it in place and nothing is read again. It is
    // confirmed once its transaction reached the history the window follows.
    [GATEWAY_METHOD.TASKS_RESTORE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksRevisionParamsSchema,
          params,
          "restoring a revision names a task and its number",
        );
        if (!gate()) return { restored: false };
        const { taskId, seq } = read;
        const restored = yield* serial(
          Effect.gen(function* () {
            const answer = yield* served(client.restore(taskId, seq));
            if (answer === undefined) return undefined;
            return { ...answer, held: takeAnswered(answer.task) };
          }),
        );
        if (restored === undefined) return { restored: false };
        // Note that the waits stand outside the serial reads, so no read waits on them.
        const { held, txid } = restored;
        yield* Effect.all(
          [
            confirmWrite(historyTxWaits.get(taskId), txid),
            heldOverList(held.taskId, held.fields, txid),
          ],
          { concurrency: "unbounded" },
        );
        return { restored: true };
      }),
    // Leaving the task returns to the list, which was read when the tab
    // showed.
    [GATEWAY_METHOD.TASKS_CLOSE]: () =>
      Effect.gen(function* () {
        screenAsks += 1;
        yield* FiberHandle.clear(recordFollow);
        yield* serial(
          Effect.sync(() => {
            const { activeTaskId: _closed, ...rest } = withoutPages(view);
            view = { ...rest, document: { status: TASKS_READ.IDLE } };
            publish();
          }),
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_START]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksStartRequestSchema,
          params,
          "starting a task names it, and its repository where it has one",
        );
        if (!gate()) return carried<TasksStartAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { quiet, ...request } = read;
        // A quiet start, a group's quick add or New task set to stay, opens nothing, and answers
        // once the list carries the task, with its agent's start where it asked for one.
        if (quiet === true) {
          return yield* writtenThenListed(
            Effect.map(served(client.create(request)), (started) => {
              if (!started.ok) {
                const { failure, localAgentRefusal } = started;
                return [
                  carried<TasksStartAnswer>(
                    localAgentRefusal === undefined ? { failure } : { failure, localAgentRefusal },
                  ),
                  undefined,
                ] as const;
              }
              const { task, agent, txid } = started.answer;
              return [
                carried<TasksStartAnswer>({
                  planId: task.id,
                  ...(agent === undefined ? undefined : { agentStart: agent }),
                }),
                txid,
              ] as const;
            }),
          );
        }
        // Note that a start answers once the task is drawn open rather than once the list carries
        // it, because nothing draws its row from the answer, so a list from before the write only
        // lacks a row it has not drawn yet, and the window opens the task's agent at once.
        screenAsks += 1;
        const asked = screenAsks;
        return yield* serial(
          Effect.gen(function* () {
            const started = yield* served(client.create(request));
            if (!started.ok) {
              const { failure, localAgentRefusal } = started;
              return carried<TasksStartAnswer>(
                localAgentRefusal === undefined ? { failure } : { failure, localAgentRefusal },
              );
            }
            const { task, agent } = started.answer;
            const answer = carried<TasksStartAnswer>({
              planId: task.id,
              ...(agent === undefined ? undefined : { agentStart: agent }),
            });
            // A start the developer went on from, to another task or another start, opens nothing.
            if (screenAsks !== asked) return answer;
            view = {
              ...withoutPages(view),
              activeTaskId: task.id,
              document: { status: TASKS_READ.READY, task },
            };
            publish();
            yield* openRecord(task.id);
            return answer;
          }),
        );
      }),
    [GATEWAY_METHOD.TASKS_DELETE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksOpenParamsSchema,
          params,
          "deleting a task names one task",
        );
        if (!gate()) return { deleted: false };
        const { taskId } = read;
        return yield* writtenThenListed(
          Effect.gen(function* () {
            const deleted = yield* served(client.delete(taskId));
            if (deleted === undefined) return [{ deleted: false }, undefined] as const;
            if (view.activeTaskId === taskId) {
              yield* FiberHandle.clear(recordFollow);
              const { activeTaskId: _deleted, ...rest } = withoutPages(view);
              view = { ...rest, document: { status: TASKS_READ.IDLE } };
              publish();
            }
            return [{ deleted: true }, deleted.txid, { taskId, fields: ROW_GONE }] as const;
          }),
        );
      }),
    // A name is drawn on the task's row at once and kept once the list
    // carries it (`task-list-collections.ts`); the open document takes the
    // service's answer in place, and nothing is read again.
    [GATEWAY_METHOD.TASKS_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksRenameParamsSchema,
          params,
          "renaming a task names it and its name",
        );
        if (!gate()) return { renamed: false };
        const { taskId, name } = read;
        return yield* taskList.collections.writePlan(
          taskId,
          () => ({ name }),
          serial(
            Effect.gen(function* () {
              const written = yield* served(client.rename(taskId, { name }));
              if (written === undefined) return { refused: { renamed: false } };
              const answered = written.task;
              write({
                ...documentTook(taskId, answered, (held) => ({
                  ...held,
                  name: answered.name,
                  document: answered.document,
                })),
              });
              return {
                answer: { renamed: true },
                txid: written.txid,
                fields: planFieldsOf(answered),
              };
            }),
          ),
        );
      }),
    // Where a task stands is drawn on its row at once, a member assigned by
    // the name the window knows them by, and kept once the list carries it
    // (`task-list-collections.ts`); the open document takes the service's
    // answer in place, and nothing is read again.
    [GATEWAY_METHOD.TASKS_SET_STANDING]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksSetStandingParamsSchema,
          params,
          "setting where a task stands names it and its status, priority, or assignee",
        );
        if (!gate()) return { changed: false };
        const { taskId, assigneeName, ...standing } = read;
        return yield* taskList.collections.writePlan(
          taskId,
          (row) => ({
            ...(standing.status === undefined
              ? undefined
              : {
                  status: standing.status,
                  // Note that a task finished here is stamped now, as the service stamps it, so the recently finished find it.
                  completedAt:
                    standing.status === row.status
                      ? (row.completedAt ?? null)
                      : FINISHED.has(standing.status)
                        ? kernel.now()
                        : null,
                }),
            ...(standing.priority === undefined ? undefined : { priority: standing.priority }),
            ...(standing.assigneeId === undefined
              ? undefined
              : {
                  assigneeId: standing.assigneeId,
                  assigneeName: standing.assigneeId === null ? null : (assigneeName ?? ""),
                }),
          }),
          serial(
            Effect.gen(function* () {
              const answered = yield* served(client.setStanding(taskId, standing));
              if (answered === undefined) return { refused: { changed: false } };
              const { task } = answered;
              write({
                ...documentTook(taskId, task, (held) => ({ ...withoutAssignee(held), ...task })),
              });
              return {
                answer: { changed: true },
                txid: answered.txid,
                fields: planFieldsOf(task),
              };
            }),
          ),
        );
      }),
    [GATEWAY_METHOD.TASKS_PIN]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPinParamsSchema,
          params,
          "pinning a task names it and whether it is pinned",
        );
        if (!gate()) return { changed: false };
        const { taskId, pinned, position } = read;
        return yield* markTask(
          taskId,
          position === undefined ? { pinned } : { pinned, pinPosition: position },
        );
      }),
    // A pin is drawn at once and stands while the service writes it, kept
    // once the followed sidebar has its transaction and taken back where the
    // service refused it (`sidebar-collections.ts`). Note that the service is
    // asked under the serial lock and the transaction waited for outside it,
    // so no task open, save, or read waits on the follow behind a pin.
    [GATEWAY_METHOD.TASKS_PIN_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPinRepositoryParamsSchema,
          params,
          "pinning a repository names it and whether it is pinned",
        );
        if (!gate()) return { changed: false };
        const { repository, pinned } = read;
        const changed = yield* sidebar.collections.pinRepository(
          repository,
          pinned,
          serial(served(client.pinRepository(repository, pinned))),
        );
        return { changed };
      }),
    // A drag's or a menu's section writes are drawn and confirmed as a pin is, each written in turn.
    [GATEWAY_METHOD.TASKS_WRITE_SECTION]: (params) =>
      Effect.gen(function* () {
        const { writes } = yield* readParams(
          tasksWriteSectionParamsSchema,
          params,
          "a change to the sections names what it changes",
        );
        if (!gate()) return { changed: false };
        const changed = yield* sidebar.collections.writeSections(writes, (each) =>
          serial(served(client.writeTaskSection(each))),
        );
        return { changed };
      }),
    // The list is the service's answer whole, read now and held nowhere: the
    // panel asks again whenever its chip opens, so an App installed meanwhile
    // shows on the next opening.
    [GATEWAY_METHOD.TASKS_REPOSITORIES]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksRepositoriesParamsSchema,
          params,
          "listing repositories names the workspace they are for, or none",
        );
        if (!gate()) {
          return carried<TasksRepositoriesAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const listed = yield* served(client.repositories(read.workspaceId));
        return carried<TasksRepositoriesAnswer>(
          listed.ok ? { repositories: listed.answer } : { failure: listed.failure },
        );
      }),
    // The service answers the task as changed, so the list's row and the
    // open document take it in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_SET_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksSetRepositoryParamsSchema,
          params,
          "giving a task its repository names the task and the repository",
        );
        if (!gate()) {
          return carried<TasksSetRepositoryAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, repository } = read;
        return yield* writtenThenListed(
          Effect.gen(function* () {
            const changed = yield* served(client.setRepository(taskId, repository));
            if (!changed.ok) {
              return [
                carried<TasksSetRepositoryAnswer>({ failure: changed.failure }),
                undefined,
              ] as const;
            }
            return [
              carried<TasksSetRepositoryAnswer>({ repository: changed.answer.task.repository }),
              changed.answer.txid,
              takeAnswered(changed.answer.task),
            ] as const;
          }),
        );
      }),
    // The service answers the task as moved, so the list's row and the open
    // document take its workspace in place and nothing is read again.
    [GATEWAY_METHOD.TASKS_MOVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksMoveParamsSchema,
          params,
          "moving a task names the task and the workspace",
        );
        if (!gate()) {
          return carried<TasksMoveAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, workspaceId } = read;
        return yield* writtenThenListed(
          Effect.gen(function* () {
            const moved = yield* served(client.move(taskId, workspaceId));
            if (!moved.ok) {
              return [carried<TasksMoveAnswer>({ failure: moved.failure }), undefined] as const;
            }
            return [
              carried<TasksMoveAnswer>({ workspaceId: moved.answer.task.workspaceId }),
              moved.answer.txid,
              takeAnswered(moved.answer.task),
            ] as const;
          }),
        );
      }),
    // The task the service answered is drawn in place, so the edit stands on
    // the document at once and the notetaker's drafts drawn before it drop.
    [GATEWAY_METHOD.TASKS_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksEditParamsSchema,
          params,
          "an edit names a task, and its document's base and value",
        );
        if (!gate()) return carried<TasksEditAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, edit } = read;
        // Note that the row the edit answered is held over the list outside the serial reads, as a list's wait is.
        const edited = yield* serial(
          Effect.gen(function* () {
            const written = yield* served(client.edit(taskId, edit));
            if (!written.ok)
              return { answer: carried<TasksEditAnswer>({ failure: written.failure }) };
            const answer = written.answer;
            if ("conflict" in answer)
              return { answer: carried<TasksEditAnswer>({ conflict: answer.conflict }) };
            if ("refused" in answer)
              return { answer: carried<TasksEditAnswer>({ failure: answer.refused }) };
            return {
              answer: carried<TasksEditAnswer>({ saved: true }),
              held: takeAnswered(answer.plan),
            };
          }),
        );
        if (edited.held !== undefined) {
          yield* heldOverList(edited.held.taskId, edited.held.fields, undefined);
        }
        return edited.answer;
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
    // An admin read is answered to the caller as the service answered it and
    // held nowhere, since it is other accounts' data, which no view keeps.
    [GATEWAY_METHOD.ADMIN_READ]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          adminReadParamsSchema,
          params,
          "an admin read names its procedure and query",
        );
        if (!gate()) return carried<AdminReadAnswer>({ refused: ADMIN_UNANSWERED });
        return carried<AdminReadAnswer>(yield* served(client.admin.read(read)));
      }),
    [GATEWAY_METHOD.ADMIN_FAVORITE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          adminFavoriteParamsSchema,
          params,
          "a star names an account and whether it is set",
        );
        if (!gate()) return carried<boolean>(false);
        return carried<boolean>(yield* served(client.admin.favorite(read.id, read.favorite)));
      }),
    [GATEWAY_METHOD.WORKSPACES_CREATE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceCreateParamsSchema,
          params,
          "making a workspace names it",
        );
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const made = yield* workspaceCall(client.workspaces.create(read.name));
        return carried<TasksWorkspaceAnswer>(
          made.ok ? { workspace: made.answer } : { failure: made.failure },
        );
      }),
    // A rename moves no task: the answered workspace lands at once, and the
    // follow carries the same name a moment later.
    [GATEWAY_METHOD.WORKSPACES_RENAME]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceRenameParamsSchema,
          params,
          "renaming a workspace names it and its new name",
        );
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, name } = read;
        return carried<TasksWorkspaceAnswer>(
          yield* workspaceWrite(client.workspaces.rename(workspaceId, name)),
        );
      }),
    // A photo moves no task either, so it is a rename's twin: the answered
    // workspace, its photo's new version or none, lands; the window's tiles
    // read the photo by it.
    [GATEWAY_METHOD.WORKSPACES_PHOTO_SET]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspacePhotoSetParamsSchema,
          params,
          "setting a workspace's photo names it and a photo or none",
        );
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, photo } = read;
        return carried<TasksWorkspaceAnswer>(
          yield* workspaceWrite(client.workspaces.setPhoto(workspaceId, photo)),
        );
      }),
    // The install address is answered to the caller that opens it and held
    // nowhere: the connection lands in the browser, and the follow carries
    // the organization.
    [GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "connecting GitHub names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceGitHubConnectAnswer>(WORKSPACE_UNANSWERED);
        const begun = yield* served(client.workspaces.githubConnect(read.workspaceId));
        return carried<TasksWorkspaceGitHubConnectAnswer>(
          begun.ok ? { url: begun.answer } : { failure: begun.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "disconnecting GitHub names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const disconnected = yield* workspaceCall(
          client.workspaces.githubDisconnect(read.workspaceId),
        );
        return carried<TasksWorkspaceAnswer>(
          disconnected.ok ? { workspace: disconnected.answer } : { failure: disconnected.failure },
        );
      }),
    // A workspace's Sentry is answered to the window that asked and held
    // nowhere: the row reads it as it opens and as the window comes forward.
    [GATEWAY_METHOD.WORKSPACES_SENTRY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "reading Sentry names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceSentryAnswer>(WORKSPACE_UNANSWERED);
        const sentry = yield* served(client.workspaces.sentryInstallations(read.workspaceId));
        return carried<TasksWorkspaceSentryAnswer>(
          sentry.ok ? { sentry: sentry.answer } : { failure: sentry.failure },
        );
      }),
    // Sentry's install address is answered to the caller that opens it and
    // held nowhere: the install lands in the browser.
    [GATEWAY_METHOD.WORKSPACES_SENTRY_INSTALL]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "installing Sentry names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceGitHubConnectAnswer>(WORKSPACE_UNANSWERED);
        const begun = yield* served(client.workspaces.sentryInstall(read.workspaceId));
        return carried<TasksWorkspaceGitHubConnectAnswer>(
          begun.ok ? { url: begun.answer } : { failure: begun.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_SENTRY_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceSentryDisconnectParamsSchema,
          params,
          "disconnecting Sentry names a workspace and an installation",
        );
        if (!gate()) return carried<TasksWorkspaceSentryAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, installationId } = read;
        const sentry = yield* served(
          client.workspaces.sentryDisconnect(workspaceId, installationId),
        );
        return carried<TasksWorkspaceSentryAnswer>(
          sentry.ok ? { sentry: sentry.answer } : { failure: sentry.failure },
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
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "a follow names a workspace",
        );
        if (!gate()) return {};
        const { workspaceId } = read;
        yield* FiberMap.run(peopleFollows, workspaceId, followPeople(workspaceId));
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_PEOPLE_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "a follow names a workspace",
        );
        yield* FiberMap.remove(peopleFollows, read.workspaceId);
        return {};
      }),
    // An owner's or an admin's window follows a workspace's invitations as
    // it follows its people.
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "a follow names a workspace",
        );
        if (!gate()) return {};
        const { workspaceId } = read;
        yield* FiberMap.run(invitationFollows, workspaceId, followInvitations(workspaceId));
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "a follow names a workspace",
        );
        yield* FiberMap.remove(invitationFollows, read.workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_MEMBERS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceMembersParamsSchema,
          params,
          "reading members names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const people = yield* served(client.workspaces.people(read.workspaceId));
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
        const read = yield* readParams(
          tasksWorkspacePhotoParamsSchema,
          params,
          "reading a photo names a workspace",
        );
        if (!gate()) return carried<TasksWorkspacePhotoAnswer>(WORKSPACE_UNANSWERED);
        const photo = yield* served(client.workspaces.photo(read.workspaceId));
        return carried<TasksWorkspacePhotoAnswer>(
          photo.ok ? photo.answer : { failure: photo.failure },
        );
      }),
    // A workspace's token repositories, and each change of them, are
    // answered to the page that asked and held nowhere, as the members are:
    // they move no task and no workspace the view holds.
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceTokenRepositoriesParamsSchema,
          params,
          "reading a workspace's token repositories names the workspace",
        );
        if (!gate()) return carried<TasksWorkspaceTokenRepositoriesAnswer>(WORKSPACE_UNANSWERED);
        const listed = yield* served(client.workspaces.tokenRepositories(read.workspaceId));
        return carried<TasksWorkspaceTokenRepositoriesAnswer>(
          listed.ok ? { repositories: listed.answer } : { failure: listed.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORY_SET]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceTokenRepositorySetParamsSchema,
          params,
          "adding or removing a token repository names the workspace, the repository, and which",
        );
        if (!gate()) return carried<TasksWorkspaceTokenRepositoriesAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, repository, added } = read;
        const changed = yield* served(
          client.workspaces.setTokenRepository(workspaceId, repository, added),
        );
        return carried<TasksWorkspaceTokenRepositoriesAnswer>(
          changed.ok ? { repositories: changed.answer } : { failure: changed.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceMemberRemoveParamsSchema,
          params,
          "removing a member names the workspace and the member",
        );
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId } = read;
        const remaining = yield* workspaceCall(client.workspaces.removeMember(workspaceId, userId));
        return carried<TasksWorkspaceMembersAnswer>(
          remaining.ok ? { members: remaining.answer } : { failure: remaining.failure },
        );
      }),
    // A role changed moves no task; the follow carries it, as a removal's.
    [GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceMemberRoleParamsSchema,
          params,
          "changing a role names the workspace, the member, and the role",
        );
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId, role } = read;
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
        const read = yield* readParams(
          tasksWorkspaceTransferParamsSchema,
          params,
          "handing a workspace over names it and the admin",
        );
        if (!gate()) return carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, userId } = read;
        const handedOver = yield* workspaceCall(client.workspaces.transfer(workspaceId, userId));
        return carried<TasksWorkspaceMembersAnswer>(
          handedOver.ok ? { members: handedOver.answer } : { failure: handedOver.failure },
        );
      }),
    // Note that a leave closes the open task where it is that workspace's, as
    // a delete of it does, because the account can no longer read or write a
    // task of a workspace it left; a refused leave closes nothing.
    [GATEWAY_METHOD.WORKSPACES_LEAVE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceLeaveParamsSchema,
          params,
          "leaving a workspace names it",
        );
        if (!gate()) return carried<TasksWorkspaceLeaveAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId } = read;
        const openTaskId = view.activeTaskId;
        const openWorkspaceId = view.tasks.find((task) => task.id === openTaskId)?.workspaceId;
        const closeOpenTask = Effect.gen(function* () {
          yield* serial(
            Effect.gen(function* () {
              if (view.activeTaskId !== openTaskId) return;
              yield* FiberHandle.clear(recordFollow);
              const { activeTaskId: _left, ...rest } = withoutPages(view);
              view = { ...rest, document: { status: TASKS_READ.IDLE } };
              publish();
            }),
          );
        });
        const leave = Effect.tap(client.workspaces.leave(workspaceId), (answer) =>
          answer.ok && openWorkspaceId === workspaceId ? closeOpenTask : Effect.void,
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
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "reading invitations names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED);
        const pending = yield* served(client.workspaces.invitations(read.workspaceId));
        return carried<TasksWorkspaceInvitationsAnswer>(
          pending.ok ? { invitations: pending.answer } : { failure: pending.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceInviteParamsSchema,
          params,
          "an invitation names a workspace, an address, and a role",
        );
        if (!gate()) return carried<TasksWorkspaceInvitationAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, email, role } = read;
        const made = yield* served(client.workspaces.invite(workspaceId, email, role));
        return carried<TasksWorkspaceInvitationAnswer>(
          made.ok ? { invitation: made.answer } : { failure: made.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceInvitationCancelParamsSchema,
          params,
          "canceling an invitation names the workspace and the invitation",
        );
        if (!gate()) return carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, invitationId } = read;
        const pending = yield* served(
          client.workspaces.cancelInvitation(workspaceId, invitationId),
        );
        return carried<TasksWorkspaceInvitationsAnswer>(
          pending.ok ? { invitations: pending.answer } : { failure: pending.failure },
        );
      }),
  };

  return {
    methods,
    snapshot: () => view,
    listed,
    writeAgent: (agentId, change, written) =>
      Effect.suspend(() => taskList.collections.writeAgent(agentId, change, written)),
    reset: Effect.gen(function* () {
      yield* Cache.invalidateAll(pullRequestReads);
      yield* Cache.invalidateAll(issueReads);
      yield* FiberHandle.clear(openedRead);
      yield* FiberMap.clear(pagesFollows);
      yield* FiberMap.clear(browserTabsFollows);
      yield* FiberMap.clear(historyFollows);
      yield* FiberHandle.clear(recordFollow);
      yield* FiberHandle.clear(listFollow);
      yield* Scope.close(taskList.scope, Exit.void);
      taskList = yield* openTaskList;
      yield* FiberHandle.clear(workspacesFollow);
      yield* FiberHandle.clear(sidebarFollow);
      yield* FiberMap.clear(peopleFollows);
      yield* FiberMap.clear(invitationFollows);
      yield* Scope.close(sidebar.scope, Exit.void);
      sidebar = yield* openSidebar;
      yield* serial(
        Effect.sync(() => {
          githubAskedAt = undefined;
          githubRead += 1;
          view = idleView();
          publish();
        }),
      );
    }),
    // The plan and page reads their followed marks ask for; every other
    // read of the tasks is an ask's. Note that these reads hold no lock,
    // because each is ordered by its part's numbers (`laidNow`), and an open
    // must not queue behind a read of the task it left.
    lifetime: Effect.gen(function* () {
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(planReads), (taskId) =>
            gate() ? readPlan(taskId) : Effect.void,
          ),
        ),
      );
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(pageReads), (taskId) =>
            gate() ? readPages(taskId) : Effect.void,
          ),
        ),
      );
    }),
  };
});
