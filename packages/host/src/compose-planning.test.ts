import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@sidecar/gateway";
import {
  type GitHubRepositoriesAnswer,
  type PlanCallResult,
  VOICE_SERVICE_FRAME,
  WORKSPACE_CALL_FAILURE,
} from "@sidecar/hosted";
import type { Board } from "@sidecar/hosted/board-wire";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentMessagesAnswer,
  type CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import type { PageLine, PageVersion } from "@sidecar/hosted/page-wire";
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
import { MESSAGE_ROLE, type WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Duration, Effect, Fiber, Queue, Result } from "effect";
import { TestClock } from "effect/testing";
import {
  composePlanning,
  type PlanningClient,
  type PlanningConversationClient,
} from "./compose-planning.js";

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

/** Which page of a plan's conversation a read asked for. */
const CONVERSATION_READ = {
  NEWEST: "newest",
  AFTER: "after",
  BEFORE: "before",
} as const;

type ConversationRead = (typeof CONVERSATION_READ)[keyof typeof CONVERSATION_READ];

/** One read of a plan's conversation as the service heard it: the plan, which page, and the cursor or turn it named. */
type ConversationAsk = readonly [planId: string, read: ConversationRead, from?: string];

/**
 * The service's side of each plan's conversation. A read from the newest
 * turns or past a cursor waits for the page the test hands it, as the
 * service holds a read open while a turn runs; a read before a turn is
 * answered at once from the older pages.
 */
interface FakeConversations extends PlanningConversationClient {
  /** Every read asked, in order. */
  readonly asks: ConversationAsk[];
  /** The next read asked, waited on until the composer asks it. */
  readonly nextAsk: Effect.Effect<ConversationAsk>;
  /** Hands the read standing on `planId`, or the next one, its answer. */
  answer: (planId: string, answer: CodingAgentMessagesAnswerView) => Effect.Effect<void>;
  /** The older pages, by the turn each is read before. */
  older: Record<string, CodingAgentMessagesAnswer>;
}

function fakeConversations(): Effect.Effect<FakeConversations> {
  return Effect.gen(function* () {
    const asked = yield* Queue.unbounded<ConversationAsk>();
    const pages = new Map<string, Queue.Queue<CodingAgentMessagesAnswerView>>();
    for (const planId of [INVITES, BILLING]) {
      pages.set(planId, yield* Queue.unbounded<CodingAgentMessagesAnswerView>());
    }
    const conversations: FakeConversations = {
      asks: [],
      nextAsk: Queue.take(asked),
      older: {},
      answer: (planId, answer) => {
        const waiting = pages.get(planId);
        assert.ok(waiting, `no conversation for ${planId}`);
        return Effect.asVoid(Queue.offer(waiting, answer));
      },
      planMessages: (planId, page) =>
        Effect.gen(function* () {
          const ask: ConversationAsk =
            page.before !== undefined
              ? [planId, CONVERSATION_READ.BEFORE, page.before]
              : page.after !== undefined
                ? [planId, CONVERSATION_READ.AFTER, page.after]
                : [planId, CONVERSATION_READ.NEWEST];
          conversations.asks.push(ask);
          yield* Queue.offer(asked, ask);
          if (page.before !== undefined) {
            return (
              conversations.older[page.before] ?? { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND }
            );
          }
          const waiting = pages.get(planId);
          return waiting === undefined ? yield* Effect.never : yield* Queue.take(waiting);
        }),
    };
    return conversations;
  });
}

/** One planning turn's journal as the service stores it, its words as one text part. */
function journal(id: string, text: string): CodingAgentMessage {
  return { id, role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text }] };
}

/** A page of a plan's conversation as the service answers it. */
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
    const conversations = yield* fakeConversations();
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
      conversations,
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
    /** Waits from now on for the first view `wanted` holds of, and answers the wait. */
    const viewLands = (wanted: (view: PlanningView) => boolean) =>
      Effect.map(Deferred.make<PlanningView>(), (seen) => {
        waiters.push({ wanted, seen });
        return Deferred.await(seen);
      });
    return { planning, call, told, last, viewWhere, viewLands, conversations };
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
  "opening a plan reads its conversation's newest page onto the view, and an idle one is not asked again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations } = yield* subject(service);
      const newest = conversationPage(
        [journal("turn-2", "Read the invite model.")],
        "4:2",
        CODING_AGENT_STATUS.COMPLETED,
        "turn-1",
      );

      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
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
  "a held read joins a journal rewritten in place where it stands and appends a new one, past each cursor",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
      );

      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.AFTER, "1:1"]);
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
  "the earlier page lays older turns before the rest, and the held read goes on from its own cursor",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last, viewLands, conversations } = yield* subject(service);
      conversations.older["turn-1"] = conversationPage(
        [journal("turn-0", "Opened the plan.")],
        "9:9",
        CODING_AGENT_STATUS.COMPLETED,
      );
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
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
      yield* conversations.nextAsk;

      yield* call(GATEWAY_METHOD.PLANNING_CONVERSATION_EARLIER);
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
      assert.deepEqual(conversations.asks.at(1), [INVITES, CONVERSATION_READ.AFTER, "1:1"]);
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
      plan(INVITES, "Teammate invitations", "# Draft", 10),
      plan(BILLING, "Billing export", "# Billing export", 20),
    ]);
    const { call, viewLands, conversations } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    yield* conversations.nextAsk;
    yield* conversations.answer(
      INVITES,
      conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
    );
    yield* conversations.nextAsk;

    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: BILLING });
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
      [INVITES, CONVERSATION_READ.AFTER, "1:1"],
      [BILLING, CONVERSATION_READ.NEWEST],
    ]);
  }),
);

it.effect(
  "a conversation read the service did not answer is asked again after the backoff, and not before",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
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
  "a word of the open plan's call wakes its parked conversation read from the cursor held",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, planning, viewLands, conversations } = yield* subject(service);
      yield* planning.lifetime;
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      yield* conversations.nextAsk;
      const parked = yield* viewLands((view) => view.conversation !== undefined);
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Done.")], "1:1", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* parked;

      planning.showActivity({
        type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY,
        planId: INVITES,
        planner: {},
        notes: false,
      });
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.AFTER, "1:1"]);
      const landed = yield* viewLands((view) => view.conversation?.cursor === "2:2");
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-2", "Reading")], "2:2", CODING_AGENT_STATUS.COMPLETED),
      );

      assert.deepEqual((yield* landed).conversation?.messages, [
        journal("turn-1", "Done."),
        journal("turn-2", "Reading"),
      ]);
    }),
);

it.effect(
  "a call's end wakes the open plan's parked conversation read, and wakes it again once the call's last writes have had time to land",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, planning, viewLands, conversations } = yield* subject(service);
      yield* planning.lifetime;
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      yield* conversations.nextAsk;
      const parked = yield* viewLands((view) => view.conversation !== undefined);
      yield* conversations.answer(
        INVITES,
        conversationPage([journal("turn-1", "Done.")], "1:1", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* parked;

      planning.callEnded(INVITES);
      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.AFTER, "1:1"]);
      yield* conversations.answer(
        INVITES,
        conversationPage([], "1:1", CODING_AGENT_STATUS.COMPLETED),
      );
      yield* TestClock.adjust(Duration.seconds(5));

      assert.deepEqual(yield* conversations.nextAsk, [INVITES, CONVERSATION_READ.AFTER, "1:1"]);
    }),
);

it.effect(
  "a page's workers are joined to those held by the call that started each, the newest reading of each kept",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, viewLands, conversations } = yield* subject(service);
      const worker = (callId: string, status: CodingAgentStatus) => ({
        callId,
        status,
        model: "openai/gpt-5.5",
        effort: "medium",
        startedAt: 2_000,
      });
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      yield* conversations.nextAsk;
      yield* conversations.answer(INVITES, {
        ...conversationPage([journal("turn-1", "Reading")], "1:1", CODING_AGENT_STATUS.RUNNING),
        subagents: [worker("call-models", CODING_AGENT_STATUS.RUNNING)],
        subagentTitles: [{ callId: "call-models", title: "Read the invite model" }],
      });
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
