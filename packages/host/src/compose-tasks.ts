import {
  type HostedAdminClient,
  type HostedGitHubConnectionClient,
  type HostedTaskClient,
  type HostedWorkspaceClient,
  type TaskCallResult,
  type TaskWritten,
  WORKSPACE_CALL_FAILURE,
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
import { WRITE_UNTAKEN } from "@repo/features/keyed-write";
import { issueAddressOf, pullRequestAddressOf } from "@repo/features/link-grammar";
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
import { markedAs, readMarkOf } from "@repo/features/read-mark";
import type {
  SlackBotChannel,
  SlackListedChannel,
  WorkspaceSlackBot,
} from "@repo/features/slack-bot-wire";
import { taskListLiveRowsSchema } from "@repo/features/task-list-live";
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
  type TasksMarkReadParams,
  type TasksMoveAnswer,
  type TasksMoveParams,
  type TasksPageAnswer,
  type TasksPictureAnswer,
  type TasksPictureKeepAnswer,
  type TasksPinParams,
  type TasksRenameParams,
  type TasksRevisionAnswer,
  type TasksRevisionsAnswer,
  type TasksSetParentAnswer,
  type TasksSetParentParams,
  type TasksSetRepositoryAnswer,
  type TasksSetRepositoryParams,
  type TasksSetStandingParams,
  type TasksSkillsAnswer,
  type TasksStartAnswer,
  type TasksStartRequest,
  type TasksTreeAnswer,
  type TasksView,
  type TasksWorkspaceAnswer,
  type TasksWorkspaceGitHubConnectAnswer,
  type TasksWorkspaceInvitationAnswer,
  type TasksWorkspaceInvitationsAnswer,
  type TasksWorkspaceLeaveAnswer,
  type TasksWorkspaceMemberRemoveParams,
  type TasksWorkspaceMemberRoleParams,
  type TasksWorkspaceMembersAnswer,
  type TasksWorkspaceRenameParams,
  type TasksWorkspaceSentryAnswer,
  type TasksWorkspaceSlackBotAnswer,
  type TasksWorkspaceSlugSetParams,
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
  tasksLinkStandingParamsSchema,
  tasksMarkReadParamsSchema,
  tasksMoveParamsSchema,
  tasksPageParamsSchema,
  tasksPictureKeepParamsSchema,
  tasksPictureParamsSchema,
  tasksPinParamsSchema,
  tasksPinRepositoryParamsSchema,
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
  type AnyWrite,
  anyWrite,
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
  PubSub,
  Queue,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import { slackNotificationsWritten } from "./account-preferences-follow.js";
import {
  type AppLinkStanding,
  type AppLinkStandings,
  type AppRepositoryLists,
  type AppTokenRepositories,
  type AppWorkspacePhotos,
  EVERY_WORKSPACE,
  NO_BROWSER_TABS,
  NO_KEYS_HELD,
  NO_PAGES,
} from "./app-state.js";
import type { AccountComposer } from "./compose-account.js";
import type { Composer } from "./composer.js";
import { type EntityStore, KEPT_READ } from "./entity-store.js";
import { fixturePage } from "./fixture-stage.js";
import type { HostMethodTable } from "./gateway-door.js";
import { heldFetch } from "./held-fetch.js";
import type { HostKernel } from "./host-kernel.js";
import {
  FileAtCommitKey,
  type KeptContent,
  keptOfTask,
  PageVersionKey,
  DescriptionPictureKey,
} from "./kept-content.js";
import { type HeldAnswers, heldSlice, rowWriteOn } from "./live-collection.js";
import { confirmWrite, FOLLOW_BACKOFF, LIVE_GONE, LiveBroken, type TxWait } from "./live-follow.js";
import { pushLive } from "./live-push.js";
import {
  type CommentSubjectKey,
  commentSubjectOf,
  descriptionCommentReads,
} from "./description-comment-reads.js";
import { descriptionCommentWrites } from "./description-comment-writes.js";
import { descriptionDocumentReads } from "./description-document-reads.js";
import type { PullRequestListing } from "./pull-request-parts.js";
import { type OfflineRefused, untaken } from "./queued-writes.js";
import type { RunMode } from "./run-mode.js";
import { sidebarCollections, sidebarWrites } from "./sidebar-collections.js";
import { PLAN, type PlanRow, taskListCollections } from "./task-list-collections.js";
import { followTaskList } from "./task-list-follow.js";
import { type TokenRepositoryWrites, tokenRepositoryWrites } from "./token-repository-writes.js";
import type { WindowFocus } from "./window-focus.js";
import {
  heldWorkspaceIntegrations,
  sentryDisconnect,
  slackBotAnswered,
  slackBotChannel,
  slackBotDisconnect,
  slackBotRepository,
} from "./workspace-integrations-follow.js";
import { workspaceInvitationsReads } from "./workspace-invitations-read.js";
import {
  type MemberMoved,
  type MemberWritten,
  workspaceMembersReads,
} from "./workspace-members-read.js";
import {
  type AskedOver,
  type WorkspaceWritten,
  workspaceRows,
  workspaceWrite,
} from "./workspace-rows.js";
import { followSidebarRows, workspacesMoves } from "./workspaces-follow.js";

type TaskMarkStamps = Pick<Task, "pinnedAt" | "pinPosition">;

const GITHUB_READ_EVERY = Duration.minutes(1);

const GITHUB_PAGE_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

const LINK_READ_KEPT = {
  CAPACITY: 512,
  ANSWERED: Duration.minutes(1),
  UNANSWERED: Duration.minutes(2),
} as const;

class LinkReadKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string;
  readonly number: number;
}> {}

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

class LinkStandingKey extends Data.Class<{
  readonly workspaceId: string;
  readonly address: string;
}> {}

function linkReadKept(exit: Exit.Exit<unknown>): Duration.Duration {
  return Exit.isSuccess(exit) && exit.value !== undefined
    ? LINK_READ_KEPT.ANSWERED
    : LINK_READ_KEPT.UNANSWERED;
}

const BROWSER_TABS_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

const COMMENT_UNANSWERED: TasksCommentAnswer = { failure: TASK_CALL_FAILURE.UNANSWERED };

class PlanSkillsKey extends Data.Class<{
  readonly planId: string;
  readonly workspaceId: string | undefined;
  readonly repository: string | undefined;
}> {}

class RepositorySkillsKey extends Data.Class<{
  readonly workspaceId: string;
  readonly repository: string | undefined;
}> {}

type SkillsKey = PlanSkillsKey | RepositorySkillsKey;

class PageOwnerKey extends Data.Class<{
  readonly kind: PageOwner["kind"];
  readonly id: string;
}> {}

function pageOwnerOf(place: PagePlace): PageOwnerKey {
  return "taskId" in place
    ? new PageOwnerKey({ kind: PAGE_OWNER.TASK, id: place.taskId })
    : new PageOwnerKey({ kind: PAGE_OWNER.AGENT, id: place.agentId });
}

function pagePlaceOf(owner: PageOwnerKey): PagePlace {
  return owner.kind === PAGE_OWNER.TASK ? { taskId: owner.id } : { agentId: owner.id };
}

class BrowserTabsOwnerKey extends Data.Class<{
  readonly kind: BrowserTabsPlaceKind;
  readonly id: string;
}> {}

function browserTabsOwnerOf(place: BrowserTabsPlace): BrowserTabsOwnerKey {
  return new BrowserTabsOwnerKey({
    kind: browserTabsPlaceKind(place),
    id: browserTabsPlaceId(place),
  });
}

function browserTabsPlaceOf(owner: BrowserTabsOwnerKey): BrowserTabsPlace {
  return owner.kind === BROWSER_TABS_PLACE.TASK ? { taskId: owner.id } : { agentId: owner.id };
}

const WORKSPACE_UNANSWERED = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;

function listedChannel({
  repository: _repository,
  ...channel
}: SlackBotChannel): SlackListedChannel {
  return channel;
}

const tasksOpenParamsSchema = Schema.Struct({ taskId: Schema.NonEmptyString });

const EMPTY_DESCRIPTION = { body: "", assumptions: [] } as const satisfies Task["document"];

type StartRequest = Omit<TasksStartRequest, "quiet"> & { readonly id: string };

interface Start {
  readonly request: StartRequest;
  readonly quiet: boolean;
  readonly row: PlanRow | undefined;
}

interface StartOpened {
  readonly asked: number;
  readonly drawn: boolean;
  readonly before: string | undefined;
}

function startMayWait(start: Start): boolean {
  return start.row !== undefined;
}

const startKeptSchema = Schema.Struct({
  request: Schema.Struct({ ...taskCreateRequestSchema.fields, id: Schema.String }),
  quiet: Schema.Boolean,
  row: Schema.UndefinedOr(taskListLiveRowsSchema.fields.plans.value),
}).check(Schema.makeFilter(startMayWait));

const OPENED_EARLIER: StartOpened = { asked: -1, drawn: true, before: undefined };

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
  workspaces: Pick<
    HostedWorkspaceClient,
    | "live"
    | "create"
    | "rename"
    | "setSlug"
    | "setPhoto"
    | "githubConnect"
    | "githubDisconnect"
    | "integrationsLive"
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
    | "cancelInvitation"
  >;
  github: Pick<HostedGitHubConnectionClient, "status" | "connect" | "disconnect">;
  admin: Pick<HostedAdminClient, "read" | "favorite">;
};

export interface TasksDependencies {
  kernel: Pick<HostKernel, "emit" | "now" | "createId"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "capabilitiesActive">;
  client: TasksClient;
  accountId: () => string | undefined;
  kept: KeptContent;
  focus: WindowFocus;
  pool: EntityPool;
  entities: () => EntityStore | undefined;
  offlineRefused: Pick<OfflineRefused, "clear">;
  member: () => { readonly userId: string; readonly name: string } | undefined;
  githubMoved: Effect.Effect<void>;
}

export interface TasksComposer extends Composer {
  snapshot: () => TasksView;
  reset: Effect.Effect<void>;
  open: Effect.Effect<void>;
  listed: (txid: string | undefined) => Effect.Effect<void>;
  queueable: readonly AnyWrite[];
  pullRequestListings: Effect.Effect<Stream.Stream<PullRequestListing>, never, Scope.Scope>;
  repositoriesMoved: Effect.Effect<void>;
}

const FINISHED: ReadonlySet<string> = new Set([TASK_STATUS.DONE, TASK_STATUS.CANCELED]);

interface RelationSide {
  readonly kind: TaskRelationKind;
  readonly added: boolean;
}

interface RelationReach {
  readonly blocking: readonly string[];
  readonly opened?: { readonly taskId: string; readonly blockedBy: readonly string[] };
}

interface RelationChange {
  readonly taskId: string;
  readonly otherId: string;
  readonly sides: readonly RelationSide[];
  readonly reach: RelationReach;
}

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

function relationDrawn(change: RelationChange): (row: PlanRow) => Partial<PlanRow> {
  return (row) => {
    const fields: Partial<PlanRow> = {};
    for (const side of change.sides) {
      Object.assign(fields, relationFields(change, side, { ...row, ...fields }));
    }
    return fields;
  };
}

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

function withOlderPage(
  held: DescriptionRevisionsAnswer,
  before: number,
  page: DescriptionRevisionsAnswer,
): DescriptionRevisionsAnswer {
  const revisions = [...held.revisions.filter((line) => line.seq >= before), ...page.revisions];
  return page.earlier === undefined ? { revisions } : { revisions, earlier: page.earlier };
}

const RESYNC_SETTLE = Duration.seconds(10);

export const composeTasks = Effect.fn("host/composeTasks")(function* (
  dependencies: TasksDependencies,
): Effect.fn.Return<TasksComposer, never, Scope.Scope | HttpClient.HttpClient> {
  const { kernel, account, client, kept } = dependencies;
  const http = yield* HttpClient.HttpClient;
  const served = <Answer, Failure>(call: Effect.Effect<Answer, Failure, HttpClient.HttpClient>) =>
    Effect.provideService(call, HttpClient.HttpClient, http);
  const idleView = (): TasksView => IDLE_TASKS_VIEW;
  const gate = () => kernel.runMode.sendsNetwork && account.capabilitiesActive();

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
  const heldSkills = MutableHashMap.empty<SkillsKey, TaskSkillsAnswer>();
  const skillsReads = yield* FiberMap.make<SkillsKey, TaskSkillsAnswer | undefined, never>();

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
  const linkStandings = yield* heldFetch<typeof LIVE_READ.LINK_STANDINGS, LinkStandingKey>({
    empty: NO_KEYS_HELD,
    path: (link) => [link.workspaceId, link.address],
    gate,
    focus: dependencies.focus,
    fetch: linkStandingOf,
    tell: (held: AppLinkStandings) =>
      kernel.emit(GATEWAY_EVENT.LINK_STANDINGS_CHANGED, carried(held)),
  });
  const linkHolds = yield* FiberMap.make<LinkStandingKey>();
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
    tell: (held: AppRepositoryLists) =>
      kernel.emit(GATEWAY_EVENT.REPOSITORY_LISTS_CHANGED, carried(held)),
  });
  const repositoryHolds = yield* FiberMap.make<string>();
  const repositoryScopeOf = (params: WireRecord) =>
    Effect.map(
      readParams(
        tasksRepositoriesParamsSchema,
        params,
        "a repository list names the workspace it is for, or none",
      ),
      (read) => read.workspaceId ?? EVERY_WORKSPACE,
    );
  const repositoriesMovedIn = (workspaceIds: ReadonlySet<string>) =>
    repositoryLists.wake(
      (workspace) => workspace === EVERY_WORKSPACE || workspaceIds.has(workspace),
    );

  const serial = (yield* Semaphore.make(1)).withPermits(1);

  let view: TasksView = idleView();
  let published: TasksView = view;
  let screenAsks = 0;

  function publish(): void {
    view = keepIdentity(published, view);
    if (view === published) return;
    published = view;
    kernel.emit(GATEWAY_EVENT.TASKS_CHANGED, carried(view));
  }

  function write(next: Partial<TasksView>): void {
    view = { ...view, ...next };
    publish();
  }

  function closeActive(): void {
    const { activeTaskId: _closed, ...rest } = view;
    view = rest;
    publish();
  }

  const decodeHistory = Schema.decodeUnknownOption(taskHistoryLiveRowsSchema);
  const historyTxWaits = new Map<string, TxWait>();

  function followHistory(taskId: string, answers: HeldAnswers<DescriptionRevisionsAnswer>) {
    const userId = dependencies.accountId();
    let handed: TxWait | undefined;
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
        Effect.sync(() =>
          page === undefined
            ? answers.unanswered()
            : answers.answered(withNewestPage(answers.rows(), page)),
        ),
      onTxWait: (wait) => {
        if (wait !== undefined) {
          handed = wait;
          historyTxWaits.set(taskId, wait);
        } else if (historyTxWaits.get(taskId) === handed) historyTxWaits.delete(taskId);
      },
    });
  }

  const heldHistories = yield* heldSlice<typeof LIVE_READ.HISTORY, string>({
    empty: NO_KEYS_HELD,
    path: (taskId) => [taskId],
    gate,
    follow: followHistory,
    tell: (held) => kernel.emit(GATEWAY_EVENT.HISTORIES_CHANGED, carried(held)),
  });
  const historyHolds = yield* FiberMap.make<string>();

  const decodeBrowserTabs = Schema.decodeUnknownOption(taskBrowserTabsLiveRowsSchema);

  function followBrowserTabs(
    owner: BrowserTabsOwnerKey,
    answers: HeldAnswers<readonly AgentBrowserTab[]>,
  ) {
    type Rows = typeof taskBrowserTabsLiveRowsSchema.Type;
    const place = browserTabsPlaceOf(owner);
    const userId = dependencies.accountId();
    const tell = (rows: Rows, now: number) => answers.answered(browserTabsOfLiveRows(rows, now));
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
          publish: (rows) =>
            Effect.sync(() => {
              if (rows === undefined) answers.unanswered();
              else Queue.offerUnsafe(delivered, rows);
            }),
        });
      }),
    );
  }

  const decodePages = Schema.decodeUnknownOption(taskPagesLiveRowsSchema);

  function followPages(owner: PageOwnerKey, answers: HeldAnswers<readonly PageLine[]>) {
    const place = pagePlaceOf(owner);
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
        Effect.sync(() => (pages === undefined ? answers.unanswered() : answers.answered(pages))),
    });
  }

  const heldPageReads = yield* heldSlice<typeof LIVE_READ.PAGES, PageOwnerKey>({
    empty: NO_PAGES,
    path: (owner) => [owner.kind, owner.id],
    gate,
    follow: followPages,
    tell: (pages) => kernel.emit(GATEWAY_EVENT.PAGES_CHANGED, carried(pages)),
  });
  const pageHolds = yield* FiberMap.make<PageOwnerKey>();

  const heldBrowserTabs = yield* heldSlice<typeof LIVE_READ.BROWSER_TABS, BrowserTabsOwnerKey>({
    empty: NO_BROWSER_TABS,
    path: (owner) => [owner.kind, owner.id],
    gate,
    follow: followBrowserTabs,
    tell: (tabs) => kernel.emit(GATEWAY_EVENT.BROWSER_TABS_CHANGED, carried(tabs)),
  });
  const browserTabsHolds = yield* FiberMap.make<BrowserTabsOwnerKey>();

  const comments = yield* descriptionCommentReads({
    pool: dependencies.pool,
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
    tell: (held) => kernel.emit(GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED, carried(held)),
  });
  const commentHolds = yield* FiberMap.make<CommentSubjectKey>();
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

  const documents = yield* descriptionDocumentReads({
    gate,
    accountId: dependencies.accountId,
    open: (taskId) => served(client.open(taskId)),
    recordLive: (taskId, userId, poll, after) =>
      served(client.recordLive(taskId, userId, poll, after)),
    listed: asListed,
    tell: (held) => kernel.emit(GATEWAY_EVENT.DESCRIPTION_DOCUMENTS_CHANGED, carried(held)),
  });
  const editWaits = yield* FiberMap.make<string>();

  function withoutAssignee<T extends { readonly assignee?: unknown }>(
    standing: T,
  ): Omit<T, "assignee"> {
    const { assignee: _assignee, ...rest } = standing;
    return rest;
  }

  const listFollow = yield* FiberHandle.make<void>();

  let listWait: TxWait | undefined;

  let resyncedAt: number | undefined;

  const listed = (txid: string | undefined): Effect.Effect<void> =>
    Effect.suspend(() => confirmWrite(listWait, txid));

  const planWrite = rowWriteOn<PlanRow>(dependencies.pool, PLAN);

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

  let listKeptAt: string | undefined;

  const resending = yield* FiberHandle.make<void>();
  const resendQueued = Effect.suspend(() =>
    dependencies.pool.queued().length === 0
      ? Effect.void
      : Effect.asVoid(
          FiberHandle.run(resending, dependencies.pool.resend, { onlyIfMissing: true }),
        ),
  );

  const followList = Effect.suspend(() => {
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
      take: (rows, standing) =>
        Effect.gen(function* () {
          view = { ...view, listStatus: TASKS_READ.READY, live: HOST_LIVE.LIVE };
          const entities = dependencies.entities();
          const { collections } = taskList;
          const moved = yield* collections.answer(rows, standing);
          publish();
          if (entities !== undefined && standing !== undefined) {
            const kept = { rows: collections.synced(), at: standing.next };
            yield* moved
              ? entities.keep(KEPT_READ.TASK_LIST, kept)
              : entities.keepUnmoved(KEPT_READ.TASK_LIST, kept);
          }
          yield* resendQueued;
        }),
      failed: () => write({ listStatus: TASKS_READ.FAILED, live: HOST_LIVE.OFFLINE }),
      behind: () => write({ live: HOST_LIVE.CATCHING_UP }),
      onTxWait: (wait) => {
        listWait = wait;
      },
    });
  });

  const resealList = Effect.gen(function* () {
    if (!gate() || Option.isNone(yield* FiberHandle.get(listFollow))) return;
    resyncedAt = yield* Clock.currentTimeMillis;
    yield* FiberHandle.run(listFollow, followList);
  });

  const workspacesFollow = yield* FiberHandle.make<void>();

  let photos: AppWorkspacePhotos = NO_KEYS_HELD;
  const photoFetches = yield* FiberMap.make<string>();
  const photosAsked = new Map<string, string>();
  const tellPhotos = (next: AppWorkspacePhotos) => {
    photos = next;
    kernel.emit(GATEWAY_EVENT.WORKSPACE_PHOTOS_CHANGED, carried(photos));
  };
  const photoFetched = (workspaceId: string, version: string) =>
    Effect.gen(function* () {
      const photo = yield* served(client.workspaces.photo(workspaceId));
      if (photosAsked.get(workspaceId) === version) photosAsked.delete(workspaceId);
      if (!photo.ok) return;
      const url = `data:${photo.answer.contentType};base64,${photo.answer.base64}`;
      tellPhotos({ ...photos, [workspaceId]: { rows: { version, url } } });
    });
  const photosListed = Effect.suspend(() => {
    if (!gate()) return Effect.void;
    const listed = new Map<string, string>();
    for (const each of view.workspaces) {
      if (each.photoVersion !== undefined) listed.set(each.id, each.photoVersion);
    }
    const held = Object.entries(photos).filter(
      ([workspaceId, read]) => listed.get(workspaceId) === read.rows?.version,
    );
    if (held.length !== Object.keys(photos).length) tellPhotos(Object.fromEntries(held));
    return Effect.gen(function* () {
      for (const workspaceId of [...photosAsked.keys()]) {
        if (listed.has(workspaceId)) continue;
        photosAsked.delete(workspaceId);
        yield* FiberMap.remove(photoFetches, workspaceId);
      }
      for (const [workspaceId, version] of listed) {
        if (photos[workspaceId]?.rows?.version === version) continue;
        if (photosAsked.get(workspaceId) === version) continue;
        photosAsked.set(workspaceId, version);
        yield* FiberMap.run(photoFetches, workspaceId, photoFetched(workspaceId, version));
      }
    });
  });

  const openWorkspaces = Effect.gen(function* () {
    const scope = yield* Scope.make();
    const rows = yield* Scope.provide(scope)(
      workspaceRows({
        pool: dependencies.pool,
        draw: (workspaces) =>
          Effect.andThen(
            Effect.sync(() => write({ workspaces })),
            photosListed,
          ),
      }),
    );
    return { scope, rows };
  });
  let workspaceList = yield* openWorkspaces;
  yield* Effect.addFinalizer(() => Scope.close(workspaceList.scope, Exit.void));

  const followWorkspaces = Effect.gen(function* () {
    const failed = view.workspacesStatus === TASKS_READ.FAILED;
    if (view.workspacesStatus !== TASKS_READ.READY) {
      write({ workspacesStatus: TASKS_READ.READING });
    }
    const userId = dependencies.accountId();
    const seal = (poll: boolean, after?: string) =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : Effect.map(served(client.workspaces.live(userId, poll, after)), (sealed) =>
            "ok" in sealed ? (sealed.ok ? sealed.answer : { failure: sealed.failure }) : sealed,
          );
    const attempt = Effect.gen(function* () {
      const sealed = yield* seal(false);
      if ("failure" in sealed) return yield* Effect.fail(sealed.failure);
      const moves = workspacesMoves({ poll: (after) => seal(true, after) }, sealed);
      const gone = yield* Stream.runForEach(moves, (workspaces) =>
        Effect.gen(function* () {
          if (workspaces.length === 0) {
            write({ workspacesStatus: TASKS_READ.FAILED });
            return yield* new LiveBroken({ reason: "the account holds no workspace" });
          }
          const drawn = new Set(view.workspaces.map((each) => each.id));
          const installed = new Map(
            view.workspaces.map((each) => [
              each.id,
              JSON.stringify(each.githubInstallations ?? []),
            ]),
          );
          const reinstalled = new Set(
            workspaces
              .filter((each) => {
                const was = installed.get(each.id);
                return was !== undefined && was !== JSON.stringify(each.githubInstallations ?? []);
              })
              .map((each) => each.id),
          );
          const listed = new Set(workspaces.map((each) => each.id));
          if ([...drawn].some((id) => !listed.has(id))) yield* kept.clear;
          yield* workspaceList.rows.answer(workspaces);
          if (view.workspacesStatus !== TASKS_READ.READY) {
            write({ workspacesStatus: TASKS_READ.READY });
          }
          yield* dependencies.entities()?.keep(KEPT_READ.WORKSPACES, workspaces) ?? Effect.void;
          if (reinstalled.size > 0) yield* repositoriesMovedIn(reinstalled);
        }),
      ).pipe(
        Effect.as(false),
        Effect.catch((broken) => Effect.succeed(broken.reason === LIVE_GONE)),
      );
      return yield* Effect.fail(gone ? LIVE_SIGNED_OUT.failure : WORKSPACE_CALL_FAILURE.UNANSWERED);
    });
    const followed = attempt.pipe(
      Effect.retry({
        schedule: FOLLOW_BACKOFF,
        while: (why) => why !== LIVE_SIGNED_OUT.failure && gate(),
      }),
      Effect.ignore,
    );
    yield* FiberHandle.run(workspacesFollow, followed, { onlyIfMissing: !failed });
  });

  function workspaceSeal<Answer>(
    seal: (
      userId: string,
      poll: boolean,
      after: string | undefined,
    ) => Effect.Effect<
      WorkspaceCallResult<Answer> | typeof LIVE_SIGNED_OUT,
      never,
      HttpClient.HttpClient
    >,
  ): (
    poll: boolean,
    after?: string,
  ) => Effect.Effect<Answer | { readonly failure: string; readonly gone: boolean }> {
    const userId = dependencies.accountId();
    return (poll, after) =>
      gate() && userId !== undefined
        ? Effect.map(served(seal(userId, poll, after)), (sealed) => {
            if (!("ok" in sealed)) return { ...sealed, gone: true };
            if (sealed.ok) return sealed.answer;
            return {
              failure: sealed.failure,
              gone:
                sealed.failure === WORKSPACE_CALL_FAILURE.NOT_FOUND ||
                sealed.failure === WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
            };
          })
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true });
  }

  const membersReads = yield* workspaceMembersReads({
    gate,
    seal: (workspaceId) =>
      workspaceSeal((userId, poll, after) =>
        client.workspaces.peopleLive(workspaceId, userId, poll, after),
      ),
    tell: (held) => kernel.emit(GATEWAY_EVENT.WORKSPACE_MEMBERS_CHANGED, carried(held)),
    pool: dependencies.pool,
    entities: dependencies.entities,
  });
  const memberHolds = yield* FiberMap.make<string>();

  let tokenRepositoriesFetched: AppTokenRepositories = NO_KEYS_HELD;
  const tellTokenRepositories = (): void =>
    kernel.emit(
      GATEWAY_EVENT.TOKEN_REPOSITORIES_CHANGED,
      carried(tokenRepositoryWritten.drawn(tokenRepositoriesFetched)),
    );
  const tokenRepositories = yield* heldFetch<typeof LIVE_READ.TOKEN_REPOSITORIES, string>({
    empty: NO_KEYS_HELD,
    path: (workspaceId) => [workspaceId],
    gate,
    focus: dependencies.focus,
    fetch: (workspaceId) =>
      Effect.map(served(client.workspaces.tokenRepositories(workspaceId)), (listed) =>
        listed.ok ? Option.some(listed.answer) : Option.none(),
      ),
    tell: (held: AppTokenRepositories) => {
      tokenRepositoriesFetched = held;
      tellTokenRepositories();
    },
  });
  const tokenRepositoryHolds = yield* FiberMap.make<string>();
  const tokenRepositoryWritten: TokenRepositoryWrites = yield* tokenRepositoryWrites({
    pool: dependencies.pool,
    fetched: () => tokenRepositoriesFetched,
    tell: Effect.sync(() => tellTokenRepositories()),
    answered: (workspaceId, repositories) =>
      Effect.andThen(
        tokenRepositories.answered(workspaceId, repositories),
        repositoriesMovedIn(new Set([workspaceId])),
      ),
  });
  const tokenRepositorySet = tokenRepositoryWritten.set<WireValue>(
    ({ workspaceId, repository, added }) =>
      gate()
        ? Effect.gen(function* () {
            const changed = yield* served(
              client.workspaces.setTokenRepository(workspaceId, repository, added),
            );
            if (!changed.ok) {
              return {
                refused: carried<TasksWorkspaceTokenRepositoriesAnswer>({
                  failure: changed.failure,
                }),
              };
            }
            return {
              answer: carried<TasksWorkspaceTokenRepositoriesAnswer>({
                repositories: changed.answer,
              }),
              repositories: changed.answer,
            };
          })
        : Effect.succeed({
            refused: carried<TasksWorkspaceTokenRepositoriesAnswer>(WORKSPACE_UNANSWERED),
          }),
    carried<TasksWorkspaceTokenRepositoriesAnswer>(WORKSPACE_UNANSWERED),
  );

  const slackBotOf = (
    answer: WorkspaceCallResult<WorkspaceSlackBot>,
  ): TasksWorkspaceSlackBotAnswer =>
    answer.ok ? { slackBot: answer.answer } : { failure: answer.failure };

  const slackChannels = yield* heldFetch<typeof LIVE_READ.SLACK_CHANNELS, string>({
    empty: NO_KEYS_HELD,
    path: (workspaceId) => [workspaceId],
    gate,
    focus: dependencies.focus,
    fetch: (workspaceId) =>
      gate()
        ? Effect.map(served(client.workspaces.slackBot(workspaceId)), (read) => {
            if (!read.ok) return Option.none();
            if (read.answer.team === undefined) return Option.some([]);
            return Option.fromNullishOr(read.answer.channels).pipe(
              Option.map((channels) => channels.map(listedChannel)),
            );
          })
        : Effect.succeed(Option.none()),
    tell: (held) => kernel.emit(GATEWAY_EVENT.SLACK_CHANNELS_CHANGED, carried(held)),
  });
  const channelHolds = yield* FiberMap.make<string>();

  const integrations = yield* heldWorkspaceIntegrations({
    seal: (workspaceId, userId, poll, after) =>
      gate()
        ? Effect.map(
            served(client.workspaces.integrationsLive(workspaceId, userId, poll, after)),
            (sealed) => {
              if (!("ok" in sealed)) return { ...sealed, gone: true };
              if (sealed.ok) return sealed.answer;
              return {
                failure: sealed.failure,
                gone: sealed.failure === WORKSPACE_CALL_FAILURE.NOT_FOUND,
              };
            },
          )
        : Effect.succeed({ ...LIVE_SIGNED_OUT, gone: true }),
    accountId: dependencies.accountId,
    gate,
    pool: dependencies.pool,
    slackMoved: (workspaceId) => slackChannels.wake((held) => held === workspaceId),
    tell: (held) => kernel.emit(GATEWAY_EVENT.WORKSPACE_INTEGRATIONS_CHANGED, carried(held)),
  });
  const integrationHolds = yield* FiberMap.make<string>();

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

  const invitationsReads = yield* workspaceInvitationsReads({
    gate,
    seal: (workspaceId) =>
      workspaceSeal((userId, poll, after) =>
        client.workspaces.invitationsLive(workspaceId, userId, poll, after),
      ),
    tell: (held) => kernel.emit(GATEWAY_EVENT.WORKSPACE_INVITATIONS_CHANGED, carried(held)),
    pool: dependencies.pool,
    entities: dependencies.entities,
  });
  const invitationHolds = yield* FiberMap.make<string>();

  function memberWritten(
    call: Effect.Effect<
      WorkspaceCallResult<readonly WorkspaceMember[]>,
      never,
      HttpClient.HttpClient
    >,
    userIds: readonly string[],
  ): Effect.Effect<MemberWritten<WireValue>> {
    if (!gate()) {
      return Effect.succeed({
        refused: carried<TasksWorkspaceMembersAnswer>(WORKSPACE_UNANSWERED),
      });
    }
    return Effect.map(workspaceCall(call), (written) =>
      written.ok
        ? {
            answer: carried<TasksWorkspaceMembersAnswer>({ members: written.answer }),
            moved: membersMoved(written.answer, userIds),
          }
        : { refused: carried<TasksWorkspaceMembersAnswer>({ failure: written.failure }) },
    );
  }

  const memberRoleChanged = membersReads.write<TasksWorkspaceMemberRoleParams, WireValue>({
    workspaceId: ({ workspaceId }) => workspaceId,
    moves: ({ userId, role }) => [{ userId, role }],
    send: ({ workspaceId, userId, role }) =>
      memberWritten(client.workspaces.changeRole(workspaceId, userId, role), [userId]),
  });

  const memberRemoved = membersReads.write<TasksWorkspaceMemberRemoveParams, WireValue>({
    workspaceId: ({ workspaceId }) => workspaceId,
    moves: ({ userId }) => [{ userId, gone: true }],
    send: ({ workspaceId, userId }) =>
      memberWritten(client.workspaces.removeMember(workspaceId, userId), [userId]),
  });

  const invitationCanceled = invitationsReads.cancel<WireValue>(({ workspaceId, invitationId }) =>
    gate()
      ? Effect.map(
          served(client.workspaces.cancelInvitation(workspaceId, invitationId)),
          (pending) =>
            pending.ok
              ? {
                  answer: carried<TasksWorkspaceInvitationsAnswer>({ invitations: pending.answer }),
                }
              : { refused: carried<TasksWorkspaceInvitationsAnswer>({ failure: pending.failure }) },
        )
      : Effect.succeed({ refused: carried<TasksWorkspaceInvitationsAnswer>(WORKSPACE_UNANSWERED) }),
  );

  let githubAskedAt: number | undefined;
  let githubRead = 0;

  const readGithub = Effect.gen(function* () {
    githubRead += 1;
    const read = githubRead;
    githubAskedAt = yield* Clock.currentTimeMillis;
    const status = yield* served(client.github.status());
    if (read === githubRead && status.ok) write({ github: status.answer });
  });

  const readGithubWhenStale = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const fresh =
      githubAskedAt !== undefined && now - githubAskedAt < Duration.toMillis(GITHUB_READ_EVERY);
    if (!fresh) yield* readGithub;
  });

  const sidebarFollow = yield* FiberHandle.make<void>();
  let sidebarTxWait: TxWait | undefined;

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
  let sidebarAnswered = false;
  const sidebarWritten = sidebarWrites({
    gate,
    pinRepository: (repository, pinned, key) =>
      serial(served(client.pinRepository(repository, pinned, key))),
    writeSection: (each, key) => serial(served(client.writeTaskSection(each, key))),
    collections: () => sidebar.collections,
  });

  const followSidebar = Effect.gen(function* () {
    const userId = dependencies.accountId();
    const seal = (poll: boolean, after?: string) =>
      userId === undefined
        ? Effect.succeed(LIVE_SIGNED_OUT)
        : Effect.map(served(client.sidebarLive(userId, poll, after)), (sealed) =>
            sealed.ok ? sealed.answer : { failure: sealed.failure },
          );
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

  const drawnFromDisk = Effect.gen(function* () {
    const entities = dependencies.entities();
    if (entities === undefined) return;
    const list = entities.stored(KEPT_READ.TASK_LIST);
    if (list !== undefined && view.listStatus !== TASKS_READ.READY) {
      listKeptAt = list.at;
      view = { ...view, listStatus: TASKS_READ.READY };
      yield* taskList.collections.answer(list.rows, { past: undefined, next: list.at, gone: [] });
    }
    const sidebarRows = entities.stored(KEPT_READ.SIDEBAR);
    if (sidebarRows !== undefined && !sidebarAnswered) {
      yield* sidebar.collections.answer(sidebarRows);
    }
    const workspaces = entities.stored(KEPT_READ.WORKSPACES);
    if (
      workspaces !== undefined &&
      workspaces.length > 0 &&
      view.workspacesStatus !== TASKS_READ.READY
    ) {
      yield* workspaceList.rows.answer(workspaces);
      write({ workspacesStatus: TASKS_READ.READY });
    }
  });

  const followAccount = Effect.gen(function* () {
    if (view.listStatus === TASKS_READ.IDLE) write({ listStatus: TASKS_READ.READING });
    yield* FiberHandle.run(listFollow, followList, { onlyIfMissing: true });
    yield* followWorkspaces;
    yield* followSidebar;
  });

  const githubOpened = yield* FiberHandle.make<void>();

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

  function blocksNow(taskId: string): boolean {
    const blocker = view.tasks.find((row) => row.id === taskId);
    return blocker?.status === undefined || !FINISHED.has(blocker.status);
  }

  function listedName(userId: string): string | undefined {
    for (const row of view.tasks) {
      if (row.createdBy?.userId === userId) return row.createdBy.name;
      if (row.assignee?.userId === userId) return row.assignee.name;
    }
    return undefined;
  }

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

  function startOpened(taskId: string): Effect.Effect<StartOpened> {
    return Effect.gen(function* () {
      screenAsks += 1;
      const opened = { asked: screenAsks, before: view.activeTaskId };
      const listed = view.tasks.find((row) => row.id === taskId);
      if (listed === undefined) return { ...opened, drawn: false };
      const { agents: _agents, ...row } = listed;
      yield* documents.started({ ...row, document: EMPTY_DESCRIPTION });
      write({ activeTaskId: taskId });
      return { ...opened, drawn: true };
    });
  }

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

  function startedAs(opened: StartOpened, task: Task): Effect.Effect<void> {
    return Effect.gen(function* () {
      if (screenAsks !== opened.asked && view.activeTaskId !== task.id) return;
      yield* documents.started(task);
      if (opened.drawn) yield* documents.retry(task.id);
      write({ activeTaskId: task.id });
    });
  }

  function heldOverList(
    taskId: string,
    fields: Partial<PlanRow> | typeof ROW_GONE,
    txid: string | undefined,
  ): Effect.Effect<void> {
    return planWrite(taskId, () => fields, Effect.succeed({ answer: undefined, txid, fields }));
  }

  function takeAnswered(task: Task): {
    readonly taskId: string;
    readonly fields: Partial<PlanRow>;
  } {
    documentTook(task.id, task, (held) => ({ ...withoutAssignee(held), ...task }));
    return { taskId: task.id, fields: planFieldsOf(task) };
  }

  function documentTook(taskId: string, answered: Task, lay: (held: Task) => Task): void {
    documents.written(taskId, (held) => (held === undefined ? answered : lay(held)));
  }

  function marksOf(task: Pick<Task, "pinnedAt" | "pinPosition">): TaskMarkStamps {
    return {
      ...(task.pinnedAt === undefined ? undefined : { pinnedAt: task.pinnedAt }),
      ...(task.pinPosition === undefined ? undefined : { pinPosition: task.pinPosition }),
    };
  }

  function withMarksOf(task: Task, marked: Pick<Task, "pinnedAt" | "pinPosition">): Task {
    const { pinnedAt: _pinned, pinPosition: _position, ...kept } = task;
    return { ...kept, ...marksOf(marked) };
  }

  function takeMarks(task: Task): void {
    documents.written(task.id, (held) =>
      held === undefined ? undefined : withMarksOf(held, task),
    );
  }

  function workspaceCall<Answer>(
    call: Effect.Effect<WorkspaceCallResult<Answer>, never, HttpClient.HttpClient>,
  ): Effect.Effect<WorkspaceCallResult<Answer>> {
    return served(call);
  }

  function workspaceWritten(
    call: Effect.Effect<WorkspaceCallResult<Workspace>, never, HttpClient.HttpClient>,
  ): Effect.Effect<WorkspaceWritten<WireValue>> {
    if (!gate()) {
      return Effect.succeed({ refused: carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED) });
    }
    return Effect.map(served(call), (written) =>
      written.ok
        ? {
            answer: carried<TasksWorkspaceAnswer>({ workspace: written.answer }),
            workspace: written.answer,
          }
        : { refused: carried<TasksWorkspaceAnswer>({ failure: written.failure }) },
    );
  }

  const workspaceRenamed = workspaceWrite<TasksWorkspaceRenameParams & AskedOver, WireValue>({
    workspaceId: ({ workspaceId }) => workspaceId,
    change:
      ({ name }) =>
      (row) => ({ ...row, name }),
    send: ({ workspaceId, name }) => workspaceWritten(client.workspaces.rename(workspaceId, name)),
    unsent: carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED),
  });

  const workspaceSlugSet = workspaceWrite<TasksWorkspaceSlugSetParams & AskedOver, WireValue>({
    workspaceId: ({ workspaceId }) => workspaceId,
    change:
      ({ slug }) =>
      (row) => ({ ...row, slug }),
    send: ({ workspaceId, slug }) => workspaceWritten(client.workspaces.setSlug(workspaceId, slug)),
    unsent: carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED),
  });

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
    send: ({ taskId, name }, { key }) =>
      gate()
        ? serial(
            Effect.gen(function* () {
              const renamedAs = yield* served(client.rename(taskId, { name }, key));
              if (!renamedAs.ok) {
                return untaken(renamedAs.failure, {
                  kept: { renamed: true },
                  refused: { renamed: false },
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
                answer: { renamed: true },
                txid: written.txid,
                taken: () => planFieldsOf(answered),
              };
            }),
          )
        : Effect.succeed({ refused: { renamed: false } }),
    queue: {
      name: GATEWAY_METHOD.TASKS_RENAME,
      input: tasksRenameParamsSchema,
      queued: () => ({ renamed: true }),
    },
  };

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
                  kept: { changed: true },
                  refused: { changed: false },
                });
              }
              const answered = stoodAs.answer;
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
    queue: {
      name: GATEWAY_METHOD.TASKS_SET_STANDING,
      input: tasksSetStandingParamsSchema,
      queued: () => ({ changed: true }),
    },
  };

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
                  kept: { changed: true },
                  refused: { changed: false },
                });
              }
              const marked = markedAs.answer;
              takeMarks(marked.task);
              return {
                answer: { changed: true },
                txid: marked.txid,
                taken: () => planFieldsOf(marked.task),
              };
            }),
          )
        : Effect.succeed({ refused: { changed: false } }),
    queue: {
      name: GATEWAY_METHOD.TASKS_PIN,
      input: tasksPinParamsSchema,
      queued: () => ({ changed: true }),
    },
  };

  const markedRead: WriteDeclaration<
    PlanRow,
    FieldChange<PlanRow>,
    TasksMarkReadParams,
    { readonly changed: boolean }
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
                  kept: { changed: true },
                  refused: { changed: false },
                });
              }
              const marked = answered.answer;
              return {
                answer: { changed: true },
                txid: marked.txid,
                taken: () => readMarkOf(marked.task),
              };
            }),
          )
        : Effect.succeed({ refused: { changed: false } }),
    queue: {
      name: GATEWAY_METHOD.TASKS_MARK_READ,
      input: tasksMarkReadParamsSchema,
      queued: () => ({ changed: true }),
    },
  };

  const started: WriteDeclaration<PlanRow, FieldChange<PlanRow>, Start, WireValue> = {
    kind: PLAN,
    keys: ({ request, row }) => (row === undefined ? [] : [request.id]),
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
                  if (went === WRITE_UNTAKEN.ALREADY_WRITTEN) {
                    if (opened?.drawn === true && view.activeTaskId === id) {
                      yield* documents.retry(id);
                    }
                  } else if (opened !== undefined && !waits) yield* startedBack(opened, id);
                  return untaken<FieldChange<PlanRow>, WireValue>(went, {
                    kept: carried<TasksStartAnswer>({ planId: id }),
                    refused: carried<TasksStartAnswer>({
                      failure,
                      ...(localAgentRefusal === undefined ? undefined : { localAgentRefusal }),
                      ...(cause === undefined ? undefined : { cause }),
                    }),
                  });
                }
                const { task, agent, txid } = created.answer;
                if (opened !== undefined) yield* startedAs(opened, task);
                const row = planRowOf(task);
                return {
                  answer: carried<TasksStartAnswer>({
                    planId: task.id,
                    ...(agent === undefined ? undefined : { agentStart: agent }),
                  }),
                  txid,
                  ...(row === undefined ? undefined : { taken: { made: row } }),
                };
              }),
            );
          })
        : Effect.succeed({
            refused: carried<TasksStartAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED }),
          }),
    queue: {
      name: GATEWAY_METHOD.TASKS_START,
      input: startKeptSchema,
      queued: ({ request }) => carried<TasksStartAnswer>({ planId: request.id }),
      holds: ({ request }) => request.agent !== undefined,
    },
  };

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

  const repositorySet = taskChanged({
    keys: ({ taskId }: TasksSetRepositoryParams) => [taskId],
    drawn:
      ({ repository }) =>
      () => ({ repository }),
    call: ({ taskId, repository }) => client.setRepository(taskId, repository),
    answered: (task) => carried<TasksSetRepositoryAnswer>({ repository: task.repository }),
    refused: (failure) => carried<TasksSetRepositoryAnswer>({ failure }),
  });

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
    [GATEWAY_METHOD.TASKS_REFRESH]: () =>
      Effect.gen(function* () {
        if (!gate()) return {};
        yield* followAccount;
        yield* readGithubWhenStale;
        return {};
      }),
    [GATEWAY_METHOD.TASKS_RESYNC]: () =>
      Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis;
        if (resyncedAt !== undefined && at - resyncedAt < Duration.toMillis(RESYNC_SETTLE)) {
          return {};
        }
        yield* resealList;
        return {};
      }),
    [GATEWAY_METHOD.TASKS_REGAINED]: () =>
      Effect.gen(function* () {
        yield* dependencies.focus.raise;
        yield* resealList;
        return {};
      }),
    [GATEWAY_METHOD.TASKS_OFFLINE_REFUSED_CLEAR]: () =>
      Effect.sync(() => {
        dependencies.offlineRefused.clear();
        return {};
      }),
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
        const held = MutableHashMap.get(heldSkills, key);
        const read = yield* skillsRead(key);
        const answer = Option.isSome(held) ? held.value : yield* Fiber.join(read);
        return carried<TasksSkillsAnswer>(answer ?? { failure: TASK_CALL_FAILURE.UNANSWERED });
      }),
    [GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const link = new LinkStandingKey(
          yield* readParams(
            tasksLinkStandingParamsSchema,
            params,
            "following a link names the workspace it is read through and its address",
          ),
        );
        yield* FiberMap.run(
          linkHolds,
          link,
          Effect.scoped(Effect.andThen(linkStandings.hold(link), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_LINK_STANDING_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const link = yield* readParams(
          tasksLinkStandingParamsSchema,
          params,
          "letting a link go names the workspace it is read through and its address",
        );
        yield* FiberMap.remove(linkHolds, new LinkStandingKey(link));
        return {};
      }),
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
    [GATEWAY_METHOD.TASKS_REVISIONS]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksRevisionsParamsSchema,
          params,
          "reading a description's history names the task, and where an older page is read from",
        );
        if (!gate()) {
          return carried<TasksRevisionsAnswer>({ failure: TASK_CALL_FAILURE.UNANSWERED });
        }
        const { taskId, before } = read;
        const page = yield* served(client.readRevisions(taskId, before));
        const held = heldHistories.rowsOf(taskId);
        if (page !== undefined && before !== undefined && held !== undefined) {
          heldHistories.lay(taskId, withOlderPage(held, before, page));
        }
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
    [GATEWAY_METHOD.TASKS_PAGE]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksPageParamsSchema,
          params,
          "reading a page names a task or an agent, the page, and its version",
        );
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
    [GATEWAY_METHOD.TASKS_HISTORY_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskHistoryFollowSchema,
          params,
          "following a task's history names the task",
        );
        const { taskId } = read;
        yield* FiberMap.run(
          historyHolds,
          taskId,
          Effect.scoped(Effect.andThen(heldHistories.hold(taskId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskHistoryFollowSchema,
          params,
          "letting a task's history go names the task",
        );
        yield* FiberMap.remove(historyHolds, read.taskId);
        return {};
      }),
    [GATEWAY_METHOD.TASKS_HISTORY_RETRY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskHistoryFollowSchema,
          params,
          "reading a task's history again names the task",
        );
        if (gate()) yield* heldHistories.retry(read.taskId);
        return {};
      }),
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
    [GATEWAY_METHOD.TASKS_DOCUMENT_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskDocumentFollowSchema,
          params,
          "following a description names the task",
        );
        yield* documents.follow(read.taskId);
        return {};
      }),
    [GATEWAY_METHOD.TASKS_DOCUMENT_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskDocumentFollowSchema,
          params,
          "letting a description go names the task",
        );
        yield* documents.unfollow(read.taskId);
        return {};
      }),
    [GATEWAY_METHOD.TASKS_DOCUMENT_RETRY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          taskDocumentFollowSchema,
          params,
          "reading a description again names the task",
        );
        if (gate()) yield* documents.retry(read.taskId);
        return {};
      }),
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
          new DescriptionPictureKey({ planId: read.planId, attachmentId: read.attachmentId }),
          dependencies.accountId,
          served(client.readPicture(read.planId, read.attachmentId)),
          (answer) => ("base64" in answer ? answer : undefined),
        );
        return carried<TasksPictureAnswer>(picture);
      }),
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
    [GATEWAY_METHOD.TASKS_COMMENT_START]: declaredMethod(
      dependencies.pool,
      commentWrites.started,
      (params: WireRecord) =>
        readParams(
          tasksCommentStartParamsSchema,
          params,
          "starting a comment names a description and the thread",
        ),
    ),
    [GATEWAY_METHOD.TASKS_COMMENT_ACT]: declaredMethod(
      dependencies.pool,
      commentWrites.acted,
      (params: WireRecord) =>
        readParams(
          tasksCommentActParamsSchema,
          params,
          "changing a comment names a description, a thread, and what to do",
        ),
    ),
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
    [GATEWAY_METHOD.TASKS_CLOSE]: () =>
      Effect.gen(function* () {
        screenAsks += 1;
        yield* serial(Effect.sync(closeActive));
        return {};
      }),
    [GATEWAY_METHOD.TASKS_START]: declaredMethod(dependencies.pool, started, (params: WireRecord) =>
      Effect.map(
        readParams(
          tasksStartRequestSchema,
          params,
          "starting a task names it, and its repository where it has one",
        ),
        ({ quiet, ...asked }): Start => {
          const request = { ...asked, id: asked.id ?? kernel.createId() };
          return { request, quiet: quiet === true, row: gate() ? startedRow(request) : undefined };
        },
      ),
    ),
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
    [GATEWAY_METHOD.TASKS_MARK_READ]: declaredMethod(
      dependencies.pool,
      markedRead,
      (params: WireRecord) =>
        readParams(
          tasksMarkReadParamsSchema,
          params,
          "marking a task read names it and how its mark moves",
        ),
    ),
    [GATEWAY_METHOD.TASKS_PIN_REPOSITORY]: declaredMethod(
      dependencies.pool,
      sidebarWritten.pinned,
      (params: WireRecord) =>
        Effect.map(
          readParams(
            tasksPinRepositoryParamsSchema,
            params,
            "pinning a repository names it and whether it is pinned",
          ),
          (read) => ({ ...read, at: kernel.now() }),
        ),
    ),
    [GATEWAY_METHOD.TASKS_WRITE_SECTION]: declaredMethod(
      dependencies.pool,
      sidebarWritten.sectionsWritten,
      (params: WireRecord) =>
        Effect.map(
          readParams(
            tasksWriteSectionParamsSchema,
            params,
            "a change to the sections names what it changes",
          ),
          (read) => ({ ...read, ownerId: dependencies.accountId(), at: kernel.now() }),
        ),
    ),
    [GATEWAY_METHOD.TASKS_REPOSITORIES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const workspace = yield* repositoryScopeOf(params);
        yield* FiberMap.run(
          repositoryHolds,
          workspace,
          Effect.scoped(Effect.andThen(repositoryLists.hold(workspace), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.TASKS_REPOSITORIES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        yield* FiberMap.remove(repositoryHolds, yield* repositoryScopeOf(params));
        return {};
      }),
    [GATEWAY_METHOD.TASKS_REPOSITORIES_RETRY]: (params) =>
      Effect.gen(function* () {
        yield* repositoryLists.retry(yield* repositoryScopeOf(params));
        return {};
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
    [GATEWAY_METHOD.GITHUB_CONNECT]: () =>
      Effect.gen(function* () {
        if (!gate()) return carried<TasksGitHubPageAnswer>(GITHUB_PAGE_UNANSWERED);
        const page = yield* served(client.github.connect());
        githubAskedAt = undefined;
        return carried<TasksGitHubPageAnswer>(
          page.ok ? { url: page.answer.url } : GITHUB_PAGE_UNANSWERED,
        );
      }),
    [GATEWAY_METHOD.GITHUB_DISCONNECT]: () =>
      Effect.gen(function* () {
        if (!gate()) return carried<TasksGitHubDisconnectAnswer>(GITHUB_PAGE_UNANSWERED);
        const disconnected = yield* served(client.github.disconnect());
        githubAskedAt = undefined;
        yield* dependencies.githubMoved;
        if (!disconnected.ok) {
          return carried<TasksGitHubDisconnectAnswer>({ failure: disconnected.failure });
        }
        githubRead += 1;
        write({ github: disconnected.answer });
        return carried<TasksGitHubDisconnectAnswer>({ connection: disconnected.answer });
      }),
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
    [GATEWAY_METHOD.WORKSPACES_RENAME]: declaredMethod(
      dependencies.pool,
      workspaceRenamed,
      (params: WireRecord) =>
        Effect.map(
          readParams(
            tasksWorkspaceRenameParamsSchema,
            params,
            "renaming a workspace names it and its new name",
          ),
          (read) => ({ ...read, rows: workspaceList.rows }),
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_SLUG_SET]: declaredMethod(
      dependencies.pool,
      workspaceSlugSet,
      (params: WireRecord) =>
        Effect.map(
          readParams(
            tasksWorkspaceSlugSetParamsSchema,
            params,
            "changing a workspace's slug names it and its new slug",
          ),
          (read) => ({ ...read, rows: workspaceList.rows }),
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_PHOTO_SET]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspacePhotoSetParamsSchema,
          params,
          "setting a workspace's photo names it and a photo or none",
        );
        if (!gate()) return carried<TasksWorkspaceAnswer>(WORKSPACE_UNANSWERED);
        const { workspaceId, photo } = read;
        const written = yield* served(client.workspaces.setPhoto(workspaceId, photo));
        if (!written.ok) return carried<TasksWorkspaceAnswer>({ failure: written.failure });
        yield* workspaceList.rows.answered(written.answer);
        return carried<TasksWorkspaceAnswer>({ workspace: written.answer });
      }),
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
    [GATEWAY_METHOD.WORKSPACES_SENTRY_DISCONNECT]: declaredMethod(
      dependencies.pool,
      sentryDisconnect(({ workspaceId, installationId }) =>
        gate()
          ? Effect.map(
              served(client.workspaces.sentryDisconnect(workspaceId, installationId)),
              (sentry): TasksWorkspaceSentryAnswer =>
                sentry.ok ? { sentry: sentry.answer } : { failure: sentry.failure },
            )
          : Effect.succeed(WORKSPACE_UNANSWERED),
      ),
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceSentryDisconnectParamsSchema,
          params,
          "disconnecting Sentry names a workspace and an installation",
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_CONNECT]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "connecting the Slack bot names a workspace",
        );
        if (!gate()) return carried<TasksWorkspaceSlackBotAnswer>(WORKSPACE_UNANSWERED);
        const connected = yield* served(client.workspaces.slackBotConnect(read.workspaceId));
        if (connected.ok) yield* integrations.confirmed(read.workspaceId, connected.answer.txid);
        return slackBotAnswered(slackBotOf(connected));
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_DISCONNECT]: declaredMethod(
      dependencies.pool,
      slackBotDisconnect(({ workspaceId }) =>
        gate()
          ? Effect.map(served(client.workspaces.slackBotDisconnect(workspaceId)), slackBotOf)
          : Effect.succeed(WORKSPACE_UNANSWERED),
      ),
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceParamsSchema,
          params,
          "disconnecting the Slack bot names a workspace",
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_NOTIFICATIONS]: declaredMethod(
      dependencies.pool,
      slackNotificationsWritten(
        (write) =>
          gate()
            ? Effect.map(
                served(
                  client.workspaces.slackBotNotifications(write.workspaceId, write.notifications),
                ),
                slackBotOf,
              )
            : Effect.succeed(WORKSPACE_UNANSWERED),
        dependencies.accountId,
      ),
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceSlackBotNotificationsParamsSchema,
          params,
          "changing Slack notifications names a workspace and the switch",
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_REPOSITORY]: declaredMethod(
      dependencies.pool,
      slackBotRepository((repository) =>
        gate()
          ? Effect.map(served(client.workspaces.slackBotRepository(repository)), slackBotOf)
          : Effect.succeed(WORKSPACE_UNANSWERED),
      ),
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceSlackBotRepositoryParamsSchema,
          params,
          "naming the Slack bot's default repository names a workspace and a repository or none",
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_SLACK_BOT_CHANNEL]: declaredMethod(
      dependencies.pool,
      slackBotChannel(
        (channel) =>
          gate()
            ? Effect.map(served(client.workspaces.slackBotChannel(channel)), slackBotOf)
            : Effect.succeed(WORKSPACE_UNANSWERED),
        ({ workspaceId }, answer) => {
          if (!("slackBot" in answer)) return Effect.void;
          const { channels } = answer.slackBot;
          return channels === undefined
            ? slackChannels.wake((held) => held === workspaceId)
            : slackChannels.answered(workspaceId, channels.map(listedChannel));
        },
      ),
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceSlackBotChannelParamsSchema,
          params,
          "changing a Slack channel names a workspace, the channel, and what changes",
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "holding a workspace's integrations names the workspace",
        );
        yield* FiberMap.run(
          integrationHolds,
          workspaceId,
          Effect.scoped(Effect.andThen(integrations.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "letting a workspace's integrations go names the workspace",
        );
        yield* FiberMap.remove(integrationHolds, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_RETRY]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "reading a workspace's integrations again names the workspace",
        );
        yield* integrations.retry(workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_CHANNELS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "holding a workspace's Slack channels names the workspace",
        );
        yield* FiberMap.run(
          channelHolds,
          workspaceId,
          Effect.scoped(Effect.andThen(slackChannels.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_CHANNELS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "letting a workspace's Slack channels go names the workspace",
        );
        yield* FiberMap.remove(channelHolds, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_SLACK_CHANNELS_RETRY]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceParamsSchema,
          params,
          "asking a workspace's Slack channels again names the workspace",
        );
        yield* slackChannels.retry(workspaceId);
        return {};
      }),
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
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "holding a workspace's invitations names the workspace",
        );
        const { workspaceId } = read;
        yield* FiberMap.run(
          invitationHolds,
          workspaceId,
          Effect.scoped(Effect.andThen(invitationsReads.held.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "letting a workspace's invitations go names the workspace",
        );
        yield* FiberMap.remove(invitationHolds, read.workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATIONS_RETRY]: (params) =>
      Effect.gen(function* () {
        const read = yield* readParams(
          workspacePeopleFollowSchema,
          params,
          "reading a workspace's invitations again names the workspace",
        );
        yield* invitationsReads.held.retry(read.workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES_FOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceTokenRepositoriesParamsSchema,
          params,
          "holding a workspace's token repositories names the workspace",
        );
        yield* FiberMap.run(
          tokenRepositoryHolds,
          workspaceId,
          Effect.scoped(Effect.andThen(tokenRepositories.hold(workspaceId), Effect.never)),
          { onlyIfMissing: true },
        );
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES_UNFOLLOW]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceTokenRepositoriesParamsSchema,
          params,
          "letting a workspace's token repositories go names the workspace",
        );
        yield* FiberMap.remove(tokenRepositoryHolds, workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES_RETRY]: (params) =>
      Effect.gen(function* () {
        const { workspaceId } = yield* readParams(
          tasksWorkspaceTokenRepositoriesParamsSchema,
          params,
          "reading a workspace's token repositories again names the workspace",
        );
        yield* tokenRepositories.retry(workspaceId);
        return {};
      }),
    [GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORY_SET]: declaredMethod(
      dependencies.pool,
      tokenRepositorySet,
      (params: WireRecord) =>
        Effect.all({
          read: readParams(
            tasksWorkspaceTokenRepositorySetParamsSchema,
            params,
            "adding or removing a token repository names the workspace, the repository, and which",
          ),
          addedAt: Clock.currentTimeMillis,
        }).pipe(
          Effect.map(({ read, addedAt }) => ({
            ...read,
            addedBy: dependencies.accountId() ?? "",
            addedAt,
            session: tokenRepositoryWritten.session(),
          })),
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE]: declaredMethod(
      dependencies.pool,
      memberRemoved,
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceMemberRemoveParamsSchema,
          params,
          "removing a member names the workspace and the member",
        ),
    ),
    [GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE]: declaredMethod(
      dependencies.pool,
      memberRoleChanged,
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceMemberRoleParamsSchema,
          params,
          "changing a role names the workspace, the member, and the role",
        ),
    ),
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
        if (!made.ok) return carried<TasksWorkspaceInvitationAnswer>({ failure: made.failure });
        yield* invitationsReads.made(workspaceId, made.answer);
        return carried<TasksWorkspaceInvitationAnswer>({ invitation: made.answer });
      }),
    [GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL]: declaredMethod(
      dependencies.pool,
      invitationCanceled,
      (params: WireRecord) =>
        readParams(
          tasksWorkspaceInvitationCancelParamsSchema,
          params,
          "canceling an invitation names the workspace and the invitation",
        ),
    ),
  };

  return {
    methods,
    snapshot: () => view,
    open: Effect.gen(function* () {
      yield* heldPageReads.open;
      yield* heldBrowserTabs.open;
      yield* heldHistories.open;
      yield* comments.open;
      yield* linkStandings.open;
      yield* repositoryLists.open;
      yield* membersReads.held.open;
      yield* invitationsReads.held.open;
      yield* tokenRepositories.open;
      yield* integrations.open;
      yield* slackChannels.open;
      yield* documents.open;
      if (!gate()) return;
      yield* drawnFromDisk;
      yield* followAccount;
      yield* FiberHandle.run(githubOpened, readGithubWhenStale, { onlyIfMissing: true });
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
      yield* tokenRepositoryWritten.letGo;
      yield* Cache.invalidateAll(pullRequestReads);
      yield* Cache.invalidateAll(issueReads);
      yield* FiberMap.clear(skillsReads);
      MutableHashMap.clear(heldSkills);
      yield* heldPageReads.end;
      yield* heldBrowserTabs.end;
      yield* heldHistories.end;
      yield* comments.end;
      yield* linkStandings.end;
      yield* repositoryLists.end;
      yield* membersReads.held.end;
      yield* invitationsReads.held.end;
      yield* FiberMap.clear(photoFetches);
      photosAsked.clear();
      tellPhotos(NO_KEYS_HELD);
      yield* tokenRepositories.end;
      yield* integrations.end;
      yield* slackChannels.end;
      yield* FiberMap.clear(editWaits);
      yield* documents.end;
      yield* FiberHandle.clear(listFollow);
      yield* Scope.close(taskList.scope, Exit.void);
      taskList = yield* openTaskList;
      yield* FiberHandle.clear(workspacesFollow);
      yield* FiberHandle.clear(sidebarFollow);
      yield* FiberHandle.clear(githubOpened);
      yield* Scope.close(sidebar.scope, Exit.void);
      sidebar = yield* openSidebar;
      yield* Scope.close(workspaceList.scope, Exit.void);
      workspaceList = yield* openWorkspaces;
      sidebarAnswered = false;
      listKeptAt = undefined;
      yield* serial(
        Effect.sync(() => {
          githubAskedAt = undefined;
          githubRead += 1;
          view = idleView();
          publish();
        }),
      );
    }),
    lifetime: Effect.void,
  };
});
