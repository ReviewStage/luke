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
} from "@sidecar/hosted";
import type { Board } from "@sidecar/hosted/board-wire";
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
import type { WireRecord } from "@sidecar/wire";
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
}

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
    repositories: () =>
      Effect.sync(() => {
        service.reads.push("repositories");
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
      document: { status: PLANNING_READ.IDLE },
    });
  }),
);
