import type { HostedTaskClient, TaskCallResult, TaskWritten } from "@repo/features";
import {
  type AgentBrowserTab,
  BROWSER_TABS_PLACE,
  type BrowserTabsPlace,
  type BrowserTabsPlaceKind,
  browserTabsPlaceId,
  browserTabsPlaceKind,
} from "@repo/features/agent-browser-tab-wire";
import {
  AGENT_BROWSER_TABS_READ,
  browserTabsOfLiveRows,
  nextBrowserTabLapse,
  TASK_BROWSER_TABS_READ,
} from "@repo/features/browser-tabs-live";
import { TASK_COMMENTS_READ } from "@repo/features/description-comment-live";
import { WRITE_UNTAKEN } from "@repo/features/keyed-write";
import { issueAddressOf, pullRequestAddressOf } from "@repo/features/link-grammar";
import type { AnyLiveRead, LiveReadAnswer, LiveReadAsked } from "@repo/features/live-read";
import { type LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  PAGE_OWNER,
  type PageLine,
  type PageOwner,
  type PagePlace,
  pagePlaceId,
} from "@repo/features/page-wire";
import { markedAs, readMarkOf } from "@repo/features/read-mark";
import { SIDEBAR_READ } from "@repo/features/sidebar-live";
import { revisionsOfLiveRows, TASK_HISTORY_READ } from "@repo/features/task-history-live";
import { taskListLiveRowsSchema } from "@repo/features/task-list-live";
import { AGENT_PAGES_READ, pagesOfLiveRows, TASK_PAGES_READ } from "@repo/features/task-pages-live";
import { TASK_RECORD_READ } from "@repo/features/task-record-live";
import {
  type DescriptionRevisionsAnswer,
  startRelationsOf,
  TASK_BLOCK_CHANGE,
  TASK_CREATE_RELATION_KIND,
  TASK_PRIORITY,
  TASK_RELATION_KIND,
  TASK_STATUS,
  type Task,
  type TaskCreateRelationKind,
  type TaskRelationKind,
  type TaskSkillsAnswer,
  taskCreateRequestSchema,
  UNTITLED_TASK_NAME,
} from "@repo/features/task-wire";
import {
  type CodeLines,
  HOST_LIVE,
  IDLE_TASKS_VIEW,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksBlockAnswer,
  type TasksBlockParams,
  type TasksChangeRelationAnswer,
  type TasksChangeRelationParams,
  type TasksCommentAnswer,
  type TasksMarkReadParams,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPageAnswer,
  type TasksPageParams,
  type TasksPageSourceAnswer,
  type TasksPinParams,
  type TasksRenameParams,
  type TasksSetParentAnswer,
  type TasksSetParentParams,
  type TasksSetRepositoryAnswer,
  type TasksSetRepositoryParams,
  type TasksSetStandingParams,
  type TasksStartAnswer,
  type TasksStartRequest,
  type TasksView,
  tasksMarkReadParamsSchema,
  tasksPageParamsSchema,
  tasksPinParamsSchema,
  tasksRenameParamsSchema,
  tasksSetStandingParamsSchema,
} from "@repo/features/tasks-view";
import { carried, GATEWAY_EVENT, GATEWAY_METHOD, readParams } from "@repo/gateway";
import {
  type AnyWrite,
  anyWrite,
  declaredWrite,
  type EntityPool,
  type FieldChange,
  ROW_GONE,
  type WriteDeclaration,
} from "@repo/sync";
import { keepIdentity } from "@repo/wire";
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
  PubSub,
  Queue,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import {
  type AppLinkStanding,
  EVERY_WORKSPACE,
  NO_BROWSER_TABS,
  NO_KEYS_HELD,
  NO_PAGES,
} from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type {
  OpenTaskLeaving,
  TasksForWorkspaces,
  WorkspacesTasksAct,
} from "./compose-workspaces.js";
import type { Composer } from "./composer.js";
import { type TASKS_ACTS, TASKS_FOLLOWS } from "./contract/index.js";
import { commentSubjectOf, descriptionCommentReads } from "./description-comment-reads.js";
import { descriptionCommentWrites } from "./description-comment-writes.js";
import { descriptionDocumentReads } from "./description-document-reads.js";
import { lateService } from "./effect/kernel.js";
import { type EntityStore, KEPT_READ } from "./entity-store.js";
import { fixturePage } from "./fixture-stage.js";
import type { HostMethodTable } from "./gateway-door.js";
import { heldFetch } from "./held-fetch.js";
import { type HostActTable, liveTold } from "./host-acts.js";
import type { HostKernel } from "./host-kernel.js";
import {
  DescriptionPictureKey,
  FileAtCommitKey,
  type KeptContent,
  keptOfTask,
  PageVersionKey,
} from "./kept-content.js";
import { type HeldAnswers, heldSlice, rowWriteOn } from "./live-collection.js";
import { confirmWrite, FOLLOW_BACKOFF, type TxWait } from "./live-follow.js";
import { pushLive } from "./live-push.js";
import type { PullRequestListing } from "./pull-request-parts.js";
import { type OfflineRefused, TASK_QUEUED_WRITE, untaken } from "./queued-writes.js";
import type { RunMode } from "./run-mode.js";
import { sidebarCollections, sidebarWrites } from "./sidebar-collections.js";
import { PLAN, type PlanRow, taskListCollections } from "./task-list-collections.js";
import { followTaskList } from "./task-list-follow.js";
import type { WindowFocus } from "./window-focus.js";
import { followSidebarRows } from "./workspaces-follow.js";

/**
 * compose-tasks.ts -- the panel's named tasks, read from the service: the list, the one active task, and the descriptions the windows opened.
 *
 * Nothing here writes a description but a restore or an edit the developer asks
 * for: the task's coding agents are its writers, on the service. Each description
 * a window opened is held for it per task (`description-document-reads.ts`), read
 * as it is first held and again as its record's description mark moves, and never
 * on a clock. The list itself is followed over Neon Realtime from the
 * account gate opening until a sign-out (`task-list-follow.ts`), and is read
 * by none of those asks. The repositories the account reaches, and a task's repository
 * given or taken away, are the service's too, asked through here, as is a
 * task pinned. Each
 * task's description history a version history shows is held for it per task and
 * told on the app state (`LIVE_READ.HISTORY`): its newest page followed, and
 * the older pages read past it laid after it. A revision's text is answered
 * to the version history that asks and held nowhere here; a revision
 * restored is the one write this concern carries to the service on the
 * developer's word, and the view takes the task it answers.
 * The pages agents wrote for a task, or for an agent on no task, are held
 * for the windows that draw them, the open task's among them, by title and
 * newest version alone, and told on the app state (`LIVE_READ.PAGES`); a
 * page's HTML is answered to the frame that draws it and kept in this
 * process's memory by its version (`kept-content.ts`), never in the view, as
 * a description's pictures and a file read at a commit are.
 *
 * The workspaces the account is a member of, and whether its GitHub is
 * connected, are carried on the view beside the tasks, drawn there by the
 * workspaces' own concern (`compose-workspaces.ts`).
 */

/** A task's pin and where it stands as the list carries them, each only where it stands. */
type TaskMarkStamps = Pick<Task, "pinnedAt" | "pinPosition">;

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

/** One link's standing as the windows hold it, by the workspace it is read through and the link's own address. */
class LinkStandingKey extends Data.Class<{
  readonly workspaceId: string;
  readonly address: string;
}> {}

/** How long a link's read is kept: `LINK_READ_KEPT.ANSWERED` where the service answered, `UNANSWERED` where it did not. */
function linkReadKept(exit: Exit.Exit<unknown>): Duration.Duration {
  return Exit.isSuccess(exit) && exit.value !== undefined
    ? LINK_READ_KEPT.ANSWERED
    : LINK_READ_KEPT.UNANSWERED;
}

/** A Browser tab opened behind a closed gate, or on a service that did not answer. */
const BROWSER_TABS_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** What a write to a task's comments answers behind a closed gate: unanswered, which takes back what it drew. */
const COMMENT_UNANSWERED: TasksCommentAnswer = { failure: TASK_CALL_FAILURE.UNANSWERED };

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

/** The description a task starts on, empty, as the service makes it. */
const EMPTY_DESCRIPTION = { body: "", assumptions: [] } as const satisfies Task["document"];

/** A start's request as the service is sent it, under the id the host minted for its task where the window named none. */
type StartRequest = Omit<TasksStartRequest, "quiet"> & { readonly id: string };

/** A start as the host carries it: its request, whether it opens its task, and the row it draws, none where it draws none. */
interface Start {
  readonly request: StartRequest;
  readonly quiet: boolean;
  readonly row: PlanRow | undefined;
}

/** Where a start opened its task: the ask of the screen it was, whether it drew the task open before the service answered, and the task the reader stood on before it. */
interface StartOpened {
  readonly asked: number;
  readonly drawn: boolean;
  readonly before: string | undefined;
}

/** Whether a start may wait for the service: one that draws its row. */
function startMayWait(start: Start): boolean {
  return start.row !== undefined;
}

/** A start as it waits for the service, which only one that may wait keeps as, since a write that does not keep never waits (`WriteDeclaration.queue`). */
const startKeptSchema = Schema.Struct({
  request: Schema.Struct({ ...taskCreateRequestSchema.fields, id: Schema.String }),
  quiet: Schema.Boolean,
  row: Schema.UndefinedOr(taskListLiveRowsSchema.fields.plans.value),
}).check(Schema.makeFilter(startMayWait));

/** Where a start sent from the waiting writes opened its task: as it was asked, before any ask of the screen standing now, its description laid as held. */
const OPENED_EARLIER: StartOpened = { asked: -1, drawn: true, before: undefined };

/** A live read the service did not seal, `gone` where what it names is no longer the account's or the session another's. */
interface LiveUnsealed {
  readonly failure: string;
  readonly gone: boolean;
}

/** Whether a live read's seal is why it failed rather than its answer, which names no failure. */
function unsealed(sealed: unknown): sealed is { readonly failure: string } {
  return typeof sealed === "object" && sealed !== null && "failure" in sealed;
}

/** The service's side of the tasks as this concern asks it. */
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
  | "liveRead"
  | "writeTaskSection"
  | "liveRead"
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
  | "startComment"
  | "actOnComment"
  | "restore"
  | "repositories"
  | "setRepository"
  | "setStanding"
  | "move"
  | "edit"
>;

export interface TasksDependencies {
  kernel: Pick<HostKernel, "emit" | "now" | "createId"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: TasksClient;
  /** The account signed in now, by its id, which every live read names; none where nobody is. */
  accountId: () => string | undefined;
  /** The content this host keeps under keys it never changes under, which a picture's, a page version's, and a file's read at a commit answer from (`kept-content.ts`). */
  kept: KeptContent;
  /** The windows coming forward, raised here as the panel's focus reaches the host and heard by every read asked again on it. */
  focus: WindowFocus;
  /** The sync engine's pool, which the task list's plans and agents, and the comments' threads, stand in. */
  pool: EntityPool;
  /** The signed-in account's lists kept on disk, which the gate opening draws before the service answers and each answer keeps; none where nothing keeps them. */
  entities: () => EntityStore | undefined;
  /** The count of changes made offline the service refused as they were sent again, which a window clears once it has said so. */
  offlineRefused: Pick<OfflineRefused, "clear">;
  /** The member signed in, by id and name, whose comment a write draws before the service answers; none where nobody is. */
  member: () => { readonly userId: string; readonly name: string } | undefined;
}

/** What the tasks reach of a concern built after them, linked once it is (`compose-host.ts`). */
export interface TasksLinks {
  /** The workspaces followed where nothing follows them, and GitHub's connection read where stale, as the list's Try again asks (`WorkspacesComposer.refreshed`). */
  workspacesRefreshed: Effect.Effect<void>;
}

/** The Tasks tab's acts this composer answers: its plain asks but those `compose-workspaces.ts` answers, and its live follows. */
type TasksActs = Omit<HostActTable<typeof TASKS_ACTS>, WorkspacesTasksAct> &
  HostActTable<typeof TASKS_FOLLOWS>;

export interface TasksComposer extends Composer {
  /** The Tasks tab's plain asks and live follows, answered directly as the panel's port asks them, but GitHub's connection's and the admin dashboard's (`compose-workspaces.ts`). */
  readonly acts: TasksActs;
  /** The view as this Mac holds it now. */
  snapshot: () => TasksView;
  /** Links what the tasks reach of a concern built after them; the first link stands. */
  link: (links: TasksLinks) => Effect.Effect<void>;
  /** The view's workspaces and GitHub's connection, which the workspaces' concern draws, and what a workspace's move asks of the tasks. */
  workspaces: TasksForWorkspaces;
  /** Drops everything held, for a sign-out, and tells every client the panel has nothing. */
  reset: Effect.Effect<void>;
  /**
   * Follows the account's task list and sidebar, and every read a window
   * holds anew, as the account gate opening asks, so the list loads
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
  /** The row writes this composer declares that may wait for the service, which a queue kept on disk is laid back by. */
  queueable: readonly AnyWrite[];
  /** The task list as each drawing of it stands, each agent's status and every pull request it names, from the caller's listening until its scope closes, which the Pull request tabs' parts are asked again on (`pull-request-parts.ts`), and a terminal waiting on its agent's sandbox reads the list again on (`compose-host.ts`). */
  pullRequestListings: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  /** Every workspace's repositories the windows hold asked again, as the member's own token saved or removed moves them, answering once each has landed. */
  repositoriesMoved: Effect.Effect<void>;
}

/**
 * A page's HTML as its tab's source reads it: line by line, plain, since the
 * panel draws it as every code is, through Pierre's diffs, which colors it
 * (`@repo/panel`'s `whole-file.tsx`).
 */
function pageSourceLines(html: string): CodeLines {
  return html.split("\n").map((text) => (text === "" ? [] : [{ text }]));
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
 * A task's newest page of history laid over the history held: the page
 * whole, then every older revision held past it, so a version history
 * scrolled back keeps what it read as saves land, and the place the next
 * older page is read from with them.
 */
function withNewestPage(
  held: DescriptionRevisionsAnswer | undefined,
  page: DescriptionRevisionsAnswer,
): DescriptionRevisionsAnswer {
  const oldest = page.revisions.at(-1)?.seq;
  if (held === undefined || oldest === undefined || page.earlier === undefined) return page;
  const older = held.revisions.filter((line) => line.seq < oldest);
  if (older.length === 0) return page;
  const revisions = [...page.revisions, ...older];
  return held.earlier === undefined ? { revisions } : { revisions, earlier: held.earlier };
}

/**
 * An older page of a task's history, read before the revision `before`
 * names, laid past the history held: every revision held at or after
 * `before`, then the page, and the place the next older page is read from as
 * the page says.
 */
function withOlderPage(
  held: DescriptionRevisionsAnswer,
  before: number,
  page: DescriptionRevisionsAnswer,
): DescriptionRevisionsAnswer {
  const revisions = [...held.revisions.filter((line) => line.seq >= before), ...page.revisions];
  return page.earlier === undefined ? { revisions } : { revisions, earlier: page.earlier };
}

/**
 * How long after a resync another is let pass, so a wake that lands as
 * several events at once (resume, then unlock) seals the list again once.
 */
const RESYNC_SETTLE = Duration.seconds(10);

/**
 * The panel's tasks as one concern. The view is told to every client whole
 * whenever it moves, and exactly one task is active at a time: opening or
 * starting one replaces whichever was, and the descriptions the windows opened are
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
  /** A declared live read sealed, or polled where `poll` asks past `after`, as a follow reads it: its answer, or why not and whether the read is gone for good, a task or an agent the account no longer reaches or a session another's. */
  const sealedLive = <Read extends AnyLiveRead>(
    read: Read,
    params: LiveReadAsked<Read>,
    poll: boolean,
    after: string | undefined,
  ): Effect.Effect<LiveReadAnswer<Read> | LiveUnsealed> =>
    Effect.map(
      served(client.liveRead(read, params, poll ? { after } : undefined)),
      (sealed): LiveReadAnswer<Read> | LiveUnsealed =>
        unsealed(sealed)
          ? {
              failure: sealed.failure,
              gone:
                sealed.failure === TASK_CALL_FAILURE.NOT_FOUND ||
                sealed.failure === LIVE_SIGNED_OUT.failure,
            }
          : sealed,
    );
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

  /** What GitHub holds of the page a link names, from the reads kept for every link; none where its address names no page or the service did not answer. */
  const linkStandingOf = (link: LinkStandingKey) => {
    const { workspaceId, address } = link;
    const pullRequest = pullRequestAddressOf(address);
    if (pullRequest !== undefined) {
      const read = Cache.get(pullRequestReads, linkReadKey({ workspaceId, ...pullRequest }));
      return Effect.map(
        read,
        (answer): Option.Option<AppLinkStanding> => Option.fromUndefinedOr(answer),
      );
    }
    const issue = issueAddressOf(address);
    if (issue === undefined) return Effect.succeed(Option.none<AppLinkStanding>());
    const read = Cache.get(issueReads, linkReadKey({ workspaceId, ...issue }));
    return Effect.map(
      read,
      (answer): Option.Option<AppLinkStanding> => Option.fromUndefinedOr(answer),
    );
  };
  /**
   * What GitHub holds of each page a link names, fetched for the chips that
   * hold it (`held-fetch.ts`), by the workspace whose installation reaches it
   * and then the link's own address: asked as a chip first holds it and again
   * as a window comes forward, each ask answered from the reads kept for
   * every link (`LINK_READ_KEPT`), so a focus inside their minute asks
   * GitHub nothing.
   */
  const linkStandings = yield* heldFetch<typeof LIVE_READ.LINK_STANDINGS, LinkStandingKey>({
    empty: NO_KEYS_HELD,
    path: (link) => [link.workspaceId, link.address],
    gate,
    focus: dependencies.focus,
    fetch: linkStandingOf,
    tell: liveTold(kernel.emit, TASKS_FOLLOWS.TASKS_LINK_STANDING_FOLLOW),
  });
  /**
   * The repositories the account reaches in each workspace, or in every one,
   * fetched for the windows that hold them (`held-fetch.ts`): asked as a
   * window first holds a workspace's, again as a window comes forward, which
   * is how a developer returns from installing the App in the browser, as the
   * workspace's GitHub installations move or a token repository is set in it,
   * as the member's own token changes (`repositoriesMoved`), and on Try again.
   */
  const repositoryLists = yield* heldFetch<typeof LIVE_READ.REPOSITORY_LISTS, string>({
    empty: NO_KEYS_HELD,
    path: (workspace) => [workspace],
    gate,
    focus: dependencies.focus,
    fetch: (workspace) =>
      Effect.map(
        served(client.repositories(workspace === EVERY_WORKSPACE ? undefined : workspace)),
        (listed) => (listed.ok ? Option.some(listed.answer) : Option.none()),
      ),
    tell: liveTold(kernel.emit, TASKS_FOLLOWS.TASKS_REPOSITORIES_FOLLOW),
  });
  /** The lists of the workspaces named asked again, and the list of every workspace's, which a change in any of them moves too. */
  const repositoriesMovedIn = (workspaceIds: ReadonlySet<string>) =>
    repositoryLists.wake(
      (workspace) => workspace === EVERY_WORKSPACE || workspaceIds.has(workspace),
    );

  /**
   * One read of the service at a time, whichever ask made it. Note that the
   * answers are applied in the order the reads were made, because a list
   * that left before a task started would otherwise land last and roll the
   * view back. A held description is read outside it, ordered by its task's own
   * numbers instead (`description-document-reads.ts`).
   */
  const serial = (yield* Semaphore.make(1)).withPermits(1);
  const late = yield* lateService<TasksLinks>();

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

  /** Leaves the open task, returning the window to its list; its description stays held while the window lets it go. */
  function closeActive(): void {
    const { activeTaskId: _closed, ...rest } = view;
    view = rest;
    publish();
  }

  /** The task open as a workspace's leave is asked, and its close, which leaves it only while it is still the one open. */
  function openTaskLeaving(): OpenTaskLeaving {
    const openTaskId = view.activeTaskId;
    return {
      workspaceId: view.tasks.find((task) => task.id === openTaskId)?.workspaceId,
      close: serial(
        Effect.sync(() => {
          if (view.activeTaskId === openTaskId) closeActive();
        }),
      ),
    };
  }

  const decodeHistory = Schema.decodeUnknownOption(TASK_HISTORY_READ.rows);
  /** How to wait for a write's transaction on each task's held history, while its follow stands. */
  const historyTxWaits = new Map<string, TxWait>();

  /**
   * Follows `taskId`'s newest page of history live until let go, each page
   * laid over the older ones held (`withNewestPage`) and told through
   * `answers`, and its wait for a write's transaction kept while it stands.
   */
  function followHistory(taskId: string, answers: HeldAnswers<DescriptionRevisionsAnswer>) {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    /** The wait this follow handed last, so letting it go takes back its own alone. */
    let handed: TxWait | undefined;
    return pushLive({
      seal: (poll, after) =>
        gate() && userId !== undefined
          ? sealedLive(TASK_HISTORY_READ, { id: taskId, userId }, poll, after)
          : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
      decode: (rows) => Option.map(decodeHistory(rows), revisionsOfLiveRows),
      publish: (page) =>
        Effect.sync(() =>
          page === undefined
            ? answers.unanswered()
            : answers.answered(withNewestPage(answers.rows(), page)),
        ),
      // Note that a follow let go takes back only the wait it handed, since a retry's follow may have handed its own first.
      onTxWait: (wait) => {
        if (wait !== undefined) {
          handed = wait;
          historyTxWaits.set(taskId, wait);
        } else if (historyTxWaits.get(taskId) === handed) historyTxWaits.delete(taskId);
      },
    });
  }

  /**
   * Each task's description history a window's version history shows, and the few
   * shown latest, told whole on the app state every window draws
   * (`LIVE_READ.HISTORY`): its newest page followed from the first window's
   * hold (`heldSlice`), and the older pages read past it laid after it, so a
   * version history opened again draws its versions in its first frame.
   */
  const heldHistories = yield* heldSlice<typeof LIVE_READ.HISTORY, string>({
    empty: NO_KEYS_HELD,
    path: (taskId) => [taskId],
    gate,
    follow: followHistory,
    tell: liveTold(kernel.emit, TASKS_FOLLOWS.TASKS_HISTORY_FOLLOW),
  });

  const decodeBrowserTabs = Schema.decodeUnknownOption(TASK_BROWSER_TABS_READ.rows);

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
    type Rows = typeof TASK_BROWSER_TABS_READ.rows.Type;
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
              ? sealedLive(
                  "taskId" in place ? TASK_BROWSER_TABS_READ : AGENT_BROWSER_TABS_READ,
                  { id: browserTabsPlaceId(place), userId },
                  poll,
                  after,
                )
              : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
          decode: decodeBrowserTabs,
          // Note that a read that stops answering keeps its rows, and their lapses, until the next delivery.
          publish: (rows) =>
            Effect.sync(() => {
              if (rows === undefined) answers.unanswered();
              else Queue.offerUnsafe(delivered, rows);
            }),
        });
      }),
    );
  }

  const decodePages = Schema.decodeUnknownOption(TASK_PAGES_READ.rows);

  /** Follows the pages of `owner`, a task or an agent on no task, live until let go, each change told through `answers`. */
  function followPages(owner: PageOwnerKey, answers: HeldAnswers<readonly PageLine[]>) {
    const place = pagePlaceOf(owner);
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out.
    const userId = dependencies.accountId();
    return pushLive({
      seal: (poll, after) =>
        gate() && userId !== undefined
          ? sealedLive(
              "taskId" in place ? TASK_PAGES_READ : AGENT_PAGES_READ,
              { id: pagePlaceId(place), userId },
              poll,
              after,
            )
          : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
      decode: (rows) => Option.map(decodePages(rows), pagesOfLiveRows),
      publish: (pages) =>
        Effect.sync(() => (pages === undefined ? answers.unanswered() : answers.answered(pages))),
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
    tell: liveTold(kernel.emit, TASKS_FOLLOWS.TASKS_PAGES_FOLLOW),
  });

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
    tell: liveTold(kernel.emit, TASKS_FOLLOWS.TASKS_BROWSER_TABS_FOLLOW),
  });

  /**
   * Each description's or page's comments the windows show, and the few let go
   * latest, each thread a row of the pool with every write standing drawn
   * over it, told whole on the app state every window draws
   * (`LIVE_READ.DESCRIPTION_COMMENTS`), on the terms the pages are held.
   */
  const comments = yield* descriptionCommentReads({
    pool: dependencies.pool,
    seal: (subject, userId, poll, after) =>
      sealedLive(
        TASK_COMMENTS_READ,
        {
          id: subject.taskId,
          ...(subject.pageId === undefined ? undefined : { page: subject.pageId }),
          userId,
        },
        poll,
        after,
      ),
    accountId: dependencies.accountId,
    gate,
    tell: liveTold(kernel.emit, TASKS_FOLLOWS.TASKS_COMMENTS_FOLLOW),
  });
  /** The windows' writes to a task's comments, each drawn over its thread at once; behind a closed gate each answers unanswered, taken back as it is drawn. */
  const commentWrites = descriptionCommentWrites({
    start: (planId, start) =>
      gate() ? served(client.startComment(planId, start)) : Effect.succeed(COMMENT_UNANSWERED),
    act: (planId, threadId, action) =>
      gate()
        ? served(client.actOnComment(planId, threadId, action))
        : Effect.succeed(COMMENT_UNANSWERED),
    member: dependencies.member,
    now: kernel.now,
  });

  /**
   * The description of each task a window opened, and of the few opened latest,
   * told whole on the app state every window draws
   * (`LIVE_READ.DESCRIPTION_DOCUMENT`), so a task opened again draws its description in
   * its first frame (`description-document-reads.ts`).
   */
  const documents = yield* descriptionDocumentReads({
    gate,
    accountId: dependencies.accountId,
    open: (taskId) => served(client.open(taskId)),
    recordLive: (taskId, userId, poll, after) =>
      served(
        client.liveRead(TASK_RECORD_READ, { id: taskId, userId }, poll ? { after } : undefined),
      ),
    listed: asListed,
    tell: liveTold(kernel.emit, TASKS_FOLLOWS.TASKS_DOCUMENT_FOLLOW),
  });
  /** Each edit's waits for its transaction, on its task's record and on the list, by the task, a newer edit's replacing an older one's. */
  const editWaits = yield* FiberMap.make<string>();

  /** A task's row or description without the assignee it stood with. */
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
   * holds of each task whose description is held, its name, pin, status, assignee,
   * and repository, reaches its description as the list carries it.
   */
  /** Each drawing of the task list, told to every listener of the Pull request tabs' parts. */
  const listings = yield* Effect.acquireRelease(
    PubSub.unbounded<PullRequestListing>(),
    PubSub.shutdown,
  );

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
          const agents = [...taskAgents, ...(list.planlessAgents ?? [])];
          PubSub.publishUnsafe(listings, {
            statuses: new Map(agents.map((agent) => [agent.id, agent.status])),
            pullRequests: agentPullRequests,
          });
        },
        txWait: () => listWait,
      }),
    );
    return { scope, collections };
  });
  let taskList = yield* openTaskList;
  yield* Effect.addFinalizer(() => Scope.close(taskList.scope, Exit.void));

  /** The sync id the list drawn from disk was kept at, which the next follow reads past once; none once it has. */
  let listKeptAt: string | undefined;

  /**
   * The row writes waiting for the service sent again, one round at a time,
   * as each answer of the list lands: its first after a launch, after a
   * failed read started again, and after a wake or the connection coming
   * back (`TASKS_RESYNC`, `TASKS_REGAINED`), each of which says the service
   * answers again.
   */
  const resending = yield* FiberHandle.make<void>();
  const resendQueued = Effect.suspend(() =>
    dependencies.pool.queued().length === 0
      ? Effect.void
      : Effect.asVoid(
          FiberHandle.run(resending, dependencies.pool.resend, { onlyIfMissing: true }),
        ),
  );

  const followList = Effect.suspend(() => {
    // The account the follow starts for, which every seal names, so one under another's session is refused as signed out and ends.
    const userId = dependencies.accountId();
    const from = listKeptAt;
    listKeptAt = undefined;
    return followTaskList({
      ...(from === undefined ? undefined : { from }),
      live: (sync) =>
        userId === undefined
          ? Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true })
          : Effect.map(served(client.listLive(userId, sync)), (sealed) =>
              sealed.ok
                ? sealed.answer
                : { failure: sealed.failure, gone: sealed.failure === LIVE_SIGNED_OUT.failure },
            ),
      // Note that an answer's read standing rides the list it draws, so a window is told both at once.
      take: (rows, standing) =>
        Effect.gen(function* () {
          view = { ...view, listStatus: TASKS_READ.READY, live: HOST_LIVE.LIVE };
          const entities = dependencies.entities();
          const { collections } = taskList;
          const moved = yield* collections.answer(rows, standing);
          // Note that an answer the list did not draw tells its standing here, as after a poll that failed, and one it drew told it already.
          publish();
          // Note that only an answer read at a sync id is kept, since the follow reads past it at the next launch, and one that moved no row is written only beside the next that did, or as the store closes.
          if (entities !== undefined && standing !== undefined) {
            const kept = { rows: collections.synced(), at: standing.next };
            yield* moved
              ? entities.keep(KEPT_READ.TASK_LIST, kept)
              : entities.keepUnmoved(KEPT_READ.TASK_LIST, kept);
          }
          yield* resendQueued;
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

  /**
   * A list already followed sealed and followed again now, the time stamped
   * so a wake's further events within `RESYNC_SETTLE` seal it no more. Note
   * that it says nothing of being behind, because a read asked again is
   * loading, and its answer or its failure says where the list stands.
   */
  const resealList = Effect.gen(function* () {
    if (!gate() || Option.isNone(yield* FiberHandle.get(listFollow))) return;
    resyncedAt = yield* Clock.currentTimeMillis;
    yield* FiberHandle.run(listFollow, followList);
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
      sidebarCollections({
        pool: dependencies.pool,
        draw: write,
        ownerId: dependencies.accountId,
        txWait: () => sidebarTxWait,
      }),
    );
    return { scope, collections };
  });
  let sidebar = yield* openSidebar;
  yield* Effect.addFinalizer(() => Scope.close(sidebar.scope, Exit.void));
  /** Whether the sidebar's follow has answered since its collections opened, after which nothing kept on disk is drawn over it. */
  let sidebarAnswered = false;
  /**
   * The sidebar's writes, each service call under the serial lock and the
   * transaction waited for outside it, so no task open, save, or read waits
   * on the follow behind a pin or a drag.
   */
  const sidebarWritten = sidebarWrites({
    gate,
    pinRepository: (repository, pinned, key) =>
      serial(served(client.pinRepository(repository, pinned, key))),
    writeSection: (each, key) => serial(served(client.writeTaskSection(each, key))),
    collections: () => sidebar.collections,
  });

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
        : served(client.liveRead(SIDEBAR_READ, { userId }, poll ? { after } : undefined));
    /** One seal followed until it stops, which fails it so the backoff seals it again. */
    const attempt = Effect.gen(function* () {
      const sealed = yield* seal(false);
      if ("failure" in sealed) return yield* Effect.fail(sealed.failure);
      yield* followSidebarRows(
        {
          poll: (after) => seal(true, after),
          onTxWait: (wait) => {
            sidebarTxWait = wait;
          },
        },
        sealed,
        (rows) =>
          Effect.andThen(
            sidebar.collections.answer(rows),
            Effect.suspend(() => {
              sidebarAnswered = true;
              return dependencies.entities()?.keep(KEPT_READ.SIDEBAR, rows) ?? Effect.void;
            }),
          ),
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
   * The account's lists as the entity store kept them, drawn as the service
   * last answered them before any follow does, each only where nothing has
   * answered it since: the task list, which its next follow reads past the
   * sync id it was kept at, and the sidebar.
   */
  const drawnFromDisk = Effect.gen(function* () {
    const entities = dependencies.entities();
    if (entities === undefined) return;
    const list = entities.stored(KEPT_READ.TASK_LIST);
    if (list !== undefined && view.listStatus !== TASKS_READ.READY) {
      listKeptAt = list.at;
      // Note that a list drawn from disk is not said to be behind: the follow's first answer, or its failure, says where it stands.
      view = { ...view, listStatus: TASKS_READ.READY };
      yield* taskList.collections.answer(list.rows, { past: undefined, next: list.at, gone: [] });
    }
    const sidebarRows = entities.stored(KEPT_READ.SIDEBAR);
    if (sidebarRows !== undefined && !sidebarAnswered) {
      yield* sidebar.collections.answer(sidebarRows);
    }
  });

  /**
   * Follows the account's task list and sidebar where nothing follows each
   * yet, the list saying it is reading until its first answer lands.
   */
  const followAccount = Effect.gen(function* () {
    if (view.listStatus === TASKS_READ.IDLE) write({ listStatus: TASKS_READ.READING });
    yield* FiberHandle.run(listFollow, followList, { onlyIfMissing: true });
    yield* followSidebar;
  });

  /**
   * `task` given everything its row of the list now reads, its name,
   * status, assignee, and repository among them, so a change a teammate or
   * an agent made reaches a held description as it reaches the list; the very task
   * where the list holds no row of it. Note that the row is the whole of
   * what the task carries but its description, so a field the row leaves out is one
   * the task no longer has, and that the last save is the description's own, kept
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
      ...readMarkOf(task),
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
      ...readMarkOf(task),
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

  /** A member's name as the list already knows it, from a task they made or are assigned; none where it names them nowhere. */
  function listedName(userId: string): string | undefined {
    for (const row of view.tasks) {
      if (row.createdBy?.userId === userId) return row.createdBy.name;
      if (row.assignee?.userId === userId) return row.assignee.name;
    }
    return undefined;
  }

  /**
   * A started task's row of the list as its request draws it, under the id
   * minted for it, before the service answers: what the request names, a
   * new task's defaults as the service sets them where it names none, each
   * member by the name the list already knows them by, and no number, which
   * only the service gives. A task joining a tree takes the tree's
   * repository, as the service gives it, where the list holds the task it
   * joins by. None where the request names no workspace, since the service
   * then starts it in the account's first, which only it knows, or where
   * nobody is signed in.
   */
  function startedRow(request: StartRequest): PlanRow | undefined {
    const ownerId = dependencies.accountId();
    const { workspaceId } = request;
    if (workspaceId === undefined || ownerId === undefined) return undefined;
    const relations = startRelationsOf(request);
    const related = (kind: TaskCreateRelationKind) =>
      relations.flatMap((each) => (each.kind === kind ? [each.taskId] : []));
    const listedTask = (taskId: string | undefined) =>
      taskId === undefined ? undefined : view.tasks.find((row) => row.id === taskId);
    const parentTaskId =
      request.parentTaskId ?? related(TASK_CREATE_RELATION_KIND.SUB_TASK_OF).at(0);
    const tree =
      listedTask(parentTaskId) ?? listedTask(related(TASK_CREATE_RELATION_KIND.PARENT_OF).at(0));
    const status = request.status ?? TASK_STATUS.TODO;
    const now = kernel.now();
    const name = request.name ?? "";
    return {
      id: request.id,
      workspaceId,
      name: name.length > 0 ? name : UNTITLED_TASK_NAME,
      repository: tree === undefined ? (request.repository ?? null) : tree.repository,
      ownerId,
      ownerName: listedName(ownerId) ?? null,
      assigneeId: request.assigneeId ?? null,
      assigneeName:
        request.assigneeId === undefined ? null : (listedName(request.assigneeId) ?? ""),
      pinnedAt: null,
      pinPosition: null,
      completedAt: FINISHED.has(status) ? now : null,
      createdAt: now,
      updatedAt: now,
      status,
      priority: request.priority ?? TASK_PRIORITY.NONE,
      parentTaskId: parentTaskId ?? null,
      ...(request.mode === undefined ? undefined : { mode: request.mode }),
      ...(related(TASK_CREATE_RELATION_KIND.BLOCKED_BY).some(blocksNow)
        ? { blocked: true }
        : undefined),
    };
  }

  /**
   * Opens a starting task at once under the id minted for it, as the list
   * draws its row, on its empty description laid as held (`documents.started`), so
   * the window turns to it in the frame of the press, before the service has
   * made it. Where the list draws no row of it, as for a start that names no
   * workspace, it opens once the service answers.
   */
  function startOpened(taskId: string): Effect.Effect<StartOpened> {
    return Effect.gen(function* () {
      screenAsks += 1;
      const opened = { asked: screenAsks, before: view.activeTaskId };
      const listed = view.tasks.find((row) => row.id === taskId);
      if (listed === undefined) return { ...opened, drawn: false };
      const { agents: _agents, ...row } = listed;
      // Note that the description is laid before the task opens, so the window's first frame of it draws its description.
      yield* documents.started({ ...row, document: EMPTY_DESCRIPTION });
      write({ activeTaskId: taskId });
      return { ...opened, drawn: true };
    });
  }

  /**
   * Puts the reader back on the task they stood on, or on none, where a
   * start that opened its task at once was refused and nothing else was
   * asked of the screen since; the description it laid is let go either way.
   */
  function startedBack(opened: StartOpened, taskId: string): Effect.Effect<void> {
    return Effect.suspend(() => {
      if (screenAsks === opened.asked && view.activeTaskId === taskId) {
        const { activeTaskId: _started, ...rest } = view;
        view = opened.before === undefined ? rest : { ...rest, activeTaskId: opened.before };
        publish();
      }
      return opened.drawn ? documents.unfollow(taskId) : Effect.void;
    });
  }

  /**
   * The task a start opened, or opens now, laid as the service made it,
   * where the start is still the newest ask of the screen or its task still
   * stands open. A start the developer went on from, to another task or
   * another start, opens nothing. Note that a task drawn open before the
   * service made it has its record followed again, since a seal asked
   * before then finds no task and ends.
   */
  function startedAs(opened: StartOpened, task: Task): Effect.Effect<void> {
    return Effect.gen(function* () {
      if (screenAsks !== opened.asked && view.activeTaskId !== task.id) return;
      yield* documents.started(task);
      if (opened.drawn) yield* documents.retry(task.id);
      write({ activeTaskId: task.id });
    });
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
   * Draws `task` as the service answered it on its description wherever that is
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
   * Lays `answered`, a write's answer about `taskId`, on its description wherever
   * that is held, over the copy held by `lay`, so no read that left before
   * the answer lands over it; a description whose first read is still out takes the
   * answer whole (`description-document-reads.ts`).
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
   * Draws the pin `task` was answered with on its description wherever a copy is
   * held, which keeps everything else it holds, because a draft drawn
   * meanwhile may be ahead of the copy the service answered. Note that a
   * description whose first read is still out takes the pin from the list's row as
   * the read lands (`asListed`).
   */
  function takeMarks(task: Task): void {
    documents.written(task.id, (held) =>
      held === undefined ? undefined : withMarksOf(held, task),
    );
  }

  /**
   * A task renamed, its name drawn on its row at once and kept once the list
   * carries it (`task-list-collections.ts`); its held description takes the
   * service's answer in place, and nothing is read again.
   */
  const renamed: WriteDeclaration<PlanRow, FieldChange<PlanRow>, TasksRenameParams, boolean> = {
    kind: PLAN,
    keys: ({ taskId }) => [taskId],
    change:
      ({ name }) =>
      () => ({ name }),
    send: ({ taskId, name }, { key }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const renamedAs = yield* served(client.rename(taskId, { name }, key));
              if (!renamedAs.ok) {
                return untaken(renamedAs.failure, {
                  kept: true,
                  refused: false,
                });
              }
              const written = renamedAs.answer;
              const answered = written.task;
              documentTook(taskId, answered, (held) => ({
                ...held,
                name: answered.name,
                document: answered.document,
              }));
              return {
                answer: true,
                txid: written.txid,
                taken: () => planFieldsOf(answered),
              };
            }),
          )
        : Effect.succeed({ refused: false }),
    queue: {
      name: TASK_QUEUED_WRITE.RENAME,
      input: tasksRenameParamsSchema,
      queued: () => true,
    },
  };

  /**
   * Where a task stands, drawn on its row at once, a member assigned by the
   * name the window knows them by, and kept once the list carries it; its
   * held description takes the service's answer in place, and nothing is read
   * again.
   */
  const stood: WriteDeclaration<PlanRow, FieldChange<PlanRow>, TasksSetStandingParams, boolean> = {
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
    send: ({ taskId, assigneeName: _named, ...standing }, { key }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const stoodAs = yield* served(client.setStanding(taskId, standing, key));
              if (!stoodAs.ok) {
                return untaken(stoodAs.failure, {
                  kept: true,
                  refused: false,
                });
              }
              const answered = stoodAs.answer;
              const { task } = answered;
              documentTook(taskId, task, (held) => ({ ...withoutAssignee(held), ...task }));
              return {
                answer: true,
                txid: answered.txid,
                taken: () => planFieldsOf(task),
              };
            }),
          )
        : Effect.succeed({ refused: false }),
    queue: {
      name: TASK_QUEUED_WRITE.SET_STANDING,
      input: tasksSetStandingParamsSchema,
      queued: () => true,
    },
  };

  /**
   * A task pinned or unpinned, drawn on its row at once, a pin newest pinned
   * and standing where it was dragged, and kept once the list carries it;
   * its held description takes the service's answer.
   */
  const pinned: WriteDeclaration<PlanRow, FieldChange<PlanRow>, TasksPinParams, boolean> = {
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
    send: ({ taskId, pinned: pin, position }, { key }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const markedAs = yield* served(
                client.mark(
                  taskId,
                  position === undefined ? { pinned: pin } : { pinned: pin, pinPosition: position },
                  key,
                ),
              );
              if (!markedAs.ok) {
                return untaken(markedAs.failure, {
                  kept: true,
                  refused: false,
                });
              }
              const marked = markedAs.answer;
              takeMarks(marked.task);
              return {
                answer: true,
                txid: marked.txid,
                taken: () => planFieldsOf(marked.task),
              };
            }),
          )
        : Effect.succeed({ refused: false }),
    queue: {
      name: TASK_QUEUED_WRITE.PIN,
      input: tasksPinParamsSchema,
      queued: () => true,
    },
  };

  /**
   * The reader's read mark of a task, drawn on its row at once and kept once
   * the list carries the service's; the held description reads no mark, so only the
   * row takes the answer.
   */
  const markedRead: WriteDeclaration<
    PlanRow,
    FieldChange<PlanRow>,
    TasksMarkReadParams,
    boolean
  > = {
    kind: PLAN,
    keys: ({ taskId }) => [taskId],
    change:
      ({ readMark }) =>
      (row) =>
        markedAs(readMark, row, kernel.now()),
    send: ({ taskId, readMark }, { key }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const answered = yield* served(client.mark(taskId, { readMark }, key));
              if (!answered.ok) {
                return untaken(answered.failure, {
                  kept: true,
                  refused: false,
                });
              }
              const marked = answered.answer;
              return {
                answer: true,
                txid: marked.txid,
                taken: () => readMarkOf(marked.task),
              };
            }),
          )
        : Effect.succeed({ refused: false }),
    queue: {
      name: TASK_QUEUED_WRITE.MARK_READ,
      input: tasksMarkReadParamsSchema,
      queued: () => true,
    },
  };

  /**
   * A task started, its row drawn the moment it is asked under the id the
   * host minted for it, which the list adopts while it stands, and taken
   * back where the service refused it; a start that is not quiet opens its
   * task at once, and puts the reader back where they were if refused. The
   * agent a start asks for waits on the service, as remote work does. Where
   * the list hands no wait, or the service answers a start sent again with
   * no transaction, the row as the service answered it is taken in the
   * list's place. One that draws its row waits where the service did not
   * answer it, its row drawn and its task open, and is sent again with the
   * other writes waiting; sent so, it opens nothing, and its answer reaches
   * its task only where the task stands open. One that names an agent holds
   * its window's call until it is sent, since the window draws its agent
   * from the answer, and is sent under that agent's own key alone, which
   * the service answers a start sent again with its agent by.
   */
  const started: WriteDeclaration<PlanRow, FieldChange<PlanRow>, Start, TasksStartAnswer> = {
    kind: PLAN,
    keys: ({ request, row }) => (row === undefined ? [] : [request.id]),
    // Note that a start that draws no row names no key, so its change is never drawn.
    change: ({ row }) => (row === undefined ? () => ({}) : { made: row }),
    send: (start, { key, waited }) =>
      gate()
        ? Effect.gen(function* () {
            const { id } = start.request;
            const opened = start.quiet
              ? undefined
              : waited
                ? OPENED_EARLIER
                : yield* startOpened(id);
            return yield* serial(
              Effect.gen(function* () {
                const created = yield* served(
                  client.create(start.request, start.request.agent === undefined ? key : undefined),
                );
                if (!created.ok) {
                  const { failure, localAgentRefusal, cause } = created;
                  const went = created.untaken ?? WRITE_UNTAKEN.REFUSED;
                  const waits =
                    went === WRITE_UNTAKEN.UNANSWERED && key !== undefined && startMayWait(start);
                  // Note that a start the service took already was made by an earlier send, so its record is followed again where it stands open, as a made start's is; one that waits keeps its task open, and any other is taken back.
                  if (went === WRITE_UNTAKEN.ALREADY_WRITTEN) {
                    if (opened?.drawn === true && view.activeTaskId === id) {
                      yield* documents.retry(id);
                    }
                  } else if (opened !== undefined && !waits) yield* startedBack(opened, id);
                  return untaken<FieldChange<PlanRow>, TasksStartAnswer>(went, {
                    kept: { planId: id },
                    refused: {
                      failure,
                      ...(localAgentRefusal === undefined ? undefined : { localAgentRefusal }),
                      ...(cause === undefined ? undefined : { cause }),
                    },
                  });
                }
                const { task, agent, txid } = created.answer;
                if (opened !== undefined) yield* startedAs(opened, task);
                const row = planRowOf(task);
                return {
                  answer: {
                    planId: task.id,
                    ...(agent === undefined ? undefined : { agentStart: agent }),
                  },
                  txid,
                  ...(row === undefined ? undefined : { taken: { made: row } }),
                };
              }),
            );
          })
        : Effect.succeed({
            refused: { failure: TASK_CALL_FAILURE.UNANSWERED },
          }),
    queue: {
      name: TASK_QUEUED_WRITE.START,
      input: startKeptSchema,
      queued: ({ request }) => ({ planId: request.id }),
      holds: ({ request }) => request.agent !== undefined,
    },
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
    boolean
  > = {
    kind: PLAN,
    keys: ({ taskId }) => [taskId],
    change: () => () => ROW_GONE,
    send: ({ taskId }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const written = yield* served(client.delete(taskId));
              if (written === undefined) return { refused: false };
              yield* kept.forget(keptOfTask(taskId));
              if (view.activeTaskId === taskId) closeActive();
              return { answer: true, txid: written.txid };
            }),
          )
        : Effect.succeed({ refused: false }),
  };

  /**
   * A task changed by a call the service answers with the task, drawn at
   * once on every row `keys` names, the task's and the other task's a
   * relation joins, and kept once the list carries it; its held description takes
   * the service's answer in place, and a refusal answers why and puts
   * every row back. Note that the change is read off the input alone, which
   * holds what the list knew as it was asked, so the change taken where the
   * list hands no wait is the one drawn: the task's own row as the service
   * answered it laid over it, and every other row as drawn.
   */
  const taskChanged = <Input extends { readonly taskId: string }, Failure, Answer>(declared: {
    readonly keys: (input: Input) => readonly string[];
    readonly drawn: (input: Input) => (row: PlanRow) => Partial<PlanRow> | typeof ROW_GONE;
    readonly call: (
      input: Input,
    ) => Effect.Effect<TaskCallResult<TaskWritten, Failure>, never, HttpClient.HttpClient>;
    readonly answered: (task: Task) => Answer;
    readonly refused: (failure: Failure | typeof TASK_CALL_FAILURE.UNANSWERED) => Answer;
  }): WriteDeclaration<PlanRow, FieldChange<PlanRow>, Input, Answer> => ({
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
    answered: (task): TasksSetRepositoryAnswer => ({ repository: task.repository }),
    refused: (failure): TasksSetRepositoryAnswer => ({ failure }),
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
    answered: (task): TasksMoveAnswer => ({ workspaceId: task.workspaceId }),
    refused: (failure): TasksMoveAnswer => ({ failure }),
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
    answered: (task): TasksBlockAnswer => ({
      blockedBy: task.blockedBy ?? [],
      blocks: task.blocks ?? [],
    }),
    refused: (failure): TasksBlockAnswer => ({ failure }),
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
    answered: (task): TasksSetParentAnswer => ({ parentTaskId: task.parentTaskId ?? null }),
    refused: (failure): TasksSetParentAnswer => ({ failure }),
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
    answered: (task): TasksChangeRelationAnswer => ({
      blockedBy: task.blockedBy ?? [],
      blocks: task.blocks ?? [],
      parentTaskId: task.parentTaskId ?? null,
    }),
    refused: (failure): TasksChangeRelationAnswer => ({ failure }),
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

  /** A page's version, answered to the frame or the source tab that asked and kept by its version, which is never written again, so its HTML never enters the view every window is told. */
  const pageRead = (read: TasksPageParams): Effect.Effect<TasksPageAnswer> =>
    Effect.gen(function* () {
      // A run that sends nothing reads the page its fixture stages, frame and source alike.
      if (!kernel.runMode.sendsNetwork) return fixturePage(read);
      if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
      const { pageId, version } = read;
      const place = "taskId" in read ? { taskId: read.taskId } : { agentId: read.agentId };
      const owner = pageOwnerOf(read);
      return yield* kept.answer(
        new PageVersionKey({ ownerKind: owner.kind, ownerId: owner.id, pageId, version }),
        dependencies.accountId,
        Effect.map(
          served(client.readPageVersion(place, pageId, version)),
          (page): TasksPageAnswer =>
            page === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { page },
        ),
        (page) => ("page" in page ? page : undefined),
      );
    });

  /** The Tasks tab's plain asks, answered as the panel's port asks them (`TASKS_ACTS`), but GitHub's connection's and the admin dashboard's (`compose-workspaces.ts`). */
  const taskActs: Omit<HostActTable<typeof TASKS_ACTS>, WorkspacesTasksAct> = {
    // The list's Try again: what is followed already stands (`open`), so it
    // starts only a follow that is not running, the workspaces' among them,
    // and reads GitHub's connection again where the last read is stale
    // (`compose-workspaces.ts`). A held description has a Try again of its
    // own (`TASKS_DOCUMENT_RETRY`).
    TASKS_REFRESH: () =>
      Effect.gen(function* () {
        if (!gate()) return;
        yield* followAccount;
        yield* Effect.flatMap(late.value, (links) => links.workspacesRefreshed);
      }),
    // A window said the changes made offline the service refused, so the count it said is cleared for every window.
    TASKS_OFFLINE_REFUSED_CLEAR: () => Effect.sync(() => dependencies.offlineRefused.clear()),
    TASKS_SELECT: ({ taskId }) =>
      Effect.sync(() => {
        if (!gate()) return false;
        screenAsks += 1;
        // Note that the open reads nothing: the window holds the task's description (`TASKS_DOCUMENT_FOLLOW`), which draws at once where it was held lately.
        write({ activeTaskId: taskId });
        return true;
      }),
    // Leaving the task returns to the list, which was read when the tab
    // showed.
    TASKS_CLOSE: () =>
      Effect.gen(function* () {
        screenAsks += 1;
        yield* serial(Effect.sync(closeActive));
      }),
    TASKS_FILE: (read) =>
      Effect.gen(function* () {
        if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
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
        return answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED };
      }),
    // A folder's listing is answered to the tree that asked and held nowhere:
    // the tree keeps the folders it has opened.
    TASKS_TREE: (asked) =>
      Effect.gen(function* () {
        if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
        const folder = {
          path: asked.path,
          ...(asked.recursive === undefined ? undefined : { recursive: asked.recursive }),
        };
        const answer = yield* served(
          "planId" in asked
            ? client.readTree(asked.planId, folder)
            : client.readRepositoryTree(asked, folder),
        );
        return answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED };
      }),
    // The repository's skills are held for every window and read again behind
    // each answer (`heldSkills`), a plan's under the repository the list
    // names it on, so a plan moved to another repository reads that one's.
    TASKS_SKILLS: (asked) =>
      Effect.gen(function* () {
        if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
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
        return answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED };
      }),
    // A tab a member opens in an agent's browser is answered to the panel
    // that asked and held nowhere; the held list names it once it moves.
    TASKS_BROWSER_TAB_OPEN: (read) =>
      gate() ? served(client.openBrowserTab(read)) : Effect.succeed(BROWSER_TABS_UNANSWERED),
    // The task a link names by its number is found on the service and answered to the window that asked, held nowhere.
    TASKS_FIND: (read) =>
      Effect.gen(function* () {
        if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
        const taskId = yield* served(client.find(read.workspace, read.number));
        return taskId === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { taskId };
      }),
    // A page of the history is answered to the caller that asked, and an
    // older page is laid on the task's held history too, past the revisions
    // held from where it was read before, so a version history scrolled back
    // keeps it as saves land. A revision beside the one before it is
    // answered to the version history that asked and held nowhere.
    TASKS_REVISIONS: ({ taskId, before }) =>
      Effect.gen(function* () {
        if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
        const page = yield* served(client.readRevisions(taskId, before));
        const held = heldHistories.rowsOf(taskId);
        if (page !== undefined && before !== undefined && held !== undefined) {
          heldHistories.lay(taskId, withOlderPage(held, before, page));
        }
        return page ?? { failure: TASK_CALL_FAILURE.UNANSWERED };
      }),
    TASKS_REVISION: (read) =>
      Effect.gen(function* () {
        if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
        const revision = yield* served(client.readRevision(read.taskId, read.seq));
        return revision === undefined ? { failure: TASK_CALL_FAILURE.UNANSWERED } : { revision };
      }),
    // The version is read as its frame reads it (`pageRead`), so its HTML reaches the tab that asked alone, line by line and plain.
    TASKS_PAGE_SOURCE: (read) =>
      Effect.map(
        pageRead(read),
        (answer): TasksPageSourceAnswer =>
          "page" in answer ? { lines: pageSourceLines(answer.page.html) } : answer,
      ),
    // A picture's bytes are answered to the window that asked and kept by
    // its id, which no other upload is given, so they never enter the view
    // every window is told.
    TASKS_PICTURE_READ: (read) =>
      gate()
        ? kept.answer(
            new DescriptionPictureKey({ planId: read.planId, attachmentId: read.attachmentId }),
            dependencies.accountId,
            served(client.readPicture(read.planId, read.attachmentId)),
            (answer) => ("base64" in answer ? answer : undefined),
          )
        : Effect.succeed({ failure: TASK_CALL_FAILURE.UNANSWERED }),
    // A write to a task's comments is drawn over its thread at once, a
    // thread started drawn under the id its window minted, standing until
    // the subject's read carries it, or taken back where the service
    // refused it (`description-comment-writes.ts`).
    TASKS_COMMENT_START: declaredWrite(dependencies.pool, commentWrites.started),
    TASKS_COMMENT_ACT: declaredWrite(dependencies.pool, commentWrites.acted),
    // The picture is kept and its id answered to the editor that took it;
    // the description's text names it once the editor lays its address in.
    TASKS_PICTURE_KEEP: (read) =>
      gate()
        ? served(client.keepPicture(read.planId, read.picture))
        : Effect.succeed({ failure: TASK_CALL_FAILURE.UNANSWERED }),
    // The service answers the task as restored, so the list's row and its
    // held description take it in place and nothing is read again. It is confirmed
    // once its transaction reached the history the windows hold, or held
    // lately; at once where none is.
    TASKS_RESTORE: ({ taskId, seq }) =>
      Effect.gen(function* () {
        if (!gate()) return false;
        const restored = yield* serial(
          Effect.gen(function* () {
            const answer = yield* served(client.restore(taskId, seq));
            if (answer === undefined) return undefined;
            return { ...answer, held: takeAnswered(answer.task) };
          }),
        );
        if (restored === undefined) return false;
        // Note that the waits stand outside the serial reads, so no read waits on them.
        const { held, txid } = restored;
        yield* Effect.all(
          [
            confirmWrite(historyTxWaits.get(taskId), txid),
            heldOverList(held.taskId, held.fields, txid),
          ],
          { concurrency: "unbounded" },
        );
        return true;
      }),
    // A start draws its task's row the moment it is asked, under the id minted for it where the
    // window named none, and stands until the list carries it (`started`). A quiet start, a
    // group's quick add or New task set to stay, opens nothing, and answers with its agent's
    // start where it asked for one; any other opens its task at once.
    TASKS_START: declaredWrite(dependencies.pool, started, {
      read: ({ quiet, ...asked }) =>
        Effect.sync((): Start => {
          const request = { ...asked, id: asked.id ?? kernel.createId() };
          // Note that a start behind a closed gate draws nothing, since it never reaches the service.
          return { request, quiet: quiet === true, row: gate() ? startedRow(request) : undefined };
        }),
    }),
    TASKS_DELETE: declaredWrite(dependencies.pool, deleted),
    TASKS_RENAME: declaredWrite(dependencies.pool, renamed),
    TASKS_SET_STANDING: declaredWrite(dependencies.pool, stood),
    TASKS_PIN: declaredWrite(dependencies.pool, pinned),
    TASKS_MARK_READ: declaredWrite(dependencies.pool, markedRead),
    // A pin or a drag reads the instant it is asked at, which what it draws is stamped with.
    TASKS_PIN_REPOSITORY: declaredWrite(dependencies.pool, sidebarWritten.pinned, {
      read: (read) => Effect.sync(() => ({ ...read, at: kernel.now() })),
    }),
    TASKS_WRITE_SECTION: declaredWrite(dependencies.pool, sidebarWritten.sectionsWritten, {
      read: (read) =>
        Effect.sync(() => ({ ...read, ownerId: dependencies.accountId(), at: kernel.now() })),
    }),
    TASKS_SET_REPOSITORY: declaredWrite(dependencies.pool, repositorySet),
    // A move reads, as it is asked, whether the reader is a member of the
    // workspace it moves to, where the list goes on holding the task; while
    // the workspaces are not read yet it takes the reader for one.
    TASKS_MOVE: declaredWrite(dependencies.pool, moved, {
      read: (read) =>
        Effect.sync(() => ({
          ...read,
          member:
            view.workspacesStatus !== TASKS_READ.READY ||
            view.workspaces.some((workspace) => workspace.id === read.workspaceId),
        })),
    }),
    // A block or a relation reads, as it is asked, what the list knows of
    // the tasks it joins, which its draw reads.
    TASKS_BLOCK: declaredWrite(dependencies.pool, blockChanged, {
      read: (read) =>
        Effect.sync(() => ({ ...read, reach: relationReachOf(read.taskId, read.block.taskId) })),
    }),
    TASKS_SET_PARENT: declaredWrite(dependencies.pool, parentSet),
    TASKS_CHANGE_RELATION: declaredWrite(dependencies.pool, relationChanged, {
      read: (read) =>
        Effect.sync(() => ({
          ...read,
          reach: relationReachOf(read.taskId, read.relation.taskId),
        })),
    }),
    // The task the service answered is drawn in place, so the edit stands on
    // its description at once and the notetaker's drafts drawn before it drop. It
    // stands until the task's record and the list carry its transaction,
    // which is waited for behind the answer.
    TASKS_EDIT: ({ taskId, edit }) =>
      Effect.gen(function* () {
        if (!gate()) return { failure: TASK_CALL_FAILURE.UNANSWERED };
        const edited = yield* serial(
          Effect.gen(function* () {
            const written = yield* served(client.edit(taskId, edit));
            if (!written.ok) return { answer: { failure: written.failure } };
            const answer = written.answer;
            if ("conflict" in answer) return { answer: { conflict: answer.conflict } };
            if ("refused" in answer) return { answer: { failure: answer.refused } };
            return {
              answer: { saved: true } as const,
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
  };

  const methods: HostMethodTable = {
    // A follow may have died in a sleep or a lost network without a word,
    // and one waiting out a pause need not wait on: a list already followed
    // is sealed again now, once for a wake's several events.
    [GATEWAY_METHOD.TASKS_RESYNC]: () =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        if (resyncedAt !== undefined && at - resyncedAt < Duration.toMillis(RESYNC_SETTLE)) {
          return {};
        }
        yield* resealList;
        return {};
      }),
    // The connection came back, which no settle folds away, since a read a
    // wake started just before may have hung on the network that was not
    // yet there. Every read a window holds is asked again as a window
    // coming forward asks it (`window-focus.ts`), and the live follows
    // waiting out a backoff ask as the service answered (`live-follow.ts`).
    [GATEWAY_METHOD.TASKS_REGAINED]: () =>
      Effect.gen(function* () {
        yield* dependencies.focus.raise;
        yield* resealList;
        return {};
      }),
    // A page's version, answered to the frame that asked (`pageRead`).
    [GATEWAY_METHOD.TASKS_PAGE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPageParamsSchema,
          params,
          "reading a page names a task or an agent, the page, and its version",
        );
        return carried<TasksPageAnswer>(yield* pageRead(read));
      }),
  };

  /** The Tasks tab's live follows, each window's hold the scope of its read's own counted hold (`act-port/live-follows.ts`). */
  const taskFollows: HostActTable<typeof TASKS_FOLLOWS> = {
    TASKS_REPOSITORIES_FOLLOW: {
      hold: ({ workspaceId }) => repositoryLists.hold(workspaceId ?? EVERY_WORKSPACE),
      retry: ({ workspaceId }) => repositoryLists.retry(workspaceId ?? EVERY_WORKSPACE),
    },
    TASKS_LINK_STANDING_FOLLOW: { hold: (link) => linkStandings.hold(new LinkStandingKey(link)) },
    TASKS_BROWSER_TABS_FOLLOW: { hold: (place) => heldBrowserTabs.hold(browserTabsOwnerOf(place)) },
    TASKS_PAGES_FOLLOW: { hold: (place) => heldPageReads.hold(pageOwnerOf(place)) },
    TASKS_DOCUMENT_FOLLOW: {
      hold: ({ taskId }) => documents.hold(taskId),
      retry: ({ taskId }) => (gate() ? documents.retry(taskId) : Effect.void),
    },
    TASKS_HISTORY_FOLLOW: {
      hold: ({ taskId }) => heldHistories.hold(taskId),
      retry: ({ taskId }) => (gate() ? heldHistories.retry(taskId) : Effect.void),
    },
    TASKS_COMMENTS_FOLLOW: {
      hold: (scope) => comments.hold(commentSubjectOf(scope)),
      retry: (scope) => comments.retry(commentSubjectOf(scope)),
    },
  };

  return {
    acts: { ...taskActs, ...taskFollows },
    methods,
    snapshot: () => view,
    link: (links) => Effect.asVoid(late.set(links)),
    workspaces: {
      view: () => view,
      draw: write,
      repositoriesMovedIn,
      openTaskLeaving,
    },
    // The gate opening follows the account's task list and sidebar, so the
    // list loads after a launch or a sign-in with no window asking.
    open: Effect.gen(function* () {
      yield* heldPageReads.open;
      yield* heldBrowserTabs.open;
      yield* heldHistories.open;
      yield* comments.open;
      yield* linkStandings.open;
      yield* repositoryLists.open;
      yield* documents.open;
      if (!gate()) return;
      yield* drawnFromDisk;
      yield* followAccount;
    }),
    listed,
    queueable: [
      anyWrite(started),
      anyWrite(renamed),
      anyWrite(stood),
      anyWrite(pinned),
      anyWrite(sidebarWritten.pinned),
      anyWrite(sidebarWritten.sectionsWritten),
    ],
    pullRequestListings: Effect.map(PubSub.subscribe(listings), Stream.fromSubscription),
    repositoriesMoved: repositoryLists.reread(() => true),
    reset: Effect.gen(function* () {
      yield* Cache.invalidateAll(pullRequestReads);
      yield* Cache.invalidateAll(issueReads);
      yield* FiberMap.clear(skillsReads);
      MutableHashMap.clear(heldSkills);
      // Note that the windows' holds on pages, tabs, histories, comments, and descriptions stand through a sign-out, so a session signing in follows them anew (`open`).
      yield* heldPageReads.end;
      yield* heldBrowserTabs.end;
      yield* heldHistories.end;
      yield* comments.end;
      yield* linkStandings.end;
      yield* repositoryLists.end;
      yield* FiberMap.clear(editWaits);
      yield* documents.end;
      yield* FiberHandle.clear(listFollow);
      yield* Scope.close(taskList.scope, Exit.void);
      taskList = yield* openTaskList;
      yield* FiberHandle.clear(sidebarFollow);
      yield* Scope.close(sidebar.scope, Exit.void);
      sidebar = yield* openSidebar;
      sidebarAnswered = false;
      listKeptAt = undefined;
      yield* serial(
        Effect.sync(() => {
          view = idleView();
          publish();
        }),
      );
    }),
    // Every read of the tasks is an ask's, or a held read's, which stands in the composer's own scope.
    lifetime: Effect.void,
  };
});
