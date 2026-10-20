import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GITHUB_CONNECTION_CALL_FAILURE,
  type GitHubRepositoriesAnswer,
  type GitHubRepositoryIssueAnswer,
  type GitHubRepositoryPullRequestAnswer,
  type TaskCallResult,
  type TaskStarted,
  VOICE_SERVICE_FRAME,
  WORKSPACE_CALL_FAILURE,
} from "@luke/features";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import type { Board } from "@luke/features/board-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentMessagesAnswer,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import type { GitHubConnection } from "@luke/features/github-connection-wire";
import { ISSUE_STATE } from "@luke/features/github-repositories-wire";
import type { LinearIssueSummary } from "@luke/features/linear-wire";
import type { TaskConversationLiveAnswer } from "@luke/features/live-wire";
import type { PageLine, PageVersion } from "@luke/features/page-wire";
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
  TASK_STATUS,
  type Task,
  type TaskAgentsSummary,
  type TaskFileAnswer,
  type TaskSkillsAnswer,
  type TaskSummary,
  type TaskTreeAnswer,
} from "@luke/features/task-wire";
import {
  GITHUB_DISCONNECT_FAILURE,
  PICTURE_KEEP_FAILURE,
  type RepositoryCallFailure,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TaskCallFailure,
  type TasksView,
  type TaskWorkAnswer,
  tasksViewSchema,
} from "@luke/features/tasks-view";
import type { TaskTranscript } from "@luke/features/transcript-wire";
import type { WorkspaceInvitation } from "@luke/features/workspace-invitation-wire";
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
  type GatewayMethod,
} from "@luke/gateway";
import { MESSAGE_ROLE, type WireRecord } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { noNetwork } from "@luke/wire/testing";
import { Deferred, Duration, Effect, Exit, Fiber, Queue, Result } from "effect";
import { TestClock } from "effect/testing";
import { composeTasks, type TasksClient, type TasksConversationClient } from "./compose-tasks.js";
import type { LiveClient } from "./live-follow.js";

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

/** The instant the fake service stamps every pin and archive with. */
const MARKED_AT = 5_000;

function summary({
  document: _document,
  agentEdits: _agentEdits,
  lastEdit: _lastEdit,
  ...rest
}: Task): TaskSummary {
  return rest;
}

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
  listFails: boolean;
  /** Whether a delete is refused, as a service that did not answer refuses it. */
  deleteFails: boolean;
  /** Where a list read waits after reading the table and before answering, so a test can hold one on the wire. */
  listGate: Effect.Effect<void>;
  createAnswer: TaskCallResult<TaskStarted, RepositoryCallFailure>;
  /** The repositories the account reaches, as the service answers them; a failure is the service refusing the read. */
  repositoriesAnswer: TaskCallResult<GitHubRepositoriesAnswer, typeof TASK_CALL_FAILURE.UNANSWERED>;
  /** Whether a repository is refused as one the App does not reach. */
  repositoryUnreachable: boolean;
  /** Every read the service answered, in order, so a test can see that nothing reads on a clock. */
  readonly reads: string[];
  /** Each task's board, by task id; a task with none answers no board, as a service that did not answer. */
  boards: Record<string, Board>;
  /** The image each task's last save carried, by task id, as the service keeps it beside the board. */
  readonly images: Record<string, string | undefined>;
  /** Each task's transcript, by task id; a task with none answers no transcript, as a service that did not answer. */
  transcripts: Record<string, TaskTranscript>;
  /** Each task's newest page of work as the service keeps it, by task id; a task with none answers nothing, as a service that did not answer. */
  works: Record<string, TaskWorkAnswer>;
  /** The older pages of work, by the turn each is read before. */
  olderWorks: Record<string, TaskWorkAnswer>;
  /** Every page of work asked for, in order: the task, and the turn it was read before where it was. */
  readonly workReads: string[];
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
  /** What the service answers for a repository's issues, kept as its pull requests are. */
  issues: Record<string, Record<string, Map<number, GitHubRepositoryIssueAnswer>>>;
  /** The newest page of the history, for any task; none answers nothing, as a service that did not answer. */
  history: PlanRevisionsAnswer | undefined;
  /** The older pages of the history, by the revision each is read before. */
  olderHistory: Record<number, PlanRevisionsAnswer>;
  /** Every task whose work a Stop reached the service for, in order. */
  stops: string[];
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
  /** The workspaces the account is a member of, as the service lists them. */
  memberships: Workspace[];
  /** The Luke GitHub App install address a connection answers. */
  installUrl: string;
  /** Whether the workspaces list is refused, as a service that did not answer refuses it. */
  workspacesFail: boolean;
  /** The name another Mac renames a workspace to just after this one's rename answers, where one does. */
  renamedAgain: string | undefined;
  /** Where a workspaces read waits after reading the table and before answering, so a test can hold one on the wire. */
  workspacesGate: Effect.Effect<void>;
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
};
const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  slug: "acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
};
/** A workspace's photo as the window sends it: a WebP's `data:` URL. */
const PHOTO_URL = "data:image/webp;base64,UklGRgAAAABXRUJQ";
const RELAY: Workspace = {
  id: "workspace-relay",
  name: "Relay Labs",
  slug: "relay-labs",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
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
    listFails: false,
    deleteFails: false,
    listGate: Effect.void,
    createAnswer: { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED },
    repositoriesAnswer: { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED },
    repositoryUnreachable: false,
    reads: [],
    boards: {},
    images: {},
    transcripts: {},
    works: {},
    olderWorks: {},
    workReads: [],
    files: {},
    folders: {},
    skills: {},
    places: {},
    pullRequests: {},
    issues: {},
    history: undefined,
    olderHistory: {},
    revisions: {},
    readRevisions: (_taskId, before) =>
      Effect.sync(() => (before === undefined ? service.history : service.olderHistory[before])),
    readRevision: (_taskId, seq) => Effect.sync(() => service.revisions[seq]),
    pages: [],
    pageLines: {},
    readPages: (taskId) => Effect.sync(() => service.pageLines[taskId]),
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
        return restored;
      }),
    stops: [],
    stopWork: (taskId) =>
      Effect.sync(() => {
        service.stops.push(taskId);
      }),
    editAnswer: undefined,
    pins: [],
    pinsFail: false,
    sections: undefined,
    sectionWrites: [],
    memberships: [PERSONAL],
    installUrl: INSTALL_URL,
    workspacesFail: false,
    renamedAgain: undefined,
    workspacesGate: Effect.void,
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
    // The service's workspaces as a table the test edits, each write moving it as the store does.
    workspaces: {
      list: () =>
        Effect.gen(function* () {
          service.reads.push("workspaces");
          const answer = service.workspacesFail ? undefined : { workspaces: service.memberships };
          yield* service.workspacesGate;
          return answer;
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
        }),
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
          const now = { ...disconnected, github: null };
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
    repositoryPins: () => Effect.sync(() => (service.pinsFail ? undefined : service.pins)),
    // The service keeps a pin's first instant, newest pinned first, and answers the pins as they then stand.
    pinRepository: (repository, pinned) =>
      Effect.sync(() => {
        if (service.pinsFail) return undefined;
        const others = service.pins.filter((pin) => pin.repository !== repository);
        const standing = service.pins.find((pin) => pin.repository === repository);
        service.pins = pinned
          ? [standing ?? { repository, pinnedAt: MARKED_AT + service.pins.length }, ...others]
          : others;
        return service.pins;
      }),
    taskSections: () => Effect.sync(() => service.sections),
    // The service answers its sections as they stand, the test having set them to what the write left.
    writeTaskSection: (write) =>
      Effect.sync(() => {
        service.sectionWrites.push(write);
        return service.sections;
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
      Effect.sync(() => service.places[place.workspaceId]?.[place.repository]?.skills),
    readRepositoryPullRequest: (place, number) =>
      Effect.sync(() => service.pullRequests[place.workspaceId]?.[place.repository]?.get(number)),
    readRepositoryIssue: (place, number) =>
      Effect.sync(() => service.issues[place.workspaceId]?.[place.repository]?.get(number)),
    readBoard: (taskId) => Effect.sync(() => service.boards[taskId]),
    readTranscript: (taskId) => Effect.sync(() => service.transcripts[taskId]),
    readWork: (taskId, before) =>
      Effect.sync(() => {
        service.workReads.push(before === undefined ? taskId : `${taskId}:${before}`);
        return before === undefined ? service.works[taskId] : service.olderWorks[before];
      }),
    // The service keeps the last scene written, beside whatever drawing it holds.
    saveBoard: (taskId, elements, appliedDrawing, image) =>
      Effect.sync(() => {
        service.images[taskId] = image;
        const board = { ...service.boards[taskId], elements, appliedDrawing };
        service.boards[taskId] = board;
        return board;
      }),
    list: () =>
      Effect.gen(function* () {
        service.reads.push("list");
        const answer = service.listFails
          ? { ok: false as const, failure: TASK_CALL_FAILURE.UNANSWERED }
          : {
              ok: true as const,
              answer: {
                plans: service.tasks.map((each) => {
                  const agents = service.agents[each.id];
                  return agents === undefined ? summary(each) : { ...summary(each), agents };
                }),
                planlessAgents: service.tasklessAgents,
              },
            };
        yield* service.listGate;
        return answer;
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
      Effect.sync((): TaskCallResult<Task, RepositoryCallFailure> => {
        if (service.repositoryUnreachable) {
          return { ok: false, failure: TASK_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };
        }
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.UNANSWERED };
        const changed = { ...found, repository };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? changed : candidate,
        );
        return { ok: true, answer: changed };
      }),
    // The service moves the task and answers it whole.
    move: (taskId, workspaceId) =>
      Effect.sync((): TaskCallResult<Task, TaskCallFailure> => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return { ok: false, failure: TASK_CALL_FAILURE.NOT_FOUND };
        const moved = { ...found, workspaceId };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? moved : candidate,
        );
        return { ok: true, answer: moved };
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
        return renamed;
      }),
    // The service sets the status and the priority named, and leaves the other standing.
    setStanding: (taskId, standing) =>
      Effect.sync(() => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return undefined;
        const changed = { ...found, ...standing };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? changed : candidate,
        );
        return changed;
      }),
    // The service stamps a pin or an archive at its own clock, and a false takes it away.
    mark: (taskId, { pinned, archived }) =>
      Effect.sync(() => {
        const found = service.tasks.find((candidate) => candidate.id === taskId);
        if (found === undefined) return undefined;
        const { pinnedAt, archivedAt, ...rest } = found;
        const pin = pinned === undefined ? pinnedAt : pinned ? MARKED_AT : undefined;
        const archive = archived === undefined ? archivedAt : archived ? MARKED_AT : undefined;
        const marked = {
          ...rest,
          ...(pin === undefined ? undefined : { pinnedAt: pin }),
          ...(archive === undefined ? undefined : { archivedAt: archive }),
        };
        service.tasks = service.tasks.map((candidate) =>
          candidate.id === taskId ? marked : candidate,
        );
        return marked;
      }),
    delete: (taskId) =>
      Effect.sync(() => {
        if (service.deleteFails) return false;
        service.tasks = service.tasks.filter((candidate) => candidate.id !== taskId);
        return true;
      }),
  };
  return service;
}

/** Which page of a task's conversation a read asked for. */
const CONVERSATION_READ = {
  NEWEST: "newest",
  AFTER: "after",
  /** Past a cursor in one look, never held, as a read on the conversation's live mark asks. */
  LOOK: "look",
  BEFORE: "before",
} as const;

type ConversationRead = (typeof CONVERSATION_READ)[keyof typeof CONVERSATION_READ];

/** One read of a task's conversation as the service heard it: the task, which page, and the cursor or turn it named. */
type ConversationAsk = readonly [taskId: string, read: ConversationRead, from?: string];

/**
 * The service's side of each task's conversation. A read from the newest
 * turns or past a cursor waits for the page the test hands it; a read
 * before a turn is answered at once from the older pages. Its mark is
 * sealed for following unless a test says otherwise.
 */
interface FakeConversations extends TasksConversationClient {
  /** Every read asked, in order. */
  readonly asks: ConversationAsk[];
  /** The next read asked, waited on until the composer asks it. */
  readonly nextAsk: Effect.Effect<ConversationAsk>;
  /** Hands the read standing on `planId`, or the next one, its answer. */
  answer: (taskId: string, answer: CodingAgentMessagesAnswerView) => Effect.Effect<void>;
  /** The older pages, by the turn each is read before. */
  older: Record<string, CodingAgentMessagesAnswer>;
  /** What the service seals for following a plan's conversation; none answers unanswered. */
  sealed: TaskConversationLiveAnswer | undefined;
  /** Every plan a seal was asked for, in order. */
  readonly seals: string[];
}

function fakeConversations(): Effect.Effect<FakeConversations> {
  return Effect.gen(function* () {
    const asked = yield* Queue.unbounded<ConversationAsk>();
    const pages = new Map<string, Queue.Queue<CodingAgentMessagesAnswerView>>();
    for (const taskId of [INVITES, BILLING]) {
      pages.set(taskId, yield* Queue.unbounded<CodingAgentMessagesAnswerView>());
    }
    const conversations: FakeConversations = {
      asks: [],
      nextAsk: Queue.take(asked),
      older: {},
      sealed: SEALED_CONVERSATION,
      seals: [],
      taskConversationLive: (taskId) =>
        Effect.sync(() => {
          conversations.seals.push(taskId);
          return conversations.sealed ?? { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED };
        }),
      answer: (taskId, answer) => {
        const waiting = pages.get(taskId);
        assert.ok(waiting, `no conversation for ${taskId}`);
        return Effect.asVoid(Queue.offer(waiting, answer));
      },
      taskMessages: (taskId, page) =>
        Effect.gen(function* () {
          const ask: ConversationAsk =
            page.before !== undefined
              ? [taskId, CONVERSATION_READ.BEFORE, page.before]
              : page.after !== undefined
                ? [
                    taskId,
                    page.unheld === true ? CONVERSATION_READ.LOOK : CONVERSATION_READ.AFTER,
                    page.after,
                  ]
                : [taskId, CONVERSATION_READ.NEWEST];
          conversations.asks.push(ask);
          yield* Queue.offer(asked, ask);
          if (page.before !== undefined) {
            return (
              conversations.older[page.before] ?? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }
            );
          }
          const waiting = pages.get(taskId);
          return waiting === undefined ? yield* Effect.never : yield* Queue.take(waiting);
        }),
    };
    return conversations;
  });
}

/** One brain turn's journal as the service stores it, its words as one text part. */
function journal(id: string, text: string): CodingAgentMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text }] };
}

/** A turn of Luke's that called his plan edit, its call settled with the task's receipt as eve settles it. */
function planEditing(id: string): CodingAgentMessage {
  return {
    id,
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "text", text: "Writing it down." },
      {
        type: `tool-${AGENT_TOOL.EDIT_PLAN}`,
        toolCallId: "call-1",
        state: "output-available",
        input: { notes: [] },
        output: "Started task edit_plan-1.",
      },
    ],
  };
}

/** A page of a task's conversation as the service answers it. */
function conversationPage(
  messages: readonly CodingAgentMessage[],
  cursor: string,
  status: CodingAgentStatus,
  earlier?: string,
): CodingAgentMessagesAnswer {
  return {
    messages,
    cursor,
    status,
    title: null,
    ...(earlier === undefined ? undefined : { earlier }),
  };
}

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** The host's clock, which a seal's renewal is timed by. */
const NOW = 1_800_000_100_000;

/** A task's conversation mark sealed as the service answers it. */
const SEALED_CONVERSATION: TaskConversationLiveAnswer = {
  url: "wss://realtime.example/v1",
  queries: {
    mark: {
      capability: "capability-mark",
      queryFingerprint: "fingerprint-mark",
      expiresAt: NOW + 60_000,
    },
  },
};

/** A conversation's mark as its row delivers it, at a sequence and with the newest turn's status. */
function markRow(seq: number, turnStatus: string) {
  return { seq, revision: seq, turnId: "turn-1", turnStatus, workers: [] };
}

/** Realtime as a script: each subscription by its capability, and a way to deliver rows to one or stop it for good. */
function fakeRealtime() {
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const closed: string[] = [];
  const open = (url: string): LiveClient => ({
    subscribe: (query) => ({
      onChange: (listener) => {
        listeners.set(query.capability, listener);
        return () => listeners.delete(query.capability);
      },
      renew: () => Promise.resolve(),
      unsubscribe: () => void listeners.delete(query.capability),
    }),
    close: () => void closed.push(url),
  });
  /** The mark's subscription, once the host's follower has made it. */
  const subscribed = Effect.gen(function* () {
    for (let turn = 0; turn < 100; turn += 1) {
      const listener = listeners.get("capability-mark");
      if (listener !== undefined) return listener;
      yield* Effect.yieldNow;
    }
    return assert.fail("the host never subscribed to the mark");
  });
  return {
    open,
    closed,
    /** The mark's rows delivered, as Realtime's snapshot carries them, once the host subscribed. */
    deliver: (data: readonly unknown[]) =>
      Effect.map(subscribed, (listener) => listener({ status: "live", data })),
    /** The mark's subscription stopped for good. */
    fail: Effect.map(subscribed, (listener) => listener({ status: "error", data: [] })),
  };
}

/** The one voice call as the live composer holds it: about a task, about the desk, or none. */
interface StandingCall {
  about: { readonly taskId: string | undefined } | undefined;
  /** Where ending a call waits before it lands, as a real call's close does. */
  closing?: Effect.Effect<void>;
}

function subject(service: FakeService, options: { signedIn?: boolean; call?: StandingCall } = {}) {
  return Effect.gen(function* () {
    const told: TasksView[] = [];
    const waiters: {
      wanted: (view: TasksView) => boolean;
      seen: Deferred.Deferred<TasksView>;
    }[] = [];
    const standing = options.call ?? { about: undefined };
    const conversations = yield* fakeConversations();
    const realtime = fakeRealtime();
    const tasks = yield* composeTasks({
      openLive: realtime.open,
      kernel: {
        now: () => NOW,
        runMode: { sendsNetwork: true },
        emit: (kind, payload) => {
          if (kind !== GATEWAY_EVENT.TASKS_CHANGED) return;
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
      conversations,
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
    return { tasks, call, told, last, viewWhere, viewLands, conversations, realtime };
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
    const { call, last, tasks } = yield* subject(fakeService([billing, invites]));

    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    assert.deepEqual(last()?.tasks, [summary(billing), summary(invites)]);
    assert.equal(last()?.listStatus, TASKS_READ.READY);
    assert.equal(last()?.activeTaskId, undefined);

    assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES }), {
      opened: true,
    });
    assert.equal(last()?.activeTaskId, INVITES);
    assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: invites });
    assert.equal(tasks.activeTaskId(), INVITES);

    yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: BILLING });
    assert.equal(last()?.activeTaskId, BILLING);
    assert.deepEqual(last()?.document, { status: TASKS_READ.READY, task: billing });
  }),
);

it.effect(
  "a task's code read as none is held as none, and a task whose work read did not answer holds its code unread",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      service.works[INVITES] = { turns: [] };
      const { call, last } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      assert.deepEqual(last()?.shownCode, []);

      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: BILLING });
      assert.equal(last()?.shownCode, undefined);
    }),
);

it.effect(
  "a task's work read that did not answer says so, keeping its code unread, and a refresh reads it again",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last, told } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      assert.ok(
        told.some((view) => view.workStatus === TASKS_READ.READING),
        "the read says it is out",
      );
      assert.equal(last()?.workStatus, TASKS_READ.FAILED);
      assert.equal(last()?.shownCode, undefined);

      service.works[INVITES] = { turns: [] };
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.equal(last()?.workStatus, TASKS_READ.READY);
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
  "the window's refresh lists the agents with no plan beside the plans, and a list read that fails keeps them",
  () =>
    Effect.gen(function* () {
      const billing = task(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing]);
      const triage: TasklessAgent = {
        id: "6f1c1f9e-5a8e-4f52-9d6c-2b7a0d1e3c41",
        planId: null,
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        title: "Triage overnight Sentry issues",
        createdAt: 30,
        status: CODING_AGENT_STATUS.COMPLETED,
        turnId: null,
        automationId: "0b9d6c7e-1f2a-4b3c-8d4e-5f6a7b8c9d0e",
        automationName: "Morning Sentry triage",
        workspaceId: ACME.id,
        repository: "acme/api",
        activityAt: 45,
      };
      service.tasklessAgents = [triage];
      const { call, last } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      const read = [last()?.tasks, last()?.tasklessAgents];
      service.listFails = true;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);

      assert.deepEqual(read, [[summary(billing)], [triage]]);
      assert.equal(last()?.listStatus, TASKS_READ.FAILED);
      assert.deepEqual(last()?.tasklessAgents, [triage]);
    }),
);

it.effect(
  "a draft the notetaker sends during a call is drawn in place of the open plan, and the saved one carries its save, by Luke on the call",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Draft", 10);
      const service = fakeService([invites]);
      const { call, last, tasks } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });

      const drafting = { body: "# Draft\n\n## Goal", assumptions: [] };
      tasks.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: drafting,
      });
      assert.deepEqual(last()?.document, {
        status: TASKS_READ.READY,
        task: { ...invites, document: drafting },
      });

      const saved = { body: "# Draft\n\n## Goal\n\nInvite by email.", assumptions: [] };
      tasks.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: saved,
        savedAt: 11,
      });
      assert.deepEqual(last()?.document, {
        status: TASKS_READ.READY,
        task: {
          ...invites,
          updatedAt: 11,
          document: saved,
          lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 11, duringCall: true },
        },
      });
    }),
);

it.effect(
  "the developer's edit is saved on the service and the open document takes the plan it answered",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });

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
  "after the developer's edit, a draft the notetaker drew over an older save is dropped, and its later save is drawn",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last, tasks } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* call(GATEWAY_METHOD.TASKS_EDIT, {
        taskId: INVITES,
        edit: { document: { base: INVITES_TEXT, value: `${INVITES_TEXT}\n\nInvites expire.` } },
      });
      const edited = last()?.document;

      tasks.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: { body: "# Teammate invitations\n\nA stale draft.", assumptions: [] },
        readAt: EDITED_AT - 1,
      });
      const afterStale = last()?.document;
      const saved = { body: "# Teammate invitations\n\nInvites expire.\n\nMore.", assumptions: [] };
      tasks.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: saved,
        readAt: EDITED_AT - 1,
        savedAt: EDITED_AT + 1,
      });

      assert.deepEqual(afterStale, edited);
      assert.deepEqual(last()?.document.task?.document, saved);
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
  "the window's refresh reads the account's sections, a change takes the service's answer, and one refused leaves them as read",
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
      service.sections = { sections: [launch], entries: [] };

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.deepEqual(last()?.taskSections, service.sections);

      const placed = { taskId: INVITES, sectionId: SECTION_ID, addedAt: 6 };
      service.sections = { sections: [launch], entries: [placed] };
      const place = { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES, sectionId: SECTION_ID };
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_WRITE_SECTION, place), { changed: true });
      assert.deepEqual(last()?.taskSections, { sections: [launch], entries: [placed] });

      service.sections = undefined;
      const removal = { ...place, sectionId: null };
      assert.deepEqual(yield* call(GATEWAY_METHOD.TASKS_WRITE_SECTION, removal), {
        changed: false,
      });
      assert.deepEqual(last()?.taskSections, { sections: [launch], entries: [placed] });
      assert.deepEqual(service.sectionWrites, [place, removal]);
    }),
);

it.effect("a sign-out drops the view the window drew", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last, tasks } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });

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
  "opening a plan reads its conversation's newest page onto the view, and an idle one is not asked again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations } = yield* subject(service);
      const newest = conversationPage(
        [journal("turn-2", "Read the invite model.")],
        "4:2",
        CODING_AGENT_STATUS.COMPLETED,
        "turn-1",
      );

      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.NEWEST]);
      const landed = yield* viewLands((view) => view.conversation !== undefined);
      yield* conversations.answer(INVITES, newest);
      const view = yield* landed;
      yield* TestClock.adjust(Duration.minutes(5));

      assert.deepEqual(view.conversation, newest);
      assert.deepEqual(conversations.asks, [[INVITES, CONVERSATION_READ.NEWEST]]);
    }),
);

it.effect(
  "a look past the cursor joins a journal rewritten in place where it stands and appends a new one",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations, realtime } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
      );
      yield* realtime.deliver([markRow(2, "running")]);

      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.LOOK, "1:1"]);
      const landed = yield* viewLands((view) => view.conversation?.cursor === "2:3");
      yield* conversations.answer(
        INVITES,
        conversationPage(
          [journal("turn-1", "Read the invite model."), journal("turn-2", "Invites expire.")],
          "2:3",
          CODING_AGENT_STATUS.COMPLETED,
        ),
      );
      const view = yield* landed;

      assert.deepEqual(view.conversation?.messages, [
        journal("turn-1", "Read the invite model."),
        journal("turn-2", "Invites expire."),
      ]);
      assert.equal(view.conversation?.status, CODING_AGENT_STATUS.COMPLETED);
    }),
);

it.effect(
  "the earlier page lays older turns before the rest, and the follow goes on from its own cursor",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, viewLands, conversations, realtime } = yield* subject(service);
      conversations.older["turn-1"] = conversationPage(
        [journal("turn-0", "Opened the plan.")],
        "9:9",
        CODING_AGENT_STATUS.COMPLETED,
      );
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(
        INVITES,
        conversationPage(
          [journal("turn-1", "Reading")],
          "1:1",
          CODING_AGENT_STATUS.RUNNING,
          "turn-1",
        ),
      );
      yield* realtime.deliver([markRow(2, "running")]);
      yield* conversations.nextAsk;

      yield* call(GATEWAY_METHOD.TASKS_CONVERSATION_EARLIER);
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.BEFORE, "turn-1"]);
      const earlier = last()?.conversation;
      const landed = yield* viewLands((view) => view.conversation?.cursor === "2:3");
      yield* conversations.answer(
        INVITES,
        conversationPage(
          [journal("turn-2", "Invites expire.")],
          "2:3",
          CODING_AGENT_STATUS.RUNNING,
        ),
      );
      const view = yield* landed;

      assert.deepEqual(earlier, {
        messages: [journal("turn-0", "Opened the plan."), journal("turn-1", "Reading")],
        cursor: "1:1",
        status: CODING_AGENT_STATUS.RUNNING,
        title: null,
      });
      assert.deepEqual(conversations.asks.at(1), [INVITES, CONVERSATION_READ.LOOK, "1:1"]);
      assert.deepEqual(view.conversation?.messages, [
        journal("turn-0", "Opened the plan."),
        journal("turn-1", "Reading"),
        journal("turn-2", "Invites expire."),
      ]);
    }),
);

it.effect("opening another plan stops the conversation read of the one left behind", () =>
  Effect.gen(function* () {
    const service = fakeService([
      task(INVITES, "Teammate invitations", "# Draft", 10),
      task(BILLING, "Billing export", "# Billing export", 20),
    ]);
    const { call, viewLands, conversations, realtime } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
    yield* conversations.nextAsk;
    yield* conversations.answer(
      INVITES,
      conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
    );
    yield* realtime.deliver([markRow(2, "running")]);
    yield* conversations.nextAsk;

    yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: BILLING });
    assert.deepEqual(yield* conversations.nextAsk, [BILLING, CONVERSATION_READ.NEWEST]);
    const billing = conversationPage(
      [journal("turn-9", "Exports run nightly.")],
      "3:1",
      CODING_AGENT_STATUS.COMPLETED,
    );
    const landed = yield* viewLands((view) => view.conversation !== undefined);
    yield* conversations.answer(BILLING, billing);
    yield* landed;
    yield* conversations.answer(
      INVITES,
      conversationPage([journal("turn-2", "Late.")], "2:2", CODING_AGENT_STATUS.RUNNING),
    );
    yield* TestClock.adjust(Duration.minutes(5));

    assert.deepEqual(conversations.asks, [
      [INVITES, CONVERSATION_READ.NEWEST],
      [INVITES, CONVERSATION_READ.LOOK, "1:1"],
      [BILLING, CONVERSATION_READ.NEWEST],
    ]);
  }),
);

it.effect(
  "a conversation read the service did not answer is asked again after the backoff, and not before",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(INVITES, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });

      yield* TestClock.adjust(Duration.millis(999));
      const beforeBackoff = conversations.asks.length;
      yield* TestClock.adjust(Duration.millis(1));
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.NEWEST]);
      const newest = conversationPage([], "0:0", CODING_AGENT_STATUS.COMPLETED);
      const landed = yield* viewLands((view) => view.conversation !== undefined);
      yield* conversations.answer(INVITES, newest);

      assert.equal(beforeBackoff, 1);
      assert.deepEqual((yield* landed).conversation, newest);
    }),
);

it.effect(
  "code shown on the open task's call is drawn coloured, in the order shown and once, and code about another task is dropped",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.works[INVITES] = { turns: [] };
      const { call, tasks, viewLands } = yield* subject(service);
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
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
      const line = showing[0]?.code.lines[0] ?? [];
      assert.ok(line.length > 1, "a TypeScript line is coloured in runs");
      assert.equal(line.map((run) => run.text).join(""), "const answer = 42;");
    }),
);

it.effect(
  "a turn of the open untitled plan that settles reads the list again once the name the service gives it has had time to land",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Untitled", "# Draft", 10)]);
      const { call, tasks, viewLands, conversations, realtime } = yield* subject(service);
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
      );
      yield* realtime.deliver([markRow(2, "settled")]);
      yield* conversations.nextAsk;
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Done.")], "1:2", CODING_AGENT_STATUS.COMPLETED),
      );
      // The service names the task just after the turn settles.
      service.tasks = [task(INVITES, "Fix invite emails", "# Draft", 10)];
      const named = yield* viewLands(
        (view) =>
          view.tasks.some((row) => row.id === INVITES && row.name === "Fix invite emails") &&
          view.document.task?.name === "Fix invite emails",
      );

      yield* TestClock.adjust(Duration.seconds(5));

      yield* named;
    }),
);

it.effect(
  "an untitled plan opened on a turn already settled reads the list again for the name it may have been given",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Untitled", "# Draft", 10)]);
      const { call, tasks, viewLands, conversations } = yield* subject(service);
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Done.")], "1:1", CODING_AGENT_STATUS.COMPLETED),
      );
      service.tasks = [task(INVITES, "Fix invite emails", "# Draft", 10)];
      const named = yield* viewLands((view) =>
        view.tasks.some((row) => row.id === INVITES && row.name === "Fix invite emails"),
      );

      yield* TestClock.adjust(Duration.seconds(5));

      yield* named;
    }),
);

it.effect(
  "the open plan's conversation is asked in one look each time its mark moves, an idle one included, and never on a hold or a word of the call",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks, viewLands, conversations, realtime } = yield* subject(service);
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.NEWEST]);
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
      );
      yield* realtime.deliver([markRow(2, "running")]);
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.LOOK, "1:1"]);
      assert.deepEqual(conversations.seals, [INVITES]);
      const settled = yield* viewLands((view) => view.conversation?.cursor === "2:2");
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Done.")], "2:2", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* settled;

      // The same mark again, a word of the call, and a long wait ask nothing.
      yield* realtime.deliver([markRow(2, "running")]);
      tasks.showActivity({
        type: VOICE_SERVICE_FRAME.TASK_ACTIVITY,
        planId: INVITES,
        planner: {},
        notes: false,
      });
      yield* TestClock.adjust(Duration.minutes(5));
      assert.equal(conversations.asks.length, 2);

      yield* realtime.deliver([markRow(3, "settled")]);
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.LOOK, "2:2"]);
    }),
);

it.effect(
  "a conversation mark that stops is sealed again after a pause, and the conversation asked on from the cursor held",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks, conversations, realtime } = yield* subject(service);
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
      );
      yield* realtime.fail;
      assert.deepEqual(conversations.seals, [INVITES]);
      yield* TestClock.adjust(Duration.seconds(2));

      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.LOOK, "1:1"]);
      assert.deepEqual(conversations.seals, [INVITES, INVITES]);
    }),
);

it.effect(
  "a plan the service seals no conversation mark for is asked for one again after a pause, and read once it is sealed",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks, conversations } = yield* subject(service);
      conversations.sealed = undefined;
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* TestClock.adjust(Duration.seconds(1));
      assert.deepEqual(conversations.seals, [INVITES]);
      assert.deepEqual(conversations.asks, []);

      conversations.sealed = SEALED_CONVERSATION;
      yield* TestClock.adjust(Duration.seconds(1));
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.NEWEST]);
      assert.deepEqual(conversations.seals, [INVITES, INVITES]);
    }),
);

it.effect(
  "a page's workers are joined to those held by the call that started each, the newest reading of each kept",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations, realtime } = yield* subject(service);
      const worker = (callId: string, status: CodingAgentStatus) => ({
        callId,
        status,
        model: "openai/gpt-5.5",
        effort: "medium",
        startedAt: 2_000,
      });
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(INVITES, {
        ...conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
        subagents: [worker("call-models", CODING_AGENT_STATUS.RUNNING)],
        subagentTitles: [{ callId: "call-models", title: "Read the invite model" }],
      });
      yield* realtime.deliver([markRow(2, "running")]);
      yield* conversations.nextAsk;

      const landed = yield* viewLands((view) => view.conversation?.cursor === "2:3");
      yield* conversations.answer(INVITES, {
        ...conversationPage([], "2:3", CODING_AGENT_STATUS.COMPLETED),
        subagents: [
          worker("call-models", CODING_AGENT_STATUS.COMPLETED),
          worker("call-tests", CODING_AGENT_STATUS.COMPLETED),
        ],
        subagentTitles: [{ callId: "call-tests", title: "Check the invite tests" }],
      });
      const view = yield* landed;

      assert.deepEqual(view.conversation?.subagents, [
        worker("call-models", CODING_AGENT_STATUS.COMPLETED),
        worker("call-tests", CODING_AGENT_STATUS.COMPLETED),
      ]);
      assert.deepEqual(view.conversation?.subagentTitles, [
        { callId: "call-models", title: "Read the invite model" },
        { callId: "call-tests", title: "Check the invite tests" },
      ]);
    }),
);

it.effect(
  "the list read carries the account's workspaces with their GitHub organizations, and a sign-out clears them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, tasks } = yield* subject(service);

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);

      yield* tasks.reset;
      assert.deepEqual(last()?.workspaces, []);
    }),
);

it.effect("a workspaces read the service did not answer keeps the workspaces already read", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);

    service.workspacesFail = true;
    service.tasks = [];
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);

    assert.deepEqual(last()?.tasks, []);
    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
  }),
);

it.effect(
  "a workspaces read that did not answer says so, and the next refresh reads them again and says them read",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.workspacesFail = true;
      const held = yield* Deferred.make<void>();
      service.workspacesGate = Deferred.await(held);
      const { call, last } = yield* subject(service);

      const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_REFRESH));
      for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
      assert.equal(last()?.workspacesStatus, TASKS_READ.READING);
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(refreshing);
      assert.equal(last()?.workspacesStatus, TASKS_READ.FAILED);
      assert.deepEqual(last()?.workspaces, []);

      service.workspacesFail = false;
      service.workspacesGate = Effect.void;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.equal(last()?.workspacesStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.workspaces, [PERSONAL]);
    }),
);

it.effect(
  "a workspace made reaches the service and the view then holds it, the plans not read again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      const before = service.reads.length;

      const made = yield* call(GATEWAY_METHOD.WORKSPACES_CREATE, { name: RELAY.name });

      assert.deepEqual(made, { workspace: RELAY });
      assert.deepEqual(last()?.workspaces, [PERSONAL, RELAY]);
      assert.deepEqual(service.reads.slice(before), [`create:${RELAY.name}`, "workspaces"]);
    }),
);

it.effect(
  "a workspace renamed reaches the service and the view then holds its new name, the plans not read again, and a rename the role does not allow moves nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
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

      assert.deepEqual(renamed, { workspace: { ...ACME, name: "Acme Labs" } });
      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      assert.deepEqual(service.reads.slice(before), [
        `rename:${ACME.id}:Acme Labs`,
        "workspaces",
        `rename:${ACME.id}:Acme Research`,
        "workspaces",
      ]);
    }),
);

it.effect(
  "a rename whose read after it fails still draws the new name the service answered, and the next refresh reads the workspaces again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      service.workspacesFail = true;

      yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" });
      const drawn = last()?.workspaces;
      service.workspacesFail = false;
      const before = service.reads.length;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);

      assert.deepEqual(drawn, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      assert.ok(
        service.reads.slice(before).includes("workspaces"),
        "the failed read is not taken as fresh",
      );
    }),
);

it.effect(
  "a rename another Mac renames again before the read after it draws the newer name the read answers",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      service.renamedAgain = "Acme Research";

      yield* call(GATEWAY_METHOD.WORKSPACES_RENAME, { workspaceId: ACME.id, name: "Acme Labs" });

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Research" }]);
    }),
);

it.effect(
  "a workspace's photo set reaches the service and the view then holds its version, removing it takes the version away, and a photo the role does not allow moves nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
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

      assert.deepEqual(set, { workspace: { ...ACME, photoVersion: PHOTO_URL } });
      assert.deepEqual(drawn, [PERSONAL, { ...ACME, photoVersion: PHOTO_URL }]);
      assert.deepEqual(removed, { workspace: ACME });
      assert.deepEqual(refused, { failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(service.reads.slice(before), [
        `photoSet:${ACME.id}:${PHOTO_URL}`,
        "workspaces",
        `photoSet:${ACME.id}:none`,
        "workspaces",
        `photoSet:${ACME.id}:${PHOTO_URL}`,
        "workspaces",
      ]);
    }),
);

it.effect(
  "a photo whose read after it fails still draws the version the service answered, and an SVG is refused before the service",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      service.workspacesFail = true;
      const before = service.reads.length;

      yield* call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, { workspaceId: ACME.id, photo: PHOTO_URL });
      const svg = yield* Effect.exit(
        call(GATEWAY_METHOD.WORKSPACES_PHOTO_SET, {
          workspaceId: ACME.id,
          photo: "data:image/svg+xml;base64,PHN2Zy8+",
        }),
      );

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, photoVersion: PHOTO_URL }]);
      assert.ok(Exit.isFailure(svg), "an SVG is no photo");
      assert.deepEqual(service.reads.slice(before), [
        `photoSet:${ACME.id}:${PHOTO_URL}`,
        "workspaces",
      ]);
    }),
);

it.effect(
  "connecting GitHub answers the service's install address and reads nothing, and disconnecting draws the workspace without its organization",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      const before = service.reads.length;

      const begun = yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_CONNECT, { workspaceId: ACME.id });
      const disconnected = yield* call(GATEWAY_METHOD.WORKSPACES_GITHUB_DISCONNECT, {
        workspaceId: ACME.id,
      });

      assert.deepEqual(begun, { url: INSTALL_URL });
      assert.deepEqual(disconnected, { workspace: { ...ACME, github: null } });
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, github: null }]);
      assert.deepEqual(service.reads.slice(before), [
        `connect:${ACME.id}`,
        `disconnect:${ACME.id}`,
        "workspaces",
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
  "a workspace's members are read on the service with nothing else, and a removal reads the workspaces again and not the plans",
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
      assert.deepEqual(service.reads, [
        `members:${ACME.id}`,
        `remove:${ACME.id}:${GRACE.userId}`,
        "workspaces",
      ]);
    }),
);

it.effect(
  "a role changed and a handover each read the workspaces again and not the plans, so the account's own role after a handover arrives on the view",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const owned = { ...ACME, role: WORKSPACE_ROLE.OWNER };
      const owner = { ...ADA, role: WORKSPACE_ROLE.OWNER };
      service.memberships = [PERSONAL, owned];
      service.members[ACME.id] = [owner, GRACE];
      const { call, last } = yield* subject(service);

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
      assert.deepEqual(service.reads, [
        `role:${ACME.id}:${GRACE.userId}:${WORKSPACE_ROLE.ADMIN}`,
        "workspaces",
        `transfer:${ACME.id}:${GRACE.userId}`,
        "workspaces",
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

it.effect("the plan list is drawn ready while the workspaces read is still out", () =>
  Effect.gen(function* () {
    const invites = task(INVITES, "Teammate invitations", "# Draft", 10);
    const service = fakeService([invites]);
    service.memberships = [PERSONAL, ACME];
    const held = yield* Deferred.make<void>();
    service.workspacesGate = Deferred.await(held);
    const { call, last } = yield* subject(service);

    const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.TASKS_REFRESH));
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

    assert.equal(last()?.listStatus, TASKS_READ.READY);
    assert.deepEqual(last()?.tasks, [summary(invites)]);
    assert.deepEqual(last()?.workspaces, []);

    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(refreshing);
    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
  }),
);

it.effect("a stale workspaces read that answers after a workspace made does not draw over it", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* TestClock.adjust(Duration.minutes(1));
    const held = yield* Deferred.make<void>();
    service.workspacesGate = Deferred.await(held);

    const stale = yield* Effect.forkChild(call(GATEWAY_METHOD.WORKSPACES_REFRESH));
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
    service.workspacesGate = Effect.void;
    yield* call(GATEWAY_METHOD.WORKSPACES_CREATE, { name: RELAY.name });
    assert.deepEqual(last()?.workspaces, [PERSONAL, RELAY]);

    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(stale);
    assert.deepEqual(last()?.workspaces, [PERSONAL, RELAY]);
  }),
);

it.effect("the workspaces land on the view while the GitHub connection read is still out", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    service.connection = { connected: true, login: "ada" };
    const held = yield* Deferred.make<void>();
    service.githubGate = Deferred.await(held);
    const { call, last } = yield* subject(service);

    const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.WORKSPACES_REFRESH));
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    assert.equal(last()?.github, undefined);

    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(refreshing);
    assert.deepEqual(last()?.github, { connected: true, login: "ada" });
  }),
);

it.effect(
  "the workspaces are read on the first refresh, again only once a minute has passed or after a sign-out, and never after a plan's own write",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks } = yield* subject(service);
      const workspaceReads = () => service.reads.filter((read) => read === "workspaces").length;

      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_DELETE, { taskId: INVITES });
      assert.equal(workspaceReads(), 1);

      yield* TestClock.adjust(Duration.minutes(1));
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.equal(workspaceReads(), 2);

      yield* tasks.reset;
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      assert.equal(workspaceReads(), 3);
    }),
);

it.effect(
  "the view carries whether GitHub is connected, read with the workspaces, and a read the service did not answer keeps it",
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
  "a workspaces read that saw GitHub connected before a disconnect answered does not put it back",
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
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);

    const left = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

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
      const { call, last } = yield* subject(service, { call: standing });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });

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
      const { call, last } = yield* subject(service, { call: standing });
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: BILLING });

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
    const { call, last } = yield* subject(service, { call: standing });
    yield* call(GATEWAY_METHOD.TASKS_REFRESH);
    yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });

    yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

    assert.equal(last()?.activeTaskId, INVITES);
    assert.deepEqual(standing.about, { taskId: INVITES });
  }),
);

it.effect(
  "a removal or a leave the account's role does not allow answers not-permitted, and the view is read again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA, GRACE];
      service.notPermitted = true;
      const { call, last } = yield* subject(service);

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
          skills: [{ name, description: "", path: `.agents/skills/${name}/SKILL.md` }],
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
      const { call, last } = yield* subject(fakeService([invites]));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });

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
      const { call, last } = yield* subject(fakeService([invites]));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });

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
  "with no call up, the open plan's document is read again as Luke's turn writes the plan, and once more as the turn stops writing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks, viewLands, conversations, realtime } = yield* subject(service);
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      const editing = planEditing("turn-1");
      // The save lands behind the call's receipt, and the next page of the turn carries the call again.
      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- Invites expire.", 20)];
      const saved = yield* viewLands(
        (view) =>
          view.document?.status === TASKS_READ.READY &&
          view.document.task?.document.body.endsWith("Invites expire.") === true,
      );
      yield* conversations.answer(
        INVITES,
        conversationPage([editing], "1:1", CODING_AGENT_STATUS.RUNNING),
      );
      yield* saved;

      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- Resend daily.", 30)];
      yield* realtime.deliver([markRow(2, "running")]);
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.LOOK, "1:1"]);
      const after = yield* viewLands(
        (view) =>
          view.document?.status === TASKS_READ.READY &&
          view.document.task?.document.body.endsWith("Resend daily.") === true,
      );
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Done.")], "2:2", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* after;
    }),
);

it.effect(
  "a plan edit whose save lands after Luke's turn stops writing, as one cut off by a stop does, reaches the open plan once the save has had time to unwind",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks, viewLands, conversations, realtime } = yield* subject(service);
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- Writing.", 15)];
      const writing = yield* viewLands(
        (view) =>
          view.document?.status === TASKS_READ.READY &&
          view.document.task?.document.body.endsWith("Writing.") === true,
      );
      yield* conversations.answer(
        INVITES,
        conversationPage([planEditing("turn-1")], "1:1", CODING_AGENT_STATUS.RUNNING),
      );
      yield* writing;
      yield* realtime.deliver([markRow(2, "running")]);
      yield* conversations.nextAsk;
      // The turn is stopped with its save still in its step, so the plan reads unsaved as the turn ends.
      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- Stopped.", 20)];
      const stopped = yield* viewLands(
        (view) =>
          view.document?.status === TASKS_READ.READY &&
          view.document.task?.document.body.endsWith("Stopped.") === true,
      );
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Stopped.")], "2:2", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* stopped;

      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- Invites expire.", 30)];
      const saved = yield* viewLands(
        (view) =>
          view.document?.status === TASKS_READ.READY &&
          view.document.task?.document.body.endsWith("Invites expire.") === true,
      );
      yield* TestClock.adjust(Duration.seconds(30));

      yield* saved;
    }),
);

it.effect(
  "each of two plan-editing turns that stop a second apart has its own plan read once its save has had time to unwind",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, tasks, viewLands, conversations } = yield* subject(service);
      const documentLands = (ending: string) =>
        viewLands(
          (view) =>
            view.document?.status === TASKS_READ.READY &&
            view.document.task?.document.body.endsWith(ending) === true,
        );
      yield* tasks.lifetime;
      yield* call(GATEWAY_METHOD.TASKS_OPEN, { taskId: INVITES });
      yield* conversations.nextAsk;
      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- First.", 20)];
      const first = yield* documentLands("First.");
      yield* conversations.answer(
        INVITES,
        conversationPage([planEditing("turn-1")], "1:1", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* first;

      // A second turn, heard a second later on the next follow, stops writing too.
      yield* TestClock.adjust(Duration.seconds(1));
      yield* call(GATEWAY_METHOD.TASKS_REFRESH);
      yield* conversations.nextAsk;
      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- Second.", 30)];
      const second = yield* documentLands("Second.");
      yield* conversations.answer(
        INVITES,
        conversationPage([planEditing("turn-2")], "2:2", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* second;

      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- First unwound.", 40)];
      const firstUnwound = yield* documentLands("First unwound.");
      yield* TestClock.adjust(Duration.seconds(29));
      yield* firstUnwound;
      service.tasks = [task(INVITES, "Teammate invitations", "# Draft\n\n- Second unwound.", 50)];
      const secondUnwound = yield* documentLands("Second unwound.");
      yield* TestClock.adjust(Duration.seconds(1));

      yield* secondUnwound;
    }),
);

it.effect("stopping Luke reaches the service for the task named", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call } = yield* subject(service);
    yield* call(GATEWAY_METHOD.TASKS_STOP_WORK, { taskId: INVITES });
    assert.deepEqual(service.stops, [INVITES]);
  }),
);
