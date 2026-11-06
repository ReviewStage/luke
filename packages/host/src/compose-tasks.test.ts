import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  GITHUB_CONNECTION_CALL_FAILURE,
  type GitHubRepositoriesAnswer,
  type GitHubRepositoryIssueAnswer,
  type GitHubRepositoryPullRequestAnswer,
  type TaskCallResult,
  type TaskStarted,
  type TaskWritten,
  WORKSPACE_CALL_FAILURE,
  type WorkspaceCallResult,
} from "@repo/features";
import { BROWSER_TABS_PLACE, browserTabsPlaceId } from "@repo/features/agent-browser-tab-wire";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { AGENT_STATUS, PULL_REQUEST_STATE, type TasklessAgent } from "@repo/features/agent-wire";
import type { GitHubConnection } from "@repo/features/github-connection-wire";
import { ISSUE_STATE } from "@repo/features/github-repositories-wire";
import { WRITE_UNTAKEN, type WriteUntaken } from "@repo/features/keyed-write";
import { LIVE_SIGNED_OUT, type SealedLiveQueryWire } from "@repo/features/live-wire";
import { PAGE_OWNER, PAGE_SHOWER, type PageVersion, pagePlaceId } from "@repo/features/page-wire";
import { PICTURE_TYPE, type PictureType } from "@repo/features/picture-wire";
import {
  DESCRIPTION_COMMENT_ACTION,
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_REFUSAL,
  DESCRIPTION_COMMENT_SCOPE,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import type { DescriptionEditAnswer } from "@repo/features/description-edit";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import type { SlackListedChannel, WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import {
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSections,
  type TaskSectionsWritten,
  type TaskSectionWrite,
} from "@repo/features/task-section-wire";
import {
  DESCRIPTION_ACTOR,
  type DescriptionRevisionAnswer,
  type DescriptionRevisionsAnswer,
  type RepositoryPin,
  type RepositoryPinsWritten,
  TASK_BLOCK_CHANGE,
  TASK_BLOCK_RELATION,
  TASK_PRIORITY,
  TASK_RELATION_KIND,
  TASK_SKILL_SOURCE,
  TASK_STATUS,
  type Task,
  type TaskAgentsSummary,
  type TaskFileAnswer,
  type TaskSkillsAnswer,
  type TaskTreeAnswer,
} from "@repo/features/task-wire";
import {
  type BlockCallFailure,
  BROWSER_TAB_OPEN_FAILURE,
  COMMENT_SUBJECT,
  GITHUB_DISCONNECT_FAILURE,
  type HeldDescriptionDocument,
  HOST_LIVE,
  type ParentCallFailure,
  PICTURE_KEEP_FAILURE,
  type RelationCallFailure,
  type RepositoryCallFailure,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskCallFailure,
  type TasksCommentAnswer,
  type TasksView,
  tasksViewSchema,
} from "@repo/features/tasks-view";
import type { WorkspaceIntegrations } from "@repo/features/workspace-integrations-live";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import {
  WORKSPACE_PHOTO_TYPE,
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
  type WorkspacePhotoType,
} from "@repo/features/workspace-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { type EntityPool, entityPool } from "@repo/sync";
import { isRecord, TURN_STATUS, type WireRecord, type WireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { noNetwork } from "@repo/wire/testing";
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Result, Scope } from "effect";
import { TestClock } from "effect/testing";
import {
  type AppHostRead,
  type AppDescriptionComments,
  type AppDescriptionDocuments,
  NO_KEYS_HELD,
} from "./app-state.js";
import { composeTasks, type TasksClient } from "./compose-tasks.js";
import { type EntityStore, KEPT_READ, openEntityStore } from "./entity-store.js";
import { FIXTURE_IDS, FIXTURE_PAGE } from "./fixture-stage.js";
import { KEPT_CONTENT_CHARACTERS, keptContent } from "./kept-content.js";
import { memoryFileSystem } from "./testing/memory-file-system.js";
import { type PolledLive, polledLive } from "./testing/polled-live.js";
import { agentListRow } from "./testing/task-list-rows.js";
import { testCipher } from "./testing/test-cipher.js";
import { windowFocus } from "./window-focus.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SECTION_ID = "3c9e1a2b-4d5f-4a6b-8c7d-9e0f1a2b3c4d";
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

const MARKED_AT = 5_000;

interface FakeService extends TasksClient {
  tasks: Task[];
  threads: Record<string, DescriptionCommentThread[]>;
  commentCalls: string[];
  commentAnswer: TasksCommentAnswer | undefined;
  commentGate: Deferred.Deferred<void> | undefined;
  commentLives: Record<string, PolledLive<CommentPart, typeof NOT_FOUND_LIVE>>;
  agents: Record<string, TaskAgentsSummary>;
  tasklessAgents: TasklessAgent[];
  liveListReads: number;
  deleteFails: boolean;
  deleteAnswered: Effect.Effect<void>;
  relationFails: boolean;
  relationAnswered: Effect.Effect<void>;
  createAnswer: TaskCallResult<TaskStarted, RepositoryCallFailure>;
  createKeys: (string | undefined)[];
  repositoriesAnswer: TaskCallResult<GitHubRepositoriesAnswer, typeof TASK_CALL_FAILURE.UNANSWERED>;
  repositoryUnreachable: boolean;
  readonly reads: string[];
  recordLives: Record<string, PolledLive<RecordPart, typeof NOT_FOUND_LIVE>>;
  opensUnanswered: number;
  pageLives: Record<string, PolledLive<"pages", typeof NOT_FOUND_LIVE>>;
  browserTabLives: Record<string, PolledLive<"tabs", typeof NOT_FOUND_LIVE>>;
  historyLives: Record<string, PolledLive<"revisions">>;
  files: Record<string, TaskFileAnswer>;
  folders: Record<string, TaskTreeAnswer>;
  skills: Record<string, TaskSkillsAnswer>;
  places: Record<
    string,
    Record<
      string,
      {
        files: Record<string, TaskFileAnswer>;
        folders: Record<string, TaskTreeAnswer>;
        skills: TaskSkillsAnswer;
      }
    >
  >;
  pullRequests: Record<string, Record<string, Map<number, GitHubRepositoryPullRequestAnswer>>>;
  pullRequestQuota: number | undefined;
  tokenRepositorySet: { readonly ok: true; readonly answer: readonly [] } | undefined;
  pullRequestGate: Deferred.Deferred<void> | undefined;
  issues: Record<string, Record<string, Map<number, GitHubRepositoryIssueAnswer>>>;
  history: DescriptionRevisionsAnswer | undefined;
  olderHistory: Record<number, DescriptionRevisionsAnswer>;
  revisions: Record<number, DescriptionRevisionAnswer["revision"]>;
  pages: PageVersion[];
  pictures: Map<string, Map<string, { contentType: PictureType; base64: string }>>;
  editAnswer: DescriptionEditAnswer | undefined;
  editTxid: string | undefined;
  pins: RepositoryPin[];
  pinsFail: boolean;
  pinTxid: string | undefined;
  markTxid: string | undefined;
  markFails: boolean;
  repositoryTxid: string | undefined;
  markAnswered: Effect.Effect<void>;
  pinAnswered: Effect.Effect<void>;
  sections: TaskSections | undefined;
  sectionWrites: TaskSectionWrite[];
  sectionRefused: TaskSectionWrite["kind"] | undefined;
  renameUntaken: WriteUntaken | undefined;
  renameKeys: (string | undefined)[];
  sectionAnswered: Effect.Effect<void>;
  memberships: Workspace[];
  installUrl: string;
  workspacesFail: boolean;
  workspacesSignedOut: boolean;
  renamedAgain: string | undefined;
  renameAnswered: Effect.Effect<void>;
  roleAnswered: Effect.Effect<void>;
  slugTaken: string | undefined;
  slugAnswered: Effect.Effect<void>;
  followMisses: boolean;
  readonly live: {
    readonly workspaces: PolledLive<"workspaces" | "installations">;
    readonly sidebar: PolledLive<"sections" | "entries" | "agentEntries" | "pins">;
    readonly people: PolledLive<
      "members" | "former",
      { readonly failure: typeof WORKSPACE_CALL_FAILURE.NOT_FOUND }
    >;
    readonly invitations: PolledLive<"invitations">;
    readonly integrations: PolledLive<
      "sentryInstallations" | "slackInstallation" | "slackChannelRepositories"
    >;
    readonly list: PolledLive<
      "plans" | "agents" | "issues",
      { readonly failure: typeof TASK_CALL_FAILURE.UNANSWERED | typeof LIVE_SIGNED_OUT.failure }
    >;
  };
  members: Record<string, WorkspaceMember[]>;
  invitations: Record<string, WorkspaceInvitation[]>;
  photos: Record<string, { contentType: WorkspacePhotoType; base64: string }>;
  notPermitted: boolean;
  sentryAnswer: WorkspaceCallResult<WorkspaceSentry>;
  slackBotAnswer: WorkspaceCallResult<WorkspaceSlackBot>;
  integrationsGate: Effect.Effect<void>;
  connection: GitHubConnection | undefined;
  githubGate: Effect.Effect<void>;
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

type RecordPart = "description" | "pages" | "calls" | "code";

type CommentPart = "threads" | "entries" | "files";

const NOT_FOUND_LIVE = { failure: TASK_CALL_FAILURE.NOT_FOUND } as const;

const INVITATIONS_ORIGIN = "https://app.test";

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

function workspacesLiveRows(workspaces: readonly Workspace[]) {
  return {
    workspaces: workspaces.map((each) => ({
      id: each.id,
      name: each.name,
      slug: each.slug ?? "",
      own: each.id === PERSONAL.id,
      personal: each.personal === true,
      role: each.role,
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
const ADA: WorkspaceMember = {
  userId: "user-ada",
  name: "Ada Lovelace",
  email: "ada@app.test",
  role: WORKSPACE_ROLE.ADMIN,
};
const GRACE: WorkspaceMember = {
  userId: "user-grace",
  name: "Grace Hopper",
  email: "grace@app.test",
  role: WORKSPACE_ROLE.MEMBER,
};

const UNANSWERED_WORKSPACE = { ok: false, failure: WORKSPACE_CALL_FAILURE.UNANSWERED } as const;
const NOT_PERMITTED_WORKSPACE = {
  ok: false,
  failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
} as const;

const EDITED_AT = 7_000;

type ListAnswer = Exclude<
  ReturnType<PolledLive<"plans" | "agents" | "issues">["first"]>,
  { readonly failure: string }
>;

type ListAt = Map<string, ReadonlyMap<"plans" | "agents", ReadonlyMap<string, string>>>;

function rowsById(rows: readonly unknown[] | undefined): ReadonlyMap<string, string> {
  return new Map(
    (rows ?? []).flatMap((row) => {
      const id = typeof row === "object" && row !== null ? Reflect.get(row, "id") : undefined;
      return typeof id === "string" ? [[id, JSON.stringify(row)] as const] : [];
    }),
  );
}

function listBySyncId(answer: ListAnswer, past: string | undefined, listAt: ListAt): ListAnswer {
  const next = answer.queries.plans.digest ?? "0";
  const before = past === undefined ? undefined : listAt.get(past);
  const now = new Map([
    ["plans", rowsById(answer.queries.plans.rows)],
    ["agents", rowsById(answer.queries.agents.rows)],
  ] as const);
  listAt.set(next, now);
  const part = (name: "plans" | "agents"): SealedLiveQueryWire => {
    const query = answer.queries[name];
    const sync = past === undefined ? { next } : { past, next };
    const was = before?.get(name);
    const ids = now.get(name) ?? new Map<string, string>();
    if (was === undefined || query.rows === undefined) return { ...query, sync };
    const rows = query.rows.filter((row) => {
      const id = typeof row === "object" && row !== null ? Reflect.get(row, "id") : undefined;
      return typeof id === "string" && was.get(id) !== ids.get(id);
    });
    const gone = [...was.keys()].filter((id) => !ids.has(id));
    return { ...query, rows, sync, gone };
  };
  return {
    ...answer,
    queries: { ...answer.queries, plans: part("plans"), agents: part("agents") },
  };
}

function fakeService(tasks: Task[]): FakeService {
  let memberships: Workspace[] = [PERSONAL];
  const listAt: ListAt = new Map();
  let followMisses = false;
  const live: FakeService["live"] = {
    workspaces: polledLive<"workspaces" | "installations">(["workspaces", "installations"], () =>
      workspacesLiveRows(memberships),
    ),
    sidebar: polledLive<"sections" | "entries" | "agentEntries" | "pins">(
      ["sections", "entries", "agentEntries", "pins"],
      () => sidebarLiveRows(service.sections, service.pins),
    ),
    people: polledLive<
      "members" | "former",
      { readonly failure: typeof WORKSPACE_CALL_FAILURE.NOT_FOUND }
    >(["members", "former"]),
    invitations: polledLive<"invitations">(["invitations"]),
    integrations: polledLive<
      "sentryInstallations" | "slackInstallation" | "slackChannelRepositories"
    >(["sentryInstallations", "slackInstallation", "slackChannelRepositories"]),
    list: polledLive<
      "plans" | "agents" | "issues",
      { readonly failure: typeof TASK_CALL_FAILURE.UNANSWERED | typeof LIVE_SIGNED_OUT.failure }
    >(["plans", "agents", "issues"]),
  };
  const called = <Answer, Failure extends string>(
    read: Effect.Effect<Answer | { readonly failure: Failure }>,
  ): Effect.Effect<TaskCallResult<Answer, Failure>> =>
    Effect.map(read, (answer) =>
      typeof answer === "object" && answer !== null && "failure" in answer
        ? { ok: false as const, failure: answer.failure }
        : { ok: true as const, answer: answer as Answer },
    );
  const asked = <Part extends string, Refused extends { readonly failure: string }>(
    read: PolledLive<Part, Refused>,
    poll: boolean | undefined,
    after: string | undefined,
  ) => (poll === true ? read.poll(after) : Effect.succeed(read.first()));
  const service: FakeService = {
    tasks,
    threads: {},
    commentCalls: [],
    commentAnswer: undefined,
    commentGate: undefined,
    commentLives: {},
    commentsLive: (subject, _userId, poll, after) =>
      Effect.suspend((): ReturnType<TasksClient["commentsLive"]> => {
        const read = service.commentLives[subject.pageId ?? subject.taskId];
        return read === undefined
          ? Effect.succeed({ ok: false, failure: TASK_CALL_FAILURE.UNANSWERED } as const)
          : called(asked(read, poll, after));
      }),
    startComment: (planId, start) =>
      Effect.sync(() => {
        if ("page" in start) throw new Error("the fake holds no page's threads");
        service.commentCalls.push(`start:${planId}:${start.quote}`);
        const thread: DescriptionCommentThread = {
          id: start.id ?? "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11",
          scope: start.scope,
          quote: start.quote,
          anchor: start.anchor,
          section: "Goal",
          status: DESCRIPTION_COMMENT_STATUS.OPEN,
          entries: [
            {
              id: "5f2b0c1e-8d3a-4c7b-9e6f-1a2b3c4d5e6f",
              kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
              writer: {
                actor: DESCRIPTION_COMMENT_ACTOR.MEMBER,
                by: { userId: "u1", name: "Dean" },
              },
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
      Effect.andThen(
        Effect.suspend(() =>
          service.commentGate === undefined ? Effect.void : Deferred.await(service.commentGate),
        ),
        Effect.sync(() => {
          service.commentCalls.push(`act:${planId}:${threadId}:${action.action}`);
          return service.commentAnswer ?? { deleted: threadId };
        }),
      ),
    agents: {},
    tasklessAgents: [],
    liveListReads: 0,
    deleteFails: false,
    deleteAnswered: Effect.void,
    relationFails: false,
    relationAnswered: Effect.void,
    createAnswer: { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED },
    createKeys: [],
    repositoriesAnswer: { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED },
    repositoryUnreachable: false,
    reads: [],
    recordLives: {},
    opensUnanswered: 0,
    pageLives: {},
    browserTabLives: {},
    historyLives: {},
    files: {},
    folders: {},
    skills: {},
    places: {},
    pullRequests: {},
    pullRequestQuota: undefined,
    tokenRepositorySet: undefined,
    pullRequestGate: undefined,
    issues: {},
    history: undefined,
    olderHistory: {},
    revisions: {},
    find: () => Effect.succeed(undefined),
    readRevisions: (_taskId, before) =>
      Effect.sync(() => (before === undefined ? service.history : service.olderHistory[before])),
    readRevision: (_taskId, seq) => Effect.sync(() => service.revisions[seq]),
    pages: [],
    pictures: new Map(),
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
    restore: (taskId, seq) =>
      Effect.sync(() => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        const revision = service.revisions[seq];
        if (found === undefined || revision === undefined) return undefined;
        const restored: Task = {
          ...found,
          document: revision.document,
          updatedAt: found.updatedAt + 1,
          lastEdit: {
            actor: DESCRIPTION_ACTOR.DEVELOPER,
            at: found.updatedAt + 1,
            duringCall: false,
          },
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? restored : candidate,
        );
        return { task: restored, txid: `txid-${seq}` };
      }),
    editAnswer: undefined,
    editTxid: undefined,
    pins: [],
    pinsFail: false,
    pinTxid: undefined,
    markTxid: undefined,
    markFails: false,
    repositoryTxid: undefined,
    markAnswered: Effect.void,
    pinAnswered: Effect.void,
    sections: undefined,
    sectionWrites: [],
    sectionRefused: undefined,
    renameUntaken: undefined,
    renameKeys: [],
    sectionAnswered: Effect.void,
    get memberships() {
      return memberships;
    },
    set memberships(next) {
      memberships = next;
      if (!followMisses) live.workspaces.move();
    },
    get followMisses() {
      return followMisses;
    },
    set followMisses(next) {
      followMisses = next;
    },
    live,
    installUrl: INSTALL_URL,
    workspacesFail: false,
    workspacesSignedOut: false,
    renamedAgain: undefined,
    renameAnswered: Effect.void,
    roleAnswered: Effect.void,
    slugTaken: undefined,
    slugAnswered: Effect.void,
    members: {},
    invitations: {},
    photos: {},
    notPermitted: false,
    sentryAnswer: UNANSWERED_WORKSPACE,
    slackBotAnswer: UNANSWERED_WORKSPACE,
    integrationsGate: Effect.void,
    connection: { connected: false, login: null },
    githubGate: Effect.void,
    connectPages: [],
    github: {
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
          const url = `https://vespin.dev/connect-github.html?intent=intent-${service.connectPages.length + 1}`;
          service.connectPages.push(url);
          return { ok: true as const, answer: { url } };
        }),
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
    workspaces: {
      tokenRepositories: () => Effect.succeed(UNANSWERED_WORKSPACE),
      setTokenRepository: () => Effect.succeed(service.tokenRepositorySet ?? UNANSWERED_WORKSPACE),
      invitationsLive: (workspaceId, _userId, poll, after) =>
        Effect.suspend((): ReturnType<TasksClient["workspaces"]["invitationsLive"]> => {
          if (poll !== true) service.reads.push(`invitations-live:${workspaceId}`);
          if (service.notPermitted) return Effect.succeed(NOT_PERMITTED_WORKSPACE);
          return Effect.map(asked(live.invitations, poll, after), (answer) => ({
            ok: true as const,
            answer: { ...answer, origin: INVITATIONS_ORIGIN },
          }));
        }),
      peopleLive: (workspaceId, _userId, poll, after) =>
        Effect.suspend((): ReturnType<TasksClient["workspaces"]["peopleLive"]> => {
          if (poll !== true) service.reads.push(`people-live:${workspaceId}`);
          if (service.workspacesFail) return Effect.succeed(UNANSWERED_WORKSPACE);
          return service.members[workspaceId] === undefined
            ? Effect.succeed({ ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_FOUND } as const)
            : Effect.map(asked(live.people, poll, after), (answer) =>
                "failure" in answer
                  ? ({ ok: false, failure: answer.failure } as const)
                  : ({ ok: true, answer } as const),
              );
        }),
      live: (_userId, poll, after) =>
        Effect.suspend((): ReturnType<TasksClient["workspaces"]["live"]> => {
          if (poll !== true) service.reads.push("workspaces-live");
          if (service.workspacesFail) return Effect.succeed(UNANSWERED_WORKSPACE);
          if (service.workspacesSignedOut) {
            return Effect.succeed({ ok: false, failure: LIVE_SIGNED_OUT.failure } as const);
          }
          return Effect.map(asked(live.workspaces, poll, after), (answer) =>
            service.workspacesSignedOut
              ? ({ ok: false, failure: LIVE_SIGNED_OUT.failure } as const)
              : ({ ok: true, answer } as const),
          );
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
      setSlug: (workspaceId, slug) =>
        Effect.sync(() => {
          service.reads.push(`slugSet:${workspaceId}:${slug}`);
          return slug === service.slugTaken
            ? ({ ok: false, failure: WORKSPACE_CALL_FAILURE.SLUG_TAKEN } as const)
            : UNANSWERED_WORKSPACE;
        }).pipe(Effect.tap(() => service.slugAnswered)),
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
      integrationsLive: (workspaceId, _userId, poll, after) =>
        Effect.suspend((): ReturnType<TasksClient["workspaces"]["integrationsLive"]> => {
          if (poll !== true) service.reads.push(`integrations-live:${workspaceId}`);
          return Effect.map(asked(live.integrations, poll, after), (answer) => ({
            ok: true as const,
            answer: { ...answer, sentryConfigured: true, slackConfigured: true },
          }));
        }),
      sentryInstall: () => Effect.succeed(UNANSWERED_WORKSPACE),
      sentryDisconnect: (workspaceId, installationId) =>
        Effect.suspend(() => {
          service.reads.push(`sentry-disconnect:${workspaceId}:${installationId}`);
          return Effect.as(service.integrationsGate, service.sentryAnswer);
        }),
      slackBot: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`slack-bot:${workspaceId}`);
          return service.slackBotAnswer;
        }),
      slackBotConnect: () => Effect.succeed(UNANSWERED_WORKSPACE),
      slackBotDisconnect: (workspaceId) =>
        Effect.suspend(() => {
          service.reads.push(`slack-bot-disconnect:${workspaceId}`);
          return Effect.as(service.integrationsGate, service.slackBotAnswer);
        }),
      slackBotNotifications: () => Effect.succeed(UNANSWERED_WORKSPACE),
      slackBotRepository: () => Effect.succeed(UNANSWERED_WORKSPACE),
      slackBotChannel: (channel) =>
        Effect.suspend(() => {
          service.reads.push(`slack-bot-channel:${channel.workspaceId}:${channel.channelId}`);
          return Effect.as(service.integrationsGate, service.slackBotAnswer);
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
        }).pipe(Effect.tap(() => service.roleAnswered)),
      transfer: (workspaceId, userId) =>
        Effect.sync(() => {
          service.reads.push(`transfer:${workspaceId}:${userId}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const handedOver = (service.members[workspaceId] ?? []).map((member) => ({
            ...member,
            role:
              member.userId === userId
                ? WORKSPACE_ROLE.OWNER
                : member.role === WORKSPACE_ROLE.OWNER
                  ? WORKSPACE_ROLE.ADMIN
                  : member.role,
          }));
          service.members[workspaceId] = handedOver;
          service.memberships = service.memberships.map((each) =>
            each.id === workspaceId ? { ...each, role: WORKSPACE_ROLE.ADMIN } : each,
          );
          return { ok: true, answer: handedOver } as const;
        }),
      invite: (workspaceId, email, role) =>
        Effect.sync(() => {
          service.reads.push(`invite:${workspaceId}:${email}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const made: WorkspaceInvitation = {
            id: `inv-${email}`,
            email,
            role: role === WORKSPACE_ROLE.ADMIN ? WORKSPACE_ROLE.ADMIN : WORKSPACE_ROLE.MEMBER,
            expiresAt: "2026-10-16T12:00:00.000Z",
            acceptUrl: `https://vespin.dev/accept-invitation.html?id=inv-${email}`,
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
    sidebarLive: (_userId, poll, after) =>
      Effect.suspend(() => {
        if (poll !== true) service.reads.push("sidebar-live");
        return Effect.map(asked(live.sidebar, poll, after), (answer) => ({
          ok: true as const,
          answer,
        }));
      }),
    pinRepository: (repository, pinned) =>
      Effect.andThen(
        Effect.sync((): TaskCallResult<RepositoryPinsWritten, WriteUntaken> => {
          if (service.pinsFail) return { ok: false, failure: WRITE_UNTAKEN.REFUSED };
          const others = service.pins.filter((pin) => pin.repository !== repository);
          const standing = service.pins.find((pin) => pin.repository === repository);
          service.pins = pinned
            ? [standing ?? { repository, pinnedAt: MARKED_AT + service.pins.length }, ...others]
            : others;
          const txid = service.pinTxid;
          return {
            ok: true,
            answer: { pins: service.pins, ...(txid === undefined ? undefined : { txid }) },
          };
        }),
        (answer) => Effect.as(service.pinAnswered, answer),
      ),
    writeTaskSection: (write) =>
      Effect.sync((): TaskCallResult<TaskSectionsWritten, WriteUntaken> => {
        service.sectionWrites.push(write);
        const { sections } = service;
        return write.kind === service.sectionRefused || sections === undefined
          ? { ok: false, failure: WRITE_UNTAKEN.REFUSED }
          : { ok: true, answer: sections };
      }).pipe(Effect.tap(() => service.sectionAnswered)),
    edit: (taskId, edit) =>
      Effect.sync((): TaskCallResult<DescriptionEditAnswer, typeof TASK_CALL_FAILURE.NOT_FOUND> => {
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
          lastEdit: { actor: DESCRIPTION_ACTOR.DEVELOPER, at: EDITED_AT, duringCall: false },
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? edited : candidate,
        );
        const txid = service.editTxid;
        return {
          ok: true,
          answer: { plan: edited, ...(txid === undefined ? undefined : { txid }) },
        };
      }),
    readFile: (_taskId, window) => Effect.sync(() => service.files[window.path]),
    readTree: (_taskId, folder) => Effect.sync(() => service.folders[folder.path]),
    readSkills: (taskId) =>
      Effect.sync(() => {
        service.reads.push(`skills:${taskId}`);
        return service.skills[taskId];
      }),
    readRepositoryFile: (place, window) =>
      Effect.sync(() => service.places[place.workspaceId]?.[place.repository]?.files[window.path]),
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
    openBrowserTab: () => Effect.succeed({ failure: BROWSER_TAB_OPEN_FAILURE.UNANSWERED }),
    historyLive: (taskId, _userId, poll, after) =>
      Effect.suspend((): ReturnType<TasksClient["historyLive"]> => {
        const read = service.historyLives[taskId];
        return read === undefined
          ? Effect.succeed({ ok: false, failure: TASK_CALL_FAILURE.UNANSWERED } as const)
          : called(asked(read, poll, after));
      }),
    browserTabsLive: (place, _userId, poll, after) =>
      Effect.suspend((): ReturnType<TasksClient["browserTabsLive"]> => {
        const read = service.browserTabLives[browserTabsPlaceId(place)];
        return read === undefined
          ? Effect.succeed({ ok: false, failure: TASK_CALL_FAILURE.UNANSWERED } as const)
          : called(asked(read, poll, after));
      }),
    pagesLive: (place, _userId, poll, after) =>
      Effect.suspend((): ReturnType<TasksClient["pagesLive"]> => {
        const read = service.pageLives[pagePlaceId(place)];
        return read === undefined
          ? Effect.succeed({ ok: false, failure: TASK_CALL_FAILURE.UNANSWERED } as const)
          : called(asked(read, poll, after));
      }),
    recordLive: (taskId, _userId, poll, after) =>
      Effect.suspend((): ReturnType<TasksClient["recordLive"]> => {
        const read = service.recordLives[taskId];
        return read === undefined
          ? Effect.succeed({ ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND } as const)
          : called(asked(read, poll, after));
      }),
    listLive: (_userId, sync) =>
      Effect.suspend(() => {
        if (sync === undefined) return called(Effect.succeed(live.list.first()));
        if (sync === "") {
          service.liveListReads += 1;
          const whole = live.list.first();
          return called(
            Effect.succeed("failure" in whole ? whole : listBySyncId(whole, undefined, listAt)),
          );
        }
        return called(
          Effect.map(live.list.poll(sync), (answer) =>
            "failure" in answer ? answer : listBySyncId(answer, sync, listAt),
          ),
        );
      }),
    open: (taskId) =>
      Effect.sync((): TaskCallResult<Task, TaskCallFailure> => {
        service.reads.push(`open:${taskId}`);
        if (service.opensUnanswered > 0) {
          service.opensUnanswered -= 1;
          return { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED };
        }
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        return found === undefined
          ? { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND }
          : { ok: true, answer: found };
      }),
    create: (_request, key) =>
      Effect.sync(() => {
        service.createKeys.push(key);
        return service.createAnswer;
      }),
    repositories: (workspaceId) =>
      Effect.sync(() => {
        service.reads.push(
          workspaceId === undefined ? "repositories" : `repositories:${workspaceId}`,
        );
        return service.repositoriesAnswer;
      }),
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
        const txid = service.repositoryTxid;
        return {
          ok: true,
          answer: { task: changed, ...(txid === undefined ? undefined : { txid }) },
        };
      }),
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
    block: (taskId, change) =>
      Effect.sync((): TaskCallResult<TaskWritten, BlockCallFailure> => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND };
        const blocked = { ...found, blockedBy: [...(found.blockedBy ?? []), change.taskId] };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? blocked : candidate,
        );
        return { ok: true, answer: { task: blocked } };
      }),
    setParent: (taskId, { parentTaskId }) =>
      Effect.sync((): TaskCallResult<TaskWritten, ParentCallFailure> => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND };
        const { parentTaskId: _standingParent, ...rest } = found;
        const parented = parentTaskId === null ? rest : { ...rest, parentTaskId };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? parented : candidate,
        );
        return { ok: true, answer: { task: parented } };
      }),
    changeRelation: (taskId, { taskId: otherId }) =>
      Effect.sync((): TaskCallResult<TaskWritten, RelationCallFailure> => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND };
        if (service.relationFails) return { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED };
        const moved = {
          ...found,
          blockedBy: (found.blockedBy ?? []).filter((id) => id !== otherId),
          parentTaskId: otherId,
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? moved : candidate,
        );
        return { ok: true, answer: { task: moved } };
      }).pipe(Effect.tap(() => service.relationAnswered)),
    rename: (taskId, { name }, key) =>
      Effect.sync((): TaskCallResult<TaskWritten, WriteUntaken> => {
        service.renameKeys.push(key);
        if (service.renameUntaken !== undefined)
          return { ok: false, failure: service.renameUntaken };
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: WRITE_UNTAKEN.REFUSED };
        const renamed = { ...found, name, document: { ...found.document, body: `# ${name}` } };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? renamed : candidate,
        );
        return { ok: true, answer: { task: renamed } };
      }),
    setStanding: (taskId, { assigneeId, ...standing }) =>
      Effect.sync((): TaskCallResult<TaskWritten, WriteUntaken> => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: WRITE_UNTAKEN.REFUSED };
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
        return { ok: true, answer: { task: changed } };
      }),
    mark: (taskId, { pinned }) =>
      Effect.sync((): TaskCallResult<TaskWritten, WriteUntaken> => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined || service.markFails) {
          return { ok: false, failure: WRITE_UNTAKEN.REFUSED };
        }
        const { pinnedAt, ...rest } = found;
        const pin = pinned === undefined ? pinnedAt : pinned ? MARKED_AT : undefined;
        const marked = {
          ...rest,
          ...(pin === undefined ? undefined : { pinnedAt: pin }),
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? marked : candidate,
        );
        const txid = service.markTxid;
        return {
          ok: true,
          answer: { task: marked, ...(txid === undefined ? undefined : { txid }) },
        };
      }).pipe(Effect.tap(() => service.markAnswered)),
    delete: (taskId) =>
      Effect.sync(() => {
        if (service.deleteFails) return undefined;
        service.tasks = service.tasks.filter((candidate) => candidate.id !== taskId);
        return {};
      }).pipe(Effect.tap(() => service.deleteAnswered)),
  };
  return service;
}

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

const nextPoll = (settled: Effect.Effect<void>) =>
  Effect.andThen(settled, Effect.andThen(TestClock.adjust(Duration.millis(500)), settled));

const settledTurns = Effect.repeat(Effect.yieldNow, { times: 200 });

const listAnswers = (
  service: FakeService,
  parts: {
    readonly plans?: readonly unknown[];
    readonly agents?: readonly unknown[];
    readonly issues?: readonly unknown[];
  },
) =>
  Effect.andThen(
    Effect.sync(() => service.live.list.set(parts)),
    nextPoll(settledTurns),
  );

function subject(
  service: FakeService,
  options: {
    signedIn?: boolean;
    sendsNetwork?: boolean;
    accountId?: () => string;
    entities?: EntityStore;
    pool?: EntityPool;
  } = {},
) {
  return Effect.gen(function* () {
    const pushed: [GatewayEventKind, WireValue][] = [];
    const told: TasksView[] = [];
    const events: { readonly kind: string; readonly payload: WireValue }[] = [];
    const waiters: {
      wanted: (view: TasksView) => boolean;
      seen: Deferred.Deferred<TasksView>;
    }[] = [];
    const focus = yield* windowFocus;
    const tasks = yield* composeTasks({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        now: () => 0,
        createId: () => INVITES,
        emit: (kind, payload) => {
          if (kind !== GATEWAY_EVENT.TASKS_CHANGED) {
            pushed.push([kind, payload]);
            events.push({ kind, payload });
            return;
          }
          const read = readEither(tasksViewSchema)(payload);
          assert.ok(Result.isSuccess(read), "the planning event carries a view");
          told.push(read.success);
          for (const waiter of waiters) {
            if (waiter.wanted(read.success))
              Deferred.doneUnsafe(waiter.seen, Effect.succeed(read.success));
          }
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service,
      accountId: options.accountId ?? (() => "user-dana"),
      member: () => ({ userId: options.accountId?.() ?? "user-dana", name: "Dana" }),
      kept: yield* keptContent(KEPT_CONTENT_CHARACTERS),
      focus,
      pool: options.pool ?? (yield* entityPool()),
      entities: () => options.entities,
      offlineRefused: { clear: () => undefined },
      githubMoved: Effect.void,
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = tasks.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return Effect.orDie(handler(params, context));
    };
    const last = () => told.at(-1);
    const viewWhere = (wanted: (view: TasksView) => boolean) =>
      Effect.gen(function* () {
        const seen = yield* Deferred.make<TasksView>();
        waiters.push({ wanted, seen });
        return yield* Deferred.await(seen);
      });
    const viewLands = (wanted: (view: TasksView) => boolean) =>
      Effect.map(Deferred.make<TasksView>(), (seen) => {
        waiters.push({ wanted, seen });
        return Deferred.await(seen);
      });
    const settled = Effect.gen(function* () {
      for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
    });
    const listed = (agents: readonly unknown[] = []) =>
      Effect.gen(function* () {
        service.live.list.set({ plans: service.tasks.map(rowOfTask), agents, issues: [] });
        yield* nextPoll(settled);
      });
    const holdDescription = (taskId: string) =>
      call(GATEWAY_METHOD.TASKS_DOCUMENT_FOLLOW, { taskId });
    const openTask = (taskId: string) =>
      Effect.tap(call(GATEWAY_METHOD.TASKS_OPEN, { taskId }), () =>
        Effect.andThen(holdDescription(taskId), settled),
      );
    const descriptions = (): AppDescriptionDocuments => {
      const told = pushed.findLast(
        ([kind]) => kind === GATEWAY_EVENT.DESCRIPTION_DOCUMENTS_CHANGED,
      );
      return (told?.[1] ?? NO_KEYS_HELD) as AppDescriptionDocuments;
    };
    const held = (taskId: string): AppHostRead<HeldDescriptionDocument> | undefined =>
      descriptions()[taskId];
    const description = (taskId: string): Task | undefined => {
      const rows = held(taskId)?.rows;
      return rows !== undefined && "task" in rows ? rows.task : undefined;
    };
    return {
      tasks,
      call,
      told,
      pushed,
      events,
      last,
      viewWhere,
      viewLands,
      listed,
      settled,
      openTask,
      focus,
      holdDescription,
      descriptions,
      held,
      description,
    };
  });
}

it.effect(
  "a run that sends nothing reads its fixture's page, each version it stages, and no other page",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call } = yield* subject(service, { sendsNetwork: false });
      const read = (pageId: string, version: number) =>
        call(GATEWAY_METHOD.TASKS_PAGE, { taskId: FIXTURE_IDS.TASK, pageId, version });

      const newest = yield* read(FIXTURE_PAGE.id, FIXTURE_PAGE.version);
      const first = yield* read(FIXTURE_PAGE.id, 1);
      const other = yield* read("8b2d4f6a-0c1e-4b5d-9f7a-1c3e5b7d9f1a", 1);

      assert.ok(isRecord(newest) && isRecord(newest.page));
      assert.equal(newest.page.version, FIXTURE_PAGE.version);
      assert.ok(isRecord(first) && isRecord(first.page));
      assert.equal(first.page.version, 1);
      assert.deepEqual(other, { failure: TASK_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect(
  "a description's picture is answered to the window that asked as its bytes, and as not found where the service holds none for it",
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
  "a window of a File tab's file is answered as the service read it, its lines plain, since the panel colors code itself",
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
  "a file read at a commit answers what was first read there, while one read at the head or at another commit answers the file as it stands",
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
      const read = { taskId: INVITES, path: "src/seats.ts", firstLine: 1, lastLine: 2 };
      const atCommit = { ...read, ref: "0123456789abcdef0123456789abcdef01234567" };

      yield* call(GATEWAY_METHOD.TASKS_FILE, atCommit);
      const changed = { ...window, lines: ["const seats = 4;", "export { seats };"] };
      service.files["src/seats.ts"] = { file: changed };

      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_FILE, atCommit), { file: window });
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_FILE, read), { file: changed });
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_FILE, {
          ...read,
          ref: "89abcdef0123456789abcdef0123456789abcdef",
        }),
        { file: changed },
      );
    }),
);

it.effect(
  "a picture the editor took is kept on the service and read back by the id it answered, and one past the description's bound is refused in so many words",
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

it.effect("the window's refresh lists the plans and opening one draws its saved document", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, tasks, listed, openTask, description } = yield* subject(
      fakeService([billing, invites]),
    );

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
    assert.deepEqual(description(INVITES)?.document, invites.document);
    assert.equal(tasks.snapshot().activeTaskId, INVITES);

    yield* openTask(BILLING);
    assert.equal(last()?.activeTaskId, BILLING);
    assert.deepEqual(description(BILLING)?.document, billing.document);
  }),
);

it.effect(
  "the account gate opening draws the lists kept on disk while the service answers nothing, and reads the list past where it was kept",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-entities-");
      const earlier = yield* Scope.make();
      const kept = yield* Scope.provide(earlier)(
        openEntityStore({ directory, cipher: testCipher(), accountId: "user-dana" }),
      );
      yield* kept.keep(KEPT_READ.TASK_LIST, {
        rows: { plans: [rowOfTask(task(INVITES, "Kept invitations", "# Kept", 10))], agents: [] },
        at: "7",
      });
      yield* kept.keep(KEPT_READ.WORKSPACES, [PERSONAL, ACME]);
      yield* kept.keep(KEPT_READ.SIDEBAR, {
        sections: [],
        entries: [],
        agentEntries: [],
        pins: [{ repository: "acme/relay", pinnedAt: 3 }],
      });
      yield* Scope.close(earlier, Exit.void);
      const entities = yield* openEntityStore({
        directory,
        cipher: testCipher(),
        accountId: "user-dana",
      });
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.live.list.refuse({ failure: TASK_CALL_FAILURE.UNANSWERED });
      service.workspacesFail = true;
      service.sidebarLive = () =>
        Effect.succeed({ ok: false, failure: TASK_CALL_FAILURE.UNANSWERED } as const);
      const asked: (string | undefined)[] = [];
      const { listLive } = service;
      service.listLive = (userId, sync) => {
        asked.push(sync);
        return listLive(userId, sync);
      };
      const { tasks, last, settled } = yield* subject(service, { entities });

      yield* tasks.open;
      yield* settled;

      assert.deepEqual(
        last()?.tasks.map((each) => each.name),
        ["Kept invitations"],
      );
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(last()?.repositoryPins, [{ repository: "acme/relay", pinnedAt: 3 }]);
      assert.equal(asked[0], "7");
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "an answer of the list that moves no row writes nothing to disk, and the sync id it reached is written as the store closes",
  () =>
    Effect.gen(function* () {
      const disk = Layer.merge(memoryFileSystem().layer, NodePath.layer);
      const opened = Effect.provide(
        openEntityStore({ directory: "/state", cipher: testCipher(), accountId: "user-dana" }),
        disk,
      );
      const keptAt = Effect.map(
        Effect.scoped(opened),
        (store) => store.stored(KEPT_READ.TASK_LIST)?.at,
      );
      const quit = yield* Scope.make();
      const entities = yield* Scope.provide(quit)(opened);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, listed } = yield* Scope.provide(quit)(subject(service, { entities }));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* TestClock.adjust("30 seconds");
      const first = yield* keptAt;

      yield* listed();
      yield* TestClock.adjust("30 seconds");
      const meanwhile = yield* keptAt;
      yield* Scope.close(quit, Exit.void);

      assert.deepEqual([first, meanwhile, yield* keptAt], ["1", "1", "2"]);
    }),
);

it.effect(
  "a rename the service did not answer stays drawn through a relaunch on the same disk, and is sent once more under its key",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-queue-");
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.renameUntaken = WRITE_UNTAKEN.UNANSWERED;
      const options = { mintKey: () => "rename-key", replayRefused: Effect.void };
      const opened = (pool: EntityPool) =>
        openEntityStore({
          directory,
          cipher: testCipher(),
          accountId: "user-dana",
          queued: pool.queued,
        });
      const quit = yield* Scope.make();
      const before = yield* Scope.provide(quit)(entityPool(options));
      const kept = yield* Scope.provide(quit)(opened(before));
      const first = yield* Scope.provide(quit)(subject(service, { entities: kept, pool: before }));
      yield* first.call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* first.listed();
      const answered = yield* first.call(GATEWAY_METHOD.TASKS_RENAME, {
        taskId: INVITES,
        name: "Invitations",
      });
      yield* Scope.close(quit, Exit.void);

      const pool = yield* entityPool(options);
      const entities = yield* opened(pool);
      const relaunched = yield* subject(service, { entities, pool });
      yield* pool.requeue(entities.queue, relaunched.tasks.queueable);
      service.renameUntaken = undefined;
      yield* relaunched.call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* relaunched.listed();
      yield* relaunched.settled;

      assert.deepEqual(answered, { renamed: true });
      assert.deepEqual(
        relaunched.last()?.tasks.map((each) => each.name),
        ["Invitations"],
      );
      assert.deepEqual(service.renameKeys, ["rename-key", "rename-key"]);
      assert.deepEqual(pool.queued(), []);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a change made offline that the service refuses as it is sent again is taken back and counted",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.renameUntaken = WRITE_UNTAKEN.UNANSWERED;
      const refused = { times: 0 };
      const pool = yield* entityPool({
        mintKey: () => "rename-key",
        replayRefused: Effect.sync(() => {
          refused.times += 1;
        }),
      });
      const { call, listed, last, settled } = yield* subject(service, { pool });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* call(GATEWAY_METHOD.TASKS_RENAME, { taskId: INVITES, name: "Invitations" });
      const drawn = last()?.tasks.map((each) => each.name);

      service.renameUntaken = WRITE_UNTAKEN.REFUSED;
      yield* listed();
      yield* settled;

      assert.deepEqual(drawn, ["Invitations"]);
      assert.deepEqual(
        last()?.tasks.map((each) => each.name),
        ["Teammate invitations"],
      );
      assert.equal(refused.times, 1);
    }),
);

it.effect(
  "a start the service did not answer stays drawn and open through a relaunch, and is sent once more under its key, opening nothing",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-queue-");
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.UNANSWERED,
      };
      const options = { mintKey: () => "start-key", replayRefused: Effect.void };
      const opened = (pool: EntityPool) =>
        openEntityStore({
          directory,
          cipher: testCipher(),
          accountId: "user-dana",
          queued: pool.queued,
        });
      const quit = yield* Scope.make();
      const before = yield* Scope.provide(quit)(entityPool(options));
      const kept = yield* Scope.provide(quit)(opened(before));
      const first = yield* Scope.provide(quit)(subject(service, { entities: kept, pool: before }));
      yield* first.call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* first.listed();
      const answered = yield* first.call(GATEWAY_METHOD.TASKS_START, {
        name: "Invitation expiry",
        workspaceId: billing.workspaceId,
      });
      const waiting = first.last();
      yield* Scope.close(quit, Exit.void);

      const pool = yield* entityPool(options);
      const entities = yield* opened(pool);
      const relaunched = yield* subject(service, { entities, pool });
      yield* pool.requeue(entities.queue, relaunched.tasks.queueable);
      const made = { ...task(INVITES, "Invitation expiry", "", 30), createdAt: 3_000 };
      service.tasks = [...service.tasks, made];
      service.createAnswer = { ok: true, answer: { task: made } };
      yield* relaunched.call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* relaunched.listed();
      yield* relaunched.settled;

      assert.deepEqual(answered, { planId: INVITES });
      assert.equal(waiting?.activeTaskId, INVITES, "the task stands open while it waits");
      assert.equal(
        waiting?.tasks.some((row) => row.id === INVITES),
        true,
        "its row is drawn",
      );
      assert.deepEqual(service.createKeys, ["start-key", "start-key"]);
      assert.equal(relaunched.last()?.activeTaskId, undefined, "sent again, it opens nothing");
      assert.deepEqual(
        relaunched.last()?.tasks.map((row) => row.id),
        [INVITES, BILLING],
      );
      assert.deepEqual(pool.queued(), []);
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a start the service took already as it is sent again stands open and follows its task's record, so a save someone else makes reaches its description",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.UNANSWERED,
      };
      const pool = yield* entityPool({ mintKey: () => "start-key", replayRefused: Effect.void });
      const { call, listed, last, settled, description } = yield* subject(service, { pool });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* call(GATEWAY_METHOD.TASKS_START, {
        name: "Invitation expiry",
        workspaceId: billing.workspaceId,
      });

      service.tasks = [...service.tasks, task(INVITES, "Invitation expiry", "", 30)];
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.ALREADY_WRITTEN,
      };
      yield* listed();
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      service.tasks = service.tasks.map((each) =>
        each.id === INVITES
          ? { ...each, updatedAt: 40, document: { ...each.document, body: "# Theirs" } }
          : each,
      );
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;

      assert.deepEqual(service.createKeys, ["start-key", "start-key"]);
      assert.equal(last()?.activeTaskId, INVITES);
      assert.equal(description(INVITES)?.document.body, "# Theirs");
      assert.deepEqual(pool.queued(), []);
    }),
);

it.effect(
  "a start that names an agent waits where the service did not answer, its call held until it is sent again, and then answers its agent's start",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      service.createAnswer = {
        ok: false,
        failure: TASK_CALL_FAILURE.UNANSWERED,
        untaken: WRITE_UNTAKEN.UNANSWERED,
      };
      const pool = yield* entityPool({ mintKey: () => "start-key", replayRefused: Effect.void });
      const { call, listed, last, settled } = yield* subject(service, { pool });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();

      const starting = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_START, {
          workspaceId: billing.workspaceId,
          agent: { idempotencyKey: "agent-key", prompt: "Expire invitations." },
          quiet: true,
        }),
      );
      yield* settled;
      const meanwhile = starting.pollUnsafe();
      const drawn = last()?.tasks.some((row) => row.id === INVITES);
      const made = task(INVITES, "Untitled", "", 30);
      const agentStart = {
        agent: {
          id: "3c9e1d2a-6b7f-4e8a-9c0d-1e2f3a4b5c6d",
          planId: INVITES,
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          title: null,
          createdAt: 31,
          status: AGENT_STATUS.STARTING,
          turnId: null,
        },
      };
      service.tasks = [...service.tasks, made];
      service.createAnswer = { ok: true, answer: { task: made, agent: agentStart } };
      yield* listed();

      assert.equal(meanwhile, undefined, "no answer while it waits");
      assert.equal(drawn, true, "its row is drawn while it waits");
      assert.deepEqual(yield* Fiber.join(starting), { planId: INVITES, agentStart });
      assert.deepEqual(
        service.createKeys,
        [undefined, undefined],
        "sent under the agent's key alone",
      );
      assert.deepEqual(pool.queued(), []);
    }),
);

it.effect(
  "the account gate opening follows the task list, the workspaces, and the sidebar, and reads GitHub, with no window asking",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.memberships = [PERSONAL, ACME];
      service.pins = [{ repository: "acme/relay", pinnedAt: 3 }];
      service.connection = { connected: true, login: "ada" };
      const { tasks, last, listed } = yield* subject(service);

      yield* tasks.open;
      yield* listed();

      assert.deepEqual(
        last()?.tasks.map((each) => each.name),
        ["Teammate invitations"],
      );
      assert.equal(last()?.listStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(last()?.repositoryPins, [{ repository: "acme/relay", pinnedAt: 3 }]);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });
    }),
);

it.effect(
  "a quiet start opens nothing and answers its task, and its agent's start where it named one",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(BILLING, "Billing export", "# Billing", 20)]);
      const { call, listed, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      const made = task(INVITES, "Invitation expiry", "", 10);
      const refusal = { failure: AGENT_CALL_FAILURE.INVALID_CHOICE };
      service.createAnswer = { ok: true, answer: { task: made } };
      const started = yield* call(GATEWAY_METHOD.TASKS_START, {
        name: "Invitation expiry",
        quiet: true,
      });
      service.createAnswer = { ok: true, answer: { task: made, agent: refusal } };
      const withAgent = yield* call(GATEWAY_METHOD.TASKS_START, {
        agent: { idempotencyKey: "start-1", prompt: "Expire invitations." },
        quiet: true,
      });

      assert.deepEqual(started, { planId: INVITES });
      assert.deepEqual(withAgent, { planId: INVITES, agentStart: refusal });
      assert.equal(last()?.activeTaskId, undefined, "the task is not opened");
    }),
);

it.effect(
  "a quick add draws its row before the service answers and holds it until the list carries the start, and one the service refused is taken back",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      const { call, last, settled, listed } = yield* subject(service);
      const shown = () => last()?.tasks.some((row) => row.id === INVITES);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      service.live.list.set({ plans: [rowOfTask(billing)] }, ["tx-earlier"]);
      yield* nextPoll(settled);
      const answered = yield* Deferred.make<void>();
      const { create } = service;
      service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
      service.createAnswer = { ok: false, failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };
      const quickAdd = { name: "Invitation expiry", workspaceId: billing.workspaceId, quiet: true };

      const refusing = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_START, quickAdd));
      yield* settled;
      const drawn = shown();
      yield* Deferred.succeed(answered, undefined);
      const refused = yield* Fiber.join(refusing);
      const takenBack = shown();

      const made = { ...task(INVITES, "Invitation expiry", "", 30), createdAt: 3_000 };
      service.createAnswer = { ok: true, answer: { task: made, txid: "tx-start" } };
      const start = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_START, quickAdd));
      yield* settled;
      service.live.list.set({ plans: [rowOfTask(billing)] }, ["tx-other"]);
      yield* nextPoll(settled);
      const throughStale = shown();
      service.live.list.set({ plans: [rowOfTask(made), rowOfTask(billing)] }, ["tx-start"]);
      yield* nextPoll(settled);

      assert.equal(drawn, true, "the row is drawn before the service answers");
      assert.deepEqual(refused, { failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
      assert.equal(takenBack, false, "a refused start's row is taken back");
      assert.equal(throughStale, true, "the row stands until the list carries the start");
      assert.deepEqual(yield* Fiber.join(start), { planId: INVITES });
      assert.deepEqual(
        last()?.tasks.map((row) => row.id),
        [INVITES, BILLING],
      );
    }),
);

it.effect(
  "a start opens its task at once on its empty description, and one the service refused puts the reader back on the task they stood on",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      const { call, last, settled, listed, openTask, description } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(BILLING);
      const answered = yield* Deferred.make<void>();
      const { create } = service;
      service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
      service.createAnswer = { ok: false, failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };

      const start = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_START, {
          name: "Invitation expiry",
          workspaceId: billing.workspaceId,
        }),
      );
      yield* settled;
      const opened = last()?.activeTaskId;
      const drawn = description(INVITES);
      yield* Deferred.succeed(answered, undefined);
      const refused = yield* Fiber.join(start);

      assert.equal(opened, INVITES, "the task opens before the service answers");
      assert.equal(drawn?.name, "Invitation expiry");
      assert.equal(drawn?.document.body, "", "on its empty description");
      assert.deepEqual(refused, { failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE });
      assert.equal(last()?.activeTaskId, BILLING, "the reader is back where they stood");
    }),
);

it.effect(
  "a start opened at once follows its task's record once the service made it, so a save someone else makes reaches its description",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing", 20);
      const service = fakeService([billing]);
      const { call, settled, listed, description } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      const answered = yield* Deferred.make<void>();
      const { create } = service;
      service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
      const made = { ...task(INVITES, "Invitation expiry", "", 30), createdAt: 3_000 };
      service.createAnswer = { ok: true, answer: { task: made } };

      const start = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_START, {
          name: "Invitation expiry",
          workspaceId: billing.workspaceId,
        }),
      );
      yield* settled;
      service.tasks = [...service.tasks, made];
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(start);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      service.tasks = service.tasks.map((each) =>
        each.id === INVITES
          ? { ...each, updatedAt: 40, document: { ...each.document, body: "# Theirs" } }
          : each,
      );
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;

      assert.equal(description(INVITES)?.document.body, "# Theirs");
    }),
);

it.effect("a start answered after another task was opened answers its task and opens nothing", () =>
  Effect.gen(function* () {
    const billing = task(BILLING, "Billing export", "# Billing", 20);
    const service = fakeService([billing]);
    const { call, last, settled } = yield* subject(service);
    const answered = yield* Deferred.make<void>();
    const { create } = service;
    service.create = (request) => Effect.andThen(Deferred.await(answered), create(request));
    service.createAnswer = {
      ok: true,
      answer: { task: task(INVITES, "Invitation expiry", "", 10) },
    };

    const starting = yield* Effect.forkChild(
      call(GATEWAY_METHOD.TASKS_START, { name: "Invitation expiry" }),
    );
    yield* settled;
    yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: BILLING });
    yield* Deferred.succeed(answered, undefined);
    yield* settled;

    assert.deepEqual(starting.pollUnsafe(), Exit.succeed({ planId: INVITES }));
    assert.equal(last()?.activeTaskId, BILLING, "the task opened since stays open");
  }),
);

it.effect("a task opened again draws its held description before any read of it answers", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const billing = task(BILLING, "Billing export", "# Billing export", 20);
    const service = fakeService([billing, invites]);
    const { call, last, openTask, held, settled } = yield* subject(service);
    yield* openTask(INVITES);
    yield* openTask(BILLING);
    const answered = yield* Deferred.make<void>();
    const { open } = service;
    service.open = (taskId) => Effect.andThen(Deferred.await(answered), open(taskId));

    yield* call(GATEWAY_METHOD.TASKS_DOCUMENT_UNFOLLOW, { taskId: BILLING });
    const opening = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES }));
    yield* call(GATEWAY_METHOD.TASKS_DOCUMENT_FOLLOW, { taskId: INVITES });
    yield* settled;

    assert.deepEqual(opening.pollUnsafe(), Exit.succeed({ opened: true }), "the open answered");
    assert.equal(last()?.activeTaskId, INVITES);
    assert.deepEqual(held(INVITES), { rows: { task: invites } });
    assert.deepEqual(
      held(BILLING),
      { rows: { task: billing } },
      "a description let go lately stays held",
    );
  }),
);

it.effect(
  "an open is not queued behind the read of a task switched past, whose answer lands on that task's description alone",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        taskId === BILLING ? Effect.andThen(Deferred.await(answered), open(taskId)) : open(taskId);
      const { call, last, settled, held, openTask, holdDescription } = yield* subject(service);

      yield* openTask(BILLING);
      const opening = yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* holdDescription(INVITES);
      yield* settled;

      assert.deepEqual(opening, { opened: true });
      assert.equal(last()?.activeTaskId, INVITES);
      assert.deepEqual(held(INVITES), { rows: { task: invites } });
      assert.equal(held(BILLING), undefined);

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.deepEqual(held(INVITES), { rows: { task: invites } });
      assert.deepEqual(held(BILLING), { rows: { task: billing } });
    }),
);

it.effect("a press on the task already open reads nothing again", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const service = fakeService([invites]);
    const { openTask, description } = yield* subject(service);
    yield* openTask(INVITES);
    const before = service.reads.length;

    assert.deepEqual(yield* openTask(INVITES), { opened: true });
    assert.deepEqual(service.reads.slice(before), []);
    assert.deepEqual(description(INVITES), invites);
  }),
);

it.effect(
  "a rename answered while the description it opened on is still read draws the renamed description, which the read then never lands over",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, settled, held, description, openTask } = yield* subject(service);
      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        Effect.flatMap(open(taskId), (read) => Effect.as(Deferred.await(answered), read));

      yield* openTask(INVITES);
      assert.equal(held(INVITES), undefined, "the description is still read");
      yield* call(GATEWAY_METHOD.TASKS_RENAME, { taskId: INVITES, name: "Invitations" });
      assert.equal(description(INVITES)?.document.body, "# Invitations");

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(description(INVITES)?.name, "Invitations");
      assert.equal(description(INVITES)?.document.body, "# Invitations");
    }),
);

it.effect(
  "a pin answered while a description's first read is out stands over the pin the read took, and the read's description still lands",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const { call, settled, listed, description, openTask } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();

      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        Effect.flatMap(open(taskId), (read) => Effect.as(Deferred.await(answered), read));
      yield* openTask(INVITES);
      yield* call(GATEWAY_METHOD.TASKS_PIN, { taskId: INVITES, pinned: true });

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(description(INVITES)?.pinnedAt, MARKED_AT);
      assert.equal(description(INVITES)?.document.body, "# Teammate invitations");
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
  "the developer's edit is saved on the service and the open description takes the plan it answered, which stands with its list row until the record and the list carry its transaction",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", INVITES_TEXT, 10);
      const service = fakeService([invites]);
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      const { call, last, openTask, description, settled, listed } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(INVITES);
      service.live.list.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);
      yield* answered(() => record.set({}, ["tx-earlier"]));
      const opens = () => service.reads.filter((read) => read === `open:${INVITES}`).length;
      const opened = opens();

      service.editTxid = "tx-edit";
      const mine = `${INVITES_TEXT}\n\nInvites expire.`;
      const answer = yield* call(GATEWAY_METHOD.TASKS_EDIT, {
        taskId: INVITES,
        edit: { document: { base: INVITES_TEXT, value: mine } },
      });
      assert.deepEqual(answer, { saved: true }, "the edit answers once its description is drawn");
      assert.equal(description(INVITES)?.document.body, mine);
      assert.equal(description(INVITES)?.updatedAt, EDITED_AT);

      const [edited] = service.tasks;
      assert.ok(edited !== undefined);
      const theirs = {
        ...edited,
        updatedAt: 9_000,
        document: { ...edited.document, body: "Theirs." },
      };
      service.tasks = [theirs];
      yield* answered(() =>
        record.set({ description: [{ taskId: INVITES, savedAt: theirs.updatedAt }] }, ["tx-other"]),
      );
      service.live.list.set({ plans: [rowOfTask(invites)] }, ["tx-other"]);
      yield* nextPoll(settled);
      assert.equal(opens(), opened);
      assert.equal(description(INVITES)?.document.body, mine);
      assert.equal(last()?.tasks.find((row) => row.id === INVITES)?.updatedAt, EDITED_AT);

      yield* answered(() =>
        record.set({ description: [{ taskId: INVITES, savedAt: theirs.updatedAt }] }, ["tx-edit"]),
      );
      service.live.list.set({ plans: [rowOfTask(theirs)] }, ["tx-edit"]);
      yield* nextPoll(settled);
      assert.equal(opens(), opened + 1);
      assert.equal(description(INVITES)?.document.body, "Theirs.");
      assert.equal(last()?.tasks.find((row) => row.id === INVITES)?.updatedAt, theirs.updatedAt);
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
        status: AGENT_STATUS.STARTING,
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
        answer: { task: made, agent: { failure: AGENT_CALL_FAILURE.INVALID_CHOICE } },
      };
      const refused = yield* call(GATEWAY_METHOD.TASKS_START, params);

      assert.deepEqual(started, { planId: INVITES, agentStart: { agent } });
      assert.deepEqual(refused, {
        planId: INVITES,
        agentStart: { failure: AGENT_CALL_FAILURE.INVALID_CHOICE },
      });
      assert.equal(last()?.activeTaskId, INVITES);
    }),
);

it.effect("behind a closed account gate nothing is read and nothing starts", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told, tasks } = yield* subject(service, { signedIn: false });

    yield* tasks.open;
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    const started = yield* call(GATEWAY_METHOD.TASKS_START, { name: "Teammate invitations" });

    assert.deepEqual(started, { failure: TASK_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(told, []);
    assert.deepEqual(service.reads, []);
  }),
);

it.effect(
  "the sidebar's sections and pins are followed from the first refresh and never read again, a change takes the service's answer, one refused leaves them, and another Mac's change is told at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, told, settled } = yield* subject(service);
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
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_WRITE_SECTION, { writes: [place] }), {
        changed: true,
      });
      assert.deepEqual(last()?.taskSections, {
        sections: [launch],
        entries: [placed],
        agentEntries: [],
      });

      service.sections = undefined;
      const removal = { ...place, sectionId: null };
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_WRITE_SECTION, { writes: [removal] }), {
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
      service.sections = { sections: [later, launch], entries: [], agentEntries: [] };
      service.pins = [
        { repository: "acme/relay", pinnedAt: 3 },
        { repository: "acme/web", pinnedAt: 9 },
      ];
      const before = told.length;
      service.live.sidebar.move();
      yield* nextPoll(settled);
      assert.equal(told.length - before, 1);
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
  "a drag's change the service refused takes back only what it drew, so the changes the service kept before it stay drawn",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last } = yield* subject(service);
      const launch: TaskSection = {
        id: SECTION_ID,
        workspaceId: PERSONAL.id,
        title: "Launch",
        createdAt: 5,
      };
      service.sections = { sections: [launch], entries: [], agentEntries: [] };
      service.sectionRefused = TASK_SECTION_WRITE.PLACE;
      const writes = [
        {
          kind: TASK_SECTION_WRITE.CREATE,
          id: SECTION_ID,
          workspaceId: PERSONAL.id,
          title: "Launch",
        },
        { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID },
      ];

      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_WRITE_SECTION, { writes }), {
        changed: false,
      });
      assert.deepEqual(last()?.taskSections, service.sections);
    }),
);

it.effect(
  "two quick drags draw at once, the later over the earlier, and reach the service in the order they were asked, each whole",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, settled } = yield* subject(service);
      service.sections = { sections: [], entries: [], agentEntries: [] };
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const create = {
        kind: TASK_SECTION_WRITE.CREATE,
        id: SECTION_ID,
        workspaceId: PERSONAL.id,
        title: "Launch",
      };
      const place = { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID };
      const rename = {
        kind: TASK_SECTION_WRITE.EDIT,
        id: SECTION_ID,
        title: "Launch week",
        icon: null,
      };
      const answered = yield* Deferred.make<void>();
      service.sectionAnswered = Deferred.await(answered);

      const first = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_WRITE_SECTION, { writes: [create, place] }),
      );
      yield* settled;
      const second = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_WRITE_SECTION, { writes: [rename] }),
      );
      yield* settled;
      const drawn = last()?.taskSections;
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.deepEqual(
        [
          drawn?.sections.map((section) => section.title),
          drawn?.entries.map((each) => each.taskId),
        ],
        [["Launch week"], [INVITES]],
      );
      assert.deepEqual(service.sectionWrites, [create, place, rename]);
    }),
);

it.effect(
  "a pin's write answers the service's word, before the sidebar is followed and after",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, settled } = yield* subject(service);
      const pin = (repository: string) =>
        call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, { repository, pinned: true });

      assert.deepEqual(yield* pin("acme/relay"), { changed: true });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      assert.deepEqual(yield* pin("acme/web"), { changed: true });
      assert.deepEqual(
        service.pins.map((each) => each.repository),
        ["acme/web", "acme/relay"],
      );
    }),
);

it.effect(
  "a pin stands from the press until the followed sidebar carries its transaction, through an answer from before it, and a refused one is put back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, told, settled } = yield* subject(service);
      const pinned = (view: TasksView | undefined) =>
        view?.repositoryPins?.map((pin) => pin.repository) ?? [];
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      service.live.sidebar.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);

      service.pinTxid = "tx-pin";
      const from = told.length;
      const pin = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, { repository: "acme/relay", pinned: true }),
      );
      yield* settled;
      service.live.sidebar.set({ pins: [] }, ["tx-other"]);
      yield* nextPoll(settled);
      service.live.sidebar.set({ pins: service.pins }, ["tx-pin"]);
      yield* nextPoll(settled);

      assert.deepEqual(yield* Fiber.join(pin), { changed: true });
      assert.ok(told.length > from);
      assert.deepEqual(
        told.slice(from).filter((view) => !pinned(view).includes("acme/relay")),
        [],
        "the pin is never drawn back",
      );

      service.pinsFail = true;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, { repository: "acme/web", pinned: true }),
        { changed: false },
      );
      assert.deepEqual(pinned(last()), ["acme/relay"]);
    }),
);

it.effect("a pin still being written when the account signs out is drawn for nobody after", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told, tasks, settled, listed } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* listed();
    const answered = yield* Deferred.make<void>();
    service.pinAnswered = Deferred.await(answered);
    service.markAnswered = Deferred.await(answered);

    const pin = yield* Effect.forkChild(
      call(GATEWAY_METHOD.TASKS_PIN_REPOSITORY, { repository: "acme/secret", pinned: true }),
    );
    const taskPin = yield* Effect.forkChild(
      call(GATEWAY_METHOD.TASKS_PIN, { taskId: INVITES, pinned: true }),
    );
    yield* settled;
    const from = told.length;
    const signingOut = yield* Effect.forkChild(tasks.reset);
    yield* settled;
    yield* Deferred.succeed(answered, undefined);
    yield* Fiber.join(pin);
    yield* Fiber.join(taskPin);
    yield* Fiber.join(signingOut);
    yield* settled;

    assert.deepEqual(
      told.slice(from).flatMap((view) => view.repositoryPins ?? []),
      [],
    );
    assert.deepEqual(
      told.slice(from).flatMap((view) => view.tasks.filter((row) => row.pinnedAt !== undefined)),
      [],
    );
  }),
);

it.effect(
  "a task's pin stands from the press until the followed list carries its transaction, through an answer from before it, and a refused one is put back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, told, settled, listed } = yield* subject(service);
      const pinned = (view: TasksView | undefined) =>
        view?.tasks.find((row) => row.id === INVITES)?.pinnedAt !== undefined;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      service.live.list.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);

      service.markTxid = "tx-pin";
      const from = told.length;
      const pin = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_PIN, { taskId: INVITES, pinned: true }),
      );
      yield* settled;
      const standing = last()?.pendingTasks;
      const [invites] = service.tasks;
      assert.ok(invites);
      service.live.list.set({ plans: [{ ...rowOfTask(invites), name: "Invites" }] }, ["tx-other"]);
      yield* nextPoll(settled);
      service.live.list.set({ plans: [{ ...rowOfTask(invites), pinnedAt: MARKED_AT }] }, [
        "tx-pin",
      ]);
      yield* nextPoll(settled);

      assert.deepEqual(yield* Fiber.join(pin), { changed: true });
      assert.ok(told.length > from);
      assert.deepEqual(
        told.slice(from).filter((view) => !pinned(view)),
        [],
        "the pin is never drawn back",
      );
      assert.deepEqual(standing, [INVITES]);
      assert.equal(last()?.pendingTasks, undefined);

      service.markFails = true;
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_PIN, { taskId: INVITES, pinned: false }), {
        changed: false,
      });
      assert.equal(pinned(last()), true);
    }),
);

it.effect(
  "a repository the service answered stands on the task's row through another write's draw, until the list carries it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([
        task(INVITES, "Teammate invitations", "# Draft", 10),
        task(BILLING, "Billing", "# Draft", 11),
      ]);
      const { call, last, settled, listed } = yield* subject(service);
      const repositoryOf = () => last()?.tasks.find((row) => row.id === INVITES)?.repository;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      service.live.list.set({}, ["tx-earlier"]);
      yield* nextPoll(settled);

      service.repositoryTxid = "tx-repository";
      const changed = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_SET_REPOSITORY, { taskId: INVITES, repository: "acme/relay" }),
      );
      yield* settled;
      yield* call(GATEWAY_METHOD.TASKS_PIN, { taskId: BILLING, pinned: true });
      const drawn = repositoryOf();
      service.live.list.set({ plans: service.tasks.map(rowOfTask) }, ["tx-repository"]);
      yield* nextPoll(settled);

      assert.deepEqual(yield* Fiber.join(changed), { repository: "acme/relay" });
      assert.equal(drawn, "acme/relay");
      assert.equal(repositoryOf(), "acme/relay");
    }),
);

it.effect("a block the service answered stands on the open task through the list's next draw", () =>
  Effect.gen(function* () {
    const service = fakeService([
      task(INVITES, "Teammate invitations", "# Draft", 10),
      task(BILLING, "Billing", "# Draft", 11),
    ]);
    const { call, listed, openTask, description } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* listed();
    yield* openTask(INVITES);
    const blockedBy = () => description(INVITES)?.blockedBy;

    const answered = yield* call(GATEWAY_METHOD.TASKS_BLOCK, {
      taskId: INVITES,
      block: {
        change: TASK_BLOCK_CHANGE.ADD,
        relation: TASK_BLOCK_RELATION.BLOCKED_BY,
        taskId: BILLING,
      },
    });
    yield* listed();

    assert.deepEqual(answered, { blockedBy: [BILLING], blocks: [] });
    assert.deepEqual(blockedBy(), [BILLING]);
  }),
);

it.effect(
  "a block turned around between two tasks draws on both at once, and a refusal takes both back",
  () =>
    Effect.gen(function* () {
      const invites = {
        ...task(INVITES, "Teammate invitations", "# Draft", 10),
        blockedBy: [BILLING],
      };
      const service = fakeService([invites, task(BILLING, "Billing", "# Draft", 11)]);
      const { call, last, settled, listed, openTask } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      service.live.list.set({
        plans: service.tasks.map((each) => ({ ...rowOfTask(each), blocked: each.id === INVITES })),
      });
      yield* nextPoll(settled);
      yield* openTask(INVITES);
      const blocked = () =>
        [INVITES, BILLING].map(
          (id) => last()?.tasks.find((row) => row.id === id)?.blocked === true,
        );
      const answered = yield* Deferred.make<void>();
      service.relationAnswered = Deferred.await(answered);
      service.relationFails = true;

      const turning = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_CHANGE_RELATION, {
          taskId: INVITES,
          relation: {
            taskId: BILLING,
            from: TASK_RELATION_KIND.BLOCKED_BY,
            to: TASK_RELATION_KIND.BLOCKS,
          },
        }),
      );
      yield* settled;
      const drawn = blocked();
      yield* Deferred.succeed(answered, undefined);

      assert.deepEqual(yield* Fiber.join(turning), { failure: TASK_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(drawn, [false, true], "the block is drawn turned around while it is out");
      assert.deepEqual(blocked(), [true, false]);
    }),
);

it.effect("a delete asked draws its task gone before the service answers", () =>
  Effect.gen(function* () {
    const service = fakeService([
      task(INVITES, "Teammate invitations", "# Draft", 10),
      task(BILLING, "Billing", "# Draft", 11),
    ]);
    const { call, last, settled, listed } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* listed();
    const answered = yield* Deferred.make<void>();
    service.deleteAnswered = Deferred.await(answered);

    const deleting = yield* Effect.forkChild(
      call(GATEWAY_METHOD.TASKS_DELETE, { taskId: INVITES }),
    );
    yield* settled;
    const drawn = last()?.tasks.map((row) => row.id);
    yield* Deferred.succeed(answered, undefined);

    assert.deepEqual(yield* Fiber.join(deleting), { deleted: true });
    assert.deepEqual(drawn, [BILLING]);
  }),
);

it.effect(
  "a parent the service answered stands on the open task and nests the list's row at once, through the list's next draw",
  () =>
    Effect.gen(function* () {
      const service = fakeService([
        task(INVITES, "Teammate invitations", "# Draft", 10),
        task(BILLING, "Billing", "# Draft", 11),
      ]);
      const { call, last, listed, openTask, description } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(INVITES);
      const parentOf = () => description(INVITES)?.parentTaskId;
      const nestedUnder = () => last()?.tasks.find((row) => row.id === INVITES)?.parentTaskId;

      const answered = yield* call(GATEWAY_METHOD.TASKS_SET_PARENT, {
        taskId: INVITES,
        parentTaskId: BILLING,
      });
      yield* listed();

      assert.deepEqual(answered, { parentTaskId: BILLING });
      assert.equal(parentOf(), BILLING);
      assert.equal(nestedUnder(), BILLING);
    }),
);

it.effect("a task marked done here is drawn finished now, so the recently finished find it", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told, listed } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* listed();
    const from = told.length;

    yield* call(GATEWAY_METHOD.TASKS_SET_STANDING, { taskId: INVITES, status: TASK_STATUS.DONE });

    const drawn = told[from]?.tasks.find((row) => row.id === INVITES);
    assert.equal(drawn?.status, TASK_STATUS.DONE);
    assert.equal(drawn?.completedAt, 0);
  }),
);

it.effect("a sign-out drops the view the window drew", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last, tasks, openTask, descriptions } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* openTask(INVITES);

    yield* tasks.reset;

    assert.deepEqual(last(), { tasks: [], listStatus: TASKS_READ.IDLE, workspaces: [] });
    assert.deepEqual(
      descriptions(),
      {},
      "the descriptions held for the session are dropped with it",
    );
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

      assert.equal(service.live.workspaces.held(), 1, "their poll is held while nothing moves");
      yield* tasks.reset;
      assert.deepEqual(last()?.workspaces, []);
      assert.equal(service.live.workspaces.held(), 0, "a sign-out lets their poll go");
    }),
);

it.effect("a teammate's change reaches the view as the followed workspaces answer it", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    const { call, last, settled } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* settled;

    service.memberships = [PERSONAL, { ...ACME, name: "Acme Labs" }];
    yield* settled;
    assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
  }),
);

it.effect(
  "a workspaces poll refused as signed out stops the follow, rather than reading the old account again on the backoff",
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
      service.live.workspaces.move();
      yield* TestClock.adjust(Duration.minutes(5));
      yield* settled;

      assert.deepEqual(
        service.reads.slice(before),
        [],
        "the poll refused as signed out is the last ask: the old account is not read again on the backoff",
      );
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME], "what was drawn stays");
    }),
);

it.effect(
  "while the service answers nothing the workspaces say reading and the tasks are drawn, and the read is asked again after a pause until it answers",
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

it.effect("a workspace list of none kept on disk is not drawn as ready at launch", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("tasks-entities-");
    const earlier = yield* Scope.make();
    const kept = yield* Scope.provide(earlier)(
      openEntityStore({ directory, cipher: testCipher(), accountId: "user-dana" }),
    );
    yield* kept.keep(KEPT_READ.WORKSPACES, []);
    yield* Scope.close(earlier, Exit.void);
    const entities = yield* openEntityStore({
      directory,
      cipher: testCipher(),
      accountId: "user-dana",
    });
    const service = fakeService([]);
    service.workspacesFail = true;
    const { tasks, last, settled } = yield* subject(service, { entities });

    yield* tasks.open;
    yield* settled;

    assert.equal(last()?.workspacesStatus, TASKS_READ.READING);
  }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a workspace list of none says failed and leaves the last list drawn, and its Retry reads it again at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;

      service.memberships = [];
      yield* settled;
      assert.equal(last()?.workspacesStatus, TASKS_READ.FAILED);
      assert.deepEqual(last()?.workspaces, [PERSONAL]);

      service.memberships = [PERSONAL];
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
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
  "a rename stands while it is out over a newer name the follow delivers, which stands once it is answered",
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
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);
      yield* settled;

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Research" }]);
    }),
);

it.effect(
  "a rename's answer is drawn though the follow moved another workspace while it was out, where the follow never answered the rename itself",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(answered);
      service.followMisses = true;

      const renaming = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" }),
      );
      yield* settled;
      const missed = workspacesLiveRows([{ ...PERSONAL, name: "Dana's own" }, ACME]);
      service.live.workspaces.set({ workspaces: missed.workspaces });
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
      service.memberships = [PERSONAL, ACME];
      yield* nextPoll(settled);
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);

      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    }),
);

it.effect(
  "of two renames asked at once, the second is sent once the first is answered and stands over it, where the follow answers neither",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      service.followMisses = true;
      const firstAnswered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(firstAnswered);
      const before = service.reads.length;

      const first = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Alpha" }),
      );
      yield* settled;
      service.renameAnswered = Effect.void;
      const second = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Beta" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Beta" }]);
      assert.deepEqual(service.reads.slice(before), [`rename:${ACME.id}:Alpha`]);
      yield* Deferred.succeed(firstAnswered, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Beta" }]);
      assert.deepEqual(service.reads.slice(before), [
        `rename:${ACME.id}:Alpha`,
        `rename:${ACME.id}:Beta`,
      ]);
    }),
);

it.effect("a rename still being written when the account signs out is drawn for nobody after", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    const { call, last, settled, tasks } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* settled;
    service.followMisses = true;
    const answered = yield* Deferred.make<void>();
    service.renameAnswered = Deferred.await(answered);

    const renaming = yield* Effect.forkChild(
      call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" }),
    );
    yield* settled;
    const queued = yield* Effect.forkChild(
      call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Research" }),
    );
    yield* settled;
    yield* tasks.reset;
    service.memberships = [PERSONAL, ACME];
    yield* tasks.open;
    yield* settled;
    yield* Deferred.succeed(answered, undefined);
    yield* Fiber.join(renaming);
    const unsent = yield* Fiber.join(queued);
    yield* settled;

    assert.deepEqual(unsent, { failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    assert.deepEqual(
      service.reads.filter((read) => read.startsWith("rename:")),
      [`rename:${ACME.id}:Acme Labs`],
    );
  }),
);

it.effect(
  "a slug another workspace holds is drawn, then taken back with the service's refusal",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.slugTaken = "acme-labs";
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.slugAnswered = Deferred.await(answered);

      const setting = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_SLUG_SET, { workspaceId: ACME.id, slug: "acme-labs" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, slug: "acme-labs" }]);
      yield* Deferred.succeed(answered, undefined);
      const refused = yield* Fiber.join(setting);

      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.SLUG_TAKEN });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
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

      yield* nextPoll(settled);
      assert.deepEqual(set, { workspace: { ...ACME, photoVersion: PHOTO_URL } });
      assert.deepEqual(drawn, [PERSONAL, { ...ACME, photoVersion: PHOTO_URL }]);
      assert.deepEqual(removed, { workspace: ACME });
      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(
        service.reads.slice(before).filter((read) => read.startsWith("photoSet:")),
        [
          `photoSet:${ACME.id}:${PHOTO_URL}`,
          `photoSet:${ACME.id}:none`,
          `photoSet:${ACME.id}:${PHOTO_URL}`,
        ],
      );
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

function memberRow(member: WorkspaceMember, role: string = member.role) {
  return { userId: member.userId, name: member.name, email: member.email, role, image: null };
}

const DANA: WorkspaceMember = {
  userId: "user-dana",
  name: "Dana Scully",
  email: "dana@app.test",
  role: WORKSPACE_ROLE.OWNER,
};
const ALAN: WorkspaceMember = {
  userId: "user-alan",
  name: "Alan Turing",
  email: "alan@app.test",
  role: WORKSPACE_ROLE.MEMBER,
};
const LEE = { userId: "user-lee", name: "Lee Park" };

function heldMembers(pushed: readonly (readonly [GatewayEventKind, WireValue])[]): WireValue[] {
  return pushed.flatMap(([kind, payload]) =>
    kind === GATEWAY_EVENT.WORKSPACE_MEMBERS_CHANGED ? [payload] : [],
  );
}

it.effect(
  "a workspace's people kept on disk are drawn as a window holds them, before the service answers them",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-people-");
      const opened = openEntityStore({ directory, cipher: testCipher(), accountId: "user-dana" });
      const earlier = yield* Scope.make();
      const kept = yield* Scope.provide(earlier)(opened);
      yield* kept.keepIn(KEPT_READ.MEMBERS, ACME.id, { members: [memberRow(DANA)], former: [] });
      yield* Scope.close(earlier, Exit.void);
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [];
      const { call, pushed, settled } = yield* subject(service, { entities: yield* opened });

      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;

      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: { rows: { members: [DANA] } } });
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a role change, a removal, and a handover stand until the held read carries them, through a poll answered before them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
      service.members[ACME.id] = [DANA, GRACE, ALAN];
      const { call, pushed, settled } = yield* subject(service);
      const people = service.live.people;
      const shown = () => heldMembers(pushed).at(-1);
      const standing = (members: readonly WorkspaceMember[], former?: readonly unknown[]) => ({
        [ACME.id]: { rows: { members, ...(former === undefined ? undefined : { former }) } },
      });
      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      people.set({ members: [DANA, GRACE, ALAN].map((each) => memberRow(each)), former: [] });
      yield* settled;
      assert.deepEqual(shown(), standing([DANA, ALAN, GRACE]));
      const before = service.reads.length;

      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE, {
        workspaceId: ACME.id,
        userId: GRACE.userId,
        role: WORKSPACE_ROLE.ADMIN,
      });
      const admin = { ...GRACE, role: WORKSPACE_ROLE.ADMIN };
      assert.deepEqual(shown(), standing([DANA, admin, ALAN]));
      const leeRow = { ...LEE, image: null };
      people.set({ former: [leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, admin, ALAN], [LEE]));
      people.set({
        members: [memberRow(DANA), memberRow(GRACE, "member,admin"), memberRow(ALAN)],
      });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, admin, ALAN], [LEE]));
      people.set({ members: [DANA, GRACE, ALAN].map((each) => memberRow(each)) });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, ALAN, GRACE], [LEE]));

      people.set({ members: [DANA, admin, ALAN].map((each) => memberRow(each)) });
      yield* nextPoll(settled);
      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBER_REMOVE, {
        workspaceId: ACME.id,
        userId: ALAN.userId,
      });
      assert.deepEqual(shown(), standing([DANA, admin], [LEE]));
      people.set({ former: [] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, admin]));
      people.set({ members: [memberRow(DANA), memberRow(admin)] });
      yield* nextPoll(settled);

      yield* call(GATEWAY_METHOD.WORKSPACES_TRANSFER, {
        workspaceId: ACME.id,
        userId: GRACE.userId,
      });
      const heir = { ...GRACE, role: WORKSPACE_ROLE.OWNER };
      const handedOver = standing([heir, { ...DANA, role: WORKSPACE_ROLE.ADMIN }]);
      assert.deepEqual(shown(), handedOver);
      people.set({ members: [memberRow(DANA), memberRow(heir)] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), handedOver, "the account's own role is not carried yet");
      people.set({ members: [memberRow(DANA, WORKSPACE_ROLE.ADMIN), memberRow(heir)] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), handedOver);

      assert.deepEqual(service.reads.slice(before), [
        `role:${ACME.id}:${GRACE.userId}:${WORKSPACE_ROLE.ADMIN}`,
        `remove:${ACME.id}:${ALAN.userId}`,
        `transfer:${ACME.id}:${GRACE.userId}`,
      ]);
    }),
);

it.effect("a role change draws before the service answers, and one it refuses is taken back", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
    service.members[ACME.id] = [DANA, GRACE];
    const { call, pushed, settled } = yield* subject(service);
    const shown = () => heldMembers(pushed).at(-1);
    const standing = (members: readonly WorkspaceMember[]) => ({
      [ACME.id]: { rows: { members } },
    });
    yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
    yield* settled;
    service.live.people.set({ members: [memberRow(DANA), memberRow(GRACE)], former: [] });
    yield* settled;
    const answered = yield* Deferred.make<void>();
    service.roleAnswered = Deferred.await(answered);
    service.notPermitted = true;

    const giving = yield* Effect.forkChild(
      call(GATEWAY_METHOD.WORKSPACES_MEMBER_ROLE, {
        workspaceId: ACME.id,
        userId: GRACE.userId,
        role: WORKSPACE_ROLE.ADMIN,
      }),
    );
    yield* settled;
    assert.deepEqual(shown(), standing([DANA, { ...GRACE, role: WORKSPACE_ROLE.ADMIN }]));
    yield* Deferred.succeed(answered, undefined);
    const refused = yield* Fiber.join(giving);

    assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
    assert.deepEqual(shown(), standing([DANA, GRACE]));
  }),
);

it.effect(
  "a leave draws the account gone from the workspace's people, and the read ending as the account no longer reaches it puts nothing back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [DANA, GRACE];
      const { call, pushed, settled } = yield* subject(service);
      const people = service.live.people;
      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      people.set({ members: [memberRow(DANA), memberRow(GRACE)], former: [] });
      yield* settled;

      yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });
      const left = { [ACME.id]: { rows: { members: [GRACE] } } };
      assert.deepEqual(heldMembers(pushed).at(-1), left);
      people.refuse({ failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;

      assert.deepEqual(heldMembers(pushed).at(-1), left);
    }),
);

const SENTRY_ROW = { installationId: "sentry-installation-1", account: "acme", createdAt: 1 };

const SLACK_ROW = {
  workspaceId: ACME.id,
  teamId: "T0001",
  teamName: "Acme",
  defaultRepository: null,
};

const ENG_CHANNEL = { id: "C0001", name: "eng", private: false, member: false };

function integrationsShown(
  pushed: readonly (readonly [GatewayEventKind, WireValue])[],
  workspaceId: string,
): WorkspaceIntegrations | undefined {
  const told = pushed.findLast(([kind]) => kind === GATEWAY_EVENT.WORKSPACE_INTEGRATIONS_CHANGED);
  const read = isRecord(told?.[1]) ? told[1][workspaceId] : undefined;
  return (isRecord(read) ? read.rows : undefined) as WorkspaceIntegrations | undefined;
}

function channelsShown(
  pushed: readonly (readonly [GatewayEventKind, WireValue])[],
  workspaceId: string,
): readonly SlackListedChannel[] | undefined {
  const told = pushed.findLast(([kind]) => kind === GATEWAY_EVENT.SLACK_CHANNELS_CHANGED);
  const read = isRecord(told?.[1]) ? told[1][workspaceId] : undefined;
  return (isRecord(read) ? read.rows : undefined) as readonly SlackListedChannel[] | undefined;
}

it.effect(
  "a Sentry disconnect draws its installation gone before the service answers and keeps it gone through a poll from before it until the read carries its transaction, and a refused Slack disconnect puts the bot back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
      const { call, pushed, settled } = yield* subject(service);
      const integrations = service.live.integrations;
      const installations = () =>
        integrationsShown(pushed, ACME.id)?.sentry.installations.map((one) => one.installationId);
      const team = () => integrationsShown(pushed, ACME.id)?.slack.team?.name;
      yield* call(GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      integrations.set(
        {
          sentryInstallations: [SENTRY_ROW],
          slackInstallation: [SLACK_ROW],
          slackChannelRepositories: [],
        },
        ["9100"],
      );
      yield* nextPoll(settled);
      assert.deepEqual(installations(), [SENTRY_ROW.installationId]);
      assert.equal(team(), "Acme");

      const answering = yield* Deferred.make<void>();
      service.integrationsGate = Deferred.await(answering);
      service.sentryAnswer = {
        ok: true,
        answer: { configured: true, installations: [], txid: "9200" },
      };
      const disconnecting = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_SENTRY_DISCONNECT, {
          workspaceId: ACME.id,
          installationId: SENTRY_ROW.installationId,
        }),
      );
      yield* settled;
      assert.equal(disconnecting.pollUnsafe(), undefined, "no answer while the service is asked");
      assert.deepEqual(installations(), [], "gone before the service answers");

      yield* Deferred.succeed(answering, undefined);
      assert.deepEqual(yield* Fiber.join(disconnecting), {
        sentry: { configured: true, installations: [] },
      });
      integrations.set({ sentryInstallations: [SENTRY_ROW] });
      yield* nextPoll(settled);
      assert.deepEqual(installations(), []);
      integrations.set({ sentryInstallations: [] }, ["9200"]);
      yield* nextPoll(settled);
      assert.deepEqual(installations(), []);

      const refusing = yield* Deferred.make<void>();
      service.integrationsGate = Deferred.await(refusing);
      service.slackBotAnswer = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED };
      const refused = yield* Effect.forkChild(
        call(GATEWAY_METHOD.WORKSPACES_SLACK_BOT_DISCONNECT, { workspaceId: ACME.id }),
      );
      yield* settled;
      assert.equal(team(), undefined, "gone before the service answers");
      yield* Deferred.succeed(refusing, undefined);
      assert.deepEqual(yield* Fiber.join(refused), {
        failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED,
      });
      yield* settled;
      assert.equal(team(), "Acme", "put back once the service refused it");
    }),
);

it.effect(
  "Slack's channels are asked for an owner's window as it holds them and again as the bot is connected or disconnected, a channel joined lays the channels its answer carries, and a window holding the integrations alone asks for none",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
      const { call, pushed, settled } = yield* subject(service);
      const integrations = service.live.integrations;
      const channelAsks = () =>
        service.reads.filter((read) => read === `slack-bot:${ACME.id}`).length;
      const connected = {
        configured: true,
        team: { id: SLACK_ROW.teamId, name: SLACK_ROW.teamName },
        channels: [ENG_CHANNEL],
      };
      service.slackBotAnswer = { ok: true, answer: { configured: true } };
      yield* call(GATEWAY_METHOD.WORKSPACES_INTEGRATIONS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      integrations.set({
        sentryInstallations: [],
        slackInstallation: [],
        slackChannelRepositories: [],
      });
      yield* nextPoll(settled);
      service.slackBotAnswer = { ok: true, answer: connected };
      integrations.set({ slackInstallation: [SLACK_ROW] });
      yield* nextPoll(settled);
      assert.equal(channelAsks(), 0, "no window holds the channels");

      yield* call(GATEWAY_METHOD.WORKSPACES_SLACK_CHANNELS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      assert.equal(channelAsks(), 1);
      assert.deepEqual(channelsShown(pushed, ACME.id), [ENG_CHANNEL]);

      service.slackBotAnswer = { ok: true, answer: { configured: true } };
      integrations.set({ slackInstallation: [] });
      yield* nextPoll(settled);
      assert.equal(channelAsks(), 2);
      assert.deepEqual(channelsShown(pushed, ACME.id), []);
      service.slackBotAnswer = { ok: true, answer: connected };
      integrations.set({ slackInstallation: [SLACK_ROW] });
      yield* nextPoll(settled);
      assert.equal(channelAsks(), 3);
      assert.deepEqual(channelsShown(pushed, ACME.id), [ENG_CHANNEL]);

      const joined = { ...ENG_CHANNEL, member: true };
      service.slackBotAnswer = { ok: true, answer: { ...connected, channels: [joined] } };
      yield* call(GATEWAY_METHOD.WORKSPACES_SLACK_BOT_CHANNEL, {
        workspaceId: ACME.id,
        channelId: ENG_CHANNEL.id,
        member: true,
      });
      yield* settled;
      assert.deepEqual(channelsShown(pushed, ACME.id), [joined]);
      assert.deepEqual(
        service.reads.filter((read) => read.startsWith("slack-bot-channel:")),
        [`slack-bot-channel:${ACME.id}:${ENG_CHANNEL.id}`],
      );
    }),
);

function heldPhotos(pushed: readonly (readonly [GatewayEventKind, WireValue])[]): WireValue[] {
  return pushed.flatMap(([kind, payload]) =>
    kind === GATEWAY_EVENT.WORKSPACE_PHOTOS_CHANGED ? [payload] : [],
  );
}

it.effect(
  "a listed workspace's photo is fetched once per version, laid under it, and fetched again as the version moves",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, photoVersion: "v1" }];
      const photo = { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" };
      service.photos[ACME.id] = photo;
      const { call, pushed, settled } = yield* subject(service);
      const fetches = () => service.reads.filter((read) => read.startsWith("photo:"));

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      const first = heldPhotos(pushed).at(-1);
      yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" });
      yield* nextPoll(settled);
      const renamed = fetches().length;
      yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, { workspaceId: ACME.id, photo: PHOTO_URL });
      yield* settled;

      const url = "data:image/png;base64,iVBORw0KGgo=";
      assert.deepEqual(first, { [ACME.id]: { rows: { version: "v1", url } } });
      assert.equal(renamed, 1, "a move that leaves the version fetches nothing");
      assert.deepEqual(fetches(), [`photo:${ACME.id}`, `photo:${ACME.id}`]);
      assert.deepEqual(heldPhotos(pushed).at(-1), {
        [ACME.id]: { rows: { version: PHOTO_URL, url } },
      });
    }),
);

function heldInvitations(pushed: readonly (readonly [GatewayEventKind, WireValue])[]): WireValue[] {
  return pushed.flatMap(([kind, payload]) =>
    kind === GATEWAY_EVENT.WORKSPACE_INVITATIONS_CHANGED ? [payload] : [],
  );
}

function invitationRow(id: string, expiresAt: number) {
  return { id, email: `${id}@example.com`, role: WORKSPACE_ROLE.MEMBER, expiresAt };
}

function pendingInvitation(id: string, expiresAt: number): WorkspaceInvitation {
  return {
    id,
    email: `${id}@example.com`,
    role: WORKSPACE_ROLE.MEMBER,
    expiresAt: new Date(expiresAt).toISOString(),
    acceptUrl: `https://app.test/accept-invitation?id=${id}&email=${id}%40example.com`,
  };
}

const HOUR = 3_600_000;

it.effect(
  "an invitation made and one canceled stand until the held read carries them, through a poll answered before them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, pushed, settled } = yield* subject(service);
      const invitations = service.live.invitations;
      const shown = () => heldInvitations(pushed).at(-1);
      const standing = (rows: readonly WorkspaceInvitation[]) => ({ [ACME.id]: { rows } });
      const graceRow = invitationRow("grace", HOUR);
      const leeRow = invitationRow("lee", 2 * HOUR);
      const grace = pendingInvitation("grace", HOUR);
      const lee = pendingInvitation("lee", 2 * HOUR);
      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      invitations.set({ invitations: [graceRow] });
      yield* settled;
      const before = service.reads.length;

      const made = yield* call(GATEWAY_METHOD.WORKSPACES_INVITE, {
        workspaceId: ACME.id,
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
      });
      assert.deepEqual(made, {
        invitation: {
          id: "inv-alan@example.com",
          email: "alan@example.com",
          role: WORKSPACE_ROLE.MEMBER,
          expiresAt: "2026-10-16T12:00:00.000Z",
          acceptUrl: "https://vespin.dev/accept-invitation.html?id=inv-alan@example.com",
        },
      });
      const alan = {
        id: "inv-alan@example.com",
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
        expiresAt: "2026-10-16T12:00:00.000Z",
        acceptUrl:
          "https://app.test/accept-invitation?id=inv-alan%40example.com&email=alan%40example.com",
      };
      assert.deepEqual(shown(), standing([grace, alan]));
      invitations.set({ invitations: [graceRow, leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace, lee, alan]));
      invitations.set({
        invitations: [
          graceRow,
          leeRow,
          { ...invitationRow(alan.id, Date.parse(alan.expiresAt)), email: alan.email },
        ],
      });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace, lee, alan]));
      invitations.set({ invitations: [graceRow, leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace, lee]));

      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL, {
        workspaceId: ACME.id,
        invitationId: "lee",
      });
      assert.deepEqual(shown(), standing([grace]));
      invitations.set({ invitations: [graceRow, leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace]));
      invitations.set({ invitations: [graceRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace]));

      service.notPermitted = true;
      const refused = yield* call(GATEWAY_METHOD.WORKSPACES_INVITE, {
        workspaceId: ACME.id,
        email: "ada@example.com",
        role: WORKSPACE_ROLE.ADMIN,
      });
      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(shown(), standing([grace]));
      assert.deepEqual(service.reads.slice(before), [
        `invite:${ACME.id}:alan@example.com`,
        `cancel:${ACME.id}:lee`,
        `invite:${ACME.id}:ada@example.com`,
      ]);
    }),
);

it.effect(
  "an invitation canceled while its invite still waits on the read stays gone once that wait gives up",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, pushed, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      service.live.invitations.set({ invitations: [] });
      yield* settled;

      yield* call(GATEWAY_METHOD.WORKSPACES_INVITE, {
        workspaceId: ACME.id,
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
      });
      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATION_CANCEL, {
        workspaceId: ACME.id,
        invitationId: "inv-alan@example.com",
      });
      yield* TestClock.adjust(Duration.seconds(11));
      yield* settled;

      assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [] } });
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
  "leaving the open plan's workspace closes the plan, and a refused leave keeps it open",
  () =>
    Effect.gen(function* () {
      const acmeTask = {
        ...task(INVITES, "Teammate invitations", "# Draft", 10),
        workspaceId: ACME.id,
      };
      const service = fakeService([acmeTask]);
      service.memberships = [PERSONAL, ACME];
      service.notPermitted = true;
      const { call, last, listed, openTask } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(INVITES);

      const refused = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.equal(last()?.activeTaskId, INVITES);

      service.notPermitted = false;
      const left = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

      assert.deepEqual(left, { left: true });
      assert.equal(last()?.activeTaskId, undefined);
    }),
);

it.effect("leaving another workspace than the open plan's keeps the plan open", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    const { call, last, openTask } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* openTask(INVITES);

    yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

    assert.equal(last()?.activeTaskId, INVITES);
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
    yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
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
  "a file, a folder, and the skills of a repository are read by its workspace and its name where no plan names it, and by the plan where one does",
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
      const file = (path: string): TaskFileAnswer => ({
        file: {
          path,
          repository: "acme/relay",
          branch: "main",
          firstLine: 1,
          lineCount: 1,
          lines: ["const seats = 3;"],
        },
      });
      service.places[ACME.id] = {
        "acme/relay": {
          files: { "src/seats.ts": file("src/seats.ts") },
          folders: { src: folder("src") },
          skills: skills("release"),
        },
      };
      service.files["docs/plan.md"] = file("docs/plan.md");
      service.folders.docs = folder("docs");
      service.skills[INVITES] = skills("review");
      const { call } = yield* subject(service);
      const place = { workspaceId: ACME.id, repository: "acme/relay" };

      const window = { firstLine: 1, lastLine: 1 };
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_FILE, { ...place, path: "src/seats.ts", ...window }),
        file("src/seats.ts"),
      );
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_FILE, {
          taskId: INVITES,
          path: "docs/plan.md",
          ...window,
        }),
        file("docs/plan.md"),
      );
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
  "a plan's skills are answered at once from what was read and read again behind the answer, so a skill added lands on the next ask; a read that does not answer keeps them, and a sign-out lets them go",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const skillsNamed = (...names: string[]): TaskSkillsAnswer => ({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: names.map((name) => ({
            name,
            description: "",
            source: TASK_SKILL_SOURCE.REPOSITORY,
            path: `.agents/skills/${name}/SKILL.md`,
          })),
        },
      });
      const { tasks, call, settled } = yield* subject(service);
      const asked = () => call(GATEWAY_METHOD.TASKS_SKILLS, { planId: INVITES });

      assert.deepEqual(yield* asked(), { failure: TASK_CALL_FAILURE.UNANSWERED });
      service.skills[INVITES] = skillsNamed("review");
      assert.deepEqual(yield* asked(), skillsNamed("review"), "none held, the read is waited on");

      service.skills[INVITES] = skillsNamed("review", "release");
      assert.deepEqual(yield* asked(), skillsNamed("review"));
      yield* settled;
      assert.deepEqual(yield* asked(), skillsNamed("review", "release"));

      Reflect.deleteProperty(service.skills, INVITES);
      yield* asked();
      yield* settled;
      assert.deepEqual(
        yield* asked(),
        skillsNamed("review", "release"),
        "kept past a read unanswered",
      );

      yield* tasks.reset;
      assert.deepEqual(yield* asked(), { failure: TASK_CALL_FAILURE.UNANSWERED });
    }),
);

it.effect(
  "a plan moved to another workspace on the same repository has its skills read there, never answered with the last workspace's",
  () =>
    Effect.gen(function* () {
      const invites = {
        ...task(INVITES, "Teammate invitations", "# Invites", 10),
        repository: "acme/relay",
      };
      const service = fakeService([invites]);
      const installed = (name: string): TaskSkillsAnswer => ({
        skills: {
          repository: "acme/relay",
          branch: "main",
          skills: [{ name, description: "", source: TASK_SKILL_SOURCE.WORKSPACE }],
        },
      });
      const { call, listed } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      const asked = () => call(GATEWAY_METHOD.TASKS_SKILLS, { planId: INVITES });
      service.skills[INVITES] = installed("review");
      assert.deepEqual(yield* asked(), installed("review"));

      service.tasks = [{ ...invites, workspaceId: "workspace-acme" }];
      service.skills[INVITES] = installed("release");
      yield* listed();
      assert.deepEqual(yield* asked(), installed("release"));
    }),
);

const RELAY_PULL = "https://github.com/acme/relay/pull/42";
const RELAY_PULL_GONE = "https://github.com/acme/relay/pull/43";
const RELAY_PULL_UNANSWERED = "https://github.com/acme/relay/pull/44";
const RELAY_ISSUE = "https://github.com/acme/relay/issues/7";
const RELAY_HOME = "https://github.com/acme/relay";

const relayPull = (title: string): GitHubRepositoryPullRequestAnswer => ({
  pullRequest: { number: 42, title, url: RELAY_PULL, state: PULL_REQUEST_STATE.OPEN },
});

function standingsOf(events: readonly { readonly kind: string; readonly payload: WireValue }[]) {
  return events.filter((event) => event.kind === GATEWAY_EVENT.LINK_STANDINGS_CHANGED).at(-1)
    ?.payload;
}

function standingAt(
  events: readonly { readonly kind: string; readonly payload: WireValue }[],
  workspaceId: string,
  address: string,
) {
  const held = standingsOf(events);
  const inWorkspace = isRecord(held) ? held[workspaceId] : undefined;
  return isRecord(inWorkspace) ? inWorkspace[address] : undefined;
}

it.effect(
  "a link's standing is held by the workspace it is read through and its own address: a pull request or an issue as GitHub holds it, one it holds none of as none, and one the service did not answer, or an address naming no page, as failed",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const notPlanned: GitHubRepositoryIssueAnswer = {
        issue: {
          number: 7,
          title: "Invites expire",
          url: RELAY_ISSUE,
          state: ISSUE_STATE.NOT_PLANNED,
        },
      };
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([
          [42, relayPull("Batch invites")],
          [43, { pullRequest: null }],
        ]),
      };
      service.issues[ACME.id] = { "acme/relay": new Map([[7, notPlanned]]) };
      const { call, events, settled } = yield* subject(service);

      for (const address of [
        RELAY_PULL,
        RELAY_PULL_GONE,
        RELAY_PULL_UNANSWERED,
        RELAY_ISSUE,
        RELAY_HOME,
      ]) {
        yield* call(GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW, { workspaceId: ACME.id, address });
      }
      yield* settled;

      assert.deepEqual(standingsOf(events), {
        [ACME.id]: {
          [RELAY_PULL]: { rows: relayPull("Batch invites") },
          [RELAY_PULL_GONE]: { rows: { pullRequest: null } },
          [RELAY_PULL_UNANSWERED]: { failed: true },
          [RELAY_ISSUE]: { rows: notPlanned },
          [RELAY_HOME]: { failed: true },
        },
      });
    }),
);

it.effect(
  "a window coming forward inside the minute a link's read is kept asks GitHub nothing, and one past it reads what moved; one the service did not answer is asked again only after two",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.pullRequests[ACME.id] = { "acme/relay": new Map([[42, relayPull("Batch invites")]]) };
      service.pullRequestQuota = 1;
      const { call, events, settled, focus } = yield* subject(service);
      const hold = (address: string) =>
        call(GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW, { workspaceId: ACME.id, address });
      const forwardAfter = (seconds: number) =>
        Effect.gen(function* () {
          yield* TestClock.adjust(Duration.seconds(seconds));
          yield* focus.raise;
          yield* settled;
        });

      yield* hold(RELAY_PULL);
      yield* settled;
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([[42, relayPull("Send in batches")]]),
      };
      service.pullRequestQuota = undefined;
      yield* forwardAfter(30);
      assert.deepEqual(standingsOf(events), {
        [ACME.id]: { [RELAY_PULL]: { rows: relayPull("Batch invites") } },
      });
      yield* forwardAfter(31);
      assert.deepEqual(standingsOf(events), {
        [ACME.id]: { [RELAY_PULL]: { rows: relayPull("Send in batches") } },
      });

      service.pullRequestQuota = 0;
      yield* hold(RELAY_PULL_GONE);
      yield* settled;
      service.pullRequestQuota = undefined;
      service.pullRequests[ACME.id] = {
        "acme/relay": new Map([
          [42, relayPull("Send in batches")],
          [43, { pullRequest: null }],
        ]),
      };
      yield* forwardAfter(90);
      assert.deepEqual(standingAt(events, ACME.id, RELAY_PULL_GONE), { failed: true });
      yield* forwardAfter(31);
      assert.deepEqual(standingAt(events, ACME.id, RELAY_PULL_GONE), {
        rows: { pullRequest: null },
      });
    }),
);

it.effect("behind a closed account gate a link's standing reaches no service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.pullRequests[ACME.id] = { "acme/relay": new Map([[42, relayPull("Batch invites")]]) };
    const { call, events, settled } = yield* subject(service, { signedIn: false });

    yield* call(GATEWAY_METHOD.TASKS_LINK_STANDING_FOLLOW, {
      workspaceId: ACME.id,
      address: RELAY_PULL,
    });
    yield* settled;

    assert.equal(standingsOf(events), undefined);
  }),
);

it.effect(
  "a workspace's repositories are held by the workspace, every one's where none is named, and asked again as its GitHub installations move or a token repository is set in it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.repositoriesAnswer = {
        ok: true,
        answer: {
          installed: true,
          repositories: [],
          installationUrl: "https://github.com/apps/vespin",
        },
      };
      service.tokenRepositorySet = { ok: true, answer: [] };
      const { call, settled } = yield* subject(service);
      const asked = () => service.reads.filter((read) => read.startsWith("repositories"));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;

      yield* call(GATEWAY_METHOD.TASKS_REPOSITORIES_FOLLOW, { workspaceId: ACME.id });
      yield* call(GATEWAY_METHOD.TASKS_REPOSITORIES_FOLLOW, {});
      yield* settled;
      assert.deepEqual(asked(), [`repositories:${ACME.id}`, "repositories"]);

      const installed = {
        ...ACME,
        githubInstallations: [
          ...(ACME.githubInstallations ?? []),
          { installationId: 9, login: "acme-labs", active: true },
        ],
      };
      service.live.workspaces.set(workspacesLiveRows([PERSONAL, installed]));
      yield* nextPoll(settled);
      assert.deepEqual(
        asked().slice(2).toSorted(),
        [`repositories:${ACME.id}`, "repositories"].toSorted(),
      );

      yield* call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORY_SET, {
        workspaceId: ACME.id,
        repository: "acme/side",
        added: true,
      });
      yield* settled;
      assert.deepEqual(
        asked().slice(4).toSorted(),
        [`repositories:${ACME.id}`, "repositories"].toSorted(),
      );
    }),
);

it.effect(
  "a plan moved to another workspace answers that workspace, and the list and the open document take it in place",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, listed, openTask, description } = yield* subject(service);
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
      assert.equal(description(INVITES)?.workspaceId, ACME.id);
    }),
);

it.effect(
  "a plan's status and priority set on the service land in the list and the open document in place, and a change naming neither never travels",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last, openTask, description } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listAnswers(service, { plans: [rowOfTask(invites)], agents: [], issues: [] });
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
      assert.equal(description(INVITES)?.status, TASK_STATUS.DONE);
    }),
);

it.effect(
  "a plan's assignee set on the service lands in the list and the open document in place, and null assigns it to no one",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const { call, last, listed, openTask, description } = yield* subject(fakeService([invites]));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listed();
      yield* openTask(INVITES);
      const openAssignee = () => description(INVITES)?.assignee;

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

const followSettled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 20 },
);

const recordLive = () =>
  polledLive<RecordPart, typeof NOT_FOUND_LIVE>(["description", "pages", "calls", "code"]);

function polledRecord(service: FakeService, taskId: string) {
  return polledLive<RecordPart, typeof NOT_FOUND_LIVE>(
    ["description", "pages", "calls", "code"],
    () => ({
      description: service.tasks
        .filter((each) => each.id === taskId)
        .map((each) => ({ taskId, savedAt: each.updatedAt })),
      pages: [],
      calls: [],
      code: [],
    }),
  );
}

const answered = (set: () => void) =>
  Effect.andThen(
    Effect.sync(set),
    Effect.andThen(
      followSettled,
      Effect.andThen(TestClock.adjust(Duration.millis(500)), followSettled),
    ),
  );

it.effect(
  "a description saved by someone else reaches its held description as its polled mark moves, the task open or not, a read of it that went unanswered asked again, and the window's own save, which the mark only confirms, reads nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([
        task(INVITES, "Teammate invitations", INVITES_TEXT, 10),
        task(BILLING, "Billing export", "# Billing export", 20),
      ]);
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      const { call, last, openTask, description } = yield* subject(service);
      yield* openTask(INVITES);
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      const opens = () => service.reads.filter((read) => read === `open:${INVITES}`).length;
      const opened = opens();
      yield* TestClock.adjust(Duration.seconds(5));
      yield* followSettled;
      assert.equal(opens(), opened);

      yield* openTask(BILLING);
      yield* call(GATEWAY_METHOD.TASKS_DOCUMENT_UNFOLLOW, { taskId: INVITES });
      assert.equal(last()?.activeTaskId, BILLING);

      const theirs = `${INVITES_TEXT}\n\nInvites expire after a week.`;
      const held = service.tasks.find((each) => each.id === INVITES);
      assert.ok(held !== undefined);
      service.tasks = service.tasks.map((each) =>
        each.id === INVITES
          ? {
              ...held,
              updatedAt: 20,
              document: { ...held.document, body: theirs },
              lastEdit: { actor: DESCRIPTION_ACTOR.DEVELOPER, at: 20, duringCall: false },
            }
          : each,
      );
      service.opensUnanswered = 1;
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      assert.equal(opens(), opened + 1);
      assert.equal(description(INVITES)?.document.body, INVITES_TEXT, "the copy held stands");
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      assert.equal(description(INVITES)?.document.body, theirs);
      assert.equal(opens(), opened + 2);

      const mine = `${theirs}\n\nOnly members invite.`;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.TASKS_EDIT, {
          taskId: INVITES,
          edit: { document: { base: theirs, value: mine } },
        }),
        { saved: true },
      );
      record.move();
      yield* TestClock.adjust(Duration.seconds(5));
      yield* followSettled;
      assert.equal(description(INVITES)?.document.body, mine);
      assert.equal(opens(), opened + 2);
    }),
);

it.effect(
  "a poll that finds the open task gone ends its record's follow, rather than asking again",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const record = recordLive();
      service.recordLives[INVITES] = record;
      const { openTask, description } = yield* subject(service);
      yield* openTask(INVITES);
      yield* followSettled;
      yield* answered(() => record.set({ description: [], pages: [], calls: [], code: [] }));
      assert.equal(record.held(), 1);

      record.refuse(NOT_FOUND_LIVE);
      yield* followSettled;
      yield* TestClock.adjust(Duration.hours(1));
      yield* followSettled;
      assert.equal(record.held(), 0);
      const polls = record.polls();
      yield* TestClock.adjust(Duration.hours(1));
      yield* followSettled;
      assert.equal(record.polls(), polls, "a follow whose task is gone asks no more");
      assert.deepEqual(description(INVITES), invites, "the description read stays drawn");
    }),
);

it.effect("a read answering an older save than the held description lands nothing", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", INVITES_TEXT, 10);
    const service = fakeService([invites]);
    const record = polledRecord(service, INVITES);
    service.recordLives[INVITES] = record;
    const { call, openTask, description } = yield* subject(service);
    yield* openTask(INVITES);
    yield* followSettled;
    const mine = `${INVITES_TEXT}\n\nInvites expire.`;
    yield* call(GATEWAY_METHOD.TASKS_EDIT, {
      taskId: INVITES,
      edit: { document: { base: INVITES_TEXT, value: mine } },
    });
    const opens = () => service.reads.filter((read) => read === `open:${INVITES}`).length;
    const opened = opens();

    const { open } = service;
    service.open = (taskId) =>
      Effect.map(open(taskId), (read) => (read.ok ? { ok: true, answer: invites } : read));
    const [edited] = service.tasks;
    assert.ok(edited !== undefined);
    service.tasks = [{ ...edited, updatedAt: EDITED_AT + 1 }];
    record.move();
    yield* TestClock.adjust(Duration.seconds(1));
    yield* followSettled;

    assert.equal(opens(), opened + 1, "the moved mark asked a read");
    assert.equal(
      description(INVITES)?.document.body,
      mine,
      "the saved description stands over the older read",
    );
  }),
);

it.effect(
  "a pin answered while a read of a plan the list does not hold yet is out keeps the pin the held description took",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", INVITES_TEXT, 10);
      const service = fakeService([invites]);
      service.createAnswer = { ok: true, answer: { task: invites } };
      const record = polledRecord(service, INVITES);
      service.recordLives[INVITES] = record;
      const { call, description, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_START, { name: "Teammate invitations" });
      yield* followSettled;

      const answered = yield* Deferred.make<void>();
      const { open } = service;
      service.open = (taskId) =>
        Effect.flatMap(open(taskId), (read) => Effect.as(Deferred.await(answered), read));
      service.tasks = [
        { ...invites, updatedAt: 20, document: { ...invites.document, body: "Theirs." } },
      ];
      record.move();
      yield* TestClock.adjust(Duration.seconds(1));
      yield* followSettled;
      yield* call(GATEWAY_METHOD.TASKS_PIN, { taskId: INVITES, pinned: true });
      assert.equal(description(INVITES)?.pinnedAt, MARKED_AT);

      yield* Deferred.succeed(answered, undefined);
      yield* settled;
      assert.equal(
        description(INVITES)?.pinnedAt,
        MARKED_AT,
        "the read from before the pin lands nothing",
      );
      service.open = open;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      assert.equal(
        description(INVITES)?.document.body,
        "Theirs.",
        "the save is read again after the pin",
      );
      assert.equal(description(INVITES)?.pinnedAt, MARKED_AT);
    }),
);

const FUNNEL = {
  id: "3f8e2a1b-6c4d-4e5f-8a9b-0c1d2e3f4a5b",
  title: "Invite funnel",
  version: 1,
  at: 1_500,
};

it.effect(
  "a plan's pages held for the Inbox are laid on the app state as they move, never in the view, a read that never answered as failed, kept followed once let go, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { tasks, call, told, pushed } = yield* subject(service);
      const held = (read: WireValue) => [
        GATEWAY_EVENT.PAGES_CHANGED,
        { [PAGE_OWNER.TASK]: { [INVITES]: read }, [PAGE_OWNER.AGENT]: {} },
      ];

      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.deepEqual(pushed, [held({ failed: true })]);

      const pages = polledLive<"pages", typeof NOT_FOUND_LIVE>(["pages"]);
      service.pageLives[INVITES] = pages;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      yield* answered(() => pages.set({ pages: [{ ...FUNNEL, shownBy: null }] }));
      const shown = { ...FUNNEL, version: 2, at: 2_500, shownBy: { kind: PAGE_SHOWER.APP } };
      yield* answered(() => pages.set({ pages: [shown] }));
      assert.deepEqual(pushed.slice(1), [held({ rows: [FUNNEL] }), held({ rows: [shown] })]);
      assert.equal(told.length, 0, "a plan's pages held for the Inbox are never told in the view");

      yield* call(GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(pages.held(), 1);
      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(pushed.length, 3, "a plan held again is drawn from where its pages stand");

      yield* tasks.reset;
      yield* followSettled;
      assert.equal(pages.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.PAGES_CHANGED),
        [GATEWAY_EVENT.PAGES_CHANGED, { [PAGE_OWNER.TASK]: {}, [PAGE_OWNER.AGENT]: {} }],
      );
    }),
);

it.effect(
  "a plan's pages the service refuses are told as failed and asked no more while held, and held anew are asked again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const pages = polledLive<"pages", typeof NOT_FOUND_LIVE>(["pages"]);
      pages.refuse(NOT_FOUND_LIVE);
      service.pageLives[INVITES] = pages;
      const { pagesLive } = service;
      let seals = 0;
      service.pagesLive = (...asked) =>
        Effect.suspend(() => {
          seals += 1;
          return pagesLive(...asked);
        });
      const { call, pushed } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* followSettled;
      assert.equal(seals, 1, "a plan the reader cannot reach is not asked again while held");
      assert.deepEqual(pushed, [
        [
          GATEWAY_EVENT.PAGES_CHANGED,
          { [PAGE_OWNER.TASK]: { [INVITES]: { failed: true } }, [PAGE_OWNER.AGENT]: {} },
        ],
      ]);

      yield* call(GATEWAY_METHOD.TASKS_PAGES_UNFOLLOW, { taskId: INVITES });
      yield* call(GATEWAY_METHOD.TASKS_PAGES_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(seals, 2);
    }),
);

const SEVEN_DAYS: DescriptionCommentThread = {
  id: "1b7c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  scope: DESCRIPTION_COMMENT_SCOPE.WORDS,
  quote: "Invites",
  anchor: { from: 2, to: 9 },
  section: "Goal",
  status: DESCRIPTION_COMMENT_STATUS.OPEN,
  entries: [
    {
      id: "2c8d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f",
      kind: DESCRIPTION_COMMENT_ENTRY.COMMENT,
      writer: { actor: DESCRIPTION_COMMENT_ACTOR.MEMBER, by: { userId: "u1", name: "Dean" } },
      words: "Should this be a setting?",
      at: 0,
    },
  ],
  createdAt: 0,
  updatedAt: 0,
  revision: 1,
};

function commentRows(threads: readonly DescriptionCommentThread[]) {
  return {
    threads: threads.map((thread) => ({
      id: thread.id,
      scope: thread.scope,
      quote: thread.quote,
      anchorFrom: thread.anchor?.from ?? null,
      anchorTo: thread.anchor?.to ?? null,
      section: thread.section,
      pageId: thread.page?.id ?? null,
      pageVersion: thread.page?.version ?? null,
      pageElement: thread.page?.element ?? null,
      status: thread.status,
      revision: thread.revision,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    })),
    entries: threads.flatMap((thread) =>
      thread.entries.map((entry, seq) => ({
        id: entry.id,
        threadId: thread.id,
        seq,
        kind: entry.kind,
        actor: entry.writer.actor,
        userId: entry.writer.by?.userId ?? null,
        userName: entry.writer.by?.name ?? null,
        agentId: null,
        words: entry.words ?? null,
        askedActor: null,
        askedAgentId: null,
        createdAt: entry.at,
        editedAt: null,
      })),
    ),
    files: [],
  };
}

it.effect(
  "a description's comments and a page's held for a window are laid on the app state apart as they move, never in the view, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const description = polledLive<CommentPart, typeof NOT_FOUND_LIVE>([
        "threads",
        "entries",
        "files",
      ]);
      const page = polledLive<CommentPart, typeof NOT_FOUND_LIVE>(["threads", "entries", "files"]);
      service.commentLives[INVITES] = description;
      service.commentLives[FUNNEL.id] = page;
      const { tasks, call, told, pushed } = yield* subject(service);
      const onPage = {
        ...SEVEN_DAYS,
        id: "3d9e4f5a-6b7c-4d8e-8f9a-1b2c3d4e5f6a",
        scope: DESCRIPTION_COMMENT_SCOPE.PAGE,
        quote: "Invite funnel",
        page: { id: FUNNEL.id, version: 1 },
        entries: [],
      };
      const { anchor: _anchor, ...withoutAnchor } = onPage;

      yield* call(GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW, { taskId: INVITES });
      yield* call(GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW, { taskId: INVITES, pageId: FUNNEL.id });
      yield* followSettled;
      yield* answered(() => description.set(commentRows([SEVEN_DAYS])));
      yield* answered(() => page.set(commentRows([withoutAnchor])));

      assert.deepEqual(pushed.at(-1), [
        GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED,
        {
          [COMMENT_SUBJECT.DESCRIPTION]: { [INVITES]: { rows: [SEVEN_DAYS] } },
          [COMMENT_SUBJECT.PAGE]: { [FUNNEL.id]: { rows: [withoutAnchor] } },
        },
      ]);
      assert.equal(told.length, 0, "a task's comments are never told in the view");

      yield* tasks.reset;
      yield* followSettled;
      assert.equal(description.held() + page.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED),
        [
          GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED,
          { [COMMENT_SUBJECT.DESCRIPTION]: {}, [COMMENT_SUBJECT.PAGE]: {} },
        ],
      );
    }),
);

it.effect(
  "a resolve draws over its thread at once, stands through a read from before it until the read carries it, and a refused one is taken back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const description = polledLive<CommentPart, typeof NOT_FOUND_LIVE>([
        "threads",
        "entries",
        "files",
      ]);
      service.commentLives[INVITES] = description;
      const { call, pushed } = yield* subject(service);
      const status = () => {
        const [, held] =
          pushed.findLast(([kind]) => kind === GATEWAY_EVENT.DESCRIPTION_COMMENTS_CHANGED) ?? [];
        const rows = (held as AppDescriptionComments | undefined)?.[COMMENT_SUBJECT.DESCRIPTION][
          INVITES
        ]?.rows;
        return rows?.map((thread) => thread.status);
      };
      const resolve = call(GATEWAY_METHOD.TASKS_COMMENT_ACT, {
        planId: INVITES,
        threadId: SEVEN_DAYS.id,
        action: { action: DESCRIPTION_COMMENT_ACTION.RESOLVE },
      });
      const resolved = { ...SEVEN_DAYS, status: DESCRIPTION_COMMENT_STATUS.RESOLVED, revision: 2 };
      yield* call(GATEWAY_METHOD.TASKS_COMMENTS_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      yield* answered(() => description.set(commentRows([SEVEN_DAYS]), ["tx-earlier"]));

      service.commentGate = Deferred.makeUnsafe<void>();
      service.commentAnswer = { refused: DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS };
      const refused = yield* Effect.forkChild(resolve);
      yield* followSettled;
      assert.deepEqual(
        status(),
        [DESCRIPTION_COMMENT_STATUS.RESOLVED],
        "drawn before the service answers",
      );
      Deferred.doneUnsafe(service.commentGate, Effect.void);
      assert.deepEqual(yield* Fiber.join(refused), {
        refused: DESCRIPTION_COMMENT_REFUSAL.NOT_YOURS,
      });
      assert.deepEqual(status(), [DESCRIPTION_COMMENT_STATUS.OPEN], "taken back once refused");

      service.commentGate = undefined;
      service.commentAnswer = { thread: resolved, txid: "tx-resolve" };
      const kept = yield* Effect.forkChild(resolve);
      yield* followSettled;
      yield* answered(() => description.set(commentRows([SEVEN_DAYS]), ["tx-other"]));
      assert.deepEqual(status(), [DESCRIPTION_COMMENT_STATUS.RESOLVED], "a read from before it");
      yield* answered(() => description.set(commentRows([resolved]), ["tx-resolve"]));
      assert.deepEqual(yield* Fiber.join(kept), { thread: resolved, txid: "tx-resolve" });
      assert.deepEqual(status(), [DESCRIPTION_COMMENT_STATUS.RESOLVED]);
    }),
);

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
  "a task's Browser tabs held for the side panel are laid on the app state by kind and id as they move, the agent's pointer among them, laid again as a takeover lapses though let go, never in the view, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { tasks, call, told, pushed } = yield* subject(service);
      const held = (read: WireValue) => [
        GATEWAY_EVENT.BROWSER_TABS_CHANGED,
        { [BROWSER_TABS_PLACE.TASK]: { [INVITES]: read }, [BROWSER_TABS_PLACE.AGENT]: {} },
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
      yield* followSettled;
      assert.deepEqual(pushed, [held({ failed: true })]);

      const tabs = polledLive<"tabs", typeof NOT_FOUND_LIVE>(["tabs"]);
      service.browserTabLives[INVITES] = tabs;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* followSettled;
      yield* answered(() =>
        tabs.set({ tabs: [{ ...SIGN_IN_TAB, driverUserId: "user-dana", heldUntil: 10_000 }] }),
      );
      assert.deepEqual(pushed.slice(1), [
        held({ rows: [{ ...tab, driver: { userId: "user-dana", heldUntil: 10_000 } }] }),
      ]);

      yield* call(GATEWAY_METHOD.TASKS_BROWSER_TABS_UNFOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(tabs.held(), 1);
      yield* TestClock.adjust(Duration.seconds(8));
      yield* followSettled;
      assert.deepEqual(pushed.slice(2), [held({ rows: [{ ...tab, driver: null }] })]);
      assert.equal(told.length, 0, "a task's Browser tabs are never told in the view");

      yield* tasks.reset;
      yield* followSettled;
      assert.equal(tabs.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.BROWSER_TABS_CHANGED),
        [
          GATEWAY_EVENT.BROWSER_TABS_CHANGED,
          { [BROWSER_TABS_PLACE.TASK]: {}, [BROWSER_TABS_PLACE.AGENT]: {} },
        ],
      );
    }),
);

function historyRow(seq: number, at: number) {
  return {
    seq,
    actor: DESCRIPTION_ACTOR.DEVELOPER,
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
  };
}

function historyLine(seq: number, at: number) {
  return {
    seq,
    lastEdit: {
      actor: DESCRIPTION_ACTOR.DEVELOPER,
      by: { userId: "user-dean", name: "Dean" },
      at,
      duringCall: false,
    },
    startedAt: at,
    changes: 1,
  };
}

function revisionsFrom(newest: number, oldest: number): readonly number[] {
  return Array.from({ length: newest - oldest + 1 }, (_, back) => newest - back);
}

it.effect(
  "a description's newest page of history held for a window is laid on the app state as saves land, never in the view, kept followed once let go, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const history = polledLive<"revisions">(["revisions"]);
      service.historyLives[INVITES] = history;
      const { tasks, call, told, pushed } = yield* subject(service);
      const held = (read: WireValue) => [GATEWAY_EVENT.HISTORIES_CHANGED, { [INVITES]: read }];

      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      yield* answered(() => history.set({ revisions: [historyRow(1, 1_000)] }));
      yield* answered(() =>
        history.set({ revisions: [historyRow(2, 2_000), historyRow(1, 1_000)] }),
      );
      assert.deepEqual(pushed, [
        held({ rows: { revisions: [historyLine(1, 1_000)] } }),
        held({ rows: { revisions: [historyLine(2, 2_000), historyLine(1, 1_000)] } }),
      ]);
      assert.equal(told.length, 0, "a description's history is never told in the view");

      yield* call(GATEWAY_METHOD.TASKS_HISTORY_UNFOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(history.held(), 1);
      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      assert.equal(pushed.length, 2, "a history held again is drawn from where it stands");

      yield* tasks.reset;
      yield* followSettled;
      assert.equal(history.held(), 0);
      assert.deepEqual(
        pushed.findLast(([kind]) => kind === GATEWAY_EVENT.HISTORIES_CHANGED),
        [GATEWAY_EVENT.HISTORIES_CHANGED, {}],
      );
    }),
);

it.effect("an older page laid into a held history stays when a save lands a new newest page", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
    const history = polledLive<"revisions">(["revisions"]);
    service.historyLives[INVITES] = history;
    const rows = (newest: number, oldest: number) =>
      revisionsFrom(newest, oldest).map((seq) => historyRow(seq, seq * 1_000));
    const lines = (newest: number, oldest: number) =>
      revisionsFrom(newest, oldest).map((seq) => historyLine(seq, seq * 1_000));
    service.olderHistory[3] = { revisions: lines(2, 1) };
    const { call, pushed } = yield* subject(service);
    const heldNow = () => pushed.findLast(([kind]) => kind === GATEWAY_EVENT.HISTORIES_CHANGED);

    yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
    yield* followSettled;
    yield* answered(() => history.set({ revisions: rows(52, 2) }));
    assert.deepEqual(heldNow(), [
      GATEWAY_EVENT.HISTORIES_CHANGED,
      { [INVITES]: { rows: { revisions: lines(52, 3), earlier: 3 } } },
    ]);

    assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_REVISIONS, { taskId: INVITES, before: 3 }), {
      revisions: lines(2, 1),
    });
    assert.deepEqual(heldNow(), [
      GATEWAY_EVENT.HISTORIES_CHANGED,
      { [INVITES]: { rows: { revisions: lines(52, 1) } } },
    ]);

    yield* answered(() => history.set({ revisions: rows(53, 3) }));
    assert.deepEqual(heldNow(), [
      GATEWAY_EVENT.HISTORIES_CHANGED,
      { [INVITES]: { rows: { revisions: lines(53, 1) } } },
    ]);
  }),
);

it.effect(
  "a restore puts the revision back and is answered once the history held for its version history carries its transaction",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.revisions[1] = {
        seq: 1,
        document: { body: "# Invites", assumptions: [] },
        previous: null,
      };
      const history = polledLive<"revisions">(["revisions"]);
      service.historyLives[INVITES] = history;
      const { call } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_HISTORY_FOLLOW, { taskId: INVITES });
      yield* followSettled;
      yield* answered(() => history.set({ revisions: [historyRow(1, 1_000)] }, ["tx-earlier"]));

      const restoring = yield* Effect.forkChild(
        call(GATEWAY_METHOD.TASKS_RESTORE, { taskId: INVITES, seq: 1 }),
      );
      yield* followSettled;
      assert.equal(restoring.pollUnsafe(), undefined, "no answer before the history carries it");
      yield* answered(() =>
        history.set({ revisions: [historyRow(2, 2_000), historyRow(1, 1_000)] }, ["txid-1"]),
      );
      assert.deepEqual(yield* Fiber.join(restoring), { restored: true });
    }),
);

const LIVE_NOW = 1_800_000_000_000;

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

function rowOfTask(each: Task) {
  return {
    ...taskRow(each.id, each.name),
    workspaceId: each.workspaceId,
    repository: each.repository,
    createdAt: each.createdAt,
    updatedAt: each.updatedAt,
    status: each.status ?? TASK_STATUS.TODO,
    priority: each.priority ?? TASK_PRIORITY.NONE,
    parentTaskId: each.parentTaskId ?? null,
  };
}

function agentRow(planId: string | null, ago: number) {
  return agentListRow(planId, LIVE_NOW - ago);
}

it.effect(
  "a list that could not be read says so beside what it drew and is read again, and a read refused as signed out ends the follow",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      service.live.list.refuse({ failure: TASK_CALL_FAILURE.UNANSWERED });
      const { call, last, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* settled;
      assert.equal(last()?.listStatus, TASKS_READ.FAILED);
      assert.equal(last()?.live, HOST_LIVE.OFFLINE, "a service that answers no read is offline");

      service.live.list.refuse(undefined);
      yield* TestClock.adjust(Duration.seconds(5));
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [],
        issues: [],
      });
      assert.equal(last()?.listStatus, TASKS_READ.READY);
      assert.equal(last()?.live, HOST_LIVE.LIVE);
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");

      service.live.list.refuse({ failure: LIVE_SIGNED_OUT.failure });
      yield* settled;
      yield* TestClock.adjust(Duration.seconds(30));
      yield* settled;
      const asked = [service.liveListReads, service.live.list.polls()];
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;
      assert.deepEqual(
        [service.liveListReads, service.live.list.polls()],
        asked,
        "a follow refused as signed out asks no more",
      );
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");
    }),
);

it.effect(
  "a task the service no longer lists leaves the list as an answer past its sync id names it gone, and the rest stand",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations"), taskRow(BILLING, "Billing export")],
        agents: [],
        issues: [],
      });
      assert.deepEqual(
        last()
          ?.tasks.map((row) => row.id)
          .toSorted(),
        [BILLING, INVITES].toSorted(),
      );

      yield* listAnswers(service, { plans: [taskRow(INVITES, "Teammate invitations")] });

      assert.deepEqual(
        last()?.tasks.map((row) => row.id),
        [INVITES],
      );
    }),
);

it.effect(
  "the list is drawn from its live rows, and an agent with no turn reads failed once its grace ends with nothing read",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [agentRow(INVITES, 60_000)],
        issues: [],
      });
      const drawn = last()?.tasks[0];
      assert.equal(drawn?.name, "Teammate invitations, live");
      assert.deepEqual(
        [drawn?.agents?.working, drawn?.agents?.agents.map((line) => line.status)],
        [1, [AGENT_STATUS.STARTING]],
      );
      assert.deepEqual(
        last()?.taskAgents?.map((each) => [each.planId, each.status, each.turnId]),
        [[INVITES, AGENT_STATUS.STARTING, null]],
      );

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_DELETE, { taskId: BILLING });
      yield* TestClock.adjust(Duration.minutes(5));
      yield* settled;

      const ended = last()?.tasks[0]?.agents;
      assert.deepEqual(
        [ended?.working, ended?.agents.map((line) => line.status)],
        [0, [AGENT_STATUS.FAILED]],
      );
    }),
);

it.effect(
  "an agent whose line no turn takes reads running in the live list until the line's grace ends, then failed with nothing read",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [
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
        ],
        issues: [],
      });
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live", "the list is drawn live");
      assert.deepEqual(
        last()?.tasks[0]?.agents?.agents.map((line) => line.status),
        [AGENT_STATUS.RUNNING],
      );
      yield* TestClock.adjust(Duration.minutes(3));
      yield* settled;
      assert.deepEqual(
        last()?.tasks[0]?.agents?.agents.map((line) => line.status),
        [AGENT_STATUS.RUNNING],
        "inside the line's grace",
      );
      yield* TestClock.adjust(Duration.minutes(2));
      yield* settled;
      assert.deepEqual(
        last()?.tasks[0]?.agents?.agents.map((line) => line.status),
        [AGENT_STATUS.FAILED],
        "the line's grace ran out with no row moving",
      );
    }),
);

it.effect(
  "a list whose rows stop decoding keeps what it drew and says it is catching up, and is live again once it is read again",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, settled } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [],
        issues: [],
      });
      assert.equal(last()?.live, HOST_LIVE.LIVE);

      yield* listAnswers(service, { plans: [{ id: INVITES, title: "Teammate invitations" }] });
      yield* TestClock.adjust(Duration.seconds(1));
      yield* settled;
      assert.equal(last()?.live, HOST_LIVE.CATCHING_UP);
      assert.equal(last()?.listStatus, TASKS_READ.READY, "the list drawn stands");
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, live");

      service.live.list.set({ plans: [taskRow(INVITES, "Teammate invitations, again")] });
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(last()?.live, HOST_LIVE.LIVE);
      assert.equal(last()?.tasks[0]?.name, "Teammate invitations, again");
    }),
);

it.effect(
  "a resync reads a followed list again at once, once for a wake's several events, without saying it is behind, and asks nothing of a list not followed; a regain right after a wake reads it again",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const service = fakeService([task(INVITES, "Teammate invitations", "# Invites", 10)]);
      const { call, last, told, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* settled;
      assert.equal(service.liveListReads, 0, "nothing is followed before the Tasks tab asks");

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listAnswers(service, {
        plans: [taskRow(INVITES, "Teammate invitations, live")],
        agents: [],
        issues: [],
      });
      const before = service.liveListReads;
      const toldBefore = told.length;

      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* settled;
      assert.equal(service.liveListReads, before + 1, "one wake reads the list once");
      assert.ok(
        told.slice(toldBefore).every((view) => view.live !== HOST_LIVE.CATCHING_UP),
        "a read asked again is loading, not behind",
      );
      assert.equal(last()?.live, HOST_LIVE.LIVE);

      yield* call(GATEWAY_METHOD.TASKS_REGAINED);
      yield* settled;
      assert.equal(service.liveListReads, before + 2, "a regain reads the list again");

      yield* TestClock.adjust(Duration.seconds(10));
      const later = service.liveListReads;
      yield* call(GATEWAY_METHOD.TASKS_RESYNC);
      yield* settled;
      assert.equal(service.liveListReads, later + 1, "a later wake reads it again");
    }),
);

it.effect(
  "a teammate's change to the open task's status, assignee, and repository reaches its held description as the live list carries it, its body and last save kept",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, openTask, description } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* listAnswers(service, { plans: [rowOfTask(invites)], agents: [], issues: [] });
      yield* openTask(INVITES);
      const standing = () => {
        const open = description(INVITES);
        return [
          open?.status,
          open?.assignee,
          open?.repository,
          open?.document.body,
          open?.updatedAt,
        ];
      };

      yield* listAnswers(service, {
        plans: [
          {
            ...rowOfTask(invites),
            status: TASK_STATUS.IN_PROGRESS,
            assigneeId: ADA.userId,
            assigneeName: ADA.name,
            repository: "acme/relay",
            updatedAt: 20,
          },
        ],
      });
      assert.deepEqual(standing(), [
        TASK_STATUS.IN_PROGRESS,
        { userId: ADA.userId, name: ADA.name },
        "acme/relay",
        "# Teammate invitations",
        10,
      ]);

      yield* listAnswers(service, { plans: [{ ...rowOfTask(invites), status: TASK_STATUS.DONE }] });
      assert.deepEqual(standing(), [
        TASK_STATUS.DONE,
        undefined,
        null,
        "# Teammate invitations",
        10,
      ]);
    }),
);

it.effect(
  "a workspace's people held for a window are laid on the app state in the held read's order, who left among them, read with nothing else, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA];
      const { call, pushed, tasks, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      service.live.people.set({ members: [memberRow(GRACE), memberRow(ADA)], former: [] });
      yield* settled;
      service.live.people.set({ former: [{ ...LEE, image: null }] });
      yield* nextPoll(settled);

      assert.deepEqual(heldMembers(pushed), [
        { [ACME.id]: { rows: { members: [ADA, GRACE] } } },
        { [ACME.id]: { rows: { members: [ADA, GRACE], former: [LEE] } } },
      ]);
      assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
      yield* tasks.reset;
      yield* settled;
      assert.equal(service.live.people.held(), 0, "a sign-out lets its poll go");
      assert.deepEqual(heldMembers(pushed).at(-1), {});
    }),
);

function heldTokenRepositories(
  pushed: readonly (readonly [GatewayEventKind, WireValue])[],
): WireValue[] {
  return pushed.flatMap(([kind, payload]) =>
    kind === GATEWAY_EVENT.TOKEN_REPOSITORIES_CHANGED ? [payload] : [],
  );
}

it.effect(
  "a workspace's token repositories asked before an addition land behind the addition's answer, never over it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const listed = (fullName: string) => ({
        fullName,
        addedBy: "Ada",
        addedAt: 1,
        removable: true,
      });
      const before = [listed("acme/relay")];
      const after = [listed("acme/side"), ...before];
      const answering = yield* Deferred.make<void>();
      Object.assign(service.workspaces, {
        tokenRepositories: () =>
          Effect.as(Deferred.await(answering), { ok: true as const, answer: before }),
        setTokenRepository: () => Effect.succeed({ ok: true as const, answer: after }),
      });
      const { call, pushed, settled } = yield* subject(service);

      yield* call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORIES_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      yield* call(GATEWAY_METHOD.WORKSPACES_TOKEN_REPOSITORY_SET, {
        workspaceId: ACME.id,
        repository: "acme/side",
        added: true,
      });
      yield* Deferred.succeed(answering, undefined);
      yield* settled;

      assert.deepEqual(heldTokenRepositories(pushed).at(-1), { [ACME.id]: { rows: after } });
    }),
);

it.effect("two holds and a remount read one workspace's people once", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    service.members[ACME.id] = [ADA];
    const { call, pushed, settled } = yield* subject(service);

    yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
    yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
    yield* settled;
    service.live.people.set({ members: [memberRow(ADA)], former: [] });
    yield* nextPoll(settled);
    yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_UNFOLLOW, { workspaceId: ACME.id });
    yield* settled;
    yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
    yield* settled;

    assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
    assert.equal(service.live.people.held(), 1);
    assert.deepEqual(heldMembers(pushed), [{ [ACME.id]: { rows: { members: [ADA] } } }]);
  }),
);

it.effect(
  "a people read that fails for now stands failed where it never answered, is asked again on its own, and Try again reads it at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.members[ACME.id] = [ADA];
      service.workspacesFail = true;
      const { call, pushed, settled } = yield* subject(service);
      const seals = () => service.reads.filter((read) => read === `people-live:${ACME.id}`).length;

      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: { failed: true } });
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(seals(), 2, "the read is asked again");

      service.workspacesFail = false;
      yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_RETRY, { workspaceId: ACME.id });
      yield* settled;
      assert.equal(seals(), 3, "Try again reads at once");
      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: {} });
      service.live.people.set({ members: [memberRow(ADA)], former: [] });
      yield* settled;
      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: { rows: { members: [ADA] } } });
    }),
);

it.effect("a workspace the account is not in is told failed once, and not asked again", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call, pushed, settled } = yield* subject(service);

    yield* call(GATEWAY_METHOD.WORKSPACES_MEMBERS_FOLLOW, { workspaceId: ACME.id });
    yield* settled;
    yield* TestClock.adjust(Duration.minutes(1));
    yield* settled;

    assert.deepEqual(heldMembers(pushed), [{ [ACME.id]: { failed: true } }]);
    assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
  }),
);

it.effect(
  "a workspace's invitations held for an owner or an admin are laid on the app state soonest first, the expired left out by the host's clock and each with its accept link, and one the account may not manage is told failed once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, pushed, settled } = yield* subject(service);

      service.notPermitted = true;
      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, { workspaceId: RELAY.id });
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;
      service.notPermitted = false;
      yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, { workspaceId: ACME.id });
      yield* settled;
      service.live.invitations.set({
        invitations: [
          invitationRow("late", 2 * HOUR),
          invitationRow("spent", 0),
          invitationRow("soon", HOUR),
        ],
      });
      yield* settled;

      assert.deepEqual(heldInvitations(pushed), [
        { [RELAY.id]: { failed: true } },
        {
          [RELAY.id]: { failed: true },
          [ACME.id]: {
            rows: [pendingInvitation("soon", HOUR), pendingInvitation("late", 2 * HOUR)],
          },
        },
      ]);
      assert.deepEqual(service.reads, [
        `invitations-live:${RELAY.id}`,
        `invitations-live:${ACME.id}`,
      ]);
    }),
);

it.effect("an invitation leaves the held list at its expiry with no row moving", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call, pushed, settled } = yield* subject(service);
    yield* call(GATEWAY_METHOD.WORKSPACES_INVITATIONS_FOLLOW, { workspaceId: ACME.id });
    yield* settled;
    service.live.invitations.set({
      invitations: [invitationRow("soon", HOUR), invitationRow("late", 2 * HOUR)],
    });
    yield* settled;
    const soon = pendingInvitation("soon", HOUR);
    const late = pendingInvitation("late", 2 * HOUR);

    yield* TestClock.adjust(Duration.millis(HOUR - 1));
    yield* settled;
    assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [soon, late] } });
    yield* TestClock.adjust(Duration.millis(1));
    yield* settled;
    assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [late] } });
    yield* TestClock.adjust(Duration.millis(HOUR));
    yield* settled;
    assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [] } });
  }),
);
