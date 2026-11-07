/**
 * tasks-subject.ts -- the tasks and the workspaces composed over a fake service, as the host composes them, for the tests of each.
 */
import assert from "node:assert/strict";
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
import type { TasklessAgent } from "@repo/features/agent-wire";
import { AGENT_BROWSER_TABS_READ, TASK_BROWSER_TABS_READ } from "@repo/features/browser-tabs-live";
import { TASK_COMMENTS_READ } from "@repo/features/description-comment-live";
import {
  DESCRIPTION_COMMENT_ACTOR,
  DESCRIPTION_COMMENT_ENTRY,
  DESCRIPTION_COMMENT_STATUS,
  type DescriptionCommentThread,
} from "@repo/features/description-comment-wire";
import type { DescriptionEditAnswer } from "@repo/features/description-edit";
import type { GitHubConnection } from "@repo/features/github-connection-wire";
import { WRITE_UNTAKEN, type WriteUntaken } from "@repo/features/keyed-write";
import { LIVE_SIGNED_OUT, type SealedLiveQueryWire } from "@repo/features/live-wire";
import type { PageVersion } from "@repo/features/page-wire";
import { PICTURE_TYPE, type PictureType } from "@repo/features/picture-wire";
import type { WorkspaceSentry } from "@repo/features/sentry-install-wire";
import { SIDEBAR_READ } from "@repo/features/sidebar-live";
import type { WorkspaceSlackBot } from "@repo/features/slack-bot-wire";
import { TASK_HISTORY_READ } from "@repo/features/task-history-live";
import { AGENT_PAGES_READ, TASK_PAGES_READ } from "@repo/features/task-pages-live";
import { TASK_RECORD_READ } from "@repo/features/task-record-live";
import type {
  TaskSections,
  TaskSectionsWritten,
  TaskSectionWrite,
} from "@repo/features/task-section-wire";
import {
  DESCRIPTION_ACTOR,
  type DescriptionRevisionAnswer,
  type DescriptionRevisionsAnswer,
  type RepositoryPin,
  type RepositoryPinsWritten,
  TASK_PRIORITY,
  TASK_STATUS,
  type Task,
  type TaskAgentsSummary,
  type TaskCreateRequest,
  type TaskFileAnswer,
  type TaskSkillsAnswer,
  type TaskTreeAnswer,
} from "@repo/features/task-wire";
import {
  type BlockCallFailure,
  BROWSER_TAB_OPEN_FAILURE,
  type HeldDescriptionDocument,
  type ParentCallFailure,
  PICTURE_KEEP_FAILURE,
  type RelationCallFailure,
  type RepositoryCallFailure,
  TASK_CALL_FAILURE,
  type TaskCallFailure,
  type TasksCommentAnswer,
  type TasksView,
  tasksViewSchema,
} from "@repo/features/tasks-view";
import { WORKSPACE_INTEGRATIONS_READ } from "@repo/features/workspace-integrations-live";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import {
  WORKSPACE_INVITATIONS_READ,
  WORKSPACE_MEMBERS_READ,
  WORKSPACES_READ,
} from "@repo/features/workspace-live";
import {
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
import { type EntityPool, entityPool } from "@repo/sync";
import type { WireRecord, WireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { noNetwork } from "@repo/wire/testing";
import { Deferred, Duration, Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { type AppDescriptionDocuments, type AppHostRead, NO_KEYS_HELD } from "../app-state.js";
import { composeTasks, type TasksClient } from "../compose-tasks.js";
import { composeWorkspaces, type WorkspacesClient } from "../compose-workspaces.js";
import {
  type ActInput,
  type ActOutput,
  type TASKS_ACTS,
  WORKSPACE_ACTS,
} from "../contract/index.js";
import type { EntityStore } from "../entity-store.js";
import { type ActHandler, ActRefused, type HostActTable } from "../host-acts.js";
import { KEPT_CONTENT_CHARACTERS, keptContent } from "../kept-content.js";
import { windowFocus } from "../window-focus.js";
import { type PolledLive, polledLive } from "./polled-live.js";

/** A declared act the tasks composer answers, by its name. */
type TasksActName = keyof typeof TASKS_ACTS;

export const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
export const SECTION_ID = "3c9e1a2b-4d5f-4a6b-8c7d-9e0f1a2b3c4d";
/** The text the edit tests' task opens on. */
export const INVITES_TEXT = "# Teammate invitations";
export const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

export function task(id: string, name: string, body: string, updatedAt: number): Task {
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
export const MARKED_AT = 5_000;

/** The service as a table of tasks the test edits between beats. */
export interface FakeService extends TasksClient, WorkspacesClient {
  tasks: Task[];
  /** Each task's comment threads, by task id, and every comment write asked, in order. */
  threads: Record<string, DescriptionCommentThread[]>;
  commentCalls: string[];
  /** What a write to a thread answers, once `commentGate` opens where one stands; a deletion where none is named. */
  commentAnswer: TasksCommentAnswer | undefined;
  commentGate: Deferred.Deferred<void> | undefined;
  /** Each description's comments' live read by its task's id, and each page's by the page's; none answers unanswered. */
  commentLives: Record<string, PolledLive<CommentPart, typeof NOT_FOUND_LIVE>>;
  /** What the list says of each task's coding agents, by task id; a task with none says nothing. */
  agents: Record<string, TaskAgentsSummary>;
  /** The agents with no plan the list carries beside the plans. */
  tasklessAgents: TasklessAgent[];
  /** How many times the list's live read was first asked, its polls apart. */
  liveListReads: number;
  /** Whether a delete is refused, as a service that did not answer refuses it. */
  deleteFails: boolean;
  /** What a delete's answer waits on, so a test can see what is drawn while it is out. */
  deleteAnswered: Effect.Effect<void>;
  /** Whether a relation's change is refused, as a service that did not answer refuses it. */
  relationFails: boolean;
  /** What a relation change's answer waits on, so a test can see what is drawn while it is out. */
  relationAnswered: Effect.Effect<void>;
  createAnswer: TaskCallResult<TaskStarted, RepositoryCallFailure>;
  /** The idempotency key each start asked was sent under, in order. */
  createKeys: (string | undefined)[];
  /** Each start's request as the service was sent it, in order. */
  createRequests: TaskCreateRequest[];
  /** The repositories the account reaches, as the service answers them; a failure is the service refusing the read. */
  repositoriesAnswer: TaskCallResult<GitHubRepositoriesAnswer, typeof TASK_CALL_FAILURE.UNANSWERED>;
  /** Whether a repository is refused as one the App does not reach. */
  repositoryUnreachable: boolean;
  /** Every read the service answered, in order, so a test can see that nothing reads on a clock. */
  readonly reads: string[];
  /** Each task's pages' and calls' live read, by task id; a task with none is not found, as the service answers one the account does not reach. */
  recordLives: Record<string, PolledLive<RecordPart, typeof NOT_FOUND_LIVE>>;
  /** How many opens the service leaves unanswered before it answers again. */
  opensUnanswered: number;
  /** Each task's pages' live read; none answers unanswered. */
  pageLives: Record<string, PolledLive<"pages", typeof NOT_FOUND_LIVE>>;
  /** Each task's Browser tabs' live read; none answers unanswered. */
  browserTabLives: Record<string, PolledLive<"tabs", typeof NOT_FOUND_LIVE>>;
  /** Each task's newest page of history's live read; none answers unanswered. */
  historyLives: Record<string, PolledLive<"revisions">>;
  /** What the service answers for each file's window, by path; a path with none answers nothing, as a service that did not answer. */
  files: Record<string, TaskFileAnswer>;
  /** What the service answers for each folder's listing, by path; a path with none answers nothing, as a service that did not answer. */
  folders: Record<string, TaskTreeAnswer>;
  /** What the service answers for each task's skills, by task id; a task with none answers nothing, as a service that did not answer. */
  skills: Record<string, TaskSkillsAnswer>;
  /** What the service answers of a repository a workspace reaches, read with no plan, by workspace id and then repository: its files' windows and its folders by path, and its skills. */
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
  /** What the service answers for a repository's pull requests, by workspace id, then repository, then number; one with none answers nothing, as a service that did not answer. */
  pullRequests: Record<string, Record<string, Map<number, GitHubRepositoryPullRequestAnswer>>>;
  /** How many more pull request reads the service answers before it answers nothing, as GitHub refusing an App over its rate limit; none for no limit. And the gate a read waits on before it answers, where one is set. */
  pullRequestQuota: number | undefined;
  /** What setting a workspace's token repository answers; unanswered where a test gives none. */
  tokenRepositorySet: { readonly ok: true; readonly answer: readonly [] } | undefined;
  pullRequestGate: Deferred.Deferred<void> | undefined;
  /** What the service answers for a repository's issues, kept as its pull requests are. */
  issues: Record<string, Record<string, Map<number, GitHubRepositoryIssueAnswer>>>;
  /** The newest page of the history, for any task; none answers nothing, as a service that did not answer. */
  history: DescriptionRevisionsAnswer | undefined;
  /** The older pages of the history, by the revision each is read before. */
  olderHistory: Record<number, DescriptionRevisionsAnswer>;
  /** Each revision the service holds, by its number, which a restore puts back as the task's document. */
  revisions: Record<number, DescriptionRevisionAnswer["revision"]>;
  /** Every version of every page the service holds, for any task. */
  pages: PageVersion[];
  /** The descriptions' pictures the service holds, by plan and then by picture. */
  pictures: Map<string, Map<string, { contentType: PictureType; base64: string }>>;
  /** What an edit answers in place of a save, where a test sets one: a conflict or a refusal. */
  editAnswer: DescriptionEditAnswer | undefined;
  /** The transaction an edit answers it committed in, where a test names one. */
  editTxid: string | undefined;
  /** The account's pinned repositories, newest pinned first, as the service keeps them. */
  pins: RepositoryPin[];
  /** Whether the pins are refused, read and written alike, as a service that did not answer refuses them. */
  pinsFail: boolean;
  /** The transaction a pin's write answers it committed in, where a test names one. */
  pinTxid: string | undefined;
  /** The transaction a task's pin answers it committed in, where a test names one. */
  markTxid: string | undefined;
  /** Whether a task's pin is refused, as a service that did not answer refuses it. */
  markFails: boolean;
  /** The transaction a task's repository change answers it committed in, where a test names one. */
  repositoryTxid: string | undefined;
  /** What a task pin's answer waits on once the store has moved, so a test can sign out while it is still out. */
  markAnswered: Effect.Effect<void>;
  /** What a pin's answer waits on once the store has moved, so a test can sign out while it is still out. */
  pinAnswered: Effect.Effect<void>;
  /** The account's sidebar sections as the service keeps them; none where it does not answer, as before any test sets them. */
  sections: TaskSections | undefined;
  /** Every change to the sections the service was asked for, in order. */
  sectionWrites: TaskSectionWrite[];
  /** The kind of section change the service refuses, where a test names one. */
  sectionRefused: TaskSectionWrite["kind"] | undefined;
  /** How a task's rename goes untaken where a test names it: unanswered as offline, or refused. */
  renameUntaken: WriteUntaken | undefined;
  /** The idempotency key each rename asked was sent under, in order. */
  renameKeys: (string | undefined)[];
  /** What a section change's answer waits on once the service has it, so a test can ask another meanwhile. */
  sectionAnswered: Effect.Effect<void>;
  /** The workspaces the account is a member of, as the service lists them. */
  memberships: Workspace[];
  /** Our GitHub App's install address a connection answers. */
  installUrl: string;
  /** Whether the workspaces are not sealed, as a service that did not answer. */
  workspacesFail: boolean;
  /** Whether the service answers the workspaces' seals and polls as signed out, as a changed session does. */
  workspacesSignedOut: boolean;
  /** The name another Mac renames a workspace to just after this one's rename answers, where one does. */
  renamedAgain: string | undefined;
  /** What a rename's answer waits on once the store has moved, so a test can have the follow deliver first. */
  renameAnswered: Effect.Effect<void>;
  /** Waited on before an experiment's write answers, which a test holds open to see it drawn while it is out. */
  experimentAnswered: Effect.Effect<void>;
  /** What a role change's answer waits on once the store has answered, so a test can see what is drawn before it. */
  roleAnswered: Effect.Effect<void>;
  /** A slug another workspace holds, which the service refuses as taken; none where every slug is free. */
  slugTaken: string | undefined;
  /** What a slug change's answer waits on, so a test can see what is drawn before it. */
  slugAnswered: Effect.Effect<void>;
  /** Whether the workspaces' follow misses the store's changes, the live read answering none of them. */
  followMisses: boolean;
  /**
   * The account's live reads as the service answers them polled
   * (`testing/polled-live.ts`): the workspaces and the sidebar read from the
   * service's own state, the workspaces moved on every change to them; a
   * workspace's people and invitations, and the task list, as a test sets
   * their rows.
   */
  readonly live: {
    readonly workspaces: PolledLive<"workspaces" | "installations" | "experiments">;
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
  /** Each workspace's members, by its id. */
  members: Record<string, WorkspaceMember[]>;
  /** Each workspace's pending invitations, by its id. */
  invitations: Record<string, WorkspaceInvitation[]>;
  /** Each workspace's photo, by its id: its type and its bytes in base64; one with none is not found. */
  photos: Record<string, { contentType: WorkspacePhotoType; base64: string }>;
  /** Whether a write is refused as the account's role not allowing it. */
  notPermitted: boolean;
  /** What a Sentry disconnect answers, once `integrationsGate` lets it. */
  sentryAnswer: WorkspaceCallResult<WorkspaceSentry>;
  /** What the Slack bot's read and every Slack write answer, once `integrationsGate` lets a write. */
  slackBotAnswer: WorkspaceCallResult<WorkspaceSlackBot>;
  /** What a Sentry or Slack write waits on before the service answers it; nothing from the start. */
  integrationsGate: Effect.Effect<void>;
  /** The account's GitHub as the service last says it; none answers nothing, as a service that did not answer. */
  connection: GitHubConnection | undefined;
  /** Where a GitHub connection read waits before answering what it read, so a test can hold one on the wire. */
  githubGate: Effect.Effect<void>;
  /** The single-use pages the service hands out to connect GitHub, the newest last. */
  connectPages: string[];
}

export const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  slug: "ada-lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  githubInstallations: [],
  memberCount: 1,
};
export const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
  githubInstallations: [{ installationId: 7, login: "acme", active: true }],
  memberCount: 3,
};
/** A workspace's photo as the window sends it: a WebP's `data:` URL. */
export const PHOTO_URL = "data:image/webp;base64,UklGRgAAAABXRUJQ";
export const RELAY: Workspace = {
  id: "workspace-relay",
  name: "Relay Labs",
  slug: "relay-labs",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  githubInstallations: [],
  memberCount: 1,
};

/** The parts of a task's record's live read. */
export type RecordPart = "description" | "pages" | "calls" | "code";

/** The parts a subject's comments' live read delivers. */
export type CommentPart = "threads" | "entries" | "files";

/** A live read the service answers not found, as one the account does not reach. */
export const NOT_FOUND_LIVE = { failure: TASK_CALL_FAILURE.NOT_FOUND } as const;

/** A live read the service did not answer. */
const UNANSWERED_LIVE = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

/** The origin a workspace's invitations are answered with, which each accept link is built on. */
const INVITATIONS_ORIGIN = "https://app.test";

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

/** The workspaces as the live statements' rows carry them, the account's own first one being Ada's. */
export function workspacesLiveRows(workspaces: readonly Workspace[]) {
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
    experiments: workspaces.flatMap((each) =>
      (each.experiments ?? []).map(({ changedBy, ...choice }) => ({
        workspaceId: each.id,
        ...choice,
        changedById: changedBy?.id ?? null,
        changedByName: changedBy?.name ?? null,
      })),
    ),
  };
}
export const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=intent-1";
export const ADA: WorkspaceMember = {
  userId: "user-ada",
  name: "Ada Lovelace",
  email: "ada@app.test",
  role: WORKSPACE_ROLE.ADMIN,
};
export const GRACE: WorkspaceMember = {
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

/** The instant the fake service stamps every edit's save with. */
export const EDITED_AT = 7_000;

/** The task list's read as the service answers it, before it is read by sync id. */
type ListAnswer = Exclude<
  ReturnType<PolledLive<"plans" | "agents" | "issues">["first"]>,
  { readonly failure: string }
>;

/** Each part of the task list's rows by id as they stood at each sync id answered, so a read past one is answered what moved since. */
type ListAt = Map<string, ReadonlyMap<"plans" | "agents", ReadonlyMap<string, string>>>;

/** A part's rows by id, each as JSON, to tell which moved. */
function rowsById(rows: readonly unknown[] | undefined): ReadonlyMap<string, string> {
  return new Map(
    (rows ?? []).flatMap((row) => {
      const id = typeof row === "object" && row !== null ? Reflect.get(row, "id") : undefined;
      return typeof id === "string" ? [[id, JSON.stringify(row)] as const] : [];
    }),
  );
}

/**
 * The task list's read as the service answers it by sync id, each version
 * of the rows its id: past none, every row whole with the id to read past
 * next; past an id, each part only the rows that moved since, with the ids
 * of its own rows that stand no longer.
 */
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

export function fakeService(tasks: Task[]): FakeService {
  let memberships: Workspace[] = [PERSONAL];
  /** What the task list's read keeps to answer by sync id. */
  const listAt: ListAt = new Map();
  let followMisses = false;
  const live: FakeService["live"] = {
    workspaces: polledLive<"workspaces" | "installations" | "experiments">(
      ["workspaces", "installations", "experiments"],
      () => workspacesLiveRows(memberships),
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
  /** A live read's answer as the service's call answers it: the read, or why it answered none. */
  const called = <Answer, Failure extends string>(
    read: Effect.Effect<Answer | { readonly failure: Failure }>,
  ): Effect.Effect<TaskCallResult<Answer, Failure>> =>
    Effect.map(read, (answer) =>
      typeof answer === "object" && answer !== null && "failure" in answer
        ? { ok: false as const, failure: answer.failure }
        : { ok: true as const, answer: answer as Answer },
    );
  /** A live read first asked, or polled past `after`. */
  const asked = <Part extends string, Refused extends { readonly failure: string }>(
    read: PolledLive<Part, Refused>,
    poll: boolean | undefined,
    after: string | undefined,
  ) => (poll === true ? read.poll(after) : Effect.succeed(read.first()));
  /** The fake's live read of the declared read named, for the task, agent, or page its params name, first asked or polled past `after`; none where the service holds none. */
  const liveOf = (
    name: string,
    params: { readonly id: string; readonly page?: string },
    poll: boolean,
    after: string | undefined,
  ) => {
    const ask = <Part extends string, Refused extends { readonly failure: string }>(
      read: PolledLive<Part, Refused> | undefined,
    ) => (read === undefined ? undefined : asked(read, poll, after));
    if (name === TASK_COMMENTS_READ.name)
      return ask(service.commentLives[params.page ?? params.id]);
    if (name === TASK_HISTORY_READ.name) return ask(service.historyLives[params.id]);
    if (name === TASK_RECORD_READ.name) return ask(service.recordLives[params.id]);
    if (name === TASK_PAGES_READ.name || name === AGENT_PAGES_READ.name)
      return ask(service.pageLives[params.id]);
    if (name === TASK_BROWSER_TABS_READ.name || name === AGENT_BROWSER_TABS_READ.name)
      return ask(service.browserTabLives[params.id]);
    return undefined;
  };
  const service: FakeService = {
    tasks,
    threads: {},
    commentCalls: [],
    commentAnswer: undefined,
    commentGate: undefined,
    commentLives: {},
    // The service starts the thread as asked, the member its writer, and holds it on the description.
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
    createRequests: [],
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
    // The service keeps a picture under the next id, and refuses one more where the description holds two, a bound small enough to reach.
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
    experimentAnswered: Effect.void,
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
    // Each connect is a fresh page bound to the account, as the service mints one.
    github: {
      // The service reads the connection when asked and answers it after the gate.
      status: () =>
        Effect.suspend(() => {
          const read = service.connection;
          return Effect.map(service.githubGate, () =>
            read === undefined ? { failure: GITHUB_CONNECTION_CALL_FAILURE.UNANSWERED } : read,
          );
        }),
      connect: () =>
        Effect.sync(() => {
          const url = `https://vespin.dev/connect-github.html?intent=intent-${service.connectPages.length + 1}`;
          service.connectPages.push(url);
          return { url };
        }),
      // The service unlinks the session's GitHub and answers the connection as it then stands.
      disconnect: () =>
        Effect.sync(() => {
          service.reads.push("github-disconnect");
          if (service.notPermitted) {
            return { failure: GITHUB_CONNECTION_CALL_FAILURE.NOT_PERMITTED };
          }
          service.connection = { connected: false, login: null };
          return service.connection;
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
      setTokenRepository: () => Effect.succeed(service.tokenRepositorySet ?? UNANSWERED_WORKSPACE),
      environment: () => Effect.succeed(UNANSWERED_WORKSPACE),
      putVariable: () => Effect.succeed(UNANSWERED_WORKSPACE),
      deleteVariable: () => Effect.succeed(UNANSWERED_WORKSPACE),
      // Each workspace read as the service answers it; a poll is not counted among the reads.
      // SAFETY: each declared read answers its own script's rows, as its declaration's answer.
      liveRead: ((
        read: { readonly name: string },
        params: { readonly workspaceId?: string },
        poll?: { readonly after?: string | undefined },
      ) =>
        Effect.suspend((): Effect.Effect<unknown> => {
          const polled = poll !== undefined;
          const after = poll?.after;
          const workspaceId = params.workspaceId ?? "";
          switch (read.name) {
            // A workspace's invitations are read for an owner or an admin alone, as the service reads them.
            case WORKSPACE_INVITATIONS_READ.name:
              if (!polled) service.reads.push(`invitations-live:${workspaceId}`);
              if (service.notPermitted) {
                return Effect.succeed({ failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
              }
              return Effect.map(asked(live.invitations, polled, after), (answer) => ({
                ...answer,
                origin: INVITATIONS_ORIGIN,
              }));
            // A workspace's people are read for a member alone, as the service reads them.
            case WORKSPACE_MEMBERS_READ.name:
              if (!polled) service.reads.push(`people-live:${workspaceId}`);
              if (service.workspacesFail) {
                return Effect.succeed({ failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
              }
              return service.members[workspaceId] === undefined
                ? Effect.succeed({ failure: WORKSPACE_CALL_FAILURE.NOT_FOUND })
                : asked(live.people, polled, after);
            // The workspaces as the store holds them, each poll held until they move.
            case WORKSPACES_READ.name:
              if (!polled) service.reads.push("workspaces-live");
              if (service.workspacesFail) {
                return Effect.succeed({ failure: WORKSPACE_CALL_FAILURE.UNANSWERED });
              }
              if (service.workspacesSignedOut) return Effect.succeed(LIVE_SIGNED_OUT);
              // Note that a poll held until the workspaces moved reads the session again as it answers.
              return Effect.map(asked(live.workspaces, polled, after), (answer) =>
                service.workspacesSignedOut ? LIVE_SIGNED_OUT : answer,
              );
            // A workspace's integrations are read for a member alone, with both integrations held by the deployment.
            case WORKSPACE_INTEGRATIONS_READ.name:
              if (!polled) service.reads.push(`integrations-live:${workspaceId}`);
              return Effect.map(asked(live.integrations, polled, after), (answer) => ({
                ...answer,
                sentryConfigured: true,
                slackConfigured: true,
              }));
            default:
              return assert.fail(`no script answers the live read ${read.name}`);
          }
        })) as WorkspacesClient["workspaces"]["liveRead"],
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
      setExperiment: (workspaceId, experiment, on) =>
        Effect.sync(() => {
          service.reads.push(`experimentSet:${workspaceId}:${experiment}:${on}`);
          if (service.notPermitted) return NOT_PERMITTED_WORKSPACE;
          const found = service.memberships.find((each) => each.id === workspaceId);
          if (found === undefined) return UNANSWERED_WORKSPACE;
          const chosen = {
            experiment,
            on,
            changedBy: { id: "user-dana", name: "Dana" },
            changedAt: 5,
          };
          const now = { ...found, experiments: [chosen] };
          service.memberships = service.memberships.map((each) =>
            each.id === workspaceId ? now : each,
          );
          return { ok: true, answer: now } as const;
        }).pipe(Effect.tap(() => service.experimentAnswered)),
      setSlug: (workspaceId, slug) =>
        Effect.sync(() => {
          service.reads.push(`slugSet:${workspaceId}:${slug}`);
          return slug === service.slugTaken
            ? ({ ok: false, failure: WORKSPACE_CALL_FAILURE.SLUG_TAKEN } as const)
            : UNANSWERED_WORKSPACE;
        }).pipe(Effect.tap(() => service.slugAnswered)),
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
      // A handover makes the heir the owner and the account, the owner until then, an admin.
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
    // The service keeps a pin's first instant, newest pinned first, and answers the pins as they then stand.
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
    // The service answers its sections as they stand, the test having set them to what the write left.
    writeTaskSection: (write) =>
      Effect.sync((): TaskCallResult<TaskSectionsWritten, WriteUntaken> => {
        service.sectionWrites.push(write);
        const { sections } = service;
        return write.kind === service.sectionRefused || sections === undefined
          ? { ok: false, failure: WRITE_UNTAKEN.REFUSED }
          : { ok: true, answer: sections };
      }).pipe(Effect.tap(() => service.sectionAnswered)),
    // The service writes the edit's value into the document's decisions and answers the task whole.
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
    // A declared live read answers as its follow asks it: first, or polled past `after`; the sidebar as the service holds it, a poll not counted among the reads; the record of a task with none is not found, every other read unanswered.
    liveRead: ((
      read: { readonly name: string },
      params: { readonly id: string; readonly page?: string },
      poll?: { readonly after?: string | undefined },
    ) =>
      Effect.suspend((): Effect.Effect<unknown> => {
        if (read.name === SIDEBAR_READ.name) {
          if (poll === undefined) service.reads.push("sidebar-live");
          return asked(live.sidebar, poll !== undefined, poll?.after);
        }
        const followed = liveOf(read.name, params, poll !== undefined, poll?.after);
        if (followed !== undefined) return followed;
        return Effect.succeed(
          read.name === TASK_RECORD_READ.name ? NOT_FOUND_LIVE : UNANSWERED_LIVE,
        );
      })) as TasksClient["liveRead"],
    // Note that a poll past a sync id is not counted among the list's reads, as each is held until its rows move.
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
    create: (request, key) =>
      Effect.sync(() => {
        service.createKeys.push(key);
        service.createRequests.push(request);
        return service.createAnswer;
      }),
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
        const txid = service.repositoryTxid;
        return {
          ok: true,
          answer: { task: changed, ...(txid === undefined ? undefined : { txid }) },
        };
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
    // The service adds the block to the task the change names, as the store does, and answers the task whole.
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
    // The service sets the task's parent, or clears it, as the store does, and answers the task whole.
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
    // The service moves the relation to the kind named, as the store does: the other made the parent here, and answers the task whole.
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
    // The service re-titles the document with the name, as the store does.
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
    // The service sets the status, the priority, and the assignee named, naming the assignee by
    // their account, and leaves the rest standing; null assigns the task to no one.
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
    // The service stamps a pin at its own clock, and a false takes it away.
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

/** `settled`, then the host's next poll asked, which waits half a second after the last answered (`live-follow.ts`), then `settled` again. */
export const nextPoll = (settled: Effect.Effect<void>) =>
  Effect.andThen(settled, Effect.andThen(TestClock.adjust(Duration.millis(500)), settled));

/** The host's own fibers given their turn, as `subject`'s `settled` gives them. */
const settledTurns = Effect.repeat(Effect.yieldNow, { times: 200 });

/** The followed list answered with the parts given, the rest as they stood, on the poll standing or the next. */
export const listAnswers = (
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

export function subject(
  service: FakeService,
  options: {
    signedIn?: boolean;
    /** Whether the run reaches the service, which a fixture run does not. */
    sendsNetwork?: boolean;
    /** The account signed in now, Dana's where none is named. */
    accountId?: () => string;
    /** The account's lists kept on disk, none where none is named. */
    entities?: EntityStore;
    /** The pool the composer's rows stand in, a fresh one that keeps no write waiting where none is named. */
    pool?: EntityPool;
  } = {},
) {
  return Effect.gen(function* () {
    /** Every event the composer emitted besides the view, by its kind. */
    const pushed: [GatewayEventKind, WireValue][] = [];
    const told: TasksView[] = [];
    /** Every other event the host emitted, in order. */
    const events: { readonly kind: string; readonly payload: WireValue }[] = [];
    const waiters: {
      wanted: (view: TasksView) => boolean;
      seen: Deferred.Deferred<TasksView>;
    }[] = [];
    const focus = yield* windowFocus;
    const kept = yield* keptContent(KEPT_CONTENT_CHARACTERS);
    const pool = options.pool ?? (yield* entityPool());
    const accountId = options.accountId ?? (() => "user-dana");
    const account = { capabilitiesActive: () => options.signedIn ?? true };
    const kernel = {
      runMode: { sendsNetwork: options.sendsNetwork ?? true },
      now: () => 0,
      // Note that the id the host mints for a task it starts is the one the service answers it under.
      createId: () => INVITES,
      emit: (kind: GatewayEventKind, payload: WireValue) => {
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
    };
    const member = () => ({ userId: options.accountId?.() ?? "user-dana", name: "Dana" });
    const tasks = yield* composeTasks({
      kernel,
      account,
      client: service,
      accountId,
      member,
      kept,
      focus,
      pool,
      entities: () => options.entities,
      offlineRefused: { clear: () => undefined },
    }).pipe(Effect.provide(noNetwork));
    // Note that the workspaces are composed beside the tasks as the host composes them (`compose-host.ts`).
    const workspaces = yield* composeWorkspaces({
      kernel,
      account,
      client: service,
      accountId,
      member,
      kept,
      focus,
      pool,
      entities: () => options.entities,
      githubMoved: Effect.void,
      recordProductEvent: () => undefined,
      tasks: tasks.workspaces,
    }).pipe(Effect.provide(noNetwork));
    yield* tasks.link({ workspacesRefreshed: workspaces.refreshed });
    /** The account gate opening, as the host opens it. */
    const open = Effect.andThen(tasks.open, workspaces.open);
    /** The account gate closing, as the host closes it. */
    const reset = Effect.andThen(workspaces.reset, tasks.reset);
    /** A declared act answered by the handler of the composer that answers it, or a Gateway method either answers. */
    function call<Name extends TasksActName>(
      act: Name,
      input: ActInput<(typeof TASKS_ACTS)[Name]>,
    ): Effect.Effect<ActOutput<(typeof TASKS_ACTS)[Name]>>;
    function call(method: GatewayMethod, params?: WireRecord): Effect.Effect<WireValue>;
    function call(name: TasksActName | GatewayMethod, params: unknown = {}) {
      const acts: HostActTable<typeof TASKS_ACTS> = { ...tasks.acts, ...workspaces.acts };
      if (name in acts) {
        // SAFETY: the overloads pair each act's name with its own input.
        const handler = acts[name as TasksActName] as (
          input: unknown,
        ) => Effect.Effect<unknown, unknown>;
        return Effect.orDie(handler(params));
      }
      const handler =
        tasks.methods[name as GatewayMethod] ?? workspaces.methods[name as GatewayMethod];
      assert.ok(handler, `no handler for ${name}`);
      // SAFETY: a Gateway method is called with a record, as its overload takes.
      return Effect.orDie(handler(params as WireRecord, context));
    }
    /** One of the workspaces' acts, as the act port answers it: its value, or the sentence it was refused in. */
    const act = <Name extends keyof typeof WORKSPACE_ACTS>(
      name: Name,
      input: ActInput<(typeof WORKSPACE_ACTS)[Name]>,
    ) => {
      const workspaceActs: HostActTable<typeof WORKSPACE_ACTS> = workspaces.acts;
      // SAFETY: a workspace act is a plain act, never a live follow, so its handler is an `ActHandler`, which a name not yet known cannot narrow to.
      const handler = workspaceActs[name] as ActHandler<(typeof WORKSPACE_ACTS)[Name]>;
      return Effect.orDie(
        Effect.catchIf(
          handler(input),
          (error): error is ActRefused => error instanceof ActRefused,
          (refused) =>
            Effect.succeed({ refused: refused.sentence ?? WORKSPACE_ACTS[name].refusal }),
        ),
      );
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
    /** The host's own fibers given their turn, so what a poll answered is drawn. */
    const settled = Effect.gen(function* () {
      for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
    });
    /**
     * The followed list answered as the service holds it: a row for each of
     * its tasks, and the agents given, on the poll standing or the next, half
     * a second after the last answered (`live-follow.ts`).
     */
    const listed = (agents: readonly unknown[] = []) =>
      Effect.gen(function* () {
        service.live.list.set({ plans: service.tasks.map(rowOfTask), agents, issues: [] });
        yield* nextPoll(settled);
      });
    /** Holds a task's description as the window does while it has the task open. */
    const holdDescription = (taskId: string) =>
      call(GATEWAY_METHOD.TASKS_DOCUMENT_FOLLOW, { taskId });
    /** Opens a task as the window's press does, the window then holding its description, and lets the description's read land. */
    const openTask = (taskId: string) =>
      Effect.tap(call("TASKS_SELECT", { taskId }), () =>
        Effect.andThen(holdDescription(taskId), settled),
      );
    /** The descriptions the host holds for the windows as it last told them (`LIVE_READ.DESCRIPTION_DOCUMENT`). */
    const descriptions = (): AppDescriptionDocuments => {
      const told = pushed.findLast(
        ([kind]) => kind === GATEWAY_EVENT.DESCRIPTION_DOCUMENTS_CHANGED,
      );
      // SAFETY: the host tells its held descriptions whole as this event's payload.
      return (told?.[1] ?? NO_KEYS_HELD) as AppDescriptionDocuments;
    };
    /** `taskId`'s description as the host last told it held; none where it holds none. */
    const held = (taskId: string): AppHostRead<HeldDescriptionDocument> | undefined =>
      descriptions()[taskId];
    /** The task `taskId`'s held description holds; none where none is held, or it is gone. */
    const description = (taskId: string): Task | undefined => {
      const rows = held(taskId)?.rows;
      return rows !== undefined && "task" in rows ? rows.task : undefined;
    };
    return {
      tasks,
      workspaces,
      open,
      reset,
      call,
      act,
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

/** Every step a live follow has to take, taken. */
export const followSettled = Effect.repeat(
  Effect.andThen(
    Effect.yieldNow,
    Effect.promise(() => Promise.resolve()),
  ),
  { times: 20 },
);

/** Rows set on a live read, then its next poll asked, half a second after the last answered. */
export const answered = (set: () => void) =>
  Effect.andThen(
    Effect.sync(set),
    Effect.andThen(
      followSettled,
      Effect.andThen(TestClock.adjust(Duration.millis(500)), followSettled),
    ),
  );

/** One plan as the plans statement delivers its row. */
export function taskRow(id: string, name: string) {
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
export function rowOfTask(each: Task) {
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
