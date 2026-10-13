import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@sidecar/gateway";
import {
  GITHUB_CONNECTION_CALL_FAILURE,
  type GitHubRepositoriesAnswer,
  type PlanCallResult,
  VOICE_SERVICE_FRAME,
  WORKSPACE_CALL_FAILURE,
} from "@sidecar/hosted";
import {
  BOARD_ELEMENT_TYPE,
  DRAW_ON_BOARD_TOOL_NAME,
  LOOK_AT_BOARD_TOOL_NAME,
} from "@sidecar/hosted/board-vocabulary";
import type { Board, BoardElement } from "@sidecar/hosted/board-wire";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import type { GitHubConnection } from "@sidecar/hosted/github-connection-wire";
import type { PageVersion } from "@sidecar/hosted/page-wire";
import type { PlanEditAnswer } from "@sidecar/hosted/plan-edit";
import {
  PLAN_ACTOR,
  type Plan,
  type PlanAgentsSummary,
  type PlanFileAnswer,
  type PlanRevisionAnswer,
  type PlanRevisionsAnswer,
  type PlanSkillsAnswer,
  type PlanSummary,
  type PlanTreeAnswer,
  type RepositoryPin,
} from "@sidecar/hosted/plan-wire";
import {
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanCallFailure,
  type PlanningView,
  type PlanWorkAnswer,
  planningViewSchema,
  type RepositoryCallFailure,
} from "@sidecar/hosted/planning-view";
import type { PlanTranscript } from "@sidecar/hosted/transcript-wire";
import {
  WORKSPACE_ROLE,
  type Workspace,
  type WorkspaceMember,
} from "@sidecar/hosted/workspace-wire";
import { unparsedWire, type WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Effect, Result } from "effect";
import { composePlanning, type PlanningClient } from "./compose-planning.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
/** The text the edit tests' plan opens on. */
const INVITES_TEXT = "# Teammate invitations";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function plan(id: string, name: string, body: string, updatedAt: number): Plan {
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
}: Plan): PlanSummary {
  return rest;
}

/** The service as a table of plans the test edits between beats. */
interface FakeService extends PlanningClient {
  plans: Plan[];
  /** What the list says of each plan's coding agents, by plan id; a plan with none says nothing. */
  agents: Record<string, PlanAgentsSummary>;
  listFails: boolean;
  /** Whether a delete is refused, as a service that did not answer refuses it. */
  deleteFails: boolean;
  /** Where a list read waits after reading the table and before answering, so a test can hold one on the wire. */
  listGate: Effect.Effect<void>;
  createAnswer: PlanCallResult<Plan, RepositoryCallFailure>;
  /** The repositories the account reaches, as the service answers them; a failure is the service refusing the read. */
  repositoriesAnswer: PlanCallResult<GitHubRepositoriesAnswer, typeof PLAN_CALL_FAILURE.UNANSWERED>;
  /** Whether a repository is refused as one the App does not reach. */
  repositoryUnreachable: boolean;
  /** Every read the service answered, in order, so a test can see that nothing reads on a clock. */
  readonly reads: string[];
  /** Each plan's board, by plan id; a plan with none answers no board, as a service that did not answer. */
  boards: Record<string, Board>;
  /** The image each plan's last save carried, by plan id, as the service keeps it beside the board. */
  readonly images: Record<string, string | undefined>;
  /** Each plan's transcript, by plan id; a plan with none answers no transcript, as a service that did not answer. */
  transcripts: Record<string, PlanTranscript>;
  /** Each plan's newest page of work as the service keeps it, by plan id; a plan with none answers nothing, as a service that did not answer. */
  works: Record<string, PlanWorkAnswer>;
  /** The older pages of work, by the turn each is read before. */
  olderWorks: Record<string, PlanWorkAnswer>;
  /** Every page of work asked for, in order: the plan, and the turn it was read before where it was. */
  readonly workReads: string[];
  /** What the service answers for each file's window, by path; a path with none answers nothing, as a service that did not answer. */
  files: Record<string, PlanFileAnswer>;
  /** What the service answers for each folder's listing, by path; a path with none answers nothing, as a service that did not answer. */
  folders: Record<string, PlanTreeAnswer>;
  /** What the service answers for each plan's skills, by plan id; a plan with none answers nothing, as a service that did not answer. */
  skills: Record<string, PlanSkillsAnswer>;
  /** The newest page of the history, for any plan; none answers nothing, as a service that did not answer. */
  history: PlanRevisionsAnswer | undefined;
  /** The older pages of the history, by the revision each is read before. */
  olderHistory: Record<number, PlanRevisionsAnswer>;
  /** Each revision the service holds, by its number, which a restore puts back as the plan's document. */
  revisions: Record<number, PlanRevisionAnswer["revision"]>;
  /** Every version of every page the service holds, for any plan. */
  pages: PageVersion[];
  /** Each plan's pages as the service lists them, by plan id; a plan with none answers nothing, as a service that did not answer. */
  pageLines: Record<string, readonly PageLine[]>;
  /** What an edit answers in place of a save, where a test sets one: a conflict or a refusal. */
  editAnswer: PlanEditAnswer | undefined;
  /** The account's pinned repositories, newest pinned first, as the service keeps them. */
  pins: RepositoryPin[];
  /** Whether the pins are refused, read and written alike, as a service that did not answer refuses them. */
  pinsFail: boolean;
  /** The workspaces the account is a member of, as the service lists them. */
  memberships: Workspace[];
  /** The Luke GitHub App install address a connection answers. */
  installUrl: string;
  /** Whether the workspaces list is refused, as a service that did not answer refuses it. */
  workspacesFail: boolean;
  /** Where a workspaces read waits after reading the table and before answering, so a test can hold one on the wire. */
  workspacesGate: Effect.Effect<void>;
  /** Each workspace's members, by its id. */
  members: Record<string, WorkspaceMember[]>;
  /** Whether a write is refused as the account's role not allowing it. */
  notPermitted: boolean;
  /** The account's GitHub as the service last says it; none answers nothing, as a service that did not answer. */
  connection: GitHubConnection | undefined;
  /** The single-use pages the service hands out to connect GitHub, the newest last. */
  connectPages: string[];
}

const PERSONAL: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  personal: true,
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const ACME: Workspace = {
  id: "workspace-acme",
  name: "acme",
  personal: false,
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme", active: true },
};
const RELAY: Workspace = {
  id: "workspace-relay",
  name: "Relay Labs",
  personal: false,
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};
const INSTALL_URL = "https://github.com/apps/luke/installations/new?state=intent-1";
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

function fakeService(plans: Plan[]): FakeService {
  const service: FakeService = {
    plans,
    agents: {},
    listFails: false,
    deleteFails: false,
    listGate: Effect.void,
    createAnswer: { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED },
    repositoriesAnswer: { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED },
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
    history: undefined,
    olderHistory: {},
    revisions: {},
    readRevisions: (_planId, before) =>
      Effect.sync(() => (before === undefined ? service.history : service.olderHistory[before])),
    readRevision: (_planId, seq) => Effect.sync(() => service.revisions[seq]),
    pages: [],
    pageLines: {},
    readPages: (planId) => Effect.sync(() => service.pageLines[planId]),
    readPageVersion: (_planId, pageId, version) =>
      Effect.sync(() =>
        service.pages.find((page) => page.id === pageId && page.version === version),
      ),
    // The service puts the revision's document back and names the developer its last editor.
    restore: (planId, seq) =>
      Effect.sync(() => {
        const found = service.plans.find((candidate) => candidate.id === planId);
        const revision = service.revisions[seq];
        if (found === undefined || revision === undefined) return undefined;
        const restored: Plan = {
          ...found,
          document: revision.document,
          updatedAt: found.updatedAt + 1,
          lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: found.updatedAt + 1, duringCall: false },
        };
        service.plans = service.plans.map((candidate) =>
          candidate.id === planId ? restored : candidate,
        );
        return restored;
      }),
    editAnswer: undefined,
    pins: [],
    pinsFail: false,
    memberships: [PERSONAL],
    installUrl: INSTALL_URL,
    workspacesFail: false,
    workspacesGate: Effect.void,
    members: {},
    notPermitted: false,
    connection: { connected: false, login: null },
    connectPages: [],
    // Each connect is a fresh page bound to the account, as the service mints one.
    github: {
      status: () =>
        Effect.sync(() =>
          service.connection === undefined
            ? { ok: false as const, failure: GITHUB_CONNECTION_CALL_FAILURE.UNANSWERED }
            : { ok: true as const, answer: service.connection },
        ),
      connect: () =>
        Effect.sync(() => {
          const url = `https://tryluke.dev/connect-github.html?intent=intent-${service.connectPages.length + 1}`;
          service.connectPages.push(url);
          return { ok: true as const, answer: { url } };
        }),
      disconnectUrl: () => "https://tryluke.dev/connect-github.html?disconnect=1",
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
      members: (workspaceId) =>
        Effect.sync(() => {
          service.reads.push(`members:${workspaceId}`);
          const members = service.members[workspaceId];
          return members === undefined
            ? UNANSWERED_WORKSPACE
            : ({ ok: true, answer: members } as const);
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
    // The service writes the edit's value into the document's decisions and answers the plan whole.
    edit: (planId, edit) =>
      Effect.sync((): PlanCallResult<PlanEditAnswer, typeof PLAN_CALL_FAILURE.NOT_FOUND> => {
        if (service.editAnswer !== undefined) return { ok: true, answer: service.editAnswer };
        const found = service.plans.find((candidate) => candidate.id === planId);
        if (found === undefined) return { ok: false, failure: PLAN_CALL_FAILURE.NOT_FOUND };
        const edited = {
          ...found,
          updatedAt: EDITED_AT,
          document: {
            ...found.document,
            body: edit.document.value,
          },
          lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: EDITED_AT, duringCall: false },
        };
        service.plans = service.plans.map((candidate) =>
          candidate.id === planId ? edited : candidate,
        );
        return { ok: true, answer: { plan: edited } };
      }),
    readFile: (_planId, window) => Effect.sync(() => service.files[window.path]),
    readTree: (_planId, folder) => Effect.sync(() => service.folders[folder.path]),
    readSkills: (planId) => Effect.sync(() => service.skills[planId]),
    readBoard: (planId) => Effect.sync(() => service.boards[planId]),
    readTranscript: (planId) => Effect.sync(() => service.transcripts[planId]),
    readWork: (planId, before) =>
      Effect.sync(() => {
        service.workReads.push(before === undefined ? planId : `${planId}:${before}`);
        return before === undefined ? service.works[planId] : service.olderWorks[before];
      }),
    // The service keeps the last scene written, beside whatever drawing it holds.
    saveBoard: (planId, elements, appliedDrawing, image) =>
      Effect.sync(() => {
        service.images[planId] = image;
        const board = { ...service.boards[planId], elements, appliedDrawing };
        service.boards[planId] = board;
        return board;
      }),
    list: () =>
      Effect.gen(function* () {
        service.reads.push("list");
        const answer = service.listFails
          ? { ok: false as const, failure: PLAN_CALL_FAILURE.UNANSWERED }
          : {
              ok: true as const,
              answer: service.plans.map((each) => {
                const agents = service.agents[each.id];
                return agents === undefined ? summary(each) : { ...summary(each), agents };
              }),
            };
        yield* service.listGate;
        return answer;
      }),
    open: (planId) =>
      Effect.sync((): PlanCallResult<Plan, PlanCallFailure> => {
        service.reads.push(`open:${planId}`);
        const found = service.plans.find((candidate) => candidate.id === planId);
        return found === undefined
          ? { ok: false, failure: PLAN_CALL_FAILURE.NOT_FOUND }
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
    // The service keeps the repository on the plan and answers the plan whole.
    setRepository: (planId, repository) =>
      Effect.sync((): PlanCallResult<Plan, RepositoryCallFailure> => {
        if (service.repositoryUnreachable) {
          return { ok: false, failure: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };
        }
        const found = service.plans.find((candidate) => candidate.id === planId);
        if (found === undefined) return { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED };
        const changed = { ...found, repository };
        service.plans = service.plans.map((candidate) =>
          candidate.id === planId ? changed : candidate,
        );
        return { ok: true, answer: changed };
      }),
    // The service re-titles the document with the name, as the store does.
    rename: (planId, { name }) =>
      Effect.sync(() => {
        const found = service.plans.find((candidate) => candidate.id === planId);
        if (found === undefined) return undefined;
        const renamed = { ...found, name, document: { ...found.document, body: `# ${name}` } };
        service.plans = service.plans.map((candidate) =>
          candidate.id === planId ? renamed : candidate,
        );
        return renamed;
      }),
    // The service stamps a pin or an archive at its own clock, and a false takes it away.
    mark: (planId, { pinned, archived }) =>
      Effect.sync(() => {
        const found = service.plans.find((candidate) => candidate.id === planId);
        if (found === undefined) return undefined;
        const { pinnedAt, archivedAt, ...rest } = found;
        const pin = pinned === undefined ? pinnedAt : pinned ? MARKED_AT : undefined;
        const archive = archived === undefined ? archivedAt : archived ? MARKED_AT : undefined;
        const marked = {
          ...rest,
          ...(pin === undefined ? undefined : { pinnedAt: pin }),
          ...(archive === undefined ? undefined : { archivedAt: archive }),
        };
        service.plans = service.plans.map((candidate) =>
          candidate.id === planId ? marked : candidate,
        );
        return marked;
      }),
    delete: (planId) =>
      Effect.sync(() => {
        if (service.deleteFails) return false;
        service.plans = service.plans.filter((candidate) => candidate.id !== planId);
        return true;
      }),
  };
  return service;
}

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** The one voice call as the live composer holds it: about a plan, about the desk, or none. */
interface StandingCall {
  about: { readonly planId: string | undefined } | undefined;
  /** Where ending a call waits before it lands, as a real call's close does. */
  closing?: Effect.Effect<void>;
}

function subject(service: FakeService, options: { signedIn?: boolean; call?: StandingCall } = {}) {
  return Effect.gen(function* () {
    const told: PlanningView[] = [];
    const waiters: {
      wanted: (view: PlanningView) => boolean;
      seen: Deferred.Deferred<PlanningView>;
    }[] = [];
    const standing = options.call ?? { about: undefined };
    const planning = yield* composePlanning({
      kernel: {
        runMode: { sendsNetwork: true },
        emit: (kind, payload) => {
          if (kind !== GATEWAY_EVENT.PLANNING_CHANGED) return;
          const read = readEither(planningViewSchema)(payload);
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
      endPlanCall: (planId) =>
        Effect.gen(function* () {
          const about = standing.about?.planId;
          if (about === undefined || (planId !== undefined && about !== planId)) return;
          yield* standing.closing ?? Effect.void;
          standing.about = undefined;
        }),
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = planning.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return Effect.orDie(handler(params, context));
    };
    const last = () => told.at(-1);
    /** The first view told, from now on, that `wanted` holds of. */
    const viewWhere = (wanted: (view: PlanningView) => boolean) =>
      Effect.gen(function* () {
        const seen = yield* Deferred.make<PlanningView>();
        waiters.push({ wanted, seen });
        return yield* Deferred.await(seen);
      });
    return { planning, call, told, last, viewWhere };
  });
}

it.effect("the window's refresh lists the plans and opening one draws its saved document", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const billing = plan(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, planning } = yield* subject(fakeService([billing, invites]));

    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    assert.deepEqual(last()?.plans, [summary(billing), summary(invites)]);
    assert.equal(last()?.listStatus, PLANNING_READ.READY);
    assert.equal(last()?.activePlanId, undefined);

    assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES }), {
      opened: true,
    });
    assert.equal(last()?.activePlanId, INVITES);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: invites });
    assert.equal(planning.activePlanId(), INVITES);

    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: BILLING });
    assert.equal(last()?.activePlanId, BILLING);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: billing });
  }),
);

it.effect(
  "a draft the notetaker sends during a call is drawn in place of the open plan, and the saved one carries its save, by Luke on the call",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
      const service = fakeService([invites]);
      const { call, last, planning } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

      const drafting = { body: "# Draft\n\n## Goal", assumptions: [] };
      planning.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: drafting,
      });
      assert.deepEqual(last()?.document, {
        status: PLANNING_READ.READY,
        plan: { ...invites, document: drafting },
      });

      const saved = { body: "# Draft\n\n## Goal\n\nInvite by email.", assumptions: [] };
      planning.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: saved,
        savedAt: 11,
      });
      assert.deepEqual(last()?.document, {
        status: PLANNING_READ.READY,
        plan: {
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
      const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

      const answer = yield* call(GATEWAY_METHOD.PLANNING_EDIT, {
        planId: INVITES,
        edit: { document: { base: INVITES_TEXT, value: `${INVITES_TEXT}\n\nInvites expire.` } },
      });

      assert.deepEqual(answer, { saved: true });
      assert.deepEqual(last()?.document, {
        status: PLANNING_READ.READY,
        plan: service.plans[0],
      });
    }),
);

it.effect(
  "after the developer's edit, a draft the notetaker drew over an older save is dropped, and its later save is drawn",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const service = fakeService([invites]);
      const { call, last, planning } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      yield* call(GATEWAY_METHOD.PLANNING_EDIT, {
        planId: INVITES,
        edit: { document: { base: INVITES_TEXT, value: `${INVITES_TEXT}\n\nInvites expire.` } },
      });
      const edited = last()?.document;

      planning.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: { body: "# Teammate invitations\n\nA stale draft.", assumptions: [] },
        readAt: EDITED_AT - 1,
      });
      const afterStale = last()?.document;
      const saved = { body: "# Teammate invitations\n\nInvites expire.\n\nMore.", assumptions: [] };
      planning.showDraft({
        type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
        planId: INVITES,
        document: saved,
        readAt: EDITED_AT - 1,
        savedAt: EDITED_AT + 1,
      });

      assert.deepEqual(afterStale, edited);
      assert.deepEqual(last()?.document.plan?.document, saved);
    }),
);

it.effect("behind a closed account gate nothing is read and nothing starts", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told } = yield* subject(service, { signedIn: false });

    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    const started = yield* call(GATEWAY_METHOD.PLANNING_START, { name: "Teammate invitations" });

    assert.deepEqual(started, { failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(told, []);
    assert.deepEqual(service.reads, []);
  }),
);

it.effect("a sign-out drops the view the window drew", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last, planning } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    yield* planning.reset;

    assert.deepEqual(last(), {
      plans: [],
      listStatus: PLANNING_READ.IDLE,
      workspaces: [],
      document: { status: PLANNING_READ.IDLE },
    });
  }),
);
it.effect(
  "the list read carries the account's workspaces with their GitHub organizations, and a sign-out clears them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, planning } = yield* subject(service);

      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);

      yield* planning.reset;
      assert.deepEqual(last()?.workspaces, []);
    }),
);

it.effect("a workspaces read the service did not answer keeps the workspaces already read", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    service.workspacesFail = true;
    service.plans = [];
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    assert.deepEqual(last()?.plans, []);
    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
  }),
);

it.effect(
  "a workspace made reaches the service and the view then holds it, the plans not read again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      const before = service.reads.length;

      const made = yield* call(GATEWAY_METHOD.WORKSPACES_CREATE, { name: RELAY.name });

      assert.deepEqual(made, { workspace: RELAY });
      assert.deepEqual(last()?.workspaces, [PERSONAL, RELAY]);
      assert.deepEqual(service.reads.slice(before), [`create:${RELAY.name}`, "workspaces"]);
    }),
);

it.effect(
  "connecting GitHub answers the service's install address and reads nothing, and disconnecting draws the workspace without its organization",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
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

it.effect("the plan list is drawn ready while the workspaces read is still out", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const service = fakeService([invites]);
    service.memberships = [PERSONAL, ACME];
    const held = yield* Deferred.make<void>();
    service.workspacesGate = Deferred.await(held);
    const { call, last } = yield* subject(service);

    const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.PLANNING_REFRESH));
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

    assert.equal(last()?.listStatus, PLANNING_READ.READY);
    assert.deepEqual(last()?.plans, [summary(invites)]);
    assert.deepEqual(last()?.workspaces, []);

    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(refreshing);
    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
  }),
);

it.effect(
  "the workspaces are read on the first refresh, again only once a minute has passed or after a sign-out, and never after a plan's own write",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, planning } = yield* subject(service);
      const workspaceReads = () => service.reads.filter((read) => read === "workspaces").length;

      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_DELETE, { planId: INVITES });
      assert.equal(workspaceReads(), 1);

      yield* TestClock.adjust(Duration.minutes(1));
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      assert.equal(workspaceReads(), 2);

      yield* planning.reset;
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      assert.equal(workspaceReads(), 3);
    }),
);

it.effect(
  "the view carries whether GitHub is connected, read with the workspaces, and a read the service did not answer keeps it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.connection = { connected: true, login: "ada" };
      const { call, last, planning } = yield* subject(service);

      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });

      service.connection = undefined;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });

      yield* planning.reset;
      assert.equal(last()?.github, undefined);
    }),
);

it.effect(
  "connecting GitHub answers the service's page, and the panel coming forward then reads the connection again at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      assert.deepEqual(last()?.github, { connected: false, login: null });

      const page = yield* call(GATEWAY_METHOD.GITHUB_CONNECT);
      service.connection = { connected: true, login: "ada" };
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);

      assert.deepEqual(page, { url: service.connectPages[0] });
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });
    }),
);

it.effect(
  "disconnecting GitHub answers the page that disconnects it, and the panel coming forward then reads the connection again at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.connection = { connected: true, login: "ada" };
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

      const page = yield* call(GATEWAY_METHOD.GITHUB_DISCONNECT);
      service.connection = { connected: false, login: null };
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);

      assert.deepEqual(page, { url: "https://tryluke.dev/connect-github.html?disconnect=1" });
      assert.deepEqual(last()?.github, { connected: false, login: null });
    }),
);

it.effect("behind a closed account gate a GitHub page is never asked for", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service, { signedIn: false });

    const connect = yield* call(GATEWAY_METHOD.GITHUB_CONNECT);
    const disconnect = yield* call(GATEWAY_METHOD.GITHUB_DISCONNECT);

    assert.deepEqual(connect, { failure: PLAN_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(disconnect, { failure: PLAN_CALL_FAILURE.UNANSWERED });
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
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    const left = yield* call(GATEWAY_METHOD.WORKSPACES_LEAVE, { workspaceId: ACME.id });

    assert.deepEqual(left, { left: true });
    assert.deepEqual(last()?.workspaces, [PERSONAL]);
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

it.effect("the repository chip's read names the workspace it is for to the service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service);

    yield* call(GATEWAY_METHOD.PLANNING_REPOSITORIES, { workspaceId: ACME.id });
    yield* call(GATEWAY_METHOD.PLANNING_REPOSITORIES);

    assert.deepEqual(service.reads, [`repositories:${ACME.id}`, "repositories"]);
  }),
);

/** A box as the canvas holds one. */
function box(id: string): BoardElement {
  return { id, type: BOARD_ELEMENT_TYPE.RECTANGLE, x: 0, y: 0, width: 200, height: 80 };
}

/** Luke's drawing of one box, as the service holds it under its number. */
function drawing(number: number) {
  return {
    number,
    elements: [{ type: BOARD_ELEMENT_TYPE.RECTANGLE, id: "api", x: 0, y: 0, label: "API" }],
  };
}

/** Code as the service sends it on the call about the open plan. */
function shownCode(ref: ShownCode["ref"]): ShownCode {
  return {
    ref,
    repository: "acme/relay",
    firstLine: 1,
    lineCount: 3,
    lines: ["export function acceptInvite(token: string) {", "  return token;", "}"],
  };
}

/** One code shown on a plan, by the `show_code` call that showed it and its turn. */
function shownOn(turnId: string, code: ShownCode, callId = `${turnId}-show`): PlanShownCode {
  return { callId, turnId, shownAt: 0, code };
}

/** The open plan with its code loop running. */
function openPlan(service: FakeService) {
  return Effect.gen(function* () {
    const opened = yield* subject(service);
    yield* opened.call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    yield* opened.planning.lifetime;
    return opened;
  });
}

/** Each code a view holds, as its call, path, and lines pointed at. */
function shownPlaces(view: PlanningView | undefined) {
  return (view?.shownCode ?? []).map(({ callId, code: { ref } }) => ({ callId, ...ref }));
}

/** A plan's transcript of one call on which the developer said `words`. */
function transcriptSaying(words: string): PlanTranscript {
  return {
    calls: [
      {
        id: "5d2c8f61-3a7e-4b19-8c0d-2e9f4a6b7c81",
        startedAt: 1_000,
        messages: [{ id: "0", role: "user", parts: [{ type: "text", text: words }] }],
      },
    ],
    earlierOmitted: false,
  };
}
