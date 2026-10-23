import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  GITHUB_CONNECTION_CALL_FAILURE,
  type GitHubRepositoriesAnswer,
  type GitHubRepositoryIssueAnswer,
  type GitHubRepositoryPullRequestAnswer,
  type TaskCallResult,
  type TaskStarted,
  type TaskWritten,
  VOICE_SERVICE_FRAME,
  WORKSPACE_CALL_FAILURE,
} from "@luke/features";
import type { Board } from "@luke/features/board-wire";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import type { GitHubConnection } from "@luke/features/github-connection-wire";
import {
  type GitHubRepositoryIssuesAnswer,
  ISSUE_STATE,
  type RepositoryIssuesAsk,
} from "@luke/features/github-repositories-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import {
  LIVE_SIGNED_OUT,
  type TaskBoardLiveAnswer,
  type TaskBrowserTabsLiveAnswer,
  type TaskHistoryLiveAnswer,
  type TaskPagesLiveAnswer,
  type TaskRecordLiveAnswer,
} from "@luke/features/live-wire";
import {
  PAGE_SHOWER,
  type PageLine,
  type PageVersion,
  pagePlaceId,
} from "@luke/features/page-wire";
import { PICTURE_TYPE, type PictureType } from "@luke/features/picture-wire";
import {
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_ENTRY,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  type PlanCommentThread,
} from "@luke/features/plan-comment-wire";
import type { PlanEditAnswer } from "@luke/features/plan-edit";
import {
  TASK_ISSUE_LINK_REFUSAL,
  TASK_ISSUE_PROVIDER,
  TASK_ISSUE_RELATION,
  type TaskIssueLinkView,
} from "@luke/features/task-issue-wire";
import type { TaskListLiveAnswer } from "@luke/features/task-list-live";
import {
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import {
  PLAN_ACTOR,
  type PlanRevisionAnswer,
  type PlanRevisionsAnswer,
  type RepositoryPin,
  TASK_PRIORITY,
  TASK_SKILL_SOURCE,
  TASK_STATUS,
  type Task,
  type TaskAgentsSummary,
  type TaskFileAnswer,
  type TaskSkillsAnswer,
  type TaskTreeAnswer,
} from "@luke/features/task-wire";
import {
  BROWSER_TAB_OPEN_FAILURE,
  GITHUB_DISCONNECT_FAILURE,
  PICTURE_KEEP_FAILURE,
  type RepositoryCallFailure,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskCallFailure,
  type TaskShownCode,
  type TasksView,
  tasksViewSchema,
} from "@luke/features/tasks-view";
import type { WorkspaceInvitation } from "@luke/features/workspace-invitation-wire";
import type { WorkspacesLiveAnswer } from "@luke/features/workspace-live";
import {
  type FormerMember,
  WORKSPACE_PHOTO_TYPE,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
  type WorkspacePhotoType,
} from "@luke/features/workspace-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { TURN_STATUS, type WireRecord, type WireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { noNetwork } from "@luke/wire/testing";
import { Deferred, Duration, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { composeTasks, type TasksClient } from "./compose-tasks.js";
import type { LiveClient } from "./live-follow.js";
import { fakeRealtime as fakeServiceRealtime } from "./testing/fake-realtime.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SECTION_ID = "3c9e1a2b-4d5f-4a6b-8c7d-9e0f1a2b3c4d";
/** The text the edit tests' task opens on. */
const INVITES_TEXT = "# Teammate invitations";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function task(id: string, name: string, body: string, updatedAt: number): Task {
  return {
    id,
    workspaceId: "workspace-personal",
    name,
    createdAt: 1_000,
    updatedAt,
    repository: null,
    document: {
      body,
      assumptions: [{ text: "An invite expires after 7 days." }],
    },
  };
}

/** The instant the fake service stamps every pin with. */
const MARKED_AT = 5_000;

/** The service as a table of tasks the test edits between beats. */
interface FakeService extends TasksClient {
  tasks: Task[];
  /** Each task's comment threads, by task id, and every comment call asked, in order. */
  threads: Record<string, PlanCommentThread[]>;
  commentCalls: string[];
  /** What the list says of each task's coding agents, by task id; a task with none says nothing. */
  agents: Record<string, TaskAgentsSummary>;
  /** The agents with no plan the list carries beside the plans. */
  tasklessAgents: TasklessAgent[];
  /** What the service answers when the list is asked for sealed, to follow over Neon Realtime; sealed by default. */
  liveList: TaskCallResult<
    TaskListLiveAnswer,
    typeof TASK_CALL_FAILURE.UNANSWERED | typeof LIVE_SIGNED_OUT.failure
  >;
  /** How many times the list was asked for sealed. */
  liveListReads: number;
  /** Whether a delete is refused, as a service that did not answer refuses it. */
  deleteFails: boolean;
  createAnswer: TaskCallResult<TaskStarted, RepositoryCallFailure>;
  /** The repositories the account reaches, as the service answers them; a failure is the service refusing the read. */
  repositoriesAnswer: TaskCallResult<GitHubRepositoriesAnswer, typeof TASK_CALL_FAILURE.UNANSWERED>;
  /** Whether a repository is refused as one the App does not reach. */
  repositoryUnreachable: boolean;
  /** Every read the service answered, in order, so a test can see that nothing reads on a clock. */
  readonly reads: string[];
  /** Each task's board, by task id; a task with none answers no board, as a service that did not answer. */
  boards: Record<string, Board>;
  /** Each task's board sealed for following, by task id; a task with none is not found, as the service answers one the account does not reach. */
  boardSeals: Record<string, TaskBoardLiveAnswer>;
  /** Each task's pages and calls sealed for following, by task id; a task with none is not found, as the service answers one the account does not reach. */
  recordSeals: Record<string, TaskRecordLiveAnswer>;
  /** What the service seals for following each task's pages; none answers unanswered. */
  pageSeals: Record<string, TaskPagesLiveAnswer>;
  /** What the service seals for following each task's Browser tabs; none answers unanswered. */
  browserTabSeals: Record<string, TaskBrowserTabsLiveAnswer>;
  /** What the service seals for following each task's newest page of history; none answers unanswered. */
  historySeals: Record<string, TaskHistoryLiveAnswer>;
  /** Every read of a task's pages or transcript, in order, so a test can see which a followed mark moved. */
  readonly recordReads: string[];
  /** The image each task's last save carried, by task id, as the service keeps it beside the board. */
  readonly images: Record<string, string | undefined>;
  /** The transaction the next board save answers, as one that moved the board's live row; none answers no txid. */
  boardSaveTxid: string | undefined;
  /** Where set, a board save is held until it settles, as one still in flight. */
  boardSaveHeld: Deferred.Deferred<void> | undefined;
  /** Every code shown on each task as the service keeps it, by task id; a task with none answers nothing, as a service that did not answer. */
  codes: Record<string, readonly TaskShownCode[]>;
  /** What the service answers for each file's window, by path; a path with none answers nothing, as a service that did not answer. */
  files: Record<string, TaskFileAnswer>;
  /** What the service answers for each folder's listing, by path; a path with none answers nothing, as a service that did not answer. */
  folders: Record<string, TaskTreeAnswer>;
  /** What the service answers for each task's skills, by task id; a task with none answers nothing, as a service that did not answer. */
  skills: Record<string, TaskSkillsAnswer>;
  /** What the service answers of a repository a workspace reaches, read with no plan, by workspace id and then repository: its folders by path, and its skills. */
  places: Record<
    string,
    Record<string, { folders: Record<string, TaskTreeAnswer>; skills: TaskSkillsAnswer }>
  >;
  /** What the service answers for a repository's pull requests, by workspace id, then repository, then number; one with none answers nothing, as a service that did not answer. */
  pullRequests: Record<string, Record<string, Map<number, GitHubRepositoryPullRequestAnswer>>>;
  /** How many more pull request reads the service answers before it answers nothing, as GitHub refusing an App over its rate limit; none for no limit. And the gate a read waits on before it answers, where one is set. */
  pullRequestQuota: number | undefined;
  pullRequestGate: Deferred.Deferred<void> | undefined;
  /** What the service answers for a repository's issues, kept as its pull requests are. */
  issues: Record<string, Record<string, Map<number, GitHubRepositoryIssueAnswer>>>;
  /** What a repository's issues read answers, by workspace and repository, and each ask it heard. */
  repositoryIssues: Record<string, Record<string, GitHubRepositoryIssuesAnswer>>;
  issueAsks: RepositoryIssuesAsk[];
  /** Each task's linked issues, by task id; a task with none named is none the account reaches. */
  issueLinks: Record<string, TaskIssueLinkView[]>;
  /** The newest page of the history, for any task; none answers nothing, as a service that did not answer. */
  history: PlanRevisionsAnswer | undefined;
  /** The older pages of the history, by the revision each is read before. */
  olderHistory: Record<number, PlanRevisionsAnswer>;
  /** Each revision the service holds, by its number, which a restore puts back as the task's document. */
  revisions: Record<number, PlanRevisionAnswer["revision"]>;
  /** Every version of every page the service holds, for any task. */
  pages: PageVersion[];
  /** Each task's pages as the service lists them, by task id; a task with none answers nothing, as a service that did not answer. */
  pageLines: Record<string, readonly PageLine[]>;
  /** The plans' pictures the service holds, by plan and then by picture. */
  pictures: Map<string, Map<string, { contentType: PictureType; base64: string }>>;
  /** What an edit answers in place of a save, where a test sets one: a conflict or a refusal. */
  editAnswer: PlanEditAnswer | undefined;
  /** The account's pinned repositories, newest pinned first, as the service keeps them. */
  pins: RepositoryPin[];
  /** Whether the pins are refused, read and written alike, as a service that did not answer refuses them. */
  pinsFail: boolean;
  /** The account's sidebar sections as the service keeps them; none where it does not answer, as before any test sets them. */
  sections: TaskSections | undefined;
  /** Every change to the sections the service was asked for, in order. */
  sectionWrites: TaskSectionWrite[];
  /** The transaction a pin's or a section's write answers, where a test sets one; none as a write that changed no row. */
  sidebarTxid: string | undefined;
  /** The workspaces the account is a member of, as the service lists them. */
  memberships: Workspace[];
  /** The Luke GitHub App install address a connection answers. */
  installUrl: string;
  /** Whether the workspaces are not sealed, as a service that did not answer. */
  workspacesFail: boolean;
  /** Whether the service answers the workspaces' seals and polls as signed out, as a changed session does. */
  workspacesSignedOut: boolean;
  /** The name another Mac renames a workspace to just after this one's rename answers, where one does. */
  renamedAgain: string | undefined;
  /** What a rename's answer waits on once the store has moved, so a test can have the follow deliver first. */
  renameAnswered: Effect.Effect<void>;
  /** Whether Realtime misses the store's changes, telling none of them. */
  realtimeMisses: boolean;
  /** The transaction a task's rename answers it committed in, where it answers one. */
  renameTxid: string | undefined;
  /** Realtime as the service's deployment holds it: each subscription to the workspaces is told the table as it stands, and again on every change. */
  realtime: ReturnType<typeof fakeServiceRealtime>;
  /** Realtime's client as the host opens it at the workspaces' address, each subscription told the workspaces at once, as Realtime's first result. */
  openLive: (url: string) => LiveClient;
  /** Each workspace's members, by its id. */
  members: Record<string, WorkspaceMember[]>;
  /** Who each workspace's work names but left, as the service answers beside its members. */
  former: Record<string, FormerMember[]>;
  /** The Linear issues each workspace's connection reaches; a workspace absent has no Linear to read. */
  linearIssues: Record<string, LinearIssueSummary[]>;
  /** Each workspace's pending invitations, by its id. */
  invitations: Record<string, WorkspaceInvitation[]>;
  /** Each workspace's photo, by its id: its type and its bytes in base64; one with none is not found. */
  photos: Record<string, { contentType: WorkspacePhotoType; base64: string }>;
  /** Whether a write is refused as the account's role not allowing it. */
  notPermitted: boolean;
  /** The account's GitHub as the service last says it; none answers nothing, as a service that did not answer. */
  connection: GitHubConnection | undefined;
  /** Where a GitHub connection read waits before answering what it read, so a test can hold one on the wire. */
  githubGate: Effect.Effect<void>;
  /** The single-use pages the service hands out to connect GitHub, the newest last. */
  connectPages: string[];
}

const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  slug: "ada-lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  githubInstallations: [],
  memberCount: 1,
};
const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
  githubInstallations: [{ installationId: 7, login: "acme", active: true }],
  memberCount: 3,
};
/** A workspace's photo as the window sends it: a WebP's `data:` URL. */
const PHOTO_URL = "data:image/webp;base64,UklGRgAAAABXRUJQ";
const RELAY: Workspace = {
  id: "workspace-relay",
  name: "Relay Labs",
  slug: "relay-labs",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  githubInstallations: [],
  memberCount: 1,
};

/** The address the fake service seals the workspaces at, apart from any other read's. */
const WORKSPACES_URL = "wss://workspaces.example/v1";

/** The workspaces sealed for following, each part named by its capability, as `fakeRealtime` addresses it. */
const WORKSPACES_SEALED: WorkspacesLiveAnswer = {
  url: WORKSPACES_URL,
  queries: {
    workspaces: { capability: "capability-workspaces", queryFingerprint: "w", expiresAt: 1e15 },
    installations: {
      capability: "capability-installations",
      queryFingerprint: "i",
      expiresAt: 1e15,
    },
  },
};

/** A workspace's people sealed for following, each part named by its capability, as `fakeRealtime` addresses it. */
const PEOPLE_SEALED = {
  url: WORKSPACES_URL,
  queries: {
    members: { capability: "capability-members", queryFingerprint: "m", expiresAt: 1e15 },
    former: { capability: "capability-former", queryFingerprint: "f", expiresAt: 1e15 },
  },
};

/** The account's sidebar sealed for following, each part named by its capability, as `fakeRealtime` addresses it. */
const SIDEBAR_SEALED = {
  url: WORKSPACES_URL,
  queries: {
    sections: { capability: "capability-sections", queryFingerprint: "s", expiresAt: 1e15 },
    entries: { capability: "capability-entries", queryFingerprint: "e", expiresAt: 1e15 },
    agentEntries: {
      capability: "capability-agent-entries",
      queryFingerprint: "a",
      expiresAt: 1e15,
    },
    pins: { capability: "capability-pins", queryFingerprint: "p", expiresAt: 1e15 },
  },
};

/** The sidebar as its live statements' rows carry it: what the wire leaves out is null. */
function sidebarLiveRows(sections: TaskSections | undefined, pins: readonly RepositoryPin[]) {
  return {
    sections: (sections?.sections ?? []).map((section) => ({
      ...section,
      icon: section.icon ?? null,
      position: section.position ?? null,
    })),
    entries: (sections?.entries ?? []).map((entry) => ({
      ...entry,
      position: entry.position ?? null,
    })),
    agentEntries: (sections?.agentEntries ?? []).map((entry) => ({
      ...entry,
      position: entry.position ?? null,
    })),
    pins,
  };
}

/** A workspace's invitations sealed for following, with the origin each accept link is built on. */
const INVITATIONS_SEALED = {
  url: WORKSPACES_URL,
  origin: "https://luke.test",
  queries: {
    invitations: { capability: "capability-invitations", queryFingerprint: "v", expiresAt: 1e15 },
  },
};

/** The workspaces as the live statements' rows carry them, the account's own first one being Ada's. */
function workspacesLiveRows(workspaces: readonly Workspace[]) {
  return {
    workspaces: workspaces.map((each) => ({
      id: each.id,
      name: each.name,
      slug: each.slug ?? "",
      own: each.id === PERSONAL.id,
      personal: each.personal === true,
      role: each.role,
      linearActive: each.linear?.active ?? null,
      memberCount: each.memberCount ?? 1,
      photoVersion: each.photoVersion ?? null,
      ownerImage: null,
    })),
    installations: workspaces.flatMap((each) =>
      (each.githubInstallations ?? []).map((installation, linkedAt) => ({
        workspaceId: each.id,
        ...installation,
        linkedAt,
      })),
    ),
  };
}
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=intent-1";
const LINEAR_SIGN_IN_URL = "https://vercel.com/connect/authorize/fixture";
const ADA: WorkspaceMember = {
  userId: "user-ada",
  name: "Ada Lovelace",
  email: "ada@luke.test",
  role: WORKSPACE_ROLE.ADMIN,
};
const GRACE: WorkspaceMember = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@luke.test",
  role: WORKSPACE_ROLE.MEMBER,
};

const UNANSWERED_WORKSPACE = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;
const NOT_PERMITTED_WORKSPACE = {
  ok: false,
  failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
} as const;

/** The instant the fake service stamps every edit's save with. */
const EDITED_AT = 7_000;

function fakeService(tasks: Task[]): FakeService {
  const realtime = fakeServiceRealtime();
  let memberships: Workspace[] = [PERSONAL];
  /** Each part's rows as the workspaces stand, as Realtime would deliver them. */
  const rowsOf = (part: string) => {
    const rows = workspacesLiveRows(memberships);
    const sidebar = sidebarLiveRows(service.sections, service.pins);
    if (part === "capability-workspaces") return rows.workspaces;
    if (part === "capability-installations") return rows.installations;
    if (part === "capability-sections") return sidebar.sections;
    if (part === "capability-entries") return sidebar.entries;
    if (part === "capability-agent-entries") return sidebar.agentEntries;
    return part === "capability-pins" ? sidebar.pins : undefined;
  };
  /** The workspaces told to every subscription that stands, as Realtime tells a change. */
  let realtimeMisses = false;
  const pushWorkspaces = () => {
    if (realtimeMisses) return;
    if (!realtime.subscribed().includes("capability-workspaces")) return;
    const rows = workspacesLiveRows(memberships);
    realtime.deliver("workspaces", rows.workspaces);
    realtime.deliver("installations", rows.installations);
  };
  const service: FakeService = {
    tasks,
    threads: {},
    commentCalls: [],
    comments: (planId, after) =>
      Effect.sync(() => {
        service.commentCalls.push(`read:${planId}:${after}`);
        return { threads: service.threads[planId] ?? [], cursor: "c1" };
      }),
    // The service starts the thread as asked, the member its writer, and holds it on the plan.
    startComment: (planId, start) =>
      Effect.sync(() => {
        service.commentCalls.push(`start:${planId}:${start.quote}`);
        const thread: PlanCommentThread = {
          id: "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
          scope: start.scope,
          quote: start.quote,
          anchor: start.anchor,
          section: "Goal",
          status: PLAN_COMMENT_STATUS.OPEN,
          entries: [
            {
              id: "5f2b0c1e-8d3a-4c7b-9e6f-1a2b3c4d5e6f",
              kind: PLAN_COMMENT_ENTRY.COMMENT,
              writer: { actor: PLAN_COMMENT_ACTOR.MEMBER, by: { userId: "u1", name: "Dean" } },
              words: start.words,
              at: 1,
            },
          ],
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
        };
        service.threads[planId] = [...(service.threads[planId] ?? []), thread];
        return { thread };
      }),
    actOnComment: (planId, threadId, action) =>
      Effect.sync(() => {
        service.commentCalls.push(`act:${planId}:${threadId}:${action.action}`);
        return { deleted: threadId };
      }),
    agents: {},
    tasklessAgents: [],
    liveList: { ok: true, answer: SEALED_LIST },
    liveListReads: 0,
    deleteFails: false,
    createAnswer: { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED },
    repositoriesAnswer: { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED },
    repositoryUnreachable: false,
    reads: [],
    boards: {},
    boardSeals: {},
    recordSeals: {},
    pageSeals: {},
    browserTabSeals: {},
    historySeals: {},
    recordReads: [],
    images: {},
    boardSaveTxid: undefined,
    boardSaveHeld: undefined,
    codes: {},
    files: {},
    folders: {},
    skills: {},
    places: {},
    pullRequests: {},
    pullRequestQuota: undefined,
    pullRequestGate: undefined,
    issues: {},
    repositoryIssues: {},
    issueAsks: [],
    issueLinks: {},
    history: undefined,
    olderHistory: {},
    revisions: {},
    readRevisions: (_taskId, before) =>
      Effect.sync(() => (before === undefined ? service.history : service.olderHistory[before])),
    readRevision: (_taskId, seq) => Effect.sync(() => service.revisions[seq]),
    pages: [],
    pageLines: {},
    readPages: (place) =>
      Effect.sync(() => {
        service.recordReads.push("pages");
        return service.pageLines[pagePlaceId(place)];
      }),
    pictures: new Map(),
    // The service keeps a picture under the next id, and refuses one more where the plan holds two, a bound small enough to reach.
    keepPicture: (taskId, picture) =>
      Effect.sync(() => {
        const held = service.pictures.get(taskId) ?? new Map();
        service.pictures.set(taskId, held);
        if (held.size >= 2) return { failure: PICTURE_KEEP_FAILURE.TOO_MANY };
        const id = `kept-${held.size + 1}`;
        const [, base64 = ""] = picture.split(",");
        held.set(id, { contentType: PICTURE_TYPE.PNG, base64 });
        return { id };
      }),
    readPicture: (taskId, attachmentId) =>
      Effect.sync(
        () =>
          service.pictures.get(taskId)?.get(attachmentId) ?? {
            failure: TASK_CALL_FAILURE.NOT_FOUND,
          },
      ),
    readPageVersion: (_taskId, pageId, version) =>
      Effect.sync(() =>
        service.pages.find((page) => page.id === pageId && page.version === version),
      ),
    // The service puts the revision's document back and names the developer its last editor.
    restore: (taskId, seq) =>
      Effect.sync(() => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        const revision = service.revisions[seq];
        if (found === undefined || revision === undefined) return undefined;
        const restored: Task = {
          ...found,
          document: revision.document,
          updatedAt: found.updatedAt + 1,
          lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: found.updatedAt + 1, duringCall: false },
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? restored : candidate,
        );
        return { task: restored, txid: `txid-${seq}` };
      }),
    editAnswer: undefined,
    pins: [],
    pinsFail: false,
    sections: undefined,
    sectionWrites: [],
    sidebarTxid: undefined,
    get memberships() {
      return memberships;
    },
    set memberships(next) {
      memberships = next;
      pushWorkspaces();
    },
    get realtimeMisses() {
      return realtimeMisses;
    },
    set realtimeMisses(next) {
      realtimeMisses = next;
    },
    realtime,
    openLive: (url) => {
      const client = realtime.open(url);
      return {
        close: client.close,
        subscribe: (query) => {
          const subscription = client.subscribe(query);
          return {
            ...subscription,
            onChange: (listener) => {
              const off = subscription.onChange(listener);
              const rows = rowsOf(query.capability);
              if (rows !== undefined) listener({ status: "live", data: rows });
              return off;
            },
          };
        },
      };
    },
    installUrl: INSTALL_URL,
    workspacesFail: false,
    workspacesSignedOut: false,
    renamedAgain: undefined,
    renameAnswered: Effect.void,
    renameTxid: undefined,
    members: {},
    former: {},
    linearIssues: {},
    invitations: {},
    photos: {},
    notPermitted: false,
    connection: { connected: false, login: null },
    githubGate: Effect.void,
    connectPages: [],
    // Each connect is a fresh page bound to the account, as the service mints one.
    github: {
      // The service reads the connection when asked and answers it after the gate.
      status: () =>
        Effect.suspend(() => {
          const read = service.connection;
          return Effect.map(service.githubGate, () =>
            read === undefined
              ? { ok: false as const, failure: GITHUB_CONNECTION_CALL_FAILURE.UNANSWERED }
              : { ok: true as const, answer: read },
          );
        }),
      connect: () =>
        Effect.sync(() => {
          const url = `https://tryluke.dev/connect-github.html?intent=intent-${service.connectPages.length + 1}`;
          service.connectPages.push(url);
          return { ok: true as const, answer: { url } };
        }),
      // The service unlinks the session's GitHub and answers the connection as it then stands.
      disconnect: () =>
        Effect.sync(() => {
          service.reads.push("github-disconnect");
          if (service.notPermitted) {
            return { ok: false as const, failure: GITHUB_CONNECTION_CALL_FAILURE.NOT_PERMITTED };
          }
          service.connection = { connected: false, login: null };
          return { ok: true as const, answer: service.connection };
        }),
    },
    // The service answers an admin read with what it read, and stars any account.
    admin: {
      read: (params) =>
        Effect.sync(() => {
          service.reads.push(`admin:${params.procedure}`);
          return { answer: { procedure: params.procedure, query: params.query } };
        }),
      favorite: (id, favorite) =>
        Effect.sync(() => {
          service.reads.push(`admin-favorite:${id}:${favorite}`);
          return true;
        }),
    },
    // The service's workspaces as a table the test edits, each write moving it as the store does.
    workspaces: {
      tokenRepositories: () => Effect.succeed(UNANSWERED_WORKSPACE),
      setTokenRepository: () => Effect.succeed(UNANSWERED_WORKSPACE),
      // A workspace's invitations are sealed for an owner or an admin alone, as the service seals them.
      invitationsLive: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`invitations-live:${workspaceId}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          return { ok: true, answer: INVITATIONS_SEALED } as const;
        }),
      // A workspace's people are sealed for a member alone, as the service seals them.
      peopleLive: (workspaceId, _userId) =>
        Effect.sync(() => {
          service.reads.push(`people-live:${workspaceId}`);
          if (service.workspacesFail) return UNANSWERED_WORKSPACE;
          return service.members[workspaceId] === undefined
            ? ({ ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND } as const)
            : ({ ok: true, answer: PEOPLE_SEALED } as const);
        }),
      // A poll answers each part's rows inline, as the service answers one while Realtime fails it.
      live: (_userId, poll) =>
        Effect.sync(() => {
          service.reads.push(poll === true ? "workspaces-poll" : "workspaces-live");
          if (service.workspacesFail) return UNANSWERED_WORKSPACE;
          if (service.workspacesSignedOut)
            return { ok: false, failure: LIVE_SIGNED_OUT.failure } as const;
          if (poll !== true) return { ok: true, answer: WORKSPACES_SEALED } as const;
          const rows = workspacesLiveRows(service.memberships);
          const { workspaces, installations } = WORKSPACES_SEALED.queries;
          return {
            ok: true,
            answer: {
              ...WORKSPACES_SEALED,
              queries: {
                workspaces: { ...workspaces, rows: rows.workspaces },
                installations: { ...installations, rows: rows.installations },
              },
            },
          } as const;
        }),
      create: (name) =>
        Effect.sync(() => {
          service.reads.push(`create:${name}`);
          if (name !== RELAY.name) return UNANSWERED_WORKSPACE;
          service.memberships = [...service.memberships, RELAY];
          return { ok: true, answer: RELAY } as const;
        }),
      rename: (workspaceId, name) =>
        Effect.sync(() => {
          service.reads.push(`rename:${workspaceId}:${name}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const renamed = service.memberships.find((each) => each.id === workspaceId);
          if (renamed === undefined) return UNANSWERED_WORKSPACE;
          const now = { ...renamed, name };
          const again = service.renamedAgain;
          service.memberships = service.memberships.map((each) =>
            each.id !== workspaceId ? each : again === undefined ? now : { ...now, name: again },
          );
          return { ok: true, answer: now } as const;
        }).pipe(Effect.tap(() => service.renameAnswered)),
      // A photo set stands as its version, the photo's own text, and null takes the version away.
      setPhoto: (workspaceId, photo) =>
        Effect.sync(() => {
          service.reads.push(`photoSet:${workspaceId}:${photo ?? "none"}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const found = service.memberships.find((each) => each.id === workspaceId);
          if (found === undefined) return UNANSWERED_WORKSPACE;
          const { photoVersion: _replaced, ...rest } = found;
          const now = photo === null ? rest : { ...rest, photoVersion: photo };
          service.memberships = service.memberships.map((each) =>
            each.id === workspaceId ? now : each,
          );
          return { ok: true, answer: now } as const;
        }),
      githubConnect: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`connect:${workspaceId}`);
          return service.notPermitted
            ? NOT_PERMITTED_WORKSPACE
            : ({ ok: true, answer: service.installUrl } as const);
        }),
      githubDisconnect: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`disconnect:${workspaceId}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const disconnected = service.memberships.find((each) => each.id === workspaceId);
          if (disconnected === undefined) return UNANSWERED_WORKSPACE;
          const now = { ...disconnected, github: null, githubInstallations: [] };
          service.memberships = service.memberships.map((each) =>
            each.id === workspaceId ? now : each,
          );
          return { ok: true, answer: now } as const;
        }),
      linearConnect: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`linear-connect:${workspaceId}`);
          return service.notPermitted
            ? NOT_PERMITTED_WORKSPACE
            : ({ ok: true, answer: LINEAR_SIGN_IN_URL } as const);
        }),
      linearDisconnect: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`linear-disconnect:${workspaceId}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const found = service.memberships.find((each) => each.id === workspaceId);
          if (found === undefined) return UNANSWERED_WORKSPACE;
          const { linear: _gone, ...now } = found;
          service.memberships = service.memberships.map((each) =>
            each.id === workspaceId ? now : each,
          );
          return { ok: true, answer: now } as const;
        }),
      linearIssues: ({ workspaceId, query }) =>
        Effect.sync(() => {
          service.reads.push(`linear-issues:${workspaceId}:${query ?? ""}`);
          const issues = service.linearIssues[workspaceId];
          return issues === undefined
            ? ({ ok: false, failure: WORKSPACE_CALL_FAILURE.LINEAR_UNAVAILABLE } as const)
            : ({ ok: true, answer: issues } as const);
        }),
      sentryInstallations: () => Effect.succeed(UNANSWERED_WORKSPACE),
      sentryInstall: () => Effect.succeed(UNANSWERED_WORKSPACE),
      sentryDisconnect: () => Effect.succeed(UNANSWERED_WORKSPACE),
      people: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`members:${workspaceId}`);
          const members = service.members[workspaceId];
          return members === undefined
            ? UNANSWERED_WORKSPACE
            : ({
                ok: true,
                answer: { members, former: service.former[workspaceId] ?? [] },
              } as const);
        }),
      photo: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`photo:${workspaceId}`);
          const photo = service.photos[workspaceId];
          return photo === undefined
            ? ({ ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND } as const)
            : ({ ok: true, answer: photo } as const);
        }),
      removeMember: (workspaceId, userId) =>
        Effect.sync(() => {
          service.reads.push(`remove:${workspaceId}:${userId}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const remaining = (service.members[workspaceId] ?? []).filter(
            (member) => member.userId !== userId,
          );
          service.members[workspaceId] = remaining;
          return { ok: true, answer: remaining } as const;
        }),
      changeRole: (workspaceId, userId, role) =>
        Effect.sync(() => {
          service.reads.push(`role:${workspaceId}:${userId}:${role}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const given =
            role === WORKSPACE_ROLE.ADMIN ? WORKSPACE_ROLE.ADMIN : WORKSPACE_ROLE.MEMBER;
          const changed = (service.members[workspaceId] ?? []).map((member) =>
            member.userId === userId ? { ...member, role: given } : member,
          );
          service.members[workspaceId] = changed;
          return { ok: true, answer: changed } as const;
        }),
      // A handover makes the heir the owner and the account, the owner until then, an admin.
      transfer: (workspaceId, userId) =>
        Effect.sync(() => {
          service.reads.push(`transfer:${workspaceId}:${userId}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const handedOver = (service.members[workspaceId] ?? []).map((member) => ({
            ...member,
            role: member.userId === userId ? WORKSPACE_ROLE.OWNER : member.role,
          }));
          service.members[workspaceId] = handedOver;
          service.memberships = service.memberships.map((each) =>
            each.id === workspaceId ? { ...each, role: WORKSPACE_ROLE.ADMIN } : each,
          );
          return { ok: true, answer: handedOver } as const;
        }),
      invitations: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`invitations:${workspaceId}`);
          return { ok: true, answer: service.invitations[workspaceId] ?? [] } as const;
        }),
      // The service answers the invitation it made, with its accept link.
      invite: (workspaceId, email, role) =>
        Effect.sync(() => {
          service.reads.push(`invite:${workspaceId}:${email}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const made: WorkspaceInvitation = {
            id: `inv-${email}`,
            email,
            role: role === WORKSPACE_ROLE.ADMIN ? WORKSPACE_ROLE.ADMIN : WORKSPACE_ROLE.MEMBER,
            expiresAt: "2026-10-16T12:00:00.000Z",
            acceptUrl: `https://tryluke.dev/accept-invitation.html?id=inv-${email}`,
          };
          service.invitations[workspaceId] = [...(service.invitations[workspaceId] ?? []), made];
          return { ok: true, answer: made } as const;
        }),
      cancelInvitation: (workspaceId, invitationId) =>
        Effect.sync(() => {
          service.reads.push(`cancel:${workspaceId}:${invitationId}`);
          const pending = (service.invitations[workspaceId] ?? []).filter(
            (one) => one.id !== invitationId,
          );
          service.invitations[workspaceId] = pending;
          return { ok: true, answer: pending } as const;
        }),
      leave: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`leave:${workspaceId}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          service.memberships = service.memberships.filter((each) => each.id !== workspaceId);
          return { ok: true, answer: workspaceId } as const;
        }),
    },
    sidebarLive: (_userId) =>
      Effect.sync(() => {
        service.reads.push("sidebar-live");
        return { ok: true, answer: SIDEBAR_SEALED } as const;
      }),
    // The service keeps a pin's first instant, newest pinned first, and answers the pins as they then stand.
    pinRepository: (repository, pinned) =>
      Effect.sync(() => {
        if (service.pinsFail) return undefined;
        const others = service.pins.filter((pin) => pin.repository !== repository);
        const standing = service.pins.find((pin) => pin.repository === repository);
        service.pins = pinned
          ? [standing ?? { repository, pinnedAt: MARKED_AT + service.pins.length }, ...others]
          : others;
        const txid = service.sidebarTxid;
        return txid === undefined ? { pins: service.pins } : { pins: service.pins, txid };
      }),
    // The service answers its sections as they stand, the test having set them to what the write left.
    writeTaskSection: (write) =>
      Effect.sync(() => {
        service.sectionWrites.push(write);
        const txid = service.sidebarTxid;
        return service.sections === undefined || txid === undefined
          ? service.sections
          : { ...service.sections, txid };
      }),
    // The service writes the edit's value into the document's decisions and answers the task whole.
    edit: (taskId, edit) =>
      Effect.sync((): TaskCallResult<PlanEditAnswer, typeof TASK_CALL_FAILURE.NOT_FOUND> => {
        if (service.editAnswer !== undefined) return { ok: true, answer: service.editAnswer };
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND };
        const edited = {
          ...found,
          updatedAt: EDITED_AT,
          document: {
            ...found.document,
            body: edit.document.value,
          },
          lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: EDITED_AT, duringCall: false },
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? edited : candidate,
        );
        return { ok: true, answer: { plan: edited } };
      }),
    readFile: (_taskId, window) => Effect.sync(() => service.files[window.path]),
    readTree: (_taskId, folder) => Effect.sync(() => service.folders[folder.path]),
    readSkills: (taskId) => Effect.sync(() => service.skills[taskId]),
    readRepositoryTree: (place, folder) =>
      Effect.sync(
        () => service.places[place.workspaceId]?.[place.repository]?.folders[folder.path],
      ),
    readRepositorySkills: (place) =>
      Effect.sync(() =>
        place.repository === undefined
          ? undefined
          : service.places[place.workspaceId]?.[place.repository]?.skills,
      ),
    readRepositoryPullRequest: (place, number) =>
      Effect.gen(function* () {
        if (service.pullRequestGate !== undefined) yield* Deferred.await(service.pullRequestGate);
        if (service.pullRequestQuota !== undefined) {
          if (service.pullRequestQuota === 0) return undefined;
          service.pullRequestQuota -= 1;
        }
        return service.pullRequests[place.workspaceId]?.[place.repository]?.get(number);
      }),
    readRepositoryIssue: (place, number) =>
      Effect.sync(() => service.issues[place.workspaceId]?.[place.repository]?.get(number)),
    readRepositoryIssues: (place, ask) =>
      Effect.sync(() => {
        service.issueAsks.push(ask);
        return service.repositoryIssues[place.workspaceId]?.[place.repository];
      }),
    readBrowserTabs: () => Effect.succeed({ tabs: [] }),
    openBrowserTab: () => Effect.succeed({ failure: BROWSER_TAB_OPEN_FAILURE.UNANSWERED }),
    readIssueLinks: (taskId) =>
      Effect.sync(() => {
        const issues = service.issueLinks[taskId];
        return issues === undefined ? { failure: TASK_CALL_FAILURE.NOT_FOUND } : { issues };
      }),
    // The service links a Linear issue under its own id, and refuses one the task links already.
    linkIssue: (taskId, issue) =>
      Effect.sync(() => {
        const issues = service.issueLinks[taskId];
        if (issues === undefined) return { failure: TASK_CALL_FAILURE.NOT_FOUND };
        const externalId =
          issue.provider === TASK_ISSUE_PROVIDER.LINEAR ? issue.id : `${issue.number}`;
        if (issues.some((each) => each.externalId === externalId)) {
          return { refused: TASK_ISSUE_LINK_REFUSAL.LINKED };
        }
        const made: TaskIssueLinkView = {
          id: randomUUID(),
          provider: issue.provider,
          externalId,
          key: externalId,
          url: `https://linear.app/acme/issue/${externalId}`,
          title: externalId,
          relation: issue.relation ?? TASK_ISSUE_RELATION.CLOSES,
        };
        issues.push(made);
        return { issue: made };
      }),
    relateIssue: (taskId, linkId, relation) =>
      Effect.sync(() => {
        const link = service.issueLinks[taskId]?.find((each) => each.id === linkId);
        if (link === undefined) return { failure: TASK_CALL_FAILURE.NOT_FOUND };
        const related = { ...link, relation };
        service.issueLinks[taskId] = (service.issueLinks[taskId] ?? []).map((each) =>
          each.id === linkId ? related : each,
        );
        return { issue: related };
      }),
    unlinkIssue: (taskId, linkId) =>
      Effect.sync(() => {
        const issues = service.issueLinks[taskId] ?? [];
        if (!issues.some((each) => each.id === linkId))
          return { failure: TASK_CALL_FAILURE.NOT_FOUND };
        service.issueLinks[taskId] = issues.filter((each) => each.id !== linkId);
        return { unlinked: true as const };
      }),
    readBoard: (taskId) => Effect.sync(() => service.boards[taskId]),
    boardLive: (taskId) =>
      Effect.sync(() => {
        const sealed = service.boardSeals[taskId];
        return sealed === undefined
          ? { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND }
          : { ok: true, answer: sealed };
      }),
    historyLive: (taskId) =>
      Effect.sync(() => {
        const sealed = service.historySeals[taskId];
        return sealed === undefined
          ? { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED }
          : { ok: true, answer: sealed };
      }),
    browserTabsLive: (taskId) =>
      Effect.sync(() => {
        const sealed = service.browserTabSeals[taskId];
        return sealed === undefined
          ? { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED }
          : { ok: true, answer: sealed };
      }),
    pagesLive: (place) =>
      Effect.sync(() => {
        const sealed = service.pageSeals[pagePlaceId(place)];
        return sealed === undefined
          ? { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED }
          : { ok: true, answer: sealed };
      }),
    recordLive: (taskId) =>
      Effect.sync(() => {
        const sealed = service.recordSeals[taskId];
        return sealed === undefined
          ? { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND }
          : { ok: true, answer: sealed };
      }),
    readCode: (taskId) =>
      Effect.sync(() => {
        service.recordReads.push("code");
        const code = service.codes[taskId];
        return code === undefined ? undefined : { code };
      }),
    // The service keeps the last scene written, beside whatever drawing it holds.
    saveBoard: (taskId, elements, appliedDrawing, image) =>
      Effect.andThen(
        service.boardSaveHeld === undefined ? Effect.void : Deferred.await(service.boardSaveHeld),
        Effect.sync(() => {
          service.images[taskId] = image;
          const board = { ...service.boards[taskId], elements, appliedDrawing };
          service.boards[taskId] = board;
          const txid = service.boardSaveTxid;
          return txid === undefined ? { board } : { board, txid };
        }),
      ),
    listLive: () =>
      Effect.sync(() => {
        service.liveListReads += 1;
        return service.liveList;
      }),
    open: (taskId) =>
      Effect.sync((): TaskCallResult<Task, TaskCallFailure> => {
        service.reads.push(`open:${taskId}`);
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        return found === undefined
          ? { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND }
          : { ok: true, answer: found };
      }),
    create: () => Effect.sync(() => service.createAnswer),
    repositories: (workspaceId) =>
      Effect.sync(() => {
        service.reads.push(
          workspaceId === undefined ? "repositories" : `repositories:${workspaceId}`,
        );
        return service.repositoriesAnswer;
      }),
    // The service keeps the repository on the task and answers the task whole.
    setRepository: (taskId, repository) =>
      Effect.sync((): TaskCallResult<TaskWritten, RepositoryCallFailure> => {
        if (service.repositoryUnreachable) {
          return { ok: false, failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };
        }
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED };
        const changed = { ...found, repository };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? changed : candidate,
        );
        return { ok: true, answer: { task: changed } };
      }),
    // The service moves the task and answers it whole.
    move: (taskId, workspaceId) =>
      Effect.sync((): TaskCallResult<TaskWritten, TaskCallFailure> => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND };
        const moved = { ...found, workspaceId };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? moved : candidate,
        );
        return { ok: true, answer: { task: moved } };
      }),
    // The service re-titles the document with the name, as the store does.
    rename: (taskId, { name }) =>
      Effect.sync(() => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return undefined;
        const renamed = { ...found, name, document: { ...found.document, body: `# ${name}` } };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? renamed : candidate,
        );
        return service.renameTxid === undefined
          ? { task: renamed }
          : { task: renamed, txid: service.renameTxid };
      }),
    // The service sets the status, the priority, and the assignee named, naming the assignee by
    // their account, and leaves the rest standing; null assigns the task to no one.
    setStanding: (taskId, { assigneeId, ...standing }) =>
      Effect.sync(() => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return undefined;
        const { assignee: _standingAssignee, ...rest } = found;
        const changed =
          assigneeId === undefined
            ? { ...found, ...standing }
            : assigneeId === null
              ? { ...rest, ...standing }
              : { ...rest, ...standing, assignee: { userId: assigneeId, name: "Ada Lovelace" } };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? changed : candidate,
        );
        return { task: changed };
      }),
    // The service stamps a pin at its own clock, and a false takes it away.
    mark: (taskId, { pinned }) =>
      Effect.sync(() => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return undefined;
        const { pinnedAt, ...rest } = found;
        const pin = pinned === undefined ? pinnedAt : pinned ? MARKED_AT : undefined;
        const marked = {
          ...rest,
          ...(pin === undefined ? undefined : { pinnedAt: pin }),
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? marked : candidate,
        );
        return { task: marked };
      }),
    delete: (taskId) =>
      Effect.sync(() => {
        if (service.deleteFails) return undefined;
        service.tasks = service.tasks.filter((candidate) => candidate.id !== taskId);
        return {};
      }),
  };
  return service;
}

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** Realtime as a script: each subscription by its capability, and a way to deliver rows to one or stop it for good. */
function fakeRealtime() {
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const closed: string[] = [];
  const arrived = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  /** A write's transaction waited on until `arrive` names it, as Realtime's `awaitTxId` settles. */
  const awaitTxId = (txid: string): Promise<void> => {
    if (arrived.has(txid)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    waiting.set(txid, [...(waiting.get(txid) ?? []), resolve]);
    return promise;
  };
  const open = (url: string): LiveClient => ({
    subscribe: (query) => ({
      onChange: (listener) => {
        listeners.set(query.capability, listener);
        return () => listeners.delete(query.capability);
      },
      renew: () => Promise.resolve(),
      awaitTxId,
      unsubscribe: () => void listeners.delete(query.capability),
    }),
    close: () => void closed.push(url),
  });
  /** A part's subscription, once the host's follower has made it. */
  const subscribed = (capability: string) =>
    Effect.gen(function* () {
      for (let turn = 0; turn < 100; turn += 1) {
        const listener = listeners.get(capability);
        if (listener !== undefined) return listener;
        yield* Effect.yieldNow;
      }
      return assert.fail(`the host never subscribed to ${capability}`);
    });
  return {
    open,
    closed,
    /** The workers' rows and then the mark's delivered, as Realtime's snapshots carry them, once the host subscribed. */
    deliver: (data: readonly unknown[], workers: readonly unknown[] = []) =>
      Effect.gen(function* () {
        (yield* subscribed("capability-workers"))({ status: "live", data: workers });
        (yield* subscribed("capability-mark"))({ status: "live", data });
      }),
    /** The mark's subscription stopped for good. */
    fail: Effect.map(subscribed("capability-mark"), (listener) =>
      listener({ status: "error", data: [] }),
    ),
    /** Waits for every part of the task list to be subscribed, as the follow forked from a refresh subscribes them. */
    listSubscribed: Effect.gen(function* () {
      for (let turn = 0; turn < 100; turn += 1) {
        if (listeners.has("plans") && listeners.has("agents") && listeners.has("issues")) return;
        yield* Effect.yieldNow;
      }
      assert.fail("every part of the list is subscribed");
    }),
    /** One part of the task list's rows delivered, as Realtime's snapshot carries them. */
    deliverPart: (part: string, data: readonly unknown[]) => {
      const listener = listeners.get(part);
      assert.ok(listener, `no subscription to ${part}`);
      listener({ status: "live", data });
    },
    /** A write's transaction reaching the subscriptions, settling every wait on it. */
    arrive: (txid: string) => {
      arrived.add(txid);
      for (const resolve of waiting.get(txid) ?? []) resolve();
      waiting.delete(txid);
    },
    /** The transactions a wait still stands on. */
    awaitingTxids: () => [...waiting.keys()].toSorted(),
    /** One part of the task list's subscription stopped for good. */
    failPart: (part: string) => listeners.get(part)?.({ status: "error", data: [] }),
    /** Lets what was delivered reach the view, through the fibers that carry it. */
    settled: Effect.gen(function* () {
      for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
    }),
  };
}

/** The one voice call as the live composer holds it: about a task, about the desk, or none. */
interface StandingCall {
  about: { readonly taskId: string | undefined } | undefined;
  /** Where ending a call waits before it lands, as a real call's close does. */
  closing?: Effect.Effect<void>;
}

function subject(
  service: FakeService,
  options: {
    signedIn?: boolean;
    call?: StandingCall;
    /** A view the window's channel throws on, the first time one is told. */
    breaksOn?: (view: TasksView) => boolean;
    /** Realtime's client, which the open task's board is followed over. */
    openLive?: (url: string) => LiveClient;
    /** The account signed in now, Dana's where none is named. */
    accountId?: () => string;
  } = {},
) {
  return Effect.gen(function* () {
    /** Every event the composer emitted besides the view, by its kind. */
    const pushed: [GatewayEventKind, WireValue][] = [];
    const told: TasksView[] = [];
    /** Every other event the host emitted, in order. */
    const events: { readonly kind: string; readonly payload: WireValue }[] = [];
    const reported: string[] = [];
    let broken = false;
    const waiters: {
      wanted: (view: TasksView) => boolean;
      seen: Deferred.Deferred<TasksView>;
    }[] = [];
    const standing = options.call ?? { about: undefined };
    /** Every followed transcript's page the host told, in order. */
    const pages: WireValue[] = [];
    const realtime = fakeRealtime();
    const tasks = yield* composeTasks({
      kernel: {
        runMode: { sendsNetwork: true },
        now: () => 0,
        emit: (kind, payload) => {
          if (kind === GATEWAY_EVENT.TRANSCRIPT_CHANGED) pages.push(payload);
          if (kind !== GATEWAY_EVENT.TASKS_CHANGED) {
            pushed.push([kind, payload]);
            events.push({ kind, payload });
            return;
          }
          const read = readEither(tasksViewSchema)(payload);
          assert.ok(Result.isSuccess(read), "the planning event carries a view");
          if (!broken && options.breaksOn?.(read.success) === true) {
            broken = true;
            throw new Error("the window's channel broke");
          }
          told.push(read.success);
          for (const waiter of waiters) {
            if (waiter.wanted(read.success))
              Deferred.doneUnsafe(waiter.seen, Effect.succeed(read.success));
          }
        },
        report: (message) => {
          reported.push(message);
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service,
      // Note that the workspaces are always followed over the fake service's own Realtime, whatever a test hands for the board.
      openLive: (url) =>
        url === WORKSPACES_URL ? service.openLive(url) : (options.openLive ?? realtime.open)(url),
      accountId: options.accountId ?? (() => "user-dana"),
      endTaskCall: (taskId) =>
        Effect.gen(function* () {
          const about = standing.about?.taskId;
          if (about === undefined || (taskId !== undefined && about !== taskId)) return;
          yield* standing.closing ?? Effect.void;
          standing.about = undefined;
        }),
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = tasks.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return Effect.orDie(handler(params, context));
    };
    const last = () => told.at(-1);
    /** The first view told, from now on, that `wanted` holds of. */
    const viewWhere = (wanted: (view: TasksView) => boolean) =>
      Effect.gen(function* () {
        const seen = yield* Deferred.make<TasksView>();
        waiters.push({ wanted, seen });
        return yield* Deferred.await(seen);
      });
    /** Waits from now on for the first view `wanted` holds of, and answers the wait. */
    const viewLands = (wanted: (view: TasksView) => boolean) =>
      Effect.map(Deferred.make<TasksView>(), (seen) => {
        waiters.push({ wanted, seen });
        return Deferred.await(seen);
      });
    /** The followed list delivered as the service holds it: a row for each of its tasks, and the agents given. */
    const listed = (agents: readonly unknown[] = []) =>
      Effect.gen(function* () {
        yield* realtime.listSubscribed;
        realtime.deliverPart("plans", service.tasks.map(rowOfTask));
        realtime.deliverPart("agents", agents);
        realtime.deliverPart("issues", []);
        yield* realtime.settled;
      });
    /** The host's own fibers given their turn, so what Realtime told is drawn. */
    const settled = Effect.gen(function* () {
      for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
    });
    /** Opens a task as the window's press does, then lets the read the open left running land. */
    const openTask = (taskId: string) =>
      Effect.tap(call(GATEWAY_METHOD.TASKS_OPEN, { taskId }), () => settled);
    return {
      tasks,
      call,
      told,
      pages,
      pushed,
      events,
      reported,
      last,
      viewWhere,
      viewLands,
      realtime,
      listed,
      settled,
      openTask,
    };
  });
}

it.effect(
  "a plan's picture is answered to the window that asked as its bytes, and as not found where the service holds none for it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const picture = { contentType: PICTURE_TYPE.PNG, base64: "iVBORw0KGgo=" };
      service.pictures.set(INVITES, new Map([["picture-1", picture]]));
      const { call, told } = yield* subject(service);

      const read = yield* call(GATEWAY_METHOD.TASKS_PICTURE, {
        planId: INVITES,
        attachmentId: "picture-1",
      });
      const gone = yield* call(GATEWAY_METHOD.TASKS_PICTURE, {
        planId: INVITES,
        attachmentId: "picture-2",
      });

      assert.deepEqual(read, picture);
      assert.deepEqual(gone, { failure: TASK_CALL_FAILURE.NOT_FOUND });
      assert.equal(told.length, 0, "a picture's bytes are never told in the view");
    }),
);

it.effect(
  "a plan's pages are answered to the Inbox that asked, never told in the view, and a plan whose pages the service did not answer says so",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const funnel = {
        id: "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b",
        title: "Invite funnel",
        version: 2,
        at: 1_500,
      };
      service.pageLines[INVITES] = [funnel];
      const { call, told } = yield* subject(service);

      const read = yield* call(GATEWAY_METHOD.TASKS_PAGES, { taskId: INVITES });
      const unread = yield* call(GATEWAY_METHOD.TASKS_PAGES, { taskId: "another-plan" });

      assert.deepEqual(read, { pages: [funnel] });
      assert.deepEqual(unread, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.equal(told.length, 0, "a plan's pages read for the Inbox are never told in the view");
    }),
);

it.effect(
  "a window of a File tab's file is answered as the service read it, its lines plain, since the panel colours code itself",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const window = {
        path: "src/seats.ts",
        repository: "acme/relay",
        branch: "main",
        firstLine: 1,
        lineCount: 2,
        lines: ["const seats = 3;", "export { seats };"],
      };
      service.files["src/seats.ts"] = { file: window };
      const { call } = yield* subject(service);

      const read = yield* call(GATEWAY_METHOD.TASKS_FILE, {
        taskId: INVITES,
        path: "src/seats.ts",
        firstLine: 1,
        lastLine: 2,
      });

      assert.deepEqual(read, { file: window });
    }),
);

it.effect(
  "a picture the editor took is kept on the service and read back by the id it answered, and one past the plan's bound is refused in so many words",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call } = yield* subject(service);
      const picture = "data:image/png;base64,iVBORw0KGgo=";

      const kept = yield* call(GATEWAY_METHOD.TASKS_PICTURE_KEEP, { planId: INVITES, picture });
      yield* call(GATEWAY_METHOD.TASKS_PICTURE_KEEP, { planId: INVITES, picture });
      const third = yield* call(GATEWAY_METHOD.TASKS_PICTURE_KEEP, { planId: INVITES, picture });

      assert.deepEqual(kept, { id: "kept-1" });
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_PICTURE, { planId: INVITES, attachmentId: "kept-1" }),
        { contentType: PICTURE_TYPE.PNG, base64: "iVBORw0KGgo=" },
      );
      assert.deepEqual(third, { failure: PICTURE_KEEP_FAILURE.TOO_MANY });
    }),
);

it.effect(
  "a plan's comments are read past the window's cursor, and a thread started on it is answered as the service holds it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call } = yield* subject(service);
      const start = {
        clientKey: "key-1",
        scope: PLAN_COMMENT_SCOPE.WORDS,
        quote: "Invites",
        anchor: { from: 2, to: 9 },
        text: "# Invites",
        words: "Why invites?",
      };

      const started = yield* call(GATEWAY_METHOD.TASKS_COMMENT_START, {
        planId: INVITES,
        start,
      });
      const read = yield* call(GATEWAY_METHOD.TASKS_COMMENTS, { planId: INVITES, after: "0" });

      assert.deepEqual(started, { thread: service.threads[INVITES]?.[0] });
      assert.deepEqual(read, { threads: service.threads[INVITES], cursor: "c1" });
      assert.deepEqual(service.commentCalls, [`start:${INVITES}:Invites`, `read:${INVITES}:0`]);
    }),
);

it.effect("the window's refresh lists the plans and opening one draws its saved document", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, tasks, listed, openTask } = yield* subject(fakeService([billing, invites]));

    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* listed();
    assert.deepEqual(
      last()?.tasks.map((each) => each.name),
      [billing.name, invites.name],
    );
    assert.equal(last()?.listStatus, TASKS_READ.READY);
    assert.equal(last()?.activeTaskId, undefined);

    assert.deepEqual(yield* openTask(INVITES), {
      opened: true,
    });
    assert.equal(last()?.activeTaskId, INVITES);
    assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });
    assert.equal(tasks.activeTaskId(), INVITES);

    yield* openTask(BILLING);
    assert.equal(last()?.activeTaskId, BILLING);
    assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: billing });
  }),
);

it.effect(
  "a rename that answers its transaction is drawn at once and answered once the followed list carries it, holding no other task write meanwhile",
  () =>
    Effect.gen(function* () {
      const service = fakeService([
        task(INVITES, "Teammate invitations", "# Invites", 10),
        task(BILLING, "Billing export", "# Billing", 20),
      ]);
      service.renameTxid = "7301";
      const { call, listed, realtime, settled, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();

      const renaming = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_RENAME, { taskId: INVITES, name: "Invitations" }),
      );
      yield* settled;
      assert.deepEqual(realtime.awaitingTxids(), ["7301"]);
      assert.equal(renaming.pollUnsafe(), undefined, "the rename waits for its transaction");
      assert.equal(
        last()?.tasks.find((each) => each.id === INVITES)?.name,
        "Invitations",
        "the answer is drawn before the wait, so a newer row the list carries lands over it",
      );

      service.renameTxid = undefined;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_RENAME, { taskId: BILLING, name: "Billing" }),
        { renamed: true },
        "another write is not held behind the wait",
      );

      realtime.arrive("7301");
      assert.deepEqual(yield* Fiber.join(renaming), { renamed: true });
      assert.deepEqual(realtime.awaitingTxids(), []);
    }),
);

it.effect(
  "a rename's transaction is waited for by nothing while the list is not followed over Realtime",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.renameTxid = "7302";
      const { call, realtime } = yield* subject(service);

      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_RENAME, { taskId: INVITES, name: "Invitations" }),
        { renamed: true },
      );
      assert.deepEqual(realtime.awaitingTxids(), []);
    }),
);

it.effect(
  "opening a task tells the window it is reading, then its document, board, code, and pages in one view",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const funnel = {
        id: "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b",
        title: "Invite funnel",
        version: 2,
        at: 1_500,
      };
      const board = { elements: [], appliedDrawing: 0 };
      service.boards[BILLING] = board;
      service.codes[BILLING] = [];
      service.pageLines[BILLING] = [funnel];
      const { told, openTask } = yield* subject(service);
      yield* openTask(INVITES);

      const before = told.length;
      yield* openTask(BILLING);
      const opened = told.slice(before);

      assert.deepEqual(
        opened.map((view) => [view.activeTaskId, view.document.status, view.codeStatus]),
        [
          [BILLING, TASKS_READ.READING, TASKS_READ.READING],
          [BILLING, TASKS_READ.READY, TASKS_READ.READY],
        ],
      );
      const landed = opened.at(-1);
      assert.deepEqual(landed?.document, { status: TASKS_READ.READY, task: billing });
      assert.deepEqual(landed?.board, board);
      assert.deepEqual(landed?.shownCode, []);
      assert.deepEqual(landed?.pages, [funnel]);
    }),
);

it.effect(
  "a part of an open that has not answered holds back neither the document, the parts that have, nor a write",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      service.codes[INVITES] = [];
      // The pages are never answered, as a read that hangs until its deadline.
      service.readPages = () => Effect.never;
      const { call, last, openTask } = yield* subject(service);

      assert.deepEqual(yield* openTask(INVITES), {
        opened: true,
      });
      assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });
      assert.equal(last()?.codeStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.shownCode, []);
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_RENAME, { taskId: INVITES, name: "Invitations" }),
        { renamed: true },
        "the lock is not held for the pages",
      );
    }),
);

it.effect(
  "a part of an open that answers after its document lands on its own, though another is still out",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      service.codes[INVITES] = [];
      const codeHeld = yield* Deferred.make<void>();
      const readCode = service.readCode;
      service.readCode = (taskId) => Effect.andThen(Deferred.await(codeHeld), readCode(taskId));
      service.readPages = () => Effect.never;
      const { last, openTask } = yield* subject(service);

      yield* openTask(INVITES);
      assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });
      assert.equal(last()?.codeStatus, TASKS_READ.READING, "the code is still out");

      yield* Deferred.succeed(codeHeld, undefined);
      for (let turn = 0; turn < 8; turn += 1) yield* Effect.yieldNow;
      assert.equal(last()?.codeStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.shownCode, []);
    }),
);

it.effect(
  "switching back to a task opened a moment ago draws its document, board, code, and pages at once, answers before any read does, and lays the read over it in place",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const board = { elements: [], appliedDrawing: 0 };
      service.boards[INVITES] = board;
      service.codes[INVITES] = [];
      const { call, last, settled, openTask } = yield* subject(service);
      yield* openTask(INVITES);
      yield* openTask(BILLING);

      // Every read of the task is held from here, as a service that has not answered yet.
      const answered = yield* Deferred.make<void>();
      const held =
        <A>(read: (taskId: string) => Effect.Effect<A>) =>
        (taskId: string) =>
          Effect.andThen(Deferred.await(answered), read(taskId));
      const { open, readBoard, readCode } = service;
      service.open = held(open);
      service.readBoard = held(readBoard);
      service.readCode = held(readCode);
      service.tasks = [billing, { ...invites, document: { ...invites.document, body: "# Newer" } }];

      const switching = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES }),
      );
      yield* settled;
      assert.deepEqual(switching.pollUnsafe(), Exit.succeed({ opened: true }), "the open answered");
      assert.equal(last()?.activeTaskId, INVITES);
      assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });
      assert.deepEqual(last()?.board, board);
      assert.equal(last()?.codeStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.shownCode, []);

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(last()?.document.task?.document.body, "# Newer");
    }),
);

it.effect(
  "an open is not queued behind the reads of a task switched past, whose answers land nowhere",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      // The billing task's document and board are held, as reads still out when the next press lands.
      const answered = yield* Deferred.make<void>();
      const { open, readBoard } = service;
      service.open = (taskId) =>
        taskId === BILLING ? Effect.andThen(Deferred.await(answered), open(taskId)) : open(taskId);
      service.readBoard = (taskId) =>
        taskId === BILLING
          ? Effect.andThen(Deferred.await(answered), readBoard(taskId))
          : readBoard(taskId);
      service.boards[BILLING] = { elements: [], appliedDrawing: 1 };
      const { call, last, settled } = yield* subject(service);

      yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_OPEN, { taskId: BILLING }));
      yield* settled;
      const opening = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES }));
      yield* settled;

      assert.deepEqual(opening.pollUnsafe(), Exit.succeed({ opened: true }));
      assert.equal(last()?.activeTaskId, INVITES);
      assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });
      assert.equal(last()?.board, undefined, "the billing board lands nowhere");
    }),
);

it.effect("a press on the task already open reads nothing again", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const service = fakeService([invites]);
    const { last, openTask } = yield* subject(service);
    yield* openTask(INVITES);
    const before = service.reads.length;

    assert.deepEqual(yield* openTask(INVITES), { opened: true });
    assert.deepEqual(service.reads.slice(before), []);
    assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });
  }),
);

it.effect(
  "an open's document read that left before a rename answered never lands over the renamed document",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const { call, last, settled, openTask } = yield* subject(service);
      yield* openTask(INVITES);
      yield* openTask(BILLING);

      // The read takes the task as it stands when asked, and answers only once let go.
      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        Effect.flatMap(open(taskId), (read) => Effect.as(Deferred.await(answered), read));
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* settled;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_RENAME, { taskId: INVITES, name: "Invitations" }),
        { renamed: true },
        "the rename is not held behind the read",
      );

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(last()?.document.task?.name, "Invitations");
      assert.equal(last()?.document.task?.document.body, "# Invitations");
    }),
);

it.effect(
  "a task's code read as none is held as none, and a task whose code read did not answer holds its code unread",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      service.codes[INVITES] = [];
      const { last, openTask } = yield* subject(service);

      yield* openTask(INVITES);
      assert.deepEqual(last()?.shownCode, []);

      yield* openTask(BILLING);
      assert.equal(last()?.shownCode, undefined);
    }),
);

it.effect(
  "a task's code read that did not answer says so, keeping its code unread, and a refresh reads it again",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last, told, openTask } = yield* subject(service);

      yield* openTask(INVITES);
      assert.ok(
        told.some((view) => view.codeStatus === TASKS_READ.READING),
        "the read says it is out",
      );
      assert.equal(last()?.codeStatus, TASKS_READ.FAILED);
      assert.equal(last()?.shownCode, undefined);

      service.codes[INVITES] = [];
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.equal(last()?.codeStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.shownCode, []);
    }),
);

it.effect("a refresh that reads what the view already holds tells the window nothing", () =>
  Effect.gen(function* () {
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const { call, told } = yield* subject(fakeService([billing]));

    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    const firstRead = told.length;
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);

    assert.ok(firstRead > 0, "the first read is told");
    assert.equal(told.length, firstRead);
  }),
);

it.effect(
  "a list that moves again holds the tasks it had already listed as the objects it held",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([billing]);
      const { call, tasks, listed } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      const first = tasks.snapshot();
      service.tasks = [billing, invites];
      yield* listed();

      assert.deepEqual(
        tasks.snapshot().tasks.map((each) => each.id),
        [BILLING, INVITES],
      );
      assert.equal(tasks.snapshot().tasks[0], first.tasks[0]);
      assert.equal(tasks.snapshot().workspaces, first.workspaces);
    }),
);

it.effect("the window's refresh lists the agents with no task beside the tasks", () =>
  Effect.gen(function* () {
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, listed } = yield* subject(fakeService([billing]));
    const triage = agentRow(null, 60_000);

    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* listed([triage]);

    assert.deepEqual(
      last()?.tasks.map((each) => each.id),
      [BILLING],
    );
    assert.deepEqual(
      last()?.tasklessAgents?.map((each) => each.id),
      [triage.id],
    );
  }),
);

it.effect(
  "the developer's edit is saved on the service and the open document takes the plan it answered",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last, openTask } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* openTask(INVITES);

      const answer = yield* call(GATEWAY_METHOD.TASKS_EDIT, {
        taskId: INVITES,
        edit: { document: { base: INVITES_TEXT, value: `${INVITES_TEXT}\n\nInvites expire.` } },
      });

      assert.deepEqual(answer, { saved: true });
      assert.deepEqual(last()?.document, {
        status: TASKS_READ.READY,
        task: service.tasks[0],
      });
    }),
);

it.effect(
  "a start naming an agent opens the task it made and answers the agent's start beside it, a refusal among them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      const made = task(INVITES, "Invitation expiry", "", 10);
      const agent = {
        id: "3c9e1d2a-6b7f-4e8a-9c0d-1e2f3a4b5c6d",
        planId: INVITES,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: null,
        createdAt: 11,
        status: CODING_AGENT_STATUS.STARTING,
        turnId: null,
      };
      const params = {
        repository: "acme/relay",
        agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
      };

      service.createAnswer = { ok: true, answer: { task: made, agent: { agent } } };
      const started = yield* call(GATEWAY_METHOD.TASKS_START, params);
      service.createAnswer = {
        ok: true,
        answer: { task: made, agent: { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE } },
      };
      const refused = yield* call(GATEWAY_METHOD.TASKS_START, params);

      assert.deepEqual(started, { planId: INVITES, agentStart: { agent } });
      assert.deepEqual(refused, {
        planId: INVITES,
        agentStart: { failure: CODING_AGENT_CALL_FAILURE.INVALID_CHOICE },
      });
      assert.equal(last()?.activeTaskId, INVITES);
    }),
);

it.effect("behind a closed account gate nothing is read and nothing starts", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told } = yield* subject(service, { signedIn: false });

    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    const started = yield* call(GATEWAY_METHOD.TASKS_START, { name: "Teammate invitations" });

    assert.deepEqual(started, { failure: TASK_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(told, []);
    assert.deepEqual(service.reads, []);
  }),
);

it.effect(
  "the sidebar's sections and pins are followed from the first refresh and never read again, a change takes the service's answer, one refused leaves them, and another Mac's change is pushed",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, settled } = yield* subject(service);
      const launch: TaskSection = {
        id: SECTION_ID,
        workspaceId: PERSONAL.id,
        title: "Launch",
        createdAt: 5,
      };
      service.sections = { sections: [launch], entries: [], agentEntries: [] };
      service.pins = [{ repository: "acme/relay", pinnedAt: 3 }];

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      assert.deepEqual(last()?.taskSections, service.sections);
      assert.deepEqual(last()?.repositoryPins, service.pins);
      assert.equal(service.reads.filter((read) => read === "sidebar-live").length, 1);

      const placed = { taskId: INVITES, sectionId: SECTION_ID, addedAt: 6 };
      service.sections = { sections: [launch], entries: [placed], agentEntries: [] };
      const place = { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID };
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_WRITE_SECTION, place), { changed: true });
      assert.deepEqual(last()?.taskSections, {
        sections: [launch],
        entries: [placed],
        agentEntries: [],
      });

      service.sections = undefined;
      const removal = { ...place, sectionId: null };
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_WRITE_SECTION, removal), {
        changed: false,
      });
      assert.deepEqual(last()?.taskSections, {
        sections: [launch],
        entries: [placed],
        agentEntries: [],
      });
      assert.deepEqual(service.sectionWrites, [place, removal]);

      const later = {
        ...launch,
        id: "8c2e1f3a-4b5d-4e6f-9a7b-0c1d2e3f4a5b",
        title: "Later",
        createdAt: 7,
      };
      service.realtime.deliver(
        "sections",
        sidebarLiveRows({ sections: [later, launch], entries: [], agentEntries: [] }, []).sections,
      );
      service.realtime.deliver("pins", [
        { repository: "acme/relay", pinnedAt: 3 },
        { repository: "acme/web", pinnedAt: 9 },
      ]);
      yield* settled;
      assert.deepEqual(
        last()?.taskSections?.sections.map((section) => section.title),
        ["Launch", "Later"],
      );
      assert.deepEqual(
        last()?.repositoryPins?.map((pin) => pin.repository),
        ["acme/web", "acme/relay"],
      );
    }),
);

it.effect(
  "a pin or a section's write answers once the followed sidebar has its transaction, at once where it names none, and at once before the sidebar is followed",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, settled } = yield* subject(service);
      const launch: TaskSection = {
        id: SECTION_ID,
        workspaceId: PERSONAL.id,
        title: "Launch",
        createdAt: 5,
      };
      service.sections = { sections: [launch], entries: [], agentEntries: [] };

      // Before the first refresh nothing follows the sidebar, so a write's transaction is not waited on.
      service.sidebarTxid = "40";
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, {
          repository: "acme/relay",
          pinned: true,
        }),
        { changed: true },
      );
      assert.deepEqual(service.realtime.awaitingTxids(), []);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;

      service.sidebarTxid = "41";
      const placed = { taskId: INVITES, sectionId: SECTION_ID, addedAt: 6 };
      service.sections = { sections: [launch], entries: [placed], agentEntries: [] };
      const place = { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID };
      const placing = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_WRITE_SECTION, place));
      yield* settled;
      assert.deepEqual(service.realtime.awaitingTxids(), ["41"]);
      assert.equal(placing.pollUnsafe(), undefined, "the write waits for its transaction");
      service.realtime.arrive("41");
      assert.deepEqual(yield* Fiber.join(placing), { changed: true });
      assert.deepEqual(last()?.taskSections, {
        sections: [launch],
        entries: [placed],
        agentEntries: [],
      });

      service.sidebarTxid = "42";
      const pinning = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, { repository: "acme/web", pinned: true }),
      );
      yield* settled;
      assert.deepEqual(service.realtime.awaitingTxids(), ["42"]);
      service.realtime.arrive("42");
      assert.deepEqual(yield* Fiber.join(pinning), { changed: true });

      // A write that changed no row names no transaction, so there is nothing to wait for.
      service.sidebarTxid = undefined;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, { repository: "acme/web", pinned: true }),
        { changed: true },
      );
      assert.deepEqual(service.realtime.awaitingTxids(), []);
    }),
);

it.effect("a sign-out drops the view the window drew", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last, tasks, openTask } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* openTask(INVITES);

    yield* tasks.reset;

    assert.deepEqual(last(), {
      tasks: [],
      listStatus: TASKS_READ.IDLE,
      workspaces: [],
      document: { status: TASKS_READ.IDLE },
    });
  }),
);

it.effect(
  "code shown on the open task's call is drawn with its lines, in the order shown and once, and code about another task is dropped",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.codes[INVITES] = [];
      const { tasks, viewLands, openTask } = yield* subject(service);
      yield* tasks.lifetime;
      yield* openTask(INVITES);
      const shown = {
        callId: "call-1",
        turnId: "turn-1",
        shownAt: 10,
        code: {
          ref: { path: "src/invite.ts" },
          repository: "acme/api",
          firstLine: 1,
          lineCount: 1,
          lines: ["const answer = 42;"],
        },
      };

      const drawn = yield* viewLands((view) =>
        (view.shownCode ?? []).some((code) => code.callId === "call-3"),
      );
      tasks.showCode(BILLING, { ...shown, callId: "call-2" });
      tasks.showCode(INVITES, shown);
      tasks.showCode(INVITES, shown);
      tasks.showCode(INVITES, { ...shown, callId: "call-3" });
      const showing = (yield* drawn).shownCode ?? [];

      assert.deepEqual(
        showing.map((code) => code.callId),
        ["call-1", "call-3"],
      );
      assert.deepEqual(showing[0]?.code.lines, ["const answer = 42;"]);
    }),
);

it.effect(
  "code shown on a call into an agent with no task is held for that agent, once each, whatever task is open, and a call into another such agent replaces it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.codes[INVITES] = [];
      const { tasks, viewLands, openTask } = yield* subject(service);
      yield* tasks.lifetime;
      yield* openTask(INVITES);
      const shown = {
        callId: "call-1",
        turnId: "turn-1",
        shownAt: 10,
        agentId: "taskless-agent",
        code: {
          ref: { path: "src/invite.ts" },
          repository: "acme/api",
          firstLine: 1,
          lineCount: 1,
          lines: ["const answer = 42;"],
        },
      };

      const held = yield* viewLands((view) => (view.agentCallCode?.shownCode.length ?? 0) === 2);
      tasks.showAgentCode("taskless-agent", shown);
      tasks.showAgentCode("taskless-agent", shown);
      tasks.showAgentCode("taskless-agent", { ...shown, callId: "call-2" });
      const view = yield* held;
      assert.equal(view.agentCallCode?.agentId, "taskless-agent");
      assert.deepEqual(view.agentCallCode?.shownCode[0]?.code.lines, ["const answer = 42;"]);
      // The open task's Code tab takes none of it.
      assert.deepEqual(view.shownCode ?? [], []);

      // Its activity is the floating call's alone, never the open task's.
      const told = yield* viewLands((next) => next.callActivity?.notes === true);
      tasks.showActivity({
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        agentId: "taskless-agent",
        notes: true,
      });
      const toldView = yield* told;
      assert.equal(toldView.activity, undefined);
      assert.deepEqual(toldView.callActivity, { notes: true });

      const replaced = yield* viewLands((next) => next.agentCallCode?.agentId === "another-agent");
      tasks.showAgentCode("another-agent", { ...shown, callId: "call-3" });
      assert.deepEqual(
        (yield* replaced).agentCallCode?.shownCode.map((code) => code.callId),
        ["call-3"],
      );
    }),
);

it.effect("code whose drawing dies is reported, and code shown after it is still drawn", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.codes[INVITES] = [];
    const { tasks, viewLands, reported, openTask } = yield* subject(service, {
      breaksOn: (view) => (view.shownCode ?? []).some((code) => code.callId === "call-1"),
    });
    yield* tasks.lifetime;
    yield* openTask(INVITES);
    const shown = {
      callId: "call-1",
      turnId: "turn-1",
      shownAt: 10,
      code: {
        ref: { path: "notes.txt" },
        repository: "acme/api",
        firstLine: 1,
        lineCount: 1,
        lines: ["plain words"],
      },
    };

    const drawn = yield* viewLands((view) =>
      (view.shownCode ?? []).some((code) => code.callId === "call-2"),
    );
    tasks.showCode(INVITES, shown);
    tasks.showCode(INVITES, { ...shown, callId: "call-2" });

    assert.ok((yield* drawn).shownCode?.some((code) => code.callId === "call-2"));
    assert.equal(reported.length, 1);
    assert.match(reported[0] ?? "", /^Drawing code a call showed failed/);
  }),
);

it.effect(
  "the first refresh follows the account's workspaces with their GitHub organizations, and a sign-out clears them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, tasks, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.equal(last()?.workspacesStatus, TASKS_READ.READY);

      yield* tasks.reset;
      assert.deepEqual(last()?.workspaces, []);
      assert.deepEqual(service.realtime.subscribed(), []);
    }),
);

it.effect(
  "a teammate's change reaches the view as Realtime tells it, and while Realtime fails them the workspaces are polled until they are subscribed again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;

      service.memberships = [PERSONAL, { ...ACME, name: "Acme Labs" }];
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);

      service.realtime.fail("workspaces");
      yield* settled;
      service.memberships = [PERSONAL];
      yield* TestClock.adjust(Duration.seconds(3));
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL], "a poll draws what Realtime missed");
      assert.ok(service.reads.includes("workspaces-poll"));

      yield* TestClock.adjust(Duration.seconds(15));
      yield* settled;
      assert.ok(service.realtime.subscribed().includes("capability-workspaces"));
      service.memberships = [PERSONAL, RELAY];
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, RELAY]);
    }),
);

it.effect(
  "a workspaces reseal refused as signed out stops the follow, rather than sealing the old account again on the backoff",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);

      const before = service.reads.length;
      service.workspacesSignedOut = true;
      service.realtime.fail("workspaces");
      yield* TestClock.adjust(Duration.minutes(5));
      yield* settled;

      assert.deepEqual(
        service.reads.slice(before),
        ["workspaces-live"],
        "the reseal refused as signed out is the last ask: the old account is not sealed again on the backoff",
      );
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME], "what was drawn stays");
    }),
);

it.effect(
  "while the service seals nothing the workspaces say reading and the tasks are drawn, and the seal is asked again after a pause until it answers",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Draft", 10);
      const service = fakeService([invites]);
      service.workspacesFail = true;
      const { call, last, listed, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* settled;
      assert.equal(last()?.listStatus, TASKS_READ.READY);
      assert.deepEqual(
        last()?.tasks.map((each) => each.id),
        [invites.id],
      );
      assert.equal(last()?.workspacesStatus, TASKS_READ.READING);
      assert.deepEqual(last()?.workspaces, []);

      service.workspacesFail = false;
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(last()?.workspacesStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.workspaces, [PERSONAL]);
    }),
);

it.effect(
  "a workspace made reaches the service and the view then holds it over the follow, nothing read again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      const before = service.reads.length;

      const made = yield* call(GATEWAY_METHOD.WORKSPACES_CREATE, { name: RELAY.name });
      yield* settled;

      assert.deepEqual(made, { workspace: RELAY });
      assert.deepEqual(last()?.workspaces, [PERSONAL, RELAY]);
      assert.deepEqual(service.reads.slice(before), [`create:${RELAY.name}`]);
    }),
);

it.effect(
  "a workspace renamed reaches the service and the view then holds its new name, nothing read again, and a rename the role does not allow moves nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const before = service.reads.length;

      const renamed = yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, {
        workspaceId: ACME.id,
        name: "Acme Labs",
      });
      service.notPermitted = true;
      const refused = yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, {
        workspaceId: ACME.id,
        name: "Acme Research",
      });

      yield* settled;
      assert.deepEqual(renamed, { workspace: { ...ACME, name: "Acme Labs" } });
      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      assert.deepEqual(service.reads.slice(before), [
        `rename:${ACME.id}:Acme Labs`,
        `rename:${ACME.id}:Acme Research`,
      ]);
    }),
);

it.effect(
  "a rename another Mac renames again just after draws the newer name the follow carries",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      service.renamedAgain = "Acme Research";

      yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" });
      yield* settled;

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Research" }]);
    }),
);

it.effect(
  "a rename's answer that lands after the follow delivered a newer name is not drawn over it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      service.renamedAgain = "Acme Research";
      const answered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(answered);

      const renaming = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Research" }]);
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);
      yield* settled;

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Research" }]);
    }),
);

it.effect(
  "a rename's answer is drawn though the follow moved another workspace while it was out, where Realtime never told the rename itself",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(answered);
      service.realtimeMisses = true;

      const renaming = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" }),
      );
      yield* settled;
      // Only the other workspace's change reaches the follow; the rename's own is lost.
      const missed = workspacesLiveRows([{ ...PERSONAL, name: "Dana's own" }, ACME]);
      service.realtime.deliver("workspaces", missed.workspaces);
      yield* settled;
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);

      assert.deepEqual(last()?.workspaces, [
        { ...PERSONAL, name: "Dana's own" },
        { ...ACME, name: "Acme Labs" },
      ]);
    }),
);

it.effect(
  "a rename's answer that lands after the follow moved the workspace and moved it back is not drawn over the latest delivery",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(answered);

      const renaming = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      // A teammate renames it back before the first rename's answer lands.
      service.memberships = [PERSONAL, ACME];
      yield* settled;
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);

      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    }),
);

it.effect(
  "of two renames out at once, the first one's answer landing last is not drawn over the second's, where Realtime tells neither",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      service.realtimeMisses = true;
      const firstAnswered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(firstAnswered);

      const first = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Alpha" }),
      );
      yield* settled;
      service.renameAnswered = Effect.void;
      yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Beta" });
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Beta" }]);
      yield* Deferred.succeed(firstAnswered, undefined);
      yield* Fiber.join(first);

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Beta" }]);
    }),
);

it.effect(
  "a workspace's photo set reaches the service and the view then holds its version, removing it takes the version away, and a photo the role does not allow moves nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const before = service.reads.length;

      const set = yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, {
        workspaceId: ACME.id,
        photo: PHOTO_URL,
      });
      const drawn = last()?.workspaces;
      const removed = yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, {
        workspaceId: ACME.id,
        photo: null,
      });
      service.notPermitted = true;
      const refused = yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, {
        workspaceId: ACME.id,
        photo: PHOTO_URL,
      });

      yield* settled;
      assert.deepEqual(set, { workspace: { ...ACME, photoVersion: PHOTO_URL } });
      assert.deepEqual(drawn, [PERSONAL, { ...ACME, photoVersion: PHOTO_URL }]);
      assert.deepEqual(removed, { workspace: ACME });
      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(service.reads.slice(before), [
        `photoSet:${ACME.id}:${PHOTO_URL}`,
        `photoSet:${ACME.id}:none`,
        `photoSet:${ACME.id}:${PHOTO_URL}`,
      ]);
    }),
);

it.effect("an SVG is refused as a workspace's photo before the service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    const { call } = yield* subject(service);

    const svg = yield* Effect.exit(
      call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, {
        workspaceId: ACME.id,
        photo: "data:image/svg+xml;base64,PHN2Zy8+",
      }),
    );

    assert.ok(Exit.isFailure(svg), "an SVG is no photo");
    assert.deepEqual(service.reads, []);
  }),
);

it.effect(
  "connecting GitHub answers the service's install address and reads nothing, and disconnecting draws the workspace without its organization",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      const before = service.reads.length;

      const begun = yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT, { workspaceId: ACME.id });
      const disconnected = yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT, {
        workspaceId: ACME.id,
      });

      assert.deepEqual(begun, { url: INSTALL_URL });
      yield* settled;
      const unlinked = { ...ACME, github: null, githubInstallations: [] };
      assert.deepEqual(disconnected, { workspace: unlinked });
      assert.deepEqual(last()?.workspaces, [PERSONAL, unlinked]);
      assert.deepEqual(service.reads.slice(before), [
        `connect:${ACME.id}`,
        `disconnect:${ACME.id}`,
      ]);
    }),
);

it.effect(
  "a connection or a disconnection the account's role does not allow answers not-permitted",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.notPermitted = true;
      const { call } = yield* subject(service);
      const refused = { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED };

      assert.deepEqual(
        yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT, { workspaceId: ACME.id }),
        refused,
      );
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT, { workspaceId: ACME.id }),
        refused,
      );
    }),
);

it.effect(
  "a members read carries who the workspace's work names but left, where the service names anyone",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA];
      const lee = { userId: "user-lee", name: "Lee Park" };
      service.former[ACME.id] = [lee];
      const { call } = yield* subject(service);

      const people = yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS, { workspaceId: ACME.id });

      assert.deepEqual(people, { members: [ADA], former: [lee] });
    }),
);

it.effect(
  "a workspace's members are read on the service with nothing else, and a removal reads nothing after it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA, GRACE];
      const { call } = yield* subject(service);

      const members = yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS, { workspaceId: ACME.id });
      const remaining = yield* call(GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE, {
        workspaceId: ACME.id,
        userId: GRACE.userId,
      });

      assert.deepEqual(members, { members: [ADA, GRACE] });
      assert.deepEqual(remaining, { members: [ADA] });
      assert.deepEqual(service.reads, [`members:${ACME.id}`, `remove:${ACME.id}:${GRACE.userId}`]);
    }),
);

it.effect(
  "a role changed and a handover read nothing after them, and the account's own role after a handover arrives over the follow",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const owned = { ...ACME, role: WORKSPACE_ROLE.OWNER };
      const owner = { ...ADA, role: WORKSPACE_ROLE.OWNER };
      service.memberships = [PERSONAL, owned];
      service.members[ACME.id] = [owner, GRACE];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const before = service.reads.length;

      const changed = yield* call(GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE, {
        workspaceId: ACME.id,
        userId: GRACE.userId,
        role: WORKSPACE_ROLE.ADMIN,
      });
      const roleAfterChange = last()?.workspaces.find((each) => each.id === ACME.id)?.role;
      const handedOver = yield* call(GATEWAY_METHOD.WORKSPACES_TRANSFER, {
        workspaceId: ACME.id,
        userId: GRACE.userId,
      });
      yield* settled;
      const toOwner = yield* Effect.exit(
        call(GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE, {
          workspaceId: ACME.id,
          userId: GRACE.userId,
          role: WORKSPACE_ROLE.OWNER,
        }),
      );

      const admin = { ...GRACE, role: WORKSPACE_ROLE.ADMIN };
      assert.deepEqual(changed, { members: [owner, admin] });
      assert.equal(roleAfterChange, WORKSPACE_ROLE.OWNER);
      assert.deepEqual(handedOver, {
        members: [owner, { ...GRACE, role: WORKSPACE_ROLE.OWNER }],
      });
      assert.equal(
        last()?.workspaces.find((each) => each.id === ACME.id)?.role,
        WORKSPACE_ROLE.ADMIN,
      );
      assert.ok(Exit.isFailure(toOwner), "an owner's role is no role a change gives");
      assert.deepEqual(service.reads.slice(before), [
        `role:${ACME.id}:${GRACE.userId}:${WORKSPACE_ROLE.ADMIN}`,
        `transfer:${ACME.id}:${GRACE.userId}`,
      ]);
    }),
);

it.effect(
  "a workspace's photo is read on the service with nothing else, answered as its bytes or as none where it has none",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const photo = { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" };
      service.photos[ACME.id] = photo;
      const { call } = yield* subject(service);

      const read = yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO, { workspaceId: ACME.id });
      const none = yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO, { workspaceId: PERSONAL.id });

      assert.deepEqual(read, photo);
      assert.deepEqual(none, { failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(service.reads, [`photo:${ACME.id}`, `photo:${PERSONAL.id}`]);
    }),
);

it.effect(
  "an invitation is made, read, and canceled on the service, and nothing else is read with any of them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call } = yield* subject(service);

      const made = yield* call(GATEWAY_METHOD.WORKSPACES_INVITE, {
        workspaceId: ACME.id,
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
      });
      const pending = yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS, { workspaceId: ACME.id });
      const left = yield* call(GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL, {
        workspaceId: ACME.id,
        invitationId: "inv-alan@example.com",
      });
      service.notPermitted = true;
      const refused = yield* call(GATEWAY_METHOD.WORKSPACES_INVITE, {
        workspaceId: ACME.id,
        email: "grace@example.com",
        role: WORKSPACE_ROLE.ADMIN,
      });

      const invitation = {
        id: "inv-alan@example.com",
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
        expiresAt: "2026-10-16T12:00:00.000Z",
        acceptUrl: "https://tryluke.dev/accept-invitation.html?id=inv-alan@example.com",
      };
      assert.deepEqual(made, { invitation });
      assert.deepEqual(pending, { invitations: [invitation] });
      assert.deepEqual(left, { invitations: [] });
      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(service.reads, [
        `invite:${ACME.id}:alan@example.com`,
        `invitations:${ACME.id}`,
        `cancel:${ACME.id}:inv-alan@example.com`,
        `invite:${ACME.id}:grace@example.com`,
      ]);
    }),
);

it.effect("the workspaces land on the view while the GitHub connection read is still out", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    service.connection = { connected: true, login: "ada" };
    const held = yield* Deferred.make<void>();
    service.githubGate = Deferred.await(held);
    const { call, last, settled } = yield* subject(service);

    const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_REFRESH));
    yield* settled;

    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    assert.equal(last()?.github, undefined);

    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(refreshing);
    assert.deepEqual(last()?.github, { connected: true, login: "ada" });
  }),
);

it.effect(
  "the workspaces are sealed once, on the first refresh, and followed rather than read again on a refresh, the panel coming forward, or a write, until a sign-out",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks } = yield* subject(service);
      const seals = () => service.reads.filter((read) => read === "workspaces-live").length;

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_DELETE, { taskId: INVITES });
      yield* TestClock.adjust(Duration.minutes(1));
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.equal(seals(), 1);

      yield* tasks.reset;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.equal(seals(), 2);
    }),
);

it.effect(
  "the view carries whether GitHub is connected, read beside the workspaces, and a read the service did not answer keeps it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.connection = { connected: true, login: "ada" };
      const { call, last, tasks } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });

      service.connection = undefined;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });

      yield* tasks.reset;
      assert.equal(last()?.github, undefined);
    }),
);

it.effect(
  "connecting GitHub answers the service's page, and the panel coming forward then reads the connection again at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.deepEqual(last()?.github, { connected: false, login: null });

      const page = yield* call(GATEWAY_METHOD.GITHUB_CONNECT);
      service.connection = { connected: true, login: "ada" };
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);

      assert.deepEqual(page, { url: service.connectPages[0] });
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });
    }),
);

it.effect(
  "an admin read and a star ask the service and answer the caller as the service answered, holding nothing in the view",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      const readsBefore = service.reads.length;
      const viewBefore = last();

      const read = yield* call(GATEWAY_METHOD.ADMIN_READ, {
        procedure: "users",
        query: { window: "7" },
      });
      const starred = yield* call(GATEWAY_METHOD.ADMIN_FAVORITE, {
        id: "user-ada",
        favorite: true,
      });

      assert.deepEqual(read, { answer: { procedure: "users", query: { window: "7" } } });
      assert.equal(starred, true);
      assert.deepEqual(service.reads.slice(readsBefore), [
        "admin:users",
        "admin-favorite:user-ada:true",
      ]);
      assert.equal(last(), viewBefore);
    }),
);

it.effect(
  "disconnecting GitHub asks the service, and the view reads disconnected at once without a workspaces read",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.connection = { connected: true, login: "ada" };
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      const readsBefore = service.reads.length;

      const answered = yield* call(GATEWAY_METHOD.GITHUB_DISCONNECT);

      assert.deepEqual(answered, { connection: { connected: false, login: null } });
      assert.deepEqual(last()?.github, { connected: false, login: null });
      assert.deepEqual(service.reads.slice(readsBefore), ["github-disconnect"]);
    }),
);

it.effect(
  "a connection read that saw GitHub connected before a disconnect answered does not put it back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.connection = { connected: true, login: "ada" };
      const held = yield* Deferred.make<void>();
      service.githubGate = Deferred.await(held);
      const { call, last } = yield* subject(service);

      const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.WORKSPACES_REFRESH));
      for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
      yield* call(GATEWAY_METHOD.GITHUB_DISCONNECT);
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(refreshing);

      assert.deepEqual(last()?.github, { connected: false, login: null });
    }),
);

it.effect("GitHub as the account's only sign-in stays connected, and says so", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.connection = { connected: true, login: "ada" };
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    service.notPermitted = true;

    const answered = yield* call(GATEWAY_METHOD.GITHUB_DISCONNECT);

    assert.deepEqual(answered, { failure: GITHUB_DISCONNECT_FAILURE.NOT_PERMITTED });
    assert.deepEqual(last()?.github, { connected: true, login: "ada" });
  }),
);

it.effect("behind a closed account gate a GitHub page is never asked for", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service, { signedIn: false });

    const connect = yield* call(GATEWAY_METHOD.GITHUB_CONNECT);
    const disconnect = yield* call(GATEWAY_METHOD.GITHUB_DISCONNECT);

    assert.deepEqual(connect, { failure: TASK_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(disconnect, { failure: TASK_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(service.connectPages, []);
  }),
);

it.effect("behind a closed account gate the panel coming forward reads no workspaces", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service, { signedIn: false });

    yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);

    assert.deepEqual(service.reads, []);
  }),
);

it.effect("leaving a workspace reaches the service and the view then holds it no more", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    const { call, last, settled } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);

    const left = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });
    yield* settled;

    assert.deepEqual(left, { left: true });
    assert.deepEqual(last()?.workspaces, [PERSONAL]);
  }),
);

it.effect(
  "leaving the open plan's workspace ends the plan's call and closes the plan, and a refused leave keeps it open",
  () =>
    Effect.gen(function* () {
      const acmeTask = {
        ...task(INVITES, "Teammate invitations", "# Draft", 10),
        workspaceId: ACME.id,
      };
      const service = fakeService([acmeTask]);
      service.memberships = [PERSONAL, ACME];
      service.notPermitted = true;
      const standing: StandingCall = { about: { taskId: INVITES } };
      const { call, last, listed, openTask } = yield* subject(service, { call: standing });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(INVITES);

      const refused = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.equal(last()?.activeTaskId, INVITES);
      assert.equal(last()?.document.status, TASKS_READ.READY);
      assert.deepEqual(standing.about, { taskId: INVITES });

      service.notPermitted = false;
      const left = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

      assert.deepEqual(left, { left: true });
      assert.equal(last()?.activeTaskId, undefined);
      assert.deepEqual(last()?.document, { status: TASKS_READ.IDLE });
      assert.equal(standing.about, undefined);
    }),
);

it.effect(
  "leaving a workspace ends a call still standing about one of its plans that is no longer open, and keeps the open plan of another",
  () =>
    Effect.gen(function* () {
      const acmeTask = {
        ...task(INVITES, "Teammate invitations", "# Draft", 10),
        workspaceId: ACME.id,
      };
      const personalTask = {
        ...task(BILLING, "Billing", "# Billing", 20),
        workspaceId: PERSONAL.id,
      };
      const service = fakeService([acmeTask, personalTask]);
      service.memberships = [PERSONAL, ACME];
      const standing: StandingCall = { about: { taskId: INVITES } };
      const { call, last, listed, openTask } = yield* subject(service, { call: standing });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(BILLING);

      const left = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

      assert.deepEqual(left, { left: true });
      assert.equal(standing.about, undefined);
      assert.equal(last()?.activeTaskId, BILLING);
    }),
);

it.effect("leaving another workspace than the open plan's keeps the plan and its call", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    const standing: StandingCall = { about: { taskId: INVITES } };
    const { call, last, openTask } = yield* subject(service, { call: standing });
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* openTask(INVITES);

    yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

    assert.equal(last()?.activeTaskId, INVITES);
    assert.deepEqual(standing.about, { taskId: INVITES });
  }),
);

it.effect(
  "a removal or a leave the account's role does not allow answers not-permitted, and the view keeps the workspace",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA, GRACE];
      service.notPermitted = true;
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;

      const removed = yield* call(GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE, {
        workspaceId: ACME.id,
        userId: ADA.userId,
      });
      const left = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

      assert.deepEqual(removed, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(left, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(service.members[ACME.id], [ADA, GRACE]);
    }),
);

it.effect("behind a closed account gate no workspace call reaches the service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service, { signedIn: false });
    const unanswered = { failure: WORKSPACE_CALL_FAILURE.UNANSWERED };

    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_CREATE, { name: RELAY.name }),
      unanswered,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" }),
      unanswered,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, { workspaceId: ACME.id, photo: null }),
      unanswered,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT, { workspaceId: ACME.id }),
      unanswered,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT, { workspaceId: ACME.id }),
      unanswered,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS, { workspaceId: ACME.id }),
      unanswered,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE, {
        workspaceId: ACME.id,
        userId: GRACE.userId,
      }),
      unanswered,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id }),
      unanswered,
    );
    assert.deepEqual(service.reads, []);
  }),
);

it.effect(
  "a folder and the skills of a repository are read by its workspace and its name where no plan names it, and by the plan where one does",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const folder = (path: string): TaskTreeAnswer => ({
        folder: { path, repository: "acme/relay", branch: "main", entries: [], truncated: false },
      });
      const skills = (name: string): TaskSkillsAnswer => ({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [
            {
              name,
              description: "",
              source: TASK_SKILL_SOURCE.REPOSITORY,
              path: `.agents/skills/${name}/SKILL.md`,
            },
          ],
        },
      });
      service.places[ACME.id] = {
        "acme/relay": { folders: { src: folder("src") }, skills: skills("release") },
      };
      service.folders.docs = folder("docs");
      service.skills[INVITES] = skills("review");
      const { call } = yield* subject(service);
      const place = { workspaceId: ACME.id, repository: "acme/relay" };

      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_TREE, { ...place, path: "src" }),
        folder("src"),
      );
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_SKILLS, place), skills("release"));
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_TREE, { planId: INVITES, path: "docs" }),
        folder("docs"),
      );
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_SKILLS, { planId: INVITES }),
        skills("review"),
      );
    }),
);

it.effect(
  "a pull request is read by its workspace, its repository, and its number, none is answered as none, a service that did not answer as unanswered, and a number off the wire is refused before the service",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const merged: GitHubRepositoryPullRequestAnswer = {
        pullRequest: {
          number: 42,
          title: "Send invitations in batches",
          url: "https://github.com/acme/relay/pull/42",
          state: PULL_REQUEST_STATE.MERGED,
        },
      };
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([
          [42, merged],
          [43, { pullRequest: null }],
        ]),
      };
      const { call, told } = yield* subject(service);
      const asked = (number: number) =>
        call(GATEWAY_METHOD.TASKS_PULL_REQUEST, {
          workspaceId: ACME.id,
          repository: "acme/relay",
          number,
        });

      const read = yield* asked(42);
      const none = yield* asked(43);
      const unanswered = yield* asked(44);
      const offTheWire = yield* Effect.exit(asked(0));

      assert.deepEqual(read, merged);
      assert.deepEqual(none, { pullRequest: null });
      assert.deepEqual(unanswered, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.ok(Exit.isFailure(offTheWire), "a pull request is numbered from one");
      assert.equal(told.length, 0, "a pull request is never told in the view");
    }),
);

it.effect(
  "a pull request's read is kept for every link: forty links asking at once of a service that answers one read all get its answer, and a change on GitHub is answered once the minute it was kept for passes",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const answered = (title: string): GitHubRepositoryPullRequestAnswer => ({
        pullRequest: {
          number: 42,
          title,
          url: "https://github.com/acme/relay/pull/42",
          state: PULL_REQUEST_STATE.OPEN,
        },
      });
      service.pullRequests[ACME.id] = { "acme/relay": new Map([[42, answered("Batch invites")]]) };
      service.pullRequestGate = yield* Deferred.make<void>();
      service.pullRequestQuota = 1;
      const { call } = yield* subject(service);
      const asked = call(GATEWAY_METHOD.TASKS_PULL_REQUEST, {
        workspaceId: ACME.id,
        repository: "acme/relay",
        number: 42,
      });

      const links = yield* Effect.forkChild(
        Effect.all(
          Array.from({ length: 40 }, () => asked),
          { concurrency: "unbounded" },
        ),
      );
      yield* Effect.yieldNow;
      yield* Deferred.succeed(service.pullRequestGate, undefined);
      const first = yield* Fiber.join(links);
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([[42, answered("Send invites in batches")]]),
      };
      const withinTheMinute = yield* asked;
      service.pullRequestQuota = 1;
      yield* TestClock.adjust(Duration.minutes(1));
      const afterIt = yield* asked;

      assert.equal(first.length, 40);
      for (const one of first) assert.deepEqual(one, answered("Batch invites"));
      assert.deepEqual(withinTheMinute, answered("Batch invites"));
      assert.deepEqual(afterIt, answered("Send invites in batches"));
    }),
);

it.effect(
  "a pull request the service did not answer is answered unanswered again, without asking it, until two minutes pass, and a sign-out forgets every kept read",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const merged: GitHubRepositoryPullRequestAnswer = {
        pullRequest: {
          number: 7,
          title: "Batch invites",
          url: "https://github.com/acme/relay/pull/7",
          state: PULL_REQUEST_STATE.MERGED,
        },
      };
      const { call, tasks } = yield* subject(service);
      const asked = call(GATEWAY_METHOD.TASKS_PULL_REQUEST, {
        workspaceId: ACME.id,
        repository: "acme/relay",
        number: 7,
      });

      const refused = yield* asked;
      service.pullRequests[ACME.id] = { "acme/relay": new Map([[7, merged]]) };
      yield* TestClock.adjust(Duration.seconds(90));
      const stillRefused = yield* asked;
      yield* TestClock.adjust(Duration.seconds(30));
      const read = yield* asked;
      service.pullRequests[ACME.id] = { "acme/relay": new Map([[7, { pullRequest: null }]]) };
      yield* tasks.reset;
      const afterSignOut = yield* asked;

      assert.deepEqual(refused, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(stillRefused, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(read, merged);
      assert.deepEqual(afterSignOut, { pullRequest: null });
    }),
);

it.effect("behind a closed account gate a pull request's read does not reach the service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.pullRequests[ACME.id] = {
      "acme/relay": new Map([[42, { pullRequest: null }]]),
    };
    const { call } = yield* subject(service, { signedIn: false });

    assert.deepEqual(
      yield* call(GATEWAY_METHOD.TASKS_PULL_REQUEST, {
        workspaceId: ACME.id,
        repository: "acme/relay",
        number: 42,
      }),
      { failure: TASK_CALL_FAILURE.UNANSWERED },
    );
  }),
);

it.effect(
  "an issue is read by its workspace, its repository, and its number, none is answered as none, a service that did not answer as unanswered, a number off the wire is refused before the service, and behind a closed gate nothing reaches it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const notPlanned: GitHubRepositoryIssueAnswer = {
        issue: {
          number: 7,
          title: "Invitations expire too soon",
          url: "https://github.com/acme/relay/issues/7",
          state: ISSUE_STATE.NOT_PLANNED,
        },
      };
      service.issues[ACME.id] = {
        "acme/relay": new Map([
          [7, notPlanned],
          [8, { issue: null }],
        ]),
      };
      const open = yield* subject(service);
      const shut = yield* subject(service, { signedIn: false });
      const asked = (call: typeof open.call, number: number) =>
        call(GATEWAY_METHOD.TASKS_ISSUE, {
          workspaceId: ACME.id,
          repository: "acme/relay",
          number,
        });

      const read = yield* asked(open.call, 7);
      const none = yield* asked(open.call, 8);
      const unanswered = yield* asked(open.call, 9);
      const offTheWire = yield* Effect.exit(asked(open.call, 0));
      const gated = yield* asked(shut.call, 7);

      assert.deepEqual(read, notPlanned);
      assert.deepEqual(none, { issue: null });
      assert.deepEqual(unanswered, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.ok(Exit.isFailure(offTheWire), "an issue is numbered from one");
      assert.deepEqual(gated, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.equal(open.told.length, 0, "an issue is never told in the view");
    }),
);

it.effect(
  "an issue's read is kept as a pull request's is: a change on GitHub is answered once the minute passes, and an issue the service did not answer only after two",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const titled = (number: number, title: string): GitHubRepositoryIssueAnswer => ({
        issue: {
          number,
          title,
          url: `https://github.com/acme/relay/issues/${number}`,
          state: ISSUE_STATE.OPEN,
        },
      });
      service.issues[ACME.id] = { "acme/relay": new Map([[7, titled(7, "Invites expire")]]) };
      const { call } = yield* subject(service);
      const asked = (number: number) =>
        call(GATEWAY_METHOD.TASKS_ISSUE, {
          workspaceId: ACME.id,
          repository: "acme/relay",
          number,
        });

      const first = yield* asked(7);
      const refused = yield* asked(8);
      service.issues[ACME.id] = {
        "acme/relay": new Map([
          [7, titled(7, "Invitations expire too soon")],
          [8, titled(8, "Resend an invite")],
        ]),
      };
      const kept = yield* asked(7);
      yield* TestClock.adjust(Duration.minutes(1));
      const changed = yield* asked(7);
      const stillRefused = yield* asked(8);
      yield* TestClock.adjust(Duration.minutes(1));
      const read = yield* asked(8);

      assert.deepEqual(first, titled(7, "Invites expire"));
      assert.deepEqual(kept, titled(7, "Invites expire"));
      assert.deepEqual(changed, titled(7, "Invitations expire too soon"));
      assert.deepEqual(refused, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(stillRefused, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(read, titled(8, "Resend an invite"));
    }),
);

it.effect(
  "a repository's issues are read with the number or the words asked, an installation granting none is answered so, a service that did not answer as unanswered, and nothing is told in the view",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.repositoryIssues[ACME.id] = {
        "acme/relay": { issues: [] },
        "acme/ledger": {
          ungranted: { settingsUrl: "https://github.com/settings/installations/1" },
        },
      };
      const { call, told } = yield* subject(service);
      const asked = (repository: string, more: RepositoryIssuesAsk = {}) =>
        call(GATEWAY_METHOD.TASKS_GITHUB_ISSUES, { workspaceId: ACME.id, repository, ...more });

      const listed = yield* asked("acme/relay");
      yield* asked("acme/relay", { query: "invite" });
      yield* asked("acme/relay", { number: 7 });
      const ungranted = yield* asked("acme/ledger");
      const unanswered = yield* asked("acme/gone");

      assert.deepEqual(listed, { issues: [] });
      assert.deepEqual(ungranted, {
        ungranted: { settingsUrl: "https://github.com/settings/installations/1" },
      });
      assert.deepEqual(unanswered, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(service.issueAsks, [{}, { query: "invite" }, { number: 7 }, {}, {}]);
      assert.equal(told.length, 0, "issues are never told in the view");
    }),
);

it.effect(
  "a task's linked issues are read, linked, related, and unlinked through the service and answered to the page that asked, a link refused or a task out of reach answered so, nothing told in the view, and nothing asked behind a closed gate",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const taskId = randomUUID();
      service.issueLinks[taskId] = [];
      const open = yield* subject(service);
      const shut = yield* subject(service, { signedIn: false });
      const linear = { provider: TASK_ISSUE_PROVIDER.LINEAR, id: "ENG-42" };

      const linked = yield* open.call(GATEWAY_METHOD.TASKS_ISSUE_LINK, { taskId, issue: linear });
      const twice = yield* open.call(GATEWAY_METHOD.TASKS_ISSUE_LINK, { taskId, issue: linear });
      const linkId = service.issueLinks[taskId]?.[0]?.id ?? assert.fail("nothing was linked");
      const related = yield* open.call(GATEWAY_METHOD.TASKS_ISSUE_RELATE, {
        taskId,
        linkId,
        relation: TASK_ISSUE_RELATION.PART_OF,
      });
      const read = yield* open.call(GATEWAY_METHOD.TASKS_ISSUE_LINKS, { taskId });
      const standing = [...(service.issueLinks[taskId] ?? [])];
      const unlinked = yield* open.call(GATEWAY_METHOD.TASKS_ISSUE_UNLINK, { taskId, linkId });
      const elsewhere = yield* open.call(GATEWAY_METHOD.TASKS_ISSUE_LINKS, {
        taskId: randomUUID(),
      });
      const unnamed = yield* Effect.exit(
        open.call(GATEWAY_METHOD.TASKS_ISSUE_LINK, { taskId, issue: { provider: "jira" } }),
      );
      const gated = yield* shut.call(GATEWAY_METHOD.TASKS_ISSUE_LINKS, { taskId });

      assert.deepEqual(linked, { issue: { ...standing[0], relation: TASK_ISSUE_RELATION.CLOSES } });
      assert.deepEqual(twice, { refused: TASK_ISSUE_LINK_REFUSAL.LINKED });
      assert.deepEqual(related, { issue: standing[0] });
      assert.deepEqual(read, { issues: standing });
      assert.equal(standing[0]?.relation, TASK_ISSUE_RELATION.PART_OF);
      assert.deepEqual(unlinked, { unlinked: true });
      assert.deepEqual(service.issueLinks[taskId], []);
      assert.deepEqual(elsewhere, { failure: TASK_CALL_FAILURE.NOT_FOUND });
      assert.ok(Exit.isFailure(unnamed), "an issue is named by a provider the task links");
      assert.deepEqual(gated, { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.equal(open.told.length, 0, "a task's links are never told in the view");
    }),
);

it.effect(
  "a link made, related, and unlinked on a task's page lands on its row of the list in place, as the Board's tags, before Realtime delivers it and with nothing read again",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      service.issueLinks[INVITES] = [];
      const realtime = fakeRealtime();
      const { call, last } = yield* subject(service, { openLive: realtime.open });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* realtime.listSubscribed;
      realtime.deliverPart("plans", [rowOfTask(invites)]);
      realtime.deliverPart("agents", []);
      realtime.deliverPart("issues", []);
      yield* realtime.settled;
      const reads = [service.reads.length, service.liveListReads];
      const tagsOf = () => last()?.tasks.find((each) => each.id === INVITES)?.issues;

      yield* call(GATEWAY_METHOD.TASKS_ISSUE_LINK, {
        taskId: INVITES,
        issue: { provider: TASK_ISSUE_PROVIDER.LINEAR, id: "ENG-42" },
      });
      yield* call(GATEWAY_METHOD.TASKS_ISSUE_LINK, {
        taskId: INVITES,
        issue: { provider: TASK_ISSUE_PROVIDER.LINEAR, id: "ENG-7" },
      });
      const [first, second] = service.issueLinks[INVITES] ?? [];
      assert.ok(first !== undefined && second !== undefined, "both were linked");
      assert.deepEqual(
        tagsOf()?.map(({ key, relation }) => [key, relation]),
        [
          ["ENG-42", TASK_ISSUE_RELATION.CLOSES],
          ["ENG-7", TASK_ISSUE_RELATION.CLOSES],
        ],
      );

      yield* call(GATEWAY_METHOD.TASKS_ISSUE_RELATE, {
        taskId: INVITES,
        linkId: second.id,
        relation: TASK_ISSUE_RELATION.PART_OF,
      });
      assert.equal(tagsOf()?.[1]?.relation, TASK_ISSUE_RELATION.PART_OF);

      yield* call(GATEWAY_METHOD.TASKS_ISSUE_UNLINK, { taskId: INVITES, linkId: first.id });
      assert.deepEqual(
        tagsOf()?.map(({ key }) => key),
        ["ENG-7"],
      );
      yield* call(GATEWAY_METHOD.TASKS_ISSUE_UNLINK, { taskId: INVITES, linkId: second.id });
      assert.equal(tagsOf(), undefined, "a task left linking nothing names no tags");
      assert.deepEqual(
        [service.reads.length, service.liveListReads],
        reads,
        "the list is not read again",
      );
    }),
);

it.effect("the repository chip's read names the workspace it is for to the service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service);

    yield* call(GATEWAY_METHOD.TASKS_REPOSITORIES, { workspaceId: ACME.id });
    yield* call(GATEWAY_METHOD.TASKS_REPOSITORIES);

    assert.deepEqual(service.reads, [`repositories:${ACME.id}`, "repositories"]);
  }),
);

it.effect(
  "a plan moved to another workspace answers that workspace, and the list and the open document take it in place",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const { call, last, listed, openTask } = yield* subject(fakeService([invites]));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(INVITES);

      const moved = yield* call(GATEWAY_METHOD.TASKS_MOVE, {
        taskId: INVITES,
        workspaceId: ACME.id,
      });

      assert.deepEqual(moved, { workspaceId: ACME.id });
      assert.deepEqual(
        last()?.tasks.map((each) => each.workspaceId),
        [ACME.id],
      );
      const open = last()?.document;
      assert.equal(open?.status === TASKS_READ.READY ? open.task?.workspaceId : undefined, ACME.id);
    }),
);

it.effect(
  "a plan's status and priority set on the service land in the list and the open document in place, and a change naming neither never travels",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const realtime = fakeRealtime();
      const { call, last, openTask } = yield* subject(fakeService([invites]), {
        openLive: realtime.open,
      });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* realtime.listSubscribed;
      realtime.deliverPart("plans", [rowOfTask(invites)]);
      realtime.deliverPart("agents", []);
      realtime.deliverPart("issues", []);
      yield* realtime.settled;
      yield* openTask(INVITES);

      const changed = yield* call(GATEWAY_METHOD.TASKS_SET_STANDING, {
        taskId: INVITES,
        status: TASK_STATUS.DONE,
        priority: TASK_PRIORITY.HIGH,
      });
      const bare = yield* Effect.exit(call(GATEWAY_METHOD.TASKS_SET_STANDING, { taskId: INVITES }));

      assert.deepEqual(changed, { changed: true });
      assert.ok(Exit.isFailure(bare));
      assert.deepEqual(
        last()?.tasks.map((each) => [each.status, each.priority]),
        [[TASK_STATUS.DONE, TASK_PRIORITY.HIGH]],
      );
      const open = last()?.document;
      assert.equal(
        open?.status === TASKS_READ.READY ? open.task?.status : undefined,
        TASK_STATUS.DONE,
      );
    }),
);

it.effect(
  "a plan's assignee set on the service lands in the list and the open document in place, and null assigns it to no one",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const { call, last, listed, openTask } = yield* subject(fakeService([invites]));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(INVITES);
      const openAssignee = () => {
        const open = last()?.document;
        return open?.status === TASKS_READ.READY ? open.task?.assignee : undefined;
      };

      const assigned = yield* call(GATEWAY_METHOD.TASKS_SET_STANDING, {
        taskId: INVITES,
        assigneeId: "user-ada",
      });
      assert.deepEqual(assigned, { changed: true });
      assert.deepEqual(
        last()?.tasks.map((each) => each.assignee?.userId),
        ["user-ada"],
      );
      assert.equal(openAssignee()?.userId, "user-ada");

      yield* call(GATEWAY_METHOD.TASKS_SET_STANDING, { taskId: INVITES, assigneeId: null });
      assert.deepEqual(
        last()?.tasks.map((each) => each.assignee),
        [undefined],
      );
      assert.equal(openAssignee(), undefined);
    }),
);

/** A task's board sealed for following, named by the round it was sealed in. */
function sealedBoard(round: number): TaskBoardLiveAnswer {
  return {
    url: "wss://realtime.example/v1",
    queries: {
      board: { capability: `board-${round}`, queryFingerprint: "board", expiresAt: 3_600_000 },
    },
  };
}

/** Realtime as a script: each board subscription standing by the seal it was made with, which a test delivers rows to or stops for good. */
function fakeBoardRealtime() {
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const client: LiveClient = {
    subscribe: (query) => ({
      onChange: (listener) => {
        listeners.set(query.capability, listener);
        return () => listeners.delete(query.capability);
      },
      renew: () => Promise.resolve(),
      awaitTxId: () => Promise.resolve(),
      unsubscribe: () => void listeners.delete(query.capability),
    }),
    close: () => {},
  };
  const listener = (capability: string) => {
    const found = listeners.get(capability);
    assert.ok(found, `no subscription to ${capability}`);
    return found;
  };
  return {
    client,
    subscribed: () =>
      [...listeners.keys()].filter((capability) => !capability.startsWith("capability-")),
    deliver: (capability: string, data: readonly unknown[]) =>
      listener(capability)({ status: "live", data }),
    fail: (capability: string) => listener(capability)({ status: "error", data: undefined }),
  };
}

/** Every step the board's follow has to take, taken. */
const boardSettled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 20 },
);

it.effect(
  "the open task's board is read again as its followed mark moves, not for a delivery that left it, and a follow that stops is sealed again",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const drawn = (number: number, appliedDrawing: number): Board => ({
        elements: [],
        appliedDrawing,
        drawing: { number, elements: [] },
      });
      service.boards[INVITES] = { elements: [], appliedDrawing: 0 };
      service.boardSeals[INVITES] = sealedBoard(0);
      const realtime = fakeBoardRealtime();
      const { call, tasks, last, viewLands, openTask } = yield* subject(service, {
        openLive: () => realtime.client,
      });
      yield* tasks.lifetime;
      yield* openTask(INVITES);
      assert.deepEqual(last()?.board, { elements: [], appliedDrawing: 0 });
      yield* boardSettled;
      assert.deepEqual(realtime.subscribed(), ["board-0"]);

      // The first delivery reads the board again, since the open read may have missed a drawing.
      service.boards[INVITES] = drawn(1, 0);
      const first = yield* viewLands((view) => view.board?.drawing?.number === 1);
      realtime.deliver("board-0", [
        { taskId: INVITES, drawingNumber: 1, appliedDrawing: 0, imaged: false },
      ]);
      yield* first;

      // A delivery that left the mark where it stood reads nothing; one that moved it reads the board.
      service.boards[INVITES] = drawn(2, 1);
      const moved = yield* viewLands((view) => view.board?.drawing?.number === 2);
      realtime.deliver("board-0", [
        { taskId: INVITES, drawingNumber: 1, appliedDrawing: 0, imaged: false },
      ]);
      yield* TestClock.adjust(Duration.millis(1));
      assert.equal(last()?.board?.drawing?.number, 1);
      realtime.deliver("board-0", [
        { taskId: INVITES, drawingNumber: 2, appliedDrawing: 1, imaged: true },
      ]);
      yield* moved;

      // A follow Realtime stops is polled, and subscribed again on the next resubscribe.
      service.boardSeals[INVITES] = sealedBoard(1);
      realtime.fail("board-0");
      yield* TestClock.adjust(Duration.seconds(15));
      yield* boardSettled;
      assert.deepEqual(realtime.subscribed(), ["board-1"]);

      // Leaving the task lets the subscription go.
      yield* call(GATEWAY_METHOD.TASKS_CLOSE);
      assert.deepEqual(realtime.subscribed(), []);
    }),
);

it.effect(
  "a board save is answered once its transaction reaches the open task's followed board, and at once where nothing is followed",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      service.boards[INVITES] = { elements: [], appliedDrawing: 0 };
      service.boardSeals[INVITES] = {
        url: "wss://realtime.example/v1",
        queries: {
          board: {
            capability: "capability-board",
            queryFingerprint: "board",
            expiresAt: 3_600_000,
          },
        },
      };
      const realtime = fakeServiceRealtime();
      const { call, tasks, openTask } = yield* subject(service, { openLive: realtime.open });
      yield* tasks.lifetime;
      yield* openTask(INVITES);
      yield* boardSettled;
      realtime.deliver("board", [
        { taskId: INVITES, drawingNumber: 0, appliedDrawing: 0, imaged: false },
      ]);
      yield* boardSettled;
      const save = { taskId: INVITES, elements: [], appliedDrawing: 0 };

      // A save that moved the live row waits on its transaction before it answers.
      service.boardSaveTxid = "42";
      const saving = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_BOARD_SAVE, save));
      yield* boardSettled;
      assert.deepEqual(realtime.awaitingTxids(), ["42"]);
      assert.equal(saving.pollUnsafe(), undefined, "not answered before the transaction arrives");
      realtime.arrive("42");
      assert.deepEqual(yield* Fiber.join(saving), { saved: true });

      // A save that answers no transaction has nothing to wait for.
      service.boardSaveTxid = undefined;
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_BOARD_SAVE, save), { saved: true });

      // A save sent while one follow stood waits on no other: one let go meanwhile answers at once,
      // while a save queued behind it goes out under the follow standing then, and waits on that one.
      service.boardSaveTxid = "44";
      service.boardSaveHeld = yield* Deferred.make<void>();
      const inFlight = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_BOARD_SAVE, save));
      yield* boardSettled;
      const queued = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_BOARD_SAVE, save));
      yield* boardSettled;
      realtime.fail("board");
      yield* TestClock.adjust(Duration.seconds(15));
      yield* boardSettled;
      realtime.deliver("board", [
        { taskId: INVITES, drawingNumber: 0, appliedDrawing: 0, imaged: false },
      ]);
      yield* boardSettled;
      yield* Deferred.succeed(service.boardSaveHeld, undefined);
      service.boardSaveHeld = undefined;
      assert.deepEqual(yield* Fiber.join(inFlight), { saved: true });
      yield* boardSettled;
      assert.deepEqual(realtime.awaitingTxids(), ["44"]);
      assert.equal(
        queued.pollUnsafe(),
        undefined,
        "the queued save waits on the follow it went out under",
      );
      realtime.arrive("44");
      assert.deepEqual(yield* Fiber.join(queued), { saved: true });

      // A follow Realtime stopped is polled, which hands out no wait, so a save answers at once.
      delete service.boardSeals[INVITES];
      realtime.fail("board");
      yield* boardSettled;
      service.boardSaveTxid = "43";
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_BOARD_SAVE, save), { saved: true });
      assert.deepEqual(realtime.awaitingTxids(), []);
    }),
);

/** A task's pages and calls sealed for following, named by the round they were sealed in. */
function sealedRecord(round: number): TaskRecordLiveAnswer {
  const query = (part: string) => ({
    capability: `${part}-${round}`,
    queryFingerprint: part,
    expiresAt: 3_600_000,
  });
  return {
    url: "wss://realtime.example/v1",
    queries: { pages: query("pages"), calls: query("calls"), code: query("code") },
  };
}

/** One call about the task as its row delivers it, ended at `closedAt` or standing. */
function callRow(lastSegment: number, closedAt: number | null) {
  return {
    id: "call-1",
    closedAt,
    closeReason: closedAt === null ? null : "remote_hangup",
    usage: null,
    model: "gpt-realtime",
    lastSegment,
    spoken: 0,
  };
}

it.effect(
  "the open task's pages are read again as their mark moves, not on a call's words, its activity, or its end",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.codes[INVITES] = [];
      service.recordSeals[INVITES] = sealedRecord(0);
      const realtime = fakeBoardRealtime();
      const { call, tasks, openTask } = yield* subject(service, {
        openLive: () => realtime.client,
      });
      yield* tasks.lifetime;
      yield* openTask(INVITES);
      yield* boardSettled;
      assert.deepEqual(realtime.subscribed().toSorted(), ["calls-0", "code-0", "pages-0"]);
      const taken = () => service.recordReads.splice(0).toSorted();
      taken();
      const deliver = (pages: readonly unknown[], calls: readonly unknown[]) =>
        Effect.andThen(
          Effect.sync(() => {
            realtime.deliver("pages-0", pages);
            realtime.deliver("calls-0", calls);
            realtime.deliver("code-0", []);
          }),
          boardSettled,
        );
      const page = (version: number) => ({ pageId: "page-1", version });

      // The first delivery reads every part, since the reads the task opened with may have missed it.
      yield* deliver([page(1)], []);
      assert.deepEqual(taken(), ["code", "pages"]);

      yield* deliver([page(2)], []);
      assert.deepEqual(taken(), ["pages"]);

      // A call's words landing, its activity, and its end read nothing.
      yield* deliver([page(2)], [callRow(3, null)]);
      tasks.showActivity({
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        planId: INVITES,
        notes: false,
      });
      tasks.callEnded({ agentId: "agent-1", taskId: INVITES });
      yield* deliver([page(2)], [callRow(3, 5_000)]);
      yield* TestClock.adjust(Duration.seconds(5));
      yield* boardSettled;
      assert.deepEqual(taken(), []);

      // Leaving the task lets the subscriptions go.
      yield* call(GATEWAY_METHOD.TASKS_CLOSE);
      assert.deepEqual(realtime.subscribed(), []);
    }),
);

it.effect(
  "an agent's code shown on a typed turn is drawn once its mark moves, a call's code told live and read back is drawn once under the record's agent, and a later step of the same journal reads nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.codes[INVITES] = [];
      service.recordSeals[INVITES] = sealedRecord(0);
      const realtime = fakeBoardRealtime();
      const { tasks, viewLands, openTask } = yield* subject(service, {
        openLive: () => realtime.client,
      });
      yield* tasks.lifetime;
      yield* openTask(INVITES);
      yield* boardSettled;
      const deliver = (code: readonly unknown[]) =>
        Effect.andThen(
          Effect.sync(() => {
            realtime.deliver("pages-0", []);
            realtime.deliver("calls-0", []);
            realtime.deliver("code-0", code);
          }),
          boardSettled,
        );
      yield* deliver([]);
      const shown = (callId: string, turnId: string, shownAt: number) => ({
        callId,
        turnId,
        shownAt,
        code: {
          ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
          repository: "acme/api",
          firstLine: 1,
          lineCount: 1,
          lines: ["export const TTL = 7;"],
        },
      });

      // A call into the agent tells its code live, which names no agent.
      const told = yield* viewLands((view) =>
        (view.shownCode ?? []).some((code) => code.callId === "call-1"),
      );
      tasks.showCode(INVITES, shown("call-1", "turn-1", 10));
      yield* told;
      service.recordReads.splice(0);

      // The record lands with that call's copy and a typed turn's code, each under the agent.
      service.codes[INVITES] = [
        { ...shown("call-1", "turn-1", 10), agentId: "agent-1" },
        { ...shown("call-2", "turn-2", 20), agentId: "agent-1" },
      ];
      const read = yield* viewLands((view) =>
        (view.shownCode ?? []).some((code) => code.callId === "call-2"),
      );
      const journals = [
        { id: "journal-1", calls: '["call-1"]' },
        { id: "journal-2", calls: '["call-2"]' },
      ];
      yield* deliver(journals);
      const showing = (yield* read).shownCode ?? [];
      assert.deepEqual(
        showing.map((code) => [code.callId, code.agentId]),
        [
          ["call-1", "agent-1"],
          ["call-2", "agent-1"],
        ],
      );
      assert.deepEqual(service.recordReads.splice(0), ["code"]);

      // A later step of the same turn rewrites its journal and leaves its calls as they stood.
      yield* deliver(journals);
      assert.deepEqual(service.recordReads.splice(0), []);
    }),
);

it.effect(
  "a renewal that finds the open task gone ends the board's follow, rather than asking again",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      service.boards[INVITES] = { elements: [], appliedDrawing: 0 };
      service.boardSeals[INVITES] = sealedBoard(0);
      const realtime = fakeBoardRealtime();
      const { tasks, openTask } = yield* subject(service, {
        openLive: () => realtime.client,
      });
      yield* tasks.lifetime;
      yield* openTask(INVITES);
      yield* boardSettled;
      realtime.deliver("board-0", []);
      assert.deepEqual(realtime.subscribed(), ["board-0"]);

      // Another member deletes the task, so its seal is not found when the follow renews it.
      delete service.boardSeals[INVITES];
      yield* TestClock.adjust(Duration.hours(1));
      assert.deepEqual(realtime.subscribed(), []);
      yield* TestClock.adjust(Duration.hours(1));
      assert.deepEqual(realtime.subscribed(), []);
    }),
);

/** A task's pages sealed for following, named by the round it was sealed in. */
function sealedPages(round: number): TaskPagesLiveAnswer {
  return {
    url: "wss://realtime.example/v1",
    queries: {
      pages: { capability: `pages-${round}`, queryFingerprint: "pages", expiresAt: 3_600_000 },
    },
  };
}

const FUNNEL = {
  id: "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b",
  title: "Invite funnel",
  version: 1,
  at: 1_500,
};

it.effect(
  "a plan's pages followed for the Inbox are told as they move, never in the view, a seal the service did not answer is told as unanswered and sealed again, and let go they stop",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const realtime = fakeBoardRealtime();
      const { call, told, pushed } = yield* subject(service, { openLive: () => realtime.client });
      const changed = (view: WireValue) => [
        GATEWAY_EVENT.TASKS_PAGES_CHANGED,
        { taskId: INVITES, view },
      ];

      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* boardSettled;
      assert.deepEqual(pushed, [changed({ failure: TASK_CALL_FAILURE.UNANSWERED })]);

      service.pageSeals[INVITES] = sealedPages(1);
      yield* TestClock.adjust(Duration.seconds(2));
      yield* boardSettled;
      realtime.deliver("pages-1", [{ ...FUNNEL, shownBy: null }]);
      const shown = { ...FUNNEL, version: 2, at: 2_500, shownBy: { kind: PAGE_SHOWER.LUKE } };
      realtime.deliver("pages-1", [shown]);
      yield* boardSettled;
      assert.deepEqual(pushed.slice(1), [
        changed({ pages: [FUNNEL] }),
        changed({ pages: [shown] }),
      ]);
      assert.equal(
        told.length,
        0,
        "a plan's pages followed for the Inbox are never told in the view",
      );

      yield* call(GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW, { taskId: INVITES });
      yield* boardSettled;
      assert.deepEqual(realtime.subscribed(), []);
    }),
);

/** A task's Browser tabs sealed for following, named by the round it was sealed in. */
function sealedBrowserTabs(round: number): TaskBrowserTabsLiveAnswer {
  return {
    url: "wss://realtime.example/v1",
    queries: {
      tabs: { capability: `tabs-${round}`, queryFingerprint: "tabs", expiresAt: 3_600_000 },
    },
  };
}

/** One kept tab's row, as the live read delivers it, the agent's pointer on it. */
const SIGN_IN_TAB = {
  id: "7c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  agentId: "8d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
  address: "https://example.com/sign-in",
  title: "Sign in",
  openedBy: "agent",
  openedByUserId: null,
  driverUserId: null,
  heldUntil: null,
  createdAt: 1_000,
  lastActedAt: 1_500,
  cursorX: 320,
  cursorY: 200,
  cursorKind: "click",
  cursorViewportW: 1280,
  cursorViewportH: 800,
  cursorAt: 1_500,
} as const;

it.effect(
  "a task's Browser tabs followed for the side panel are told as they move, the agent's pointer among them, told again as a takeover lapses, and let go they stop",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const realtime = fakeBoardRealtime();
      const { call, told, pushed } = yield* subject(service, { openLive: () => realtime.client });
      const changed = (view: WireValue) => [
        GATEWAY_EVENT.TASKS_BROWSER_TABS_CHANGED,
        { taskId: INVITES, view },
      ];
      const tab = {
        id: SIGN_IN_TAB.id,
        agentId: SIGN_IN_TAB.agentId,
        address: SIGN_IN_TAB.address,
        title: SIGN_IN_TAB.title,
        openedBy: { kind: "agent" },
        createdAt: 1_000,
        lastActedAt: 1_500,
        cursor: {
          x: 320,
          y: 200,
          kind: "click",
          viewport: { width: 1280, height: 800 },
          at: 1_500,
        },
      };

      yield* call(GATEWAY_METHOD.TASKS_BROWSER_TABS_FOLLOW, { taskId: INVITES });
      yield* boardSettled;
      assert.deepEqual(pushed, [changed({ failure: TASK_CALL_FAILURE.UNANSWERED })]);

      service.browserTabSeals[INVITES] = sealedBrowserTabs(1);
      yield* TestClock.adjust(Duration.seconds(2));
      yield* boardSettled;
      // Dana takes the tab over until ten seconds in.
      realtime.deliver("tabs-1", [
        { ...SIGN_IN_TAB, driverUserId: "user-dana", heldUntil: 10_000 },
      ]);
      yield* boardSettled;
      assert.deepEqual(pushed.slice(1), [
        changed({ tabs: [{ ...tab, driver: { userId: "user-dana", heldUntil: 10_000 } }] }),
      ]);

      // Her window goes away, so the takeover lapses with no row moving.
      yield* TestClock.adjust(Duration.seconds(8));
      yield* boardSettled;
      assert.deepEqual(pushed.slice(2), [changed({ tabs: [{ ...tab, driver: null }] })]);
      assert.equal(told.length, 0, "a task's Browser tabs are never told in the view");

      yield* call(GATEWAY_METHOD.TASKS_BROWSER_TABS_UNFOLLOW, { taskId: INVITES });
      yield* boardSettled;
      assert.deepEqual(realtime.subscribed(), []);
    }),
);

it.effect(
  "a plan's newest page of history followed for its version history is told as saves land, never in the view",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.historySeals[INVITES] = {
        url: "wss://realtime.example/v1",
        queries: {
          revisions: { capability: "history-1", queryFingerprint: "history", expiresAt: 3_600_000 },
        },
      };
      const realtime = fakeBoardRealtime();
      const { call, told, pushed } = yield* subject(service, { openLive: () => realtime.client });
      const row = (seq: number, at: number) => ({
        seq,
        actor: PLAN_ACTOR.DEVELOPER,
        editorId: "user-dean",
        editorName: "Dean",
        liveSessionId: null,
        agentId: null,
        agentModel: null,
        agentTitle: null,
        callId: null,
        changes: 1,
        restoredFrom: null,
        at,
        startedAt: at,
        restoredAt: null,
      });
      const line = (seq: number, at: number) => ({
        seq,
        lastEdit: {
          actor: PLAN_ACTOR.DEVELOPER,
          by: { userId: "user-dean", name: "Dean" },
          at,
          duringCall: false,
        },
        startedAt: at,
        changes: 1,
      });

      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* boardSettled;
      realtime.deliver("history-1", [row(1, 1_000)]);
      realtime.deliver("history-1", [row(2, 2_000), row(1, 1_000)]);
      yield* boardSettled;
      assert.deepEqual(pushed, [
        [
          GATEWAY_EVENT.TASKS_HISTORY_CHANGED,
          { taskId: INVITES, view: { revisions: [line(1, 1_000)] } },
        ],
        [
          GATEWAY_EVENT.TASKS_HISTORY_CHANGED,
          { taskId: INVITES, view: { revisions: [line(2, 2_000), line(1, 1_000)] } },
        ],
      ]);
      assert.equal(told.length, 0, "a plan's history is never told in the view");
      yield* call(GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW, { taskId: INVITES });
      yield* boardSettled;
      assert.deepEqual(realtime.subscribed(), []);
    }),
);

it.effect(
  "a restore is confirmed once its transaction reaches the followed history, and at once where no history is followed",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.revisions[1] = {
        seq: 1,
        document: { body: "# Invites", assumptions: [] },
        previous: null,
      };
      service.historySeals[INVITES] = {
        url: "wss://realtime.example/v1",
        queries: {
          revisions: {
            capability: "capability-revisions",
            queryFingerprint: "history",
            expiresAt: 3_600_000,
          },
        },
      };
      const realtime = fakeServiceRealtime();
      const { call } = yield* subject(service, { openLive: realtime.open });

      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_RESTORE, { taskId: INVITES, seq: 1 }), {
        restored: true,
      });
      assert.deepEqual(realtime.awaitingTxids(), [], "no history is followed, so nothing waits");

      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* boardSettled;
      realtime.deliver("revisions", []);
      yield* boardSettled;
      const restore = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_RESTORE, { taskId: INVITES, seq: 1 }),
      );
      yield* boardSettled;
      assert.deepEqual(realtime.awaitingTxids(), ["txid-1"]);
      assert.equal(restore.pollUnsafe(), undefined, "the restore waits for its transaction");
      realtime.arrive("txid-1");
      assert.deepEqual(yield* Fiber.join(restore), { restored: true });
    }),
);

/** The host's clock as the live list is read at: renewals are timed by it, and the list's own instants by the test's clock set to it. */
const LIVE_NOW = 1_800_000_000_000;

/** The plan list sealed as the service answers it, each statement named by the part it follows. */
const SEALED_LIST: TaskListLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: {
    plans: { capability: "plans", queryFingerprint: "plans", expiresAt: LIVE_NOW + 60_000 },
    agents: { capability: "agents", queryFingerprint: "agents", expiresAt: LIVE_NOW + 60_000 },
    issues: { capability: "issues", queryFingerprint: "issues", expiresAt: LIVE_NOW + 60_000 },
  },
};

/** One plan as the plans statement delivers its row. */
function taskRow(id: string, name: string) {
  return {
    id,
    workspaceId: "workspace-personal",
    name,
    repository: null,
    ownerId: "user-dana",
    ownerName: "Dana",
    pinnedAt: null,
    pinPosition: null,
    // A key the service still answers for older builds, which this one reads past.
    archivedAt: null,
    createdAt: 1_000,
    updatedAt: 2_000,
    assigneeId: null,
    assigneeName: null,
    status: TASK_STATUS.TODO,
    priority: TASK_PRIORITY.NONE,
    number: 1,
  };
}

/** One plan as the plans statement delivers the service's task. */
function rowOfTask(each: Task) {
  return {
    ...taskRow(each.id, each.name),
    workspaceId: each.workspaceId,
    repository: each.repository,
    createdAt: each.createdAt,
    updatedAt: each.updatedAt,
    status: each.status ?? TASK_STATUS.TODO,
    priority: each.priority ?? TASK_PRIORITY.NONE,
  };
}

/** One agent of the plan, or of none, as the agents statement delivers its row, started `ago` before the list is read, with no turn yet. */
function agentRow(planId: string | null, ago: number) {
  return {
    id: "3f1d2c4b-5a6e-4f70-8a91-b2c3d4e5f607",
    planId,
    workspaceId: "workspace-personal",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    contextWindow: null,
    title: "Invite flow",
    brief: CODING_AGENT_BRIEF.PLAN,
    repository: "acme/relay",
    starterId: "user-dana",
    starterName: "Dana",
    automationId: null,
    automationName: null,
    archivedAt: null,
    archivedBy: null,
    archiverName: null,
    disabledServers: null,
    published: null,
    startedFrom: null,
    pinnedAt: null,
    pinPosition: null,
    createdAt: LIVE_NOW - ago,
    turnId: null,
    turnStatus: null,
    cancelRequested: null,
    queuedAt: null,
    startedAt: null,
    settledAt: null,
    turnSessionEnded: null,
    awaitingLineAt: null,
  };
}

it.effect(
  "a list that could not be read says so beside what it drew and is read again, and a read refused as signed out ends the follow",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.liveList = { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED };
      const realtime = fakeRealtime();
      const { call, last } = yield* subject(service, { openLive: realtime.open });

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* realtime.settled;
      assert.equal(last()?.listStatus, TASKS_READ.FAILED);

      service.liveList = { ok: true, answer: SEALED_LIST };
      yield* TestClock.adjust(Duration.seconds(5));
      yield* realtime.listSubscribed;
      realtime.deliverPart("plans", [taskRow(INVITES, "Teammate invitations, live")]);
      realtime.deliverPart("agents", []);
      realtime.deliverPart("issues", []);
      yield* realtime.settled;
      assert.equal(last()?.listStatus, TASKS_READ.READY);
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");

      // The session is another account's now: the subscription stops and the seal is refused for good.
      service.liveList = { ok: false, failure: LIVE_SIGNED_OUT.failure };
      realtime.failPart("plans");
      yield* realtime.settled;
      yield* TestClock.adjust(Duration.seconds(30));
      yield* realtime.settled;
      const reads = service.liveListReads;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* realtime.settled;
      assert.equal(service.liveListReads, reads, "a follow refused as signed out asks no more");
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");
    }),
);

it.effect(
  "the list is drawn from its live rows, and an agent with no turn reads failed once its grace ends with nothing read",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.liveList = { ok: true, answer: SEALED_LIST };
      const realtime = fakeRealtime();
      const { call, last } = yield* subject(service, { openLive: realtime.open });

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* realtime.listSubscribed;
      realtime.deliverPart("plans", [taskRow(INVITES, "Teammate invitations, live")]);
      realtime.deliverPart("agents", [agentRow(INVITES, 60_000)]);
      realtime.deliverPart("issues", []);
      yield* realtime.settled;
      const drawn = last()?.tasks[0];
      assert.equal(drawn?.name, "Teammate invitations, live");
      assert.deepEqual(
        [drawn?.agents?.working, drawn?.agents?.agents.map((line) => line.status)],
        [1, [CODING_AGENT_STATUS.STARTING]],
      );
      assert.deepEqual(
        last()?.taskAgents?.map((each) => [each.planId, each.status, each.turnId]),
        [[INVITES, CODING_AGENT_STATUS.STARTING, null]],
      );

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_DELETE, { taskId: BILLING });
      yield* TestClock.adjust(Duration.minutes(5));
      yield* realtime.settled;

      const ended = last()?.tasks[0]?.agents;
      assert.deepEqual(
        [ended?.working, ended?.agents.map((line) => line.status)],
        [0, [CODING_AGENT_STATUS.FAILED]],
      );
    }),
);

it.effect(
  "an agent whose line no turn takes reads running in the live list until the line's grace ends, then failed with nothing read",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.liveList = { ok: true, answer: SEALED_LIST };
      const realtime = fakeRealtime();
      const { call, last } = yield* subject(service, { openLive: realtime.open });

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* realtime.listSubscribed;
      realtime.deliverPart("plans", [taskRow(INVITES, "Teammate invitations, live")]);
      // A settled turn, and a line written after it that no turn has taken yet.
      realtime.deliverPart("agents", [
        {
          ...agentRow(INVITES, 30 * 60_000),
          turnId: "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d",
          turnStatus: TURN_STATUS.SETTLED,
          cancelRequested: false,
          queuedAt: LIVE_NOW - 20 * 60_000,
          startedAt: LIVE_NOW - 20 * 60_000,
          settledAt: LIVE_NOW - 10 * 60_000,
          turnSessionEnded: false,
          awaitingLineAt: LIVE_NOW - 60_000,
        },
      ]);
      realtime.deliverPart("issues", []);
      yield* realtime.settled;
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live", "the list is drawn live");
      assert.deepEqual(
        last()?.tasks[0]?.agents?.agents.map((line) => line.status),
        [CODING_AGENT_STATUS.RUNNING],
      );
      yield* TestClock.adjust(Duration.minutes(3));
      yield* realtime.settled;
      assert.deepEqual(
        last()?.tasks[0]?.agents?.agents.map((line) => line.status),
        [CODING_AGENT_STATUS.RUNNING],
        "inside the line's grace",
      );
      yield* TestClock.adjust(Duration.minutes(2));
      yield* realtime.settled;
      assert.deepEqual(
        last()?.tasks[0]?.agents?.agents.map((line) => line.status),
        [CODING_AGENT_STATUS.FAILED],
        "the line's grace ran out with no row moving",
      );
    }),
);

it.effect(
  "a list whose subscription stops for good is sealed and subscribed again after a pause, and drawn from the new rows",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const realtime = fakeRealtime();
      const { call, last } = yield* subject(service, { openLive: realtime.open });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* realtime.listSubscribed;
      realtime.deliverPart("plans", [taskRow(INVITES, "Teammate invitations, live")]);
      realtime.deliverPart("agents", []);
      realtime.deliverPart("issues", []);
      yield* realtime.settled;
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");
      assert.deepEqual(last()?.taskAgents, []);

      realtime.failPart("plans");
      yield* realtime.settled;
      yield* TestClock.adjust(Duration.seconds(5));
      yield* realtime.listSubscribed;
      realtime.deliverPart("plans", [taskRow(INVITES, "Teammate invitations, again")]);
      realtime.deliverPart("agents", []);
      realtime.deliverPart("issues", []);
      yield* realtime.settled;
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, again");
    }),
);

it.effect(
  "a workspace's people are followed over Realtime while a window follows them, each change told in the held read's order, and let go on unfollow or a sign-out",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA];
      const { call, events, tasks, settled } = yield* subject(service);
      const people = () =>
        events
          .filter((event) => event.kind === GATEWAY_EVENT.WORKSPACE_PEOPLE_CHANGED)
          .map((event) => event.payload);

      yield* call(GATEWAY_METHOD.WORKSPACES_PEOPLE_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
      const row = (member: typeof ADA) => ({
        userId: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        image: null,
      });
      service.realtime.deliver("members", [row(GRACE), row(ADA)]);
      service.realtime.deliver("former", []);
      yield* settled;
      service.realtime.deliver("former", [{ userId: "user-lee", name: "Lee Park", image: null }]);
      yield* settled;

      assert.deepEqual(people(), [
        { workspaceId: ACME.id, view: { members: [ADA, GRACE] } },
        {
          workspaceId: ACME.id,
          view: { members: [ADA, GRACE], former: [{ userId: "user-lee", name: "Lee Park" }] },
        },
      ]);
      assert.ok(!JSON.stringify(people()).includes("capability"), "no sealed statement is told");

      yield* call(GATEWAY_METHOD.WORKSPACES_PEOPLE_UNFOLLOW, { workspaceId: ACME.id });
      assert.ok(!service.realtime.subscribed().includes("capability-members"));
      yield* call(GATEWAY_METHOD.WORKSPACES_PEOPLE_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      assert.ok(service.realtime.subscribed().includes("capability-members"));
      yield* tasks.reset;
      assert.ok(!service.realtime.subscribed().includes("capability-members"));
    }),
);

it.effect(
  "a people seal that fails for now is asked again without telling the window, so it keeps the people it holds",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.members[ACME.id] = [ADA];
      service.workspacesFail = true;
      const { call, events, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.WORKSPACES_PEOPLE_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;

      assert.deepEqual(events, [], "no refusal reaches the window");
      assert.ok(
        service.reads.filter((read) => read === `people-live:${ACME.id}`).length > 1,
        "the seal is asked again",
      );
    }),
);

it.effect("a workspace the account is not in is told not found once, and not asked again", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call, events, settled } = yield* subject(service);

    yield* call(GATEWAY_METHOD.WORKSPACES_PEOPLE_FOLLOW, { workspaceId: ACME.id });
    yield* settled;
    yield* TestClock.adjust(Duration.minutes(1));
    yield* settled;

    assert.deepEqual(events, [
      {
        kind: GATEWAY_EVENT.WORKSPACE_PEOPLE_CHANGED,
        payload: { workspaceId: ACME.id, view: { failure: WORKSPACE_CALL_FAILURE.NOT_FOUND } },
      },
    ]);
    assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
  }),
);

it.effect(
  "a workspace's invitations are followed for an owner or an admin, the expired left out by the host's clock and each with its accept link, and a role that may not is told so once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, events, settled } = yield* subject(service);
      const invitations = () =>
        events
          .filter((event) => event.kind === GATEWAY_EVENT.WORKSPACE_INVITATIONS_CHANGED)
          .map((event) => event.payload);

      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      const row = (id: string, expiresAt: number) => ({
        id,
        email: `${id}@example.com`,
        role: WORKSPACE_ROLE.MEMBER,
        expiresAt,
      });
      service.realtime.deliver("invitations", [
        row("late", 9_000),
        row("spent", 0),
        row("soon", 5_000),
      ]);
      yield* settled;
      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_UNFOLLOW, { workspaceId: ACME.id });
      service.notPermitted = true;
      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, { workspaceId: RELAY.id });
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;

      const accept = (id: string) =>
        `https://luke.test/accept-invitation.html?id=${id}&email=${id}%40example.com`;
      assert.deepEqual(invitations(), [
        {
          workspaceId: ACME.id,
          view: {
            invitations: ["soon", "late"].map((id) => ({
              id,
              email: `${id}@example.com`,
              role: WORKSPACE_ROLE.MEMBER,
              expiresAt: new Date(id === "soon" ? 5_000 : 9_000).toISOString(),
              acceptUrl: accept(id),
            })),
          },
        },
        { workspaceId: RELAY.id, view: { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED } },
      ]);
    }),
);
