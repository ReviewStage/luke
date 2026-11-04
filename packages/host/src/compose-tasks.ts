import {
  type HostedAdminClient,
  type HostedGitHubConnectionClient,
  type HostedTaskClient,
  type HostedWorkspaceClient,
  type TaskCallResult,
  type TaskWritten,
  WORKSPACE_CALL_FAILURE,
  type WorkspaceCallFailure,
  type WorkspaceCallResult,
} from "@repo/features";
import {
  ADMIN_UNANSWERED,
  type AdminReadAnswer,
  adminFavoriteParamsSchema,
  adminReadParamsSchema,
} from "@repo/features/admin-wire";
import {
  type AgentBrowserTab,
  BROWSER_TABS_PLACE,
  type BrowserTabsPlace,
  type BrowserTabsPlaceKind,
  browserTabsPlaceId,
  browserTabsPlaceKind,
} from "@repo/features/agent-browser-tab-wire";
import {
  browserTabsOfLiveRows,
  type LIVE_READ,
  LIVE_SIGNED_OUT,
  nextBrowserTabLapse,
  pagesOfLiveRows,
  revisionsOfLiveRows,
  taskBrowserTabsLiveRowsSchema,
  taskHistoryLiveRowsSchema,
  taskPagesLiveRowsSchema,
} from "@repo/features/live-wire";
import {
  PAGE_OWNER,
  type PageLine,
  type PageOwner,
  type PagePlace,
} from "@repo/features/page-wire";
import {
  TASK_BLOCK_CHANGE,
  TASK_RELATION_KIND,
  TASK_STATUS,
  type Task,
  type TaskRelationKind,
  type TaskSkillsAnswer,
} from "@repo/features/task-wire";
import {
  HOST_LIVE,
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksBlockAnswer,
  type TasksBlockParams,
  type TasksBrowserTabOpenAnswer,
  type TasksChangeRelationAnswer,
  type TasksChangeRelationParams,
  type TasksCommentAnswer,
  type TasksEditAnswer,
  type TasksFileAnswer,
  type TasksFindAnswer,
  type TasksGitHubDisconnectAnswer,
  type TasksGitHubPageAnswer,
  type TasksIssueAnswer,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPageAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPinParams,
  type TasksPullRequestAnswer,
  type TasksRenameParams,
  type TasksRepositoriesAnswer,
  type TasksRevisionAnswer,
  type TasksRevisionsAnswer,
  type TasksSetParentAnswer,
  type TasksSetParentParams,
  type TasksSetRepositoryAnswer,
  type TasksSetRepositoryParams,
  type TasksSetStandingParams,
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
  type TasksWorkspaceSlackBotAnswer,
  type TasksWorkspaceTokenRepositoriesAnswer,
  taskBrowserTabsFollowSchema,
  taskDocumentFollowSchema,
  taskHistoryFollowSchema,
  taskPagesFollowSchema,
  tasksBlockParamsSchema,
  tasksBrowserTabOpenParamsSchema,
  tasksChangeRelationParamsSchema,
  tasksCommentActParamsSchema,
  tasksCommentStartParamsSchema,
  tasksCommentsFollowSchema,
  tasksEditParamsSchema,
  tasksFileParamsSchema,
  tasksFindParamsSchema,
  tasksIssueParamsSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
  tasksPullRequestParamsSchema,
  tasksRenameParamsSchema,
  tasksRepositoriesParamsSchema,
  tasksRevisionParamsSchema,
  tasksRevisionsParamsSchema,
  tasksSetParentParamsSchema,
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
  tasksWorkspaceParamsSchema,
  tasksWorkspacePhotoParamsSchema,
  tasksWorkspacePhotoSetParamsSchema,
  tasksWorkspaceRenameParamsSchema,
  tasksWorkspaceSentryDisconnectParamsSchema,
  tasksWorkspaceSlackBotChannelParamsSchema,
  tasksWorkspaceSlackBotNotificationsParamsSchema,
  tasksWorkspaceSlackBotRepositoryParamsSchema,
  tasksWorkspaceSlugSetParamsSchema,
  tasksWorkspaceTokenRepositoriesParamsSchema,
  tasksWorkspaceTokenRepositorySetParamsSchema,
  tasksWorkspaceTransferParamsSchema,
  tasksWriteSectionParamsSchema,
  workspacePeopleFollowSchema,
} from "@repo/features/tasks-view";
import type { Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, readParams } from "@repo/gateway";
import {
  declaredMethod,
  type EntityPool,
  type FieldChange,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { keepIdentity, type WireRecord, type WireValue } from "@repo/wire";
import {
  Cache,
  Clock,
  Data,
  Duration,
  Effect,
  Equal,
  Exit,
  Fiber,
  FiberHandle,
  FiberMap,
  MutableHashMap,
  Option,
  Queue,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { NO_BROWSER_TABS, NO_PAGES } from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { fixturePage } from "./fixture-stage.js";
import type { HostMethodTable } from "./gateway-door.js";
import type { HostKernel } from "./host-kernel.js";
import {
  FileAtCommitKey,
  type KeptContent,
  keptOfTask,
  PageVersionKey,
  PlanPictureKey,
} from "./kept-content.js";
import { type HeldAnswers, heldSlice, rowWriteOn } from "./live-collection.js";
import {
  confirmWrite,
  FOLLOW_BACKOFF,
  LIVE_GONE,
  type LiveBroken,
  type SealedRead,
  type TxWait,
} from "./live-follow.js";
import { pushLive } from "./live-push.js";
import {
  type CommentSubjectKey,
  commentSubjectOf,
  planCommentReads,
} from "./plan-comment-reads.js";
import { planDocumentReads } from "./plan-document-reads.js";
import type { RunMode } from "./run-mode.js";
import { sidebarCollections } from "./sidebar-collections.js";
import { PLAN, type PlanRow, taskListCollections } from "./task-list-collections.js";
import { followTaskList } from "./task-list-follow.js";
import type { WindowFocus } from "./window-focus.js";
import { type MemberMoved, workspaceMembersReads } from "./workspace-members-read.js";
import {
  followSidebarRows,
  invitationsMoves,
  type LiveReadDependencies,
  workspacesMoves,
} from "./workspaces-follow.js";

/**
 * compose-tasks.ts -- the panel's named tasks, read from the service: the list, the one active task, and the plans the windows opened.
 *
 * Nothing here writes a plan but a restore or an edit the developer asks
 * for: the task's coding agents are its writers, on the service. Each plan
 * a window opened is held for it per task (`plan-document-reads.ts`), read
 * as it is first held and again as its record's plan mark moves, and never
 * on a clock. The list itself is followed over Neon Realtime from the
 * account gate opening until a sign-out (`task-list-follow.ts`), and is read
 * by none of those asks. The repositories the account reaches, and a task's repository
 * given or taken away, are the service's too, asked through here, as is a
 * task pinned. A
 * plan's history is read for the version history that asks and held nowhere
 * here; a revision restored is the one write this concern carries to the
 * service on the developer's word, and the view takes the task it answers.
 * The pages agents wrote for a task, or for an agent on no task, are held
 * for the windows that draw them, the open task's among them, by title and
 * newest version alone, and told on the app state (`LIVE_READ.PAGES`); a
 * page's HTML is answered to the frame that draws it and kept in this
 * process's memory by its version (`kept-content.ts`), never in the view, as
 * a plan's pictures and a file read at a commit are.
 *
 * The workspaces the account is a member of are carried on the view beside
 * the tasks and followed apart from them over Neon Realtime, so the tasks
 * never wait on them: from the account gate opening, at a launch or a
 * sign-in, until a sign-out, each change drawn as it lands, a teammate's and the
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

/** A Browser tab opened behind a closed gate, or on a service that did not answer. */
const BROWSER_TABS_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** A plan's skills, by its id and the workspace and repository the list names it in, so a plan moved to another of either is another key, its workspace's installed skills among what is read. */
class PlanSkillsKey extends Data.Class<{
  readonly planId: string;
  readonly workspaceId: string | undefined;
  readonly repository: string | undefined;
}> {}

/** A workspace's repository's skills, where no plan names it, or the workspace's alone for an agent with no repository. */
class RepositorySkillsKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string | undefined;
}> {}

/** Whose skills: a plan's, or a workspace's repository's no plan names. */
type SkillsKey = PlanSkillsKey | RepositorySkillsKey;

/** Whose pages: one task's, or one agent's on no task, by what they stand on and then its id. */
class PageOwnerKey extends Data.Class<{
  readonly kind: PageOwner["kind"];
  readonly id: string;
}> {}

/** The owner a window names pages by, as their key. */
function pageOwnerOf(place: PagePlace): PageOwnerKey {
  return "taskId" in place
    ? new PageOwnerKey({ kind: PAGE_OWNER.TASK, id: place.taskId })
    : new PageOwnerKey({ kind: PAGE_OWNER.AGENT, id: place.agentId });
}

/** The place the service names an owner's pages by. */
function pagePlaceOf(owner: PageOwnerKey): PagePlace {
  return owner.kind === PAGE_OWNER.TASK ? { taskId: owner.id } : { agentId: owner.id };
}

/** Whose Browser tabs: a task's agents' together, or one agent's, by what they are listed for and then its id. */
class BrowserTabsOwnerKey extends Data.Class<{
  readonly kind: BrowserTabsPlaceKind;
  readonly id: string;
}> {}

/** The place a window lists tabs for, as their key. */
function browserTabsOwnerOf(place: BrowserTabsPlace): BrowserTabsOwnerKey {
  return new BrowserTabsOwnerKey({
    kind: browserTabsPlaceKind(place),
    id: browserTabsPlaceId(place),
  });
}

/** The place the service names an owner's tabs by. */
function browserTabsPlaceOf(owner: BrowserTabsOwnerKey): BrowserTabsPlace {
  return owner.kind === BROWSER_TABS_PLACE.TASK ? { taskId: owner.id } : { agentId: owner.id };
}

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
  | "block"
  | "setParent"
  | "changeRelation"
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
  | "openBrowserTab"
  | "find"
  | "readRevisions"
  | "readRevision"
  | "readPageVersion"
  | "readPicture"
  | "keepPicture"
  | "commentsLive"
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
    | "setSlug"
    | "setPhoto"
    | "githubConnect"
    | "githubDisconnect"
    | "sentryInstallations"
    | "sentryInstall"
    | "sentryDisconnect"
    | "slackBot"
    | "slackBotConnect"
    | "slackBotDisconnect"
    | "slackBotNotifications"
    | "slackBotRepository"
    | "slackBotChannel"
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
  /** The content this host keeps under keys it never changes under, which a picture's, a page version's, and a file's read at a commit answer from (`kept-content.ts`). */
  kept: KeptContent;
  /** The windows coming forward, raised here as the panel's focus reaches the host and heard by every read asked again on it. */
  focus: WindowFocus;
  /** The sync engine's pool, which the task list's plans and agents stand in. */
  pool: EntityPool;
  /** GitHub's standing as an integration asked again, as a GitHub connect or disconnect that answered asks (`compose-integrations.ts`). */
  githubMoved: Effect.Effect<void>;
}

export interface TasksComposer extends Composer {
  /** The view as this Mac holds it now. */
  snapshot: () => TasksView;
  /** Drops everything held, for a sign-out, and tells every client the panel has nothing. */
  reset: Effect.Effect<void>;
  /**
   * Follows the account's task list, workspaces, and sidebar, and every read
   * a window holds anew, as the account gate opening asks, so the list loads
   * with no window asking and a hold taken while nobody was signed in reads now.
   */
  open: Effect.Effect<void>;
  /**
   * Waits for a write's transaction to arrive on the task list followed
   * live, which holds every task and agent row, so a write is confirmed once
   * the list carries it; no txid, or a list not followed over Realtime,
   * waits for nothing.
   */
  listed: (txid: string | undefined) => Effect.Effect<void>;
}

/** The statuses a task stands finished in, which the service stamps `completedAt` as it enters. */
const FINISHED: ReadonlySet<string> = new Set([TASK_STATUS.DONE, TASK_STATUS.CANCELED]);

/** One side of a relation between two tasks, taken away or added. */
interface RelationSide {
  readonly kind: TaskRelationKind;
  readonly added: boolean;
}

/** What the list knew of the tasks a relation's draw reads as the change was asked, so the change drawn and the change taken read alike. */
interface RelationReach {
  /** The tasks among the two, and the open task's blockers, that hold back a task waiting on them, as an unfinished one does. */
  readonly blocking: readonly string[];
  /** The open task's blockers, where it is one of the two and its document holds them. */
  readonly opened?: { readonly taskId: string; readonly blockedBy: readonly string[] };
}

/** A change of one relation between `taskId` and the task it names, and what the list knew as it was asked. */
interface RelationChange {
  readonly taskId: string;
  readonly otherId: string;
  readonly sides: readonly RelationSide[];
  readonly reach: RelationReach;
}

/**
 * What one side of a relation leaves of a row of the list: the waiting
 * task's `blocked`, or the child's parent, as its kind names them, and
 * nothing of any other row. Note that a block taken away clears `blocked`
 * only where the waiting task's other blockers are known, as the open
 * task's are, because elsewhere another may still hold it back; the list
 * carries it there.
 */
function relationFields(
  { taskId, otherId, reach }: RelationChange,
  side: RelationSide,
  row: PlanRow,
): Partial<PlanRow> {
  switch (side.kind) {
    case TASK_RELATION_KIND.BLOCKED_BY:
    case TASK_RELATION_KIND.BLOCKS: {
      const [waiting, blocker] =
        side.kind === TASK_RELATION_KIND.BLOCKED_BY ? [taskId, otherId] : [otherId, taskId];
      if (row.id !== waiting || !reach.blocking.includes(blocker)) return {};
      const others =
        reach.opened?.taskId === waiting
          ? reach.opened.blockedBy.filter((id) => id !== blocker)
          : undefined;
      if (!side.added && others === undefined) return {};
      const blocked = side.added || (others ?? []).some((id) => reach.blocking.includes(id));
      return blocked === (row.blocked === true) ? {} : { blocked };
    }
    case TASK_RELATION_KIND.SUB_TASK:
    case TASK_RELATION_KIND.PARENT: {
      const [child, parent] =
        side.kind === TASK_RELATION_KIND.SUB_TASK ? [otherId, taskId] : [taskId, otherId];
      if (row.id !== child) return {};
      if (side.added) return { parentTaskId: parent };
      return row.parentTaskId === parent ? { parentTaskId: null } : {};
    }
  }
}

/** What a relation's change leaves of a row of the list: each side drawn in turn over the row as the one before left it. */
function relationDrawn(change: RelationChange): (row: PlanRow) => Partial<PlanRow> {
  return (row) => {
    const fields: Partial<PlanRow> = {};
    for (const side of change.sides) {
      Object.assign(fields, relationFields(change, side, { ...row, ...fields }));
    }
    return fields;
  };
}

/**
 * How long after a resync another is let pass, so a wake that lands as
 * several events at once (resume, then unlock) seals the list again once.
 */
const RESYNC_SETTLE = Duration.seconds(10);

/**
 * The panel's tasks as one concern. The view is told to every client whole
 * whenever it moves, and exactly one task is active at a time: opening or
 * starting one replaces whichever was, and the plans the windows opened are
 * held apart, per task, on the app state. The list, the workspaces, and the sidebar
 * are followed from the account gate opening, whether or not a window shows
 * them. Behind a closed account gate, or on a run that sends nothing, nothing
 * is read.
 */
export const composeTasks = /* @__PURE__ */ Effect.fn("host/composeTasks")(function* (
  dependencies: TasksDependencies,
): Effect.fn.Return<TasksComposer, never, Scope.Scope | HttpClient.HttpClient> {
  const { kernel, account, client, kept } = dependencies;
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
  /**
   * Each plan's skills, and each repository's no plan names, as the service
   * last read them: answered at once each time they are asked, a `/` opening
   * or a holder chosen, and read again behind the answer, so a skill added on
   * GitHub is offered the next time they are asked. A read that is refused or
   * not answered leaves what is held, and one answering what is held already
   * leaves it as it stood.
   */
  const heldSkills = MutableHashMap.empty<SkillsKey, TaskSkillsAnswer>();
  /** Each holder's read of the service out now, one at a time, every ask meanwhile joining it. */
  const skillsReads = yield* FiberMap.make<SkillsKey, TaskSkillsAnswer | undefined, never>();

  /** Reads `key`'s skills of the service, holding what it read where it read skills that differ from those held. */
  function readSkillsOf(key: SkillsKey) {
    return Effect.map(
      served(
        key instanceof PlanSkillsKey
          ? client.readSkills(key.planId)
          : client.readRepositorySkills(
              key.repository === undefined
                ? { workspaceId: key.workspaceId }
                : { workspaceId: key.workspaceId, repository: key.repository },
            ),
      ),
      (answer) => {
        const held = MutableHashMap.get(heldSkills, key);
        if (answer === undefined || !("skills" in answer)) return answer;
        if (Option.isSome(held) && Equal.equals(held.value, answer)) return held.value;
        MutableHashMap.set(heldSkills, key, answer);
        return answer;
      },
    );
  }

  /** The read of `key`'s skills out now, or one started, which every ask meanwhile joins. */
  const skillsRead = (key: SkillsKey) =>
    Effect.gen(function* () {
      const out = yield* FiberMap.get(skillsReads, key);
      return Option.isSome(out)
        ? out.value
        : yield* FiberMap.run(skillsReads, key, readSkillsOf(key));
    });
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
   * view back. A held plan is read outside it, ordered by its task's own
   * numbers instead (`plan-document-reads.ts`).
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

  /** Leaves the open task, returning the window to its list; its plan stays held while the window lets it go. */
  function closeActive(): void {
    const { activeTaskId: _closed, ...rest } = view;
    view = rest;
    publish();
  }

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

  const decodeBrowserTabs = Schema.decodeUnknownOption(taskBrowserTabsLiveRowsSchema);

  /**
   * Follows the Browser tabs of `owner`, one agent's or a task's agents',
   * live until let go, each change told through `answers`. A takeover lapses
   * with no row moving, so the rows last delivered are told again at each
   * instant one lapses, until the next delivery takes their place; the wait
   * for the next lapse is this follow's own, so it ends as the key closes.
   */
  function followBrowserTabs(
    owner: BrowserTabsOwnerKey,
    answers: HeldAnswers<readonly AgentBrowserTab[]>,
  ) {
    type Rows = typeof taskBrowserTabsLiveRowsSchema.Type;
    const place = browserTabsPlaceOf(owner);
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    const tell = (rows: Rows, now: number) => answers.answered(browserTabsOfLiveRows(rows, now));
    // The rows told as they arrive, then again at each takeover's lapse in turn.
    const toldUntilMoved = (rows: Rows) =>
      Effect.gen(function* () {
        let now = yield* Clock.currentTimeMillis;
        tell(rows, now);
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
        const delivered = yield* Queue.sliding<Rows>(1);
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
          // Note that a read that stops answering keeps its rows, and their lapses, until the next delivery.
          publish: (rows) => {
            if (rows === undefined) answers.unanswered();
            else Queue.offerUnsafe(delivered, rows);
          },
        });
      }),
    );
  }

  const decodePages = Schema.decodeUnknownOption(taskPagesLiveRowsSchema);

  /** Follows the pages of `owner`, a task or an agent on no task, live until let go, each change told through `answers`. */
  function followPages(owner: PageOwnerKey, answers: HeldAnswers<readonly PageLine[]>) {
    const place = pagePlaceOf(owner);
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
      publish: (pages) => (pages === undefined ? answers.unanswered() : answers.answered(pages)),
    });
  }

  /**
   * The pages each window holds, a task's or an agent's on no task, and the
   * few let go latest, each as its read stands, told whole on the app state
   * every window draws (`LIVE_READ.PAGES`): followed from the first window's
   * hold (`heldSlice`), so a window opening a task again draws its pages
   * from where they stand. Behind a closed gate a held owner is followed
   * only once the gate opens (`open`). An owner the service refuses is
   * followed no longer (`pushLive`), until every window lets it go and one
   * holds it anew.
   */
  const heldPageReads = yield* heldSlice<typeof LIVE_READ.PAGES, PageOwnerKey>({
    empty: NO_PAGES,
    path: (owner) => [owner.kind, owner.id],
    gate,
    follow: followPages,
    tell: (pages) => kernel.emit(GATEWAY_EVENT.PAGES_CHANGED, carried(pages)),
  });
  /** The windows' hold on each owner's pages, one fiber standing until let go. */
  const pageHolds = yield* FiberMap.make<PageOwnerKey>();

  /**
   * The Browser tabs each window's side panel lists, a task's agents' or one
   * agent's, and the few let go latest, each as its read stands, told whole
   * on the app state every window draws (`LIVE_READ.BROWSER_TABS`): followed
   * from the first window's hold (`heldSlice`), on the terms the pages are.
   * Note that the slice lives in memory alone, since a tab's address and
   * title reach only this member's windows.
   */
  const heldBrowserTabs = yield* heldSlice<typeof LIVE_READ.BROWSER_TABS, BrowserTabsOwnerKey>({
    empty: NO_BROWSER_TABS,
    path: (owner) => [owner.kind, owner.id],
    gate,
    follow: followBrowserTabs,
    tell: (tabs) => kernel.emit(GATEWAY_EVENT.BROWSER_TABS_CHANGED, carried(tabs)),
  });
  /** The windows' hold on each place's Browser tabs, one fiber standing until let go. */
  const browserTabsHolds = yield* FiberMap.make<BrowserTabsOwnerKey>();

  /**
   * Each plan's or page's comments the windows show, and the few let go
   * latest, each as its read stands with the windows' writes laid over it,
   * told whole on the app state every window draws
   * (`LIVE_READ.PLAN_COMMENTS`), on the terms the pages are held.
   */
  const comments = yield* planCommentReads({
    seal: (subject, userId, poll, after) =>
      Effect.map(served(client.commentsLive(subject, userId, poll, after)), (sealed) =>
        sealed.ok
          ? sealed.answer
          : {
              failure: sealed.failure,
              gone:
                sealed.failure === TASK_CALL_FAILURE.NOT_FOUND ||
                sealed.failure === LIVE_SIGNED_OUT.failure,
            },
      ),
    accountId: dependencies.accountId,
    gate,
    tell: (held) => kernel.emit(GATEWAY_EVENT.PLAN_COMMENTS_CHANGED, carried(held)),
  });
  /** The windows' hold on each subject's comments, one fiber standing until let go. */
  const commentHolds = yield* FiberMap.make<CommentSubjectKey>();

  /**
   * The plan of each task a window opened, and of the few opened latest,
   * told whole on the app state every window draws
   * (`LIVE_READ.PLAN_DOCUMENT`), so a task opened again draws its plan in
   * its first frame (`plan-document-reads.ts`).
   */
  const documents = yield* planDocumentReads({
    gate,
    accountId: dependencies.accountId,
    open: (taskId) => served(client.open(taskId)),
    recordLive: (taskId, userId, poll, after) =>
      served(client.recordLive(taskId, userId, poll, after)),
    listed: asListed,
    tell: (held) => kernel.emit(GATEWAY_EVENT.PLAN_DOCUMENTS_CHANGED, carried(held)),
  });
  /** Each edit's waits for its transaction, on its task's record and on the list, by the task, a newer edit's replacing an older one's. */
  const editWaits = yield* FiberMap.make<string>();

  /** A task's row or plan without the assignee it stood with. */
  function withoutAssignee<T extends { readonly assignee?: unknown }>(
    standing: T,
  ): Omit<T, "assignee"> {
    const { assignee: _assignee, ...rest } = standing;
    return rest;
  }

  /** The one follow of the list, started as the account gate opens and stopped by a sign-out. */
  const listFollow = yield* FiberHandle.make<void>();

  /** The list's wait for a write's transaction, while every part of it is followed over Realtime. */
  let listWait: TxWait | undefined;

  /** When the list was last sealed again for a resync, by the host's clock; none before the first. */
  let resyncedAt: number | undefined;

  const listed = (txid: string | undefined): Effect.Effect<void> =>
    Effect.suspend(() => confirmWrite(listWait, txid));

  /** A write to a plan's row still served by hand, or one the service already answered, held over the list until it carries it. */
  const planWrite = rowWriteOn<PlanRow>(dependencies.pool, PLAN);

  /**
   * The account's task list in collections (`task-list-collections.ts`),
   * from a launch or a sign-in until a sign-out closes their scope, so a
   * write still out for the account signed out draws on nothing the next
   * account sees. Each draw lays the list in the view, and what the service
   * holds of each task whose plan is held, its name, pin, status, assignee,
   * and repository, reaches its plan as the list carries it.
   */
  const openTaskList = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const collections = yield* Scope.provide(scope)(
      taskListCollections({
        pool: dependencies.pool,
        draw: ({
          list,
          taskAgents,
          taskPullRequests,
          agentPullRequests,
          taskAgentPins,
          pendingTasks,
        }) => {
          const { pendingTasks: _held, ...rest } = view;
          view = pendingTasks.length === 0 ? rest : { ...rest, pendingTasks };
          write({
            tasks: list.plans,
            tasklessAgents: list.planlessAgents ?? [],
            taskAgents,
            taskPullRequests,
            agentPullRequests,
            taskAgentPins,
          });
          documents.relisted();
        },
        txWait: () => listWait,
      }),
    );
    return { scope, collections };
  });
  let taskList = yield* openTaskList;
  yield* Effect.addFinalizer(() => Scope.close(taskList.scope, Exit.void));

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

  /** The one follow of the account's workspaces, from the account gate opening, at a launch or a sign-in, until a sign-out. */
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
        Effect.gen(function* () {
          const drawn = new Map(view.workspaces.map((each) => [each.id, JSON.stringify(each)]));
          const listed = new Set(workspaces.map((each) => each.id));
          // Note that a workspace leaving the list lets go of all content kept, since what was read in it is no longer the account's to read.
          if ([...drawn.keys()].some((id) => !listed.has(id))) yield* kept.clear;
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

  /** The workspaces whose invitations a window follows, each followed while any window does. */
  const invitationFollows = yield* FiberMap.make<string, void>();

  /**
   * Each workspace's people the windows draw, and the few drawn latest, told
   * on the app state every window draws (`LIVE_READ.WORKSPACE_MEMBERS`):
   * followed from the first window's hold, so a surface drawn again draws
   * them from where they stand, and drawn over by a member write's answer
   * until the read carries it (`workspace-members-read.ts`). A workspace the
   * account no longer reaches is followed no longer, until every window lets
   * it go and one holds it anew.
   */
  const membersReads = yield* workspaceMembersReads({
    gate,
    seal: (workspaceId) => {
      // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
      const userId = dependencies.accountId();
      return (poll, after) =>
        gate() && userId !== undefined
          ? Effect.map(
              served(client.workspaces.peopleLive(workspaceId, userId, poll, after)),
              (sealed) => {
                if (!("ok" in sealed)) return { ...sealed, gone: true };
                if (sealed.ok) return sealed.answer;
                return {
                  failure: sealed.failure,
                  gone:
                    sealed.failure === WORKSPACE_CALL_FAILURE.NOT_FOUND ||
                    sealed.failure === WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
                };
              },
            )
          : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true });
    },
    tell: (held) => kernel.emit(GATEWAY_EVENT.WORKSPACE_MEMBERS_CHANGED, carried(held)),
  });
  /** The windows' hold on each workspace's people, one fiber standing until let go. */
  const memberHolds = yield* FiberMap.make<string>();

  /** What a member write's answer says of each of `userIds`: the role it answers them with, or gone where it names them no more. */
  function membersMoved(
    answered: readonly WorkspaceMember[],
    userIds: readonly (string | undefined)[],
  ): MemberMoved[] {
    return userIds.flatMap((userId) => {
      if (userId === undefined) return [];
      const member = answered.find((each) => each.userId === userId);
      return [member === undefined ? { userId, gone: true } : { userId, role: member.role }];
    });
  }

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

  /** The one follow of the account's sidebar sections and pinned repositories, from the account gate opening, at a launch or a sign-in, until a sign-out. */
  const sidebarFollow = yield* FiberHandle.make<void>();
  /** The sidebar follow's wait for a write's transaction once Sync woke it; none while it polls or is let go. */
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
   * Follows the account's task list, workspaces, and sidebar where nothing
   * follows each yet, the list saying it is reading until its first answer
   * lands.
   */
  const followAccount = Effect.gen(function* () {
    if (view.listStatus === TASKS_READ.IDLE) write({ listStatus: TASKS_READ.READING });
    yield* FiberHandle.run(listFollow, followList, { onlyIfMissing: true });
    yield* followWorkspaces;
    yield* followSidebar;
  });

  /** The read of GitHub's connection the gate opening starts beside the follows, so a sign-in waits on none of it. */
  const githubOpened = yield* FiberHandle.make<void>();

  /**
   * `task` given everything its row of the list now reads, its name,
   * status, assignee, and repository among them, so a change a teammate or
   * an agent made reaches a held plan as it reaches the list; the very task
   * where the list holds no row of it. Note that the row is the whole of
   * what the task carries but its plan, so a field the row leaves out is one
   * the task no longer has, and that the last save is the plan's own, kept
   * with its body, as are its blocks, which a row of the list never carries.
   */
  function asListed(task: Task): Task {
    const listed = view.tasks.find((row) => row.id === task.id);
    if (listed === undefined) return task;
    const { agents: _agents, ...row } = listed;
    const { updatedAt, document, agentEdits, lastEdit, sectionEdits, blockedBy, blocks } = task;
    return {
      ...row,
      updatedAt,
      document,
      ...(agentEdits === undefined ? undefined : { agentEdits }),
      ...(lastEdit === undefined ? undefined : { lastEdit }),
      ...(sectionEdits === undefined ? undefined : { sectionEdits }),
      ...(blockedBy === undefined ? undefined : { blockedBy }),
      ...(blocks === undefined ? undefined : { blocks }),
    };
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
      parentTaskId: task.parentTaskId ?? null,
      pinnedAt: task.pinnedAt ?? null,
      pinPosition: task.pinPosition ?? null,
      completedAt: task.completedAt ?? null,
    };
  }

  /**
   * A started task's row of the list as the service answered it; none from
   * a service that leaves out a field the row needs, whose task is drawn
   * once the list carries it. Note that the answer names its blockers
   * rather than whether one is open, so the row is blocked where a blocker
   * the list holds is unfinished, or the list holds it not at all.
   */
  function planRowOf(task: Task): PlanRow | undefined {
    const { ownerId, status, priority, number, origin } = task;
    if (ownerId === undefined || status === undefined || priority === undefined) return undefined;
    if (number === undefined) return undefined;
    return {
      id: task.id,
      workspaceId: task.workspaceId,
      name: task.name,
      repository: task.repository,
      ownerId,
      ownerName: task.createdBy?.name ?? null,
      assigneeId: task.assignee?.userId ?? null,
      assigneeName: task.assignee?.name ?? null,
      pinnedAt: task.pinnedAt ?? null,
      pinPosition: task.pinPosition ?? null,
      completedAt: task.completedAt ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      status,
      priority,
      number,
      ...(origin === undefined
        ? undefined
        : { creatorActor: origin.actor, creatorAgentId: origin.agentId ?? null }),
      parentTaskId: task.parentTaskId ?? null,
      ...(task.mode === undefined ? undefined : { mode: task.mode }),
      ...((task.blockedBy ?? []).some(blocksNow) ? { blocked: true } : undefined),
    };
  }

  /** Whether `taskId` holds back a task waiting on it now: unfinished, or not held by the list at all. */
  function blocksNow(taskId: string): boolean {
    const blocker = view.tasks.find((row) => row.id === taskId);
    return blocker?.status === undefined || !FINISHED.has(blocker.status);
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
    return planWrite(taskId, () => fields, Effect.succeed({ answer: undefined, txid, fields }));
  }

  /**
   * Draws `task` as the service answered it on its plan wherever that is
   * held, and answers what it says of the task's row of the list, which the
   * caller holds over the list (`heldOverList`). Note that the assignee
   * standing is dropped first, because an answer names one only where the
   * task has one, so an answer that names none is a task assigned to no one.
   */
  function takeAnswered(task: Task): {
    readonly taskId: string;
    readonly fields: Partial<PlanRow>;
  } {
    documentTook(task.id, task, (held) => ({ ...withoutAssignee(held), ...task }));
    return { taskId: task.id, fields: planFieldsOf(task) };
  }

  /**
   * Lays `answered`, a write's answer about `taskId`, on its plan wherever
   * that is held, over the copy held by `lay`, so no read that left before
   * the answer lands over it; a plan whose first read is still out takes the
   * answer whole (`plan-document-reads.ts`).
   */
  function documentTook(taskId: string, answered: Task, lay: (held: Task) => Task): void {
    documents.written(taskId, (held) => (held === undefined ? answered : lay(held)));
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
   * Draws the pin `task` was answered with on its plan wherever a copy is
   * held, which keeps everything else it holds, because a draft drawn
   * meanwhile may be ahead of the copy the service answered. Note that a
   * plan whose first read is still out takes the pin from the list's row as
   * the read lands (`asListed`).
   */
  function takeMarks(task: Task): void {
    documents.written(task.id, (held) =>
      held === undefined ? undefined : withMarksOf(held, task),
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

  /**
   * A task renamed, its name drawn on its row at once and kept once the list
   * carries it (`task-list-collections.ts`); its held plan takes the
   * service's answer in place, and nothing is read again.
   */
  const renamed: WriteDeclaration<
    PlanRow,
    FieldChange<PlanRow>,
    TasksRenameParams,
    { readonly renamed: boolean }
  > = {
    kind: PLAN,
    keys: ({ taskId }) => [taskId],
    change:
      ({ name }) =>
      () => ({ name }),
    send: ({ taskId, name }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const written = yield* served(client.rename(taskId, { name }));
              if (written === undefined) return { refused: { renamed: false } };
              const answered = written.task;
              documentTook(taskId, answered, (held) => ({
                ...held,
                name: answered.name,
                document: answered.document,
              }));
              return {
                answer: { renamed: true },
                txid: written.txid,
                taken: () => planFieldsOf(answered),
              };
            }),
          )
        : Effect.succeed({ refused: { renamed: false } }),
  };

  /**
   * Where a task stands, drawn on its row at once, a member assigned by the
   * name the window knows them by, and kept once the list carries it; its
   * held plan takes the service's answer in place, and nothing is read
   * again.
   */
  const stood: WriteDeclaration<
    PlanRow,
    FieldChange<PlanRow>,
    TasksSetStandingParams,
    { readonly changed: boolean }
  > = {
    kind: PLAN,
    keys: ({ taskId }) => [taskId],
    change:
      ({ assigneeName, ...standing }) =>
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
    send: ({ taskId, assigneeName: _named, ...standing }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const answered = yield* served(client.setStanding(taskId, standing));
              if (answered === undefined) return { refused: { changed: false } };
              const { task } = answered;
              documentTook(taskId, task, (held) => ({ ...withoutAssignee(held), ...task }));
              return {
                answer: { changed: true },
                txid: answered.txid,
                taken: () => planFieldsOf(task),
              };
            }),
          )
        : Effect.succeed({ refused: { changed: false } }),
  };

  /**
   * A task pinned or unpinned, drawn on its row at once, a pin newest pinned
   * and standing where it was dragged, and kept once the list carries it;
   * its held plan takes the service's answer.
   */
  const pinned: WriteDeclaration<
    PlanRow,
    FieldChange<PlanRow>,
    TasksPinParams,
    { readonly changed: boolean }
  > = {
    kind: PLAN,
    keys: ({ taskId }) => [taskId],
    change:
      ({ pinned: pin, position }) =>
      (row) =>
        pin
          ? {
              pinnedAt: row.pinnedAt ?? kernel.now(),
              pinPosition: position ?? (row.pinnedAt === null ? null : row.pinPosition),
            }
          : { pinnedAt: null, pinPosition: null },
    send: ({ taskId, pinned: pin, position }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const marked = yield* served(
                client.mark(
                  taskId,
                  position === undefined ? { pinned: pin } : { pinned: pin, pinPosition: position },
                ),
              );
              if (marked === undefined) return { refused: { changed: false } };
              takeMarks(marked.task);
              return {
                answer: { changed: true },
                txid: marked.txid,
                taken: () => planFieldsOf(marked.task),
              };
            }),
          )
        : Effect.succeed({ refused: { changed: false } }),
  };

  /**
   * A task deleted once its question was answered, drawn gone at once and
   * kept once the list carries it; a refusal puts it back. What this host
   * kept of it goes, and the task closes where it is open, once the service
   * deleted it.
   */
  const deleted: WriteDeclaration<
    PlanRow,
    FieldChange<PlanRow>,
    { readonly taskId: string },
    { readonly deleted: boolean }
  > = {
    kind: PLAN,
    keys: ({ taskId }) => [taskId],
    change: () => () => ROW_GONE,
    send: ({ taskId }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const written = yield* served(client.delete(taskId));
              if (written === undefined) return { refused: { deleted: false } };
              yield* kept.forget(keptOfTask(taskId));
              if (view.activeTaskId === taskId) closeActive();
              return { answer: { deleted: true }, txid: written.txid };
            }),
          )
        : Effect.succeed({ refused: { deleted: false } }),
  };

  /**
   * A task changed by a call the service answers with the task, drawn at
   * once on every row `keys` names, the task's and the other task's a
   * relation joins, and kept once the list carries it; its held plan takes
   * the service's answer in place, and a refusal answers why and puts
   * every row back. Note that the change is read off the input alone, which
   * holds what the list knew as it was asked, so the change taken where the
   * list hands no wait is the one drawn: the task's own row as the service
   * answered it laid over it, and every other row as drawn.
   */
  const taskChanged = <Input extends { readonly taskId: string }, Failure>(declared: {
    readonly keys: (input: Input) => readonly string[];
    readonly drawn: (input: Input) => (row: PlanRow) => Partial<PlanRow> | typeof ROW_GONE;
    readonly call: (
      input: Input,
    ) => Effect.Effect<TaskCallResult<TaskWritten, Failure>, never, HttpClient.HttpClient>;
    readonly answered: (task: Task) => WireValue;
    readonly refused: (failure: Failure | typeof TASK_CALL_FAILURE.UNANSWERED) => WireValue;
  }): WriteDeclaration<PlanRow, FieldChange<PlanRow>, Input, WireValue> => ({
    kind: PLAN,
    keys: declared.keys,
    change: declared.drawn,
    send: (input) =>
      gate()
        ? serial(
            Effect.map(served(declared.call(input)), (changed) => {
              if (!changed.ok) return { refused: declared.refused(changed.failure) };
              const { task, txid } = changed.answer;
              const { fields } = takeAnswered(task);
              const drawn = declared.drawn(input);
              return {
                answer: declared.answered(task),
                txid,
                taken: (row: PlanRow) => {
                  const own = drawn(row);
                  return own === ROW_GONE || row.id !== task.id ? own : { ...own, ...fields };
                },
              };
            }),
          )
        : Effect.succeed({ refused: declared.refused(TASK_CALL_FAILURE.UNANSWERED) }),
  });

  /** A task given a repository, or none, drawn on its row at once. */
  const repositorySet = taskChanged({
    keys: ({ taskId }: TasksSetRepositoryParams) => [taskId],
    drawn:
      ({ repository }) =>
      () => ({ repository }),
    call: ({ taskId, repository }) => client.setRepository(taskId, repository),
    answered: (task) => carried<TasksSetRepositoryAnswer>({ repository: task.repository }),
    refused: (failure) => carried<TasksSetRepositoryAnswer>({ failure }),
  });

  /**
   * A task moved to another workspace, drawn there at once, or drawn gone
   * where the reader is no member of it, as the list will no longer hold it.
   */
  const moved = taskChanged({
    keys: ({ taskId }: TasksMoveParams & { readonly member: boolean }) => [taskId],
    drawn:
      ({ workspaceId, member }) =>
      () =>
        member ? { workspaceId } : ROW_GONE,
    call: ({ taskId, workspaceId }) => client.move(taskId, workspaceId),
    answered: (task) => carried<TasksMoveAnswer>({ workspaceId: task.workspaceId }),
    refused: (failure) => carried<TasksMoveAnswer>({ failure }),
  });

  /** A block added or taken away, drawn at once on the task that waits, and standing over both tasks it joins. */
  const blockChanged = taskChanged({
    keys: ({ taskId, block }: TasksBlockParams & { readonly reach: RelationReach }) => [
      taskId,
      block.taskId,
    ],
    drawn: ({ taskId, block, reach }) =>
      relationDrawn({
        taskId,
        otherId: block.taskId,
        sides: [{ kind: block.relation, added: block.change === TASK_BLOCK_CHANGE.ADD }],
        reach,
      }),
    call: ({ taskId, block }) => client.block(taskId, block),
    answered: (task) =>
      carried<TasksBlockAnswer>({ blockedBy: task.blockedBy ?? [], blocks: task.blocks ?? [] }),
    refused: (failure) => carried<TasksBlockAnswer>({ failure }),
  });

  /** A task's parent set or cleared, the task drawn nested at once, and standing over the parent it now sits under. */
  const parentSet = taskChanged({
    keys: ({ taskId, parentTaskId }: TasksSetParentParams) =>
      parentTaskId === null ? [taskId] : [taskId, parentTaskId],
    drawn:
      ({ taskId, parentTaskId }) =>
      (row) =>
        row.id === taskId ? { parentTaskId } : {},
    call: ({ taskId, parentTaskId }) => client.setParent(taskId, { parentTaskId }),
    answered: (task) => carried<TasksSetParentAnswer>({ parentTaskId: task.parentTaskId ?? null }),
    refused: (failure) => carried<TasksSetParentAnswer>({ failure }),
  });

  /** A relation moved to another kind, its taking away and its adding drawn at once on both tasks it joins. */
  const relationChanged = taskChanged({
    keys: ({ taskId, relation }: TasksChangeRelationParams & { readonly reach: RelationReach }) => [
      taskId,
      relation.taskId,
    ],
    drawn: ({ taskId, relation, reach }) =>
      relationDrawn({
        taskId,
        otherId: relation.taskId,
        sides: [
          { kind: relation.from, added: false },
          { kind: relation.to, added: true },
        ],
        reach,
      }),
    call: ({ taskId, relation }) => client.changeRelation(taskId, relation),
    answered: (task) =>
      carried<TasksChangeRelationAnswer>({
        blockedBy: task.blockedBy ?? [],
        blocks: task.blocks ?? [],
        parentTaskId: task.parentTaskId ?? null,
      }),
    refused: (failure) => carried<TasksChangeRelationAnswer>({ failure }),
  });

  /** What the list knows now of the two tasks a relation joins, which its draw reads. */
  function relationReachOf(taskId: string, otherId: string): RelationReach {
    const openId = view.activeTaskId;
    const blockedBy =
      openId === taskId || openId === otherId ? documents.heldTask(openId)?.blockedBy : undefined;
    const opened =
      openId === undefined || blockedBy === undefined ? undefined : { taskId: openId, blockedBy };
    return {
      blocking: [taskId, otherId, ...(blockedBy ?? [])].filter(blocksNow),
      ...(opened === undefined ? undefined : { opened }),
    };
  }

  const methods: HostMethodTable = {
    // The list's Try again: what is followed already stands (`open`), so it
    // starts only a follow that is not running, and reads GitHub's
    // connection again where the last read is stale. A held plan has a Try
    // again of its own (`TASKS_DOCUMENT_RETRY`).
    [GATEWAY_METHOD.TASKS_REFRESH]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        yield* followAccount;
        yield* readGithubWhenStale;
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
    // workspaces are followed and need no read. It is also the host's one
    // word that a window came forward, which every read asked again on
    // focus hears (`window-focus.ts`).
    [GATEWAY_METHOD.WORKSPACES_REFRESH]: () =>
      Effect.gen(function* () {
        yield* dependencies.focus.raise;
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
        screenAsks += 1;
        // Note that the open reads nothing: the window holds the task's plan (`TASKS_DOCUMENT_FOLLOW`), which draws at once where it was held lately.
        write({ activeTaskId: read.taskId });
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
        const asked = served(
          "taskId" in read
            ? client.readFile(read.taskId, window)
            : client.readRepositoryFile(read, window),
        );
        // A file read at a commit never changes, so it is kept; one read at the head of a branch is asked each time.
        const answer = yield* ref === undefined
          ? asked
          : kept.answer(
              new FileAtCommitKey({
                taskId: "taskId" in read ? read.taskId : undefined,
                workspaceId: "taskId" in read ? undefined : read.workspaceId,
                repository: "taskId" in read ? undefined : read.repository,
                path,
                ref,
                raw: raw === true,
                firstLine: raw === true ? undefined : firstLine,
                lastLine: raw === true ? undefined : lastLine,
              }),
              dependencies.accountId,
              asked,
              (file) =>
                file !== undefined && ("file" in file || "text" in file) ? file : undefined,
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
    // The repository's skills are held for every window and read again behind
    // each answer (`heldSkills`), a plan's under the repository the list
    // names it on, so a plan moved to another repository reads that one's.
    [GATEWAY_METHOD.TASKS_SKILLS]: (params) =>
      Effect.gen(function* () {
        const asked = yield* readParams(
          tasksSkillsParamsSchema,
          params,
          "reading a repository's skills names the task, or a workspace and its repository",
        );
        if (!gate()) {
          return carried<TasksSkillsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const listed =
          "planId" in asked ? view.tasks.find((each) => each.id === asked.planId) : undefined;
        const key: SkillsKey =
          "planId" in asked
            ? new PlanSkillsKey({
                planId: asked.planId,
                workspaceId: listed?.workspaceId,
                repository: listed?.repository ?? undefined,
              })
            : new RepositorySkillsKey({
                workspaceId: asked.workspaceId,
                repository: asked.repository,
              });
        // Note that skills held are answered as they stood when asked, the read behind them landing for the next ask.
        const held = MutableHashMap.get(heldSkills, key);
        const read = yield* skillsRead(key);
        const answer = Option.isSome(held) ? held.value : yield* Fiber.join(read);
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
    // A tab a member opens in an agent's browser is answered to the panel
    // that asked and held nowhere; the held list names it once it moves.
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
    // The task a link names by its number is found on the service and answered to the window that asked, held nowhere.
    [GATEWAY_METHOD.TASKS_FIND]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksFindParamsSchema,
          params,
          "finding a task by its number names the workspace and the number",
        );
        if (!gate()) {
          return carried<TasksFindAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const taskId = yield* served(client.find(read.workspace, read.number));
        return carried<TasksFindAnswer>(
          taskId === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { taskId },
        );
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
    // A page's version is answered to the frame that asked and kept by its
    // version, which is never written again, so its HTML never enters the view
    // every window is told.
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
        const owner = pageOwnerOf(read);
        const answer = yield* kept.answer(
          new PageVersionKey({ ownerKind: owner.kind, ownerId: owner.id, pageId, version }),
          dependencies.accountId,
          Effect.map(
            served(client.readPageVersion(place, pageId, version)),
            (page): TasksPageAnswer =>
              page === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { page },
          ),
          (page) => ("page" in page ? page : undefined),
        );
        return carried<TasksPageAnswer>(answer);
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
    // An agent's or a task's agents' Browser tabs are held for a window's
    // side panel while it lists them, and told only on the app state
    // (`BROWSER_TABS_CHANGED`), as the pages are.
    [GATEWAY_METHOD.TASKS_BROWSER_TABS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskBrowserTabsFollowSchema,
          params,
          "following Browser tabs names the agent or the task",
        );
        const owner = browserTabsOwnerOf(read);
        yield* FiberMap.run(
          browserTabsHolds,
          owner,
          Effect.scoped(Effect.andThen(heldBrowserTabs.hold(owner), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_BROWSER_TABS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskBrowserTabsFollowSchema,
          params,
          "letting Browser tabs go names the agent or the task",
        );
        yield* FiberMap.remove(browserTabsHolds, browserTabsOwnerOf(read));
        return {};
      }),
    // A plan's pages are held for a window while it draws them, the open
    // task's, an Inbox item's plan's, or a chip's card's, and an agent's on no
    // task while its page or a chip's card draws them, and told only on the
    // app state (`PAGES_CHANGED`). Note that the windows' hold is one fiber
    // standing until let go, so a window holding it again holds nothing anew.
    [GATEWAY_METHOD.TASKS_PAGES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskPagesFollowSchema,
          params,
          "following pages names the task or the agent",
        );
        const owner = pageOwnerOf(read);
        yield* FiberMap.run(
          pageHolds,
          owner,
          Effect.scoped(Effect.andThen(heldPageReads.hold(owner), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskPagesFollowSchema,
          params,
          "letting pages go names the task or the agent",
        );
        yield* FiberMap.remove(pageHolds, pageOwnerOf(read));
        return {};
      }),
    // A task's plan is held for a window while it has the task open, and
    // told only on the app state (`PLAN_DOCUMENTS_CHANGED`). Note that the
    // windows' hold is one fiber standing until let go, so a window holding
    // it again holds nothing anew.
    [GATEWAY_METHOD.TASKS_DOCUMENT_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskDocumentFollowSchema,
          params,
          "following a plan names the task",
        );
        yield* documents.follow(read.taskId);
        return {};
      }),
    [GATEWAY_METHOD.TASKS_DOCUMENT_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskDocumentFollowSchema,
          params,
          "letting a plan go names the task",
        );
        yield* documents.unfollow(read.taskId);
        return {};
      }),
    [GATEWAY_METHOD.TASKS_DOCUMENT_RETRY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskDocumentFollowSchema,
          params,
          "reading a plan again names the task",
        );
        if (gate()) yield* documents.retry(read.taskId);
        return {};
      }),
    // A picture's bytes are answered to the window that asked and kept by
    // its id, which no other upload is given, so they never enter the view
    // every window is told.
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
        const picture = yield* kept.answer(
          new PlanPictureKey({ planId: read.planId, attachmentId: read.attachmentId }),
          dependencies.accountId,
          served(client.readPicture(read.planId, read.attachmentId)),
          (answer) => ("base64" in answer ? answer : undefined),
        );
        return carried<TasksPictureAnswer>(picture);
      }),
    // A plan's comments, or a page's, are held for a window while it shows
    // them, the open task's plan's, or a page tab's beside the task or an
    // Inbox item, and told only on the app state (`PLAN_COMMENTS_CHANGED`).
    // Note that the windows' hold is one fiber standing until let go, so a
    // window holding it again holds nothing anew.
    [GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksCommentsFollowSchema,
          params,
          "following comments names the task and the page where it follows one's",
        );
        const subject = commentSubjectOf(read);
        yield* FiberMap.run(
          commentHolds,
          subject,
          Effect.scoped(Effect.andThen(comments.hold(subject), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_COMMENTS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksCommentsFollowSchema,
          params,
          "letting comments go names the task and the page where it held one's",
        );
        yield* FiberMap.remove(commentHolds, commentSubjectOf(read));
        return {};
      }),
    [GATEWAY_METHOD.TASKS_COMMENTS_RETRY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksCommentsFollowSchema,
          params,
          "reading comments again names the task and the page where it reads one's",
        );
        yield* comments.retry(commentSubjectOf(read));
        return {};
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
        comments.answered(read.planId, answer);
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
        comments.answered(read.planId, answer);
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
    // The service answers the task as restored, so the list's row and its
    // held plan take it in place and nothing is read again. It is confirmed
    // once its transaction reached the history the window follows.
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
        yield* serial(Effect.sync(closeActive));
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
        // A quiet start, a group's quick add or New task set to stay, opens nothing: its row is
        // drawn from the service's answer at once and stands until the list carries the task,
        // and it answers with its agent's start where it asked for one.
        if (quiet === true) {
          const started = yield* serial(served(client.create(request)));
          if (!started.ok) {
            const { failure, localAgentRefusal } = started;
            return carried<TasksStartAnswer>(
              localAgentRefusal === undefined ? { failure } : { failure, localAgentRefusal },
            );
          }
          const { task, agent, txid } = started.answer;
          const row = planRowOf(task);
          yield* row === undefined ? listed(txid) : taskList.collections.made(row, txid);
          return carried<TasksStartAnswer>({
            planId: task.id,
            ...(agent === undefined ? undefined : { agentStart: agent }),
          });
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
            // Note that the plan is laid before the task opens, so the window's first frame of it draws its plan.
            yield* documents.started(task);
            write({ activeTaskId: task.id });
            return answer;
          }),
        );
      }),
    [GATEWAY_METHOD.TASKS_DELETE]: declaredMethod(
      dependencies.pool,
      deleted,
      (params: WireRecord) =>
        readParams(tasksOpenParamsSchema, params, "deleting a task names one task"),
    ),
    [GATEWAY_METHOD.TASKS_RENAME]: declaredMethod(
      dependencies.pool,
      renamed,
      (params: WireRecord) =>
        readParams(tasksRenameParamsSchema, params, "renaming a task names it and its name"),
    ),
    [GATEWAY_METHOD.TASKS_SET_STANDING]: declaredMethod(
      dependencies.pool,
      stood,
      (params: WireRecord) =>
        readParams(
          tasksSetStandingParamsSchema,
          params,
          "setting where a task stands names it and its status, priority, or assignee",
        ),
    ),
    [GATEWAY_METHOD.TASKS_PIN]: declaredMethod(dependencies.pool, pinned, (params: WireRecord) =>
      readParams(tasksPinParamsSchema, params, "pinning a task names it and whether it is pinned"),
    ),
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
    [GATEWAY_METHOD.TASKS_SET_REPOSITORY]: declaredMethod(
      dependencies.pool,
      repositorySet,
      (params: WireRecord) =>
        readParams(
          tasksSetRepositoryParamsSchema,
          params,
          "giving a task its repository names the task and the repository",
        ),
    ),
    // A move reads, as it is asked, whether the reader is a member of the
    // workspace it moves to, where the list goes on holding the task; while
    // the workspaces are not read yet it takes the reader for one.
    [GATEWAY_METHOD.TASKS_MOVE]: declaredMethod(dependencies.pool, moved, (params: WireRecord) =>
      Effect.map(
        readParams(tasksMoveParamsSchema, params, "moving a task names the task and the workspace"),
        (read) => ({
          ...read,
          member:
            view.workspacesStatus !== TASKS_READ.READY ||
            view.workspaces.some((workspace) => workspace.id === read.workspaceId),
        }),
      ),
    ),
    // A block or a relation reads, as it is asked, what the list knows of
    // the tasks it joins, which its draw reads.
    [GATEWAY_METHOD.TASKS_BLOCK]: declaredMethod(
      dependencies.pool,
      blockChanged,
      (params: WireRecord) =>
        Effect.map(
          readParams(
            tasksBlockParamsSchema,
            params,
            "a block change names the task, the other task, and the side it stands on",
          ),
          (read) => ({ ...read, reach: relationReachOf(read.taskId, read.block.taskId) }),
        ),
    ),
    [GATEWAY_METHOD.TASKS_SET_PARENT]: declaredMethod(
      dependencies.pool,
      parentSet,
      (params: WireRecord) =>
        readParams(
          tasksSetParentParamsSchema,
          params,
          "a parent change names the task and its parent, or null for none",
        ),
    ),
    [GATEWAY_METHOD.TASKS_CHANGE_RELATION]: declaredMethod(
      dependencies.pool,
      relationChanged,
      (params: WireRecord) =>
        Effect.map(
          readParams(
            tasksChangeRelationParamsSchema,
            params,
            "a relation change names the task, the other task, and the kinds it moves between",
          ),
          (read) => ({ ...read, reach: relationReachOf(read.taskId, read.relation.taskId) }),
        ),
    ),
    // The task the service answered is drawn in place, so the edit stands on
    // its plan at once and the notetaker's drafts drawn before it drop. It
    // stands until the task's record and the list carry its transaction,
    // which is waited for behind the answer.
    [GATEWAY_METHOD.TASKS_EDIT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksEditParamsSchema,
          params,
          "an edit names a task, and its document's base and value",
        );
        if (!gate()) return carried<TasksEditAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        const { taskId, edit } = read;
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
              txid: answer.txid,
            };
          }),
        );
        // Note that the waits stand outside the serial reads and behind the answer, so neither a read nor the editor waits on them.
        if (edited.held !== undefined) {
          const { held, txid } = edited;
          yield* FiberMap.run(
            editWaits,
            taskId,
            Effect.all(
              [documents.confirmed(taskId, txid), heldOverList(held.taskId, held.fields, txid)],
              { concurrency: "unbounded" },
            ),
          );
        }
        return edited.answer;
      }),
    // The browser connects or disconnects GitHub, so the panel coming
    // forward again reads the connection whatever the bound says, and GitHub's
    // standing as an integration is asked again once either answers.
    [GATEWAY_METHOD.GITHUB_CONNECT]: () =>
      Effect.gen(function* () {
        if (!gate()) return carried<TasksGitHubPageAnswer>(GITHUB_PAGE_UNANSWERED);
        const page = yield* served(client.github.connect());
        githubAskedAt = undefined;
        yield* dependencies.githubMoved;
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
        yield* dependencies.githubMoved;
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
    // A slug moves no task either: links resolve by id, or by a former
    // slug the workspace keeps, so the answered workspace lands as a
    // rename's does.
    [GATEWAY_METHOD.WORKSPACES_SLUG_SET]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceSlugSetParamsSchema,
          params,
          "changing a workspace's slug names it and its new slug",
        );
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, slug } = read;
        return carried<TasksWorkspaceAnswer>(
          yield* workspaceWrite(client.workspaces.setSlug(workspaceId, slug)),
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
    // A workspace's Slack bot is answered to the window that asked and held
    // nowhere, as its Sentry is: the row reads it as it opens and as the
    // window comes forward, and a connect or disconnect answers it anew.
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "reading the Slack bot names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceSlackBotAnswer>(WORKSPACE_UNANSWERED);
        const slackBot = yield* served(client.workspaces.slackBot(read.workspaceId));
        return carried<TasksWorkspaceSlackBotAnswer>(
          slackBot.ok ? { slackBot: slackBot.answer } : { failure: slackBot.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "connecting the Slack bot names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceSlackBotAnswer>(WORKSPACE_UNANSWERED);
        const slackBot = yield* served(client.workspaces.slackBotConnect(read.workspaceId));
        return carried<TasksWorkspaceSlackBotAnswer>(
          slackBot.ok ? { slackBot: slackBot.answer } : { failure: slackBot.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_DISCONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "disconnecting the Slack bot names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceSlackBotAnswer>(WORKSPACE_UNANSWERED);
        const slackBot = yield* served(client.workspaces.slackBotDisconnect(read.workspaceId));
        return carried<TasksWorkspaceSlackBotAnswer>(
          slackBot.ok ? { slackBot: slackBot.answer } : { failure: slackBot.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_NOTIFICATIONS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceSlackBotNotificationsParamsSchema,
          params,
          "changing Slack notifications names a workspace and the switch",
        );
        if (!gate()) return carried<TasksWorkspaceSlackBotAnswer>(WORKSPACE_UNANSWERED);
        const slackBot = yield* served(
          client.workspaces.slackBotNotifications(read.workspaceId, read.notifications),
        );
        return carried<TasksWorkspaceSlackBotAnswer>(
          slackBot.ok ? { slackBot: slackBot.answer } : { failure: slackBot.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_REPOSITORY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceSlackBotRepositoryParamsSchema,
          params,
          "naming the Slack bot's default repository names a workspace and a repository or none",
        );
        if (!gate()) return carried<TasksWorkspaceSlackBotAnswer>(WORKSPACE_UNANSWERED);
        const slackBot = yield* served(client.workspaces.slackBotRepository(read));
        return carried<TasksWorkspaceSlackBotAnswer>(
          slackBot.ok ? { slackBot: slackBot.answer } : { failure: slackBot.failure },
        );
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_CHANNEL]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceSlackBotChannelParamsSchema,
          params,
          "changing a Slack channel names a workspace, the channel, and what changes",
        );
        if (!gate()) return carried<TasksWorkspaceSlackBotAnswer>(WORKSPACE_UNANSWERED);
        const slackBot = yield* served(client.workspaces.slackBotChannel(read));
        return carried<TasksWorkspaceSlackBotAnswer>(
          slackBot.ok ? { slackBot: slackBot.answer } : { failure: slackBot.failure },
        );
      }),
    // A workspace's people are held for a window while it draws them, and
    // told only on the app state (`WORKSPACE_MEMBERS_CHANGED`). Note that the
    // windows' hold is one fiber standing until let go, so a window holding
    // it again holds nothing anew.
    [GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "holding a workspace's people names the workspace",
        );
        const { workspaceId } = read;
        yield* FiberMap.run(
          memberHolds,
          workspaceId,
          Effect.scoped(Effect.andThen(membersReads.held.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_MEMBERS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "letting a workspace's people go names the workspace",
        );
        yield* FiberMap.remove(memberHolds, read.workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_MEMBERS_RETRY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "reading a workspace's people again names the workspace",
        );
        yield* membersReads.held.retry(read.workspaceId);
        return {};
      }),
    // An owner's or an admin's window follows a workspace's invitations
    // while it draws them; following again starts over, so a window that
    // follows later hears where they stand, and letting them go ends it.
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
    // A photo is answered to the window that asked and held nowhere: the
    // window keeps it under the version the list named, and the list itself
    // never carries its bytes.
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
    // answered to the page that asked and held nowhere, as a photo is: they
    // move no task and no workspace the view holds.
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
        if (!remaining.ok)
          return carried<TasksWorkspaceMembersAnswer>({ failure: remaining.failure });
        yield* membersReads.moved(workspaceId, [{ userId, gone: true }]);
        return carried<TasksWorkspaceMembersAnswer>({ members: remaining.answer });
      }),
    // A role changed moves no task; the people's read carries it, as a
    // removal's, drawn from its answer until then.
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
        if (!changed.ok) return carried<TasksWorkspaceMembersAnswer>({ failure: changed.failure });
        yield* membersReads.moved(workspaceId, membersMoved(changed.answer, [userId]));
        return carried<TasksWorkspaceMembersAnswer>({ members: changed.answer });
      }),
    // Note that a handover changes the account's own role in the workspace,
    // which the view's workspaces carry and every owner's and admin's act is
    // drawn from, and which the follow carries; it moves no task. The heir's
    // role and the account's own are drawn from its answer until the
    // people's read carries them.
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
        if (!handedOver.ok) {
          return carried<TasksWorkspaceMembersAnswer>({ failure: handedOver.failure });
        }
        yield* membersReads.moved(
          workspaceId,
          membersMoved(handedOver.answer, [userId, dependencies.accountId()]),
        );
        return carried<TasksWorkspaceMembersAnswer>({ members: handedOver.answer });
      }),
    // Note that a leave closes the open task where it is that workspace's, as
    // a delete of it does, because the account can no longer read or write a
    // task of a workspace it left; a refused leave closes nothing. The
    // account is drawn gone from the workspace's people, which its read,
    // ended as the account no longer reaches it, never takes back.
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
            Effect.sync(() => {
              if (view.activeTaskId === openTaskId) closeActive();
            }),
          );
        });
        const leave = Effect.tap(client.workspaces.leave(workspaceId), (answer) =>
          answer.ok && openWorkspaceId === workspaceId ? closeOpenTask : Effect.void,
        );
        const left = yield* workspaceCall(leave);
        if (!left.ok) return carried<TasksWorkspaceLeaveAnswer>({ failure: left.failure });
        const readerId = dependencies.accountId();
        if (readerId !== undefined) {
          yield* membersReads.moved(workspaceId, [{ userId: readerId, gone: true }]);
        }
        return carried<TasksWorkspaceLeaveAnswer>({ left: true });
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
    // The gate opening follows the account's task list, workspaces, and
    // sidebar, so the list loads after a launch or a sign-in with no window
    // asking; GitHub's connection is read beside them where the last read is stale.
    open: Effect.gen(function* () {
      yield* heldPageReads.open;
      yield* heldBrowserTabs.open;
      yield* comments.open;
      yield* membersReads.held.open;
      yield* documents.open;
      if (!gate()) return;
      yield* followAccount;
      yield* FiberHandle.run(githubOpened, readGithubWhenStale, { onlyIfMissing: true });
    }),
    listed,
    reset: Effect.gen(function* () {
      yield* Cache.invalidateAll(pullRequestReads);
      yield* Cache.invalidateAll(issueReads);
      yield* FiberMap.clear(skillsReads);
      MutableHashMap.clear(heldSkills);
      // Note that the windows' holds on pages, tabs, comments, people, and plans stand through a sign-out, so a session signing in follows them anew (`open`).
      yield* heldPageReads.end;
      yield* heldBrowserTabs.end;
      yield* comments.end;
      yield* membersReads.held.end;
      yield* FiberMap.clear(editWaits);
      yield* documents.end;
      yield* FiberMap.clear(historyFollows);
      yield* FiberHandle.clear(listFollow);
      yield* Scope.close(taskList.scope, Exit.void);
      taskList = yield* openTaskList;
      yield* FiberHandle.clear(workspacesFollow);
      yield* FiberHandle.clear(sidebarFollow);
      yield* FiberHandle.clear(githubOpened);
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
    // Every read of the tasks is an ask's, or a held read's, which stands in the composer's own scope.
    lifetime: Effect.void,
  };
});
