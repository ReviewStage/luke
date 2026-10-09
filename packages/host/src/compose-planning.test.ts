import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
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
import {
  BOARD_ELEMENT_TYPE,
  DRAW_ON_BOARD_TOOL_NAME,
  LOOK_AT_BOARD_TOOL_NAME,
} from "@sidecar/hosted/board-vocabulary";
import type { Board, BoardElement } from "@sidecar/hosted/board-wire";
import type { Plan, PlanSummary, ShownCode } from "@sidecar/hosted/plan-wire";
import {
  PLAN_CALL_FAILURE,
  PLAN_WORK_BOUNDS,
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  PLANNING_READ,
  type PlanActivity,
  type PlanCallFailure,
  type PlanningView,
  type PlanWorkState,
  type PlanWorkTurn,
  planningViewSchema,
  type RepositoryCallFailure,
} from "@sidecar/hosted/planning-view";
import type { PlanTranscript } from "@sidecar/hosted/transcript-wire";
import type { WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Duration, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { composePlanning, type PlanningClient } from "./compose-planning.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function plan(id: string, name: string, body: string, updatedAt: number): Plan {
  return {
    id,
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

function summary({ document: _document, ...rest }: Plan): PlanSummary {
  return rest;
}

/** The service as a table of plans the test edits between beats. */
interface FakeService extends PlanningClient {
  plans: Plan[];
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
}

function fakeService(plans: Plan[]): FakeService {
  const service: FakeService = {
    plans,
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
    readBoard: (planId) => Effect.sync(() => service.boards[planId]),
    readTranscript: (planId) => Effect.sync(() => service.transcripts[planId]),
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
          : { ok: true as const, answer: service.plans.map(summary) };
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
      endPlanCall: (keep) =>
        Effect.gen(function* () {
          const planId = standing.about?.planId;
          if (planId === undefined || planId === keep) return;
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

it.effect("opening a plan moves no row of the list already drawn", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const billing = plan(BILLING, "Billing export", "# Billing export", 20);
    const service = fakeService([billing, invites]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    // A service that still moved an opened plan to the head would answer this.
    service.plans = [invites, billing];

    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    assert.equal(last()?.activePlanId, INVITES);
    assert.deepEqual(last()?.plans, [summary(billing), summary(invites)]);
  }),
);

it.effect("with the tab showing and a plan open, time passing reads nothing: nothing polls", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    const readsOpen = service.reads.length;

    yield* TestClock.adjust(Duration.minutes(10));
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

    assert.deepEqual(service.reads.slice(readsOpen), []);
  }),
);

it.effect("the tab showing again reads a save made since, and draws it", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    const saved: Plan = {
      ...plan(INVITES, "Teammate invitations", "# Teammate invitations\n\n## Goal", 11),
      document: {
        body: "# Teammate invitations\n\n## Goal",
        assumptions: [{ text: "Members and admins can both invite." }],
      },
    };
    service.plans = [saved];
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: saved });
  }),
);

it.effect(
  "a draft the notetaker sends during a call is drawn in place of the open plan, and the saved one carries its save",
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
        plan: { ...invites, updatedAt: 11, document: saved },
      });
    }),
);

it.effect("a draft of a plan the panel does not have open is dropped", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const { call, last, planning } = yield* subject(fakeService([invites]));
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    planning.showDraft({
      type: VOICE_SERVICE_FRAME.PLAN_DRAFT,
      planId: BILLING,
      document: { body: "# Billing export", assumptions: [] },
    });

    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: invites });
  }),
);

/** The service's word of what each part of Luke is doing on the call about the plan named. */
function activityFrame(planId: string, activity: PlanActivity) {
  return { type: VOICE_SERVICE_FRAME.PLAN_ACTIVITY, planId, ...activity } as const;
}

it.effect(
  "what each part of Luke is doing on the open plan's call is drawn as the service last said it",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
      const { call, last, planning } = yield* subject(fakeService([invites]));
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

      const working = { planner: { action: "ls src" }, notes: true };
      planning.showActivity(activityFrame(INVITES, working));
      assert.deepEqual(last()?.activity, working);
      planning.showActivity(activityFrame(INVITES, { notes: false }));
      assert.deepEqual(last()?.activity, { notes: false });
      assert.equal(last()?.activePlanId, INVITES);
    }),
);

it.effect("activity on the call about a plan the panel does not have open is dropped", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const { call, planning, told } = yield* subject(fakeService([invites]));
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    const drawn = told.length;

    planning.showActivity(activityFrame(BILLING, { planner: {}, notes: false }));

    assert.equal(told.length, drawn);
    assert.equal(planning.snapshot().activity, undefined);
  }),
);

it.effect("leaving the open plan or switching to another clears the activity drawn for it", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const billing = plan(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, planning } = yield* subject(fakeService([billing, invites]));
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    planning.showActivity(activityFrame(INVITES, { planner: {}, notes: true }));
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: BILLING });
    assert.equal(last()?.activePlanId, BILLING);
    assert.equal(last()?.activity, undefined);

    planning.showActivity(activityFrame(BILLING, { planner: {}, notes: true }));
    yield* call(GATEWAY_METHOD.PLANNING_CLOSE);
    assert.equal(last()?.activePlanId, undefined);
    assert.equal(last()?.activity, undefined);
  }),
);

/** A planning turn's work at `state`, its one call to `command` answered with `output` where it has one. */
function workTurn(
  turnId: string,
  state: PlanWorkState,
  command: string,
  output?: string,
): PlanWorkTurn {
  return {
    turnId,
    startedAt: 0,
    state,
    earlierOmitted: false,
    parts: [
      {
        type: PLAN_WORK_PART.TOOL,
        id: `${turnId}-call`,
        tool: PLAN_WORK_TOOL.REPOSITORY,
        name: "run_in_repository",
        state,
        subject: command,
        input: JSON.stringify({ command }),
        ...(output === undefined ? undefined : { output }),
      },
    ],
  };
}

it.effect(
  "each planning turn's work on the open plan's call is drawn in the order the turns began, a turn told again in its own place, and the call's end keeps it",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
      const { call, last, planning } = yield* subject(fakeService([invites]));
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

      const first = workTurn("turn-1", PLAN_WORK_STATE.RUNNING, "ls src");
      const second = workTurn("turn-2", PLAN_WORK_STATE.RUNNING, "cat package.json");
      const answered = workTurn("turn-1", PLAN_WORK_STATE.DONE, "ls src", "invite.ts");
      planning.showWork(INVITES, first);
      planning.showWork(INVITES, second);
      planning.showWork(INVITES, answered);
      assert.deepEqual(last()?.work, [answered, second]);

      planning.showWork(BILLING, workTurn("turn-3", PLAN_WORK_STATE.RUNNING, "ls"));
      assert.deepEqual(last()?.work, [answered, second]);

      planning.callEnded(INVITES);
      assert.deepEqual(last()?.work, [answered, second]);
    }),
);

it.effect("the open plan's call keeps only its newest turns' work", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const { call, last, planning } = yield* subject(fakeService([invites]));
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    for (let turn = 0; turn < PLAN_WORK_BOUNDS.TURNS + 2; turn += 1) {
      planning.showWork(INVITES, workTurn(`turn-${turn}`, PLAN_WORK_STATE.DONE, "ls"));
    }
    const kept = last()?.work ?? [];
    assert.equal(kept.length, PLAN_WORK_BOUNDS.TURNS);
    assert.equal(kept[0]?.turnId, "turn-2");
  }),
);

it.effect("leaving the open plan or switching to another clears the work drawn for it", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const billing = plan(BILLING, "Billing export", "# Billing export", 20);
    const { call, last, planning } = yield* subject(fakeService([billing, invites]));
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    planning.showWork(INVITES, workTurn("turn-1", PLAN_WORK_STATE.DONE, "ls"));
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: BILLING });
    assert.equal(last()?.work, undefined);

    planning.showWork(BILLING, workTurn("turn-2", PLAN_WORK_STATE.DONE, "ls"));
    yield* call(GATEWAY_METHOD.PLANNING_CLOSE);
    assert.equal(last()?.work, undefined);
  }),
);

it.effect("a plan deleted elsewhere is drawn as missing, never as its last copy", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    service.plans = [];
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    assert.deepEqual(last()?.document, { status: PLANNING_READ.MISSING });
  }),
);

it.effect("deleting the open plan ends its call, drops it, and leaves no plan active", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const billing = plan(BILLING, "Billing export", "# Billing export", 20);
    const service = fakeService([billing, invites]);
    const standing: StandingCall = { about: { planId: INVITES } };
    const { call, last, planning } = yield* subject(service, { call: standing });
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_DELETE, { planId: INVITES }), {
      deleted: true,
    });

    assert.equal(standing.about, undefined);
    assert.equal(planning.activePlanId(), undefined);
    assert.deepEqual(last()?.plans, [summary(billing)]);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.IDLE });
  }),
);

it.effect("a delete the service refused keeps the plan open and listed", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const service = fakeService([invites]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    service.deleteFails = true;

    assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_DELETE, { planId: INVITES }), {
      deleted: false,
    });
    assert.equal(last()?.activePlanId, INVITES);
    assert.deepEqual(last()?.plans, [summary(invites)]);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: invites });
  }),
);

it.effect("deleting a plan that is not open leaves the open plan and its call standing", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const billing = plan(BILLING, "Billing export", "# Billing export", 20);
    const standing: StandingCall = { about: { planId: INVITES } };
    const { call, last } = yield* subject(fakeService([billing, invites]), { call: standing });
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    yield* call(GATEWAY_METHOD.PLANNING_DELETE, { planId: BILLING });

    assert.deepEqual(standing.about, { planId: INVITES });
    assert.equal(last()?.activePlanId, INVITES);
    assert.deepEqual(last()?.plans, [summary(invites)]);
  }),
);

it.effect(
  "a rename redraws the list's row and the open document in place, reading nothing again",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = plan(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      const reads = service.reads.length;

      const open = yield* call(GATEWAY_METHOD.PLANNING_RENAME, {
        planId: INVITES,
        name: "Team invites",
      });
      const listed = yield* call(GATEWAY_METHOD.PLANNING_RENAME, {
        planId: BILLING,
        name: "Billing exports",
      });

      assert.deepEqual([open, listed], [{ renamed: true }, { renamed: true }]);
      assert.deepEqual(
        last()?.plans.map((summary) => summary.name),
        ["Billing exports", "Team invites"],
      );
      assert.equal(last()?.document.plan?.name, "Team invites");
      assert.equal(last()?.document.plan?.document.body, "# Team invites");
      assert.equal(service.reads.length, reads);
    }),
);

it.effect("a rename the service refused leaves the plan as it was named", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
    const service = fakeService([invites]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    service.plans = [];

    assert.deepEqual(
      yield* call(GATEWAY_METHOD.PLANNING_RENAME, { planId: INVITES, name: "Team invites" }),
      { renamed: false },
    );
    assert.deepEqual(last()?.plans, [summary(invites)]);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: invites });
  }),
);

it.effect("a list read that fails keeps the plans and the document already drawn", () =>
  Effect.gen(function* () {
    const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
    const service = fakeService([invites]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    service.listFails = true;
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    assert.equal(last()?.listStatus, PLANNING_READ.FAILED);
    assert.deepEqual(last()?.plans, [summary(invites)]);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: invites });
  }),
);

it.effect("opening a plan that is gone draws it missing", () =>
  Effect.gen(function* () {
    const { call, last } = yield* subject(fakeService([]));

    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    assert.equal(last()?.activePlanId, INVITES);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.MISSING });
  }),
);

it.effect(
  "starting a plan on a repository makes it the active one; a refusal starts nothing and says why",
  () =>
    Effect.gen(function* () {
      const started = {
        ...plan(INVITES, "Teammate invitations", "", 10),
        repository: "acme/relay",
      };
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      const request = { name: "Teammate invitations", repository: "acme/relay" };

      service.createAnswer = { ok: false, failure: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE };
      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_START, request), {
        failure: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE,
      });
      assert.equal(last()?.activePlanId, undefined);

      service.createAnswer = { ok: true, answer: started };
      service.plans = [started];
      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_START, request), { planId: INVITES });
      assert.equal(last()?.activePlanId, INVITES);
      assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: started });
      assert.deepEqual(last()?.plans, [summary(started)]);
    }),
);

it.effect(
  "the repositories the account reaches are read from the service on each ask, and a refusal is answered as such",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call } = yield* subject(service);
      const listed: GitHubRepositoriesAnswer = {
        installed: true,
        repositories: [
          {
            owner: "acme",
            name: "relay",
            fullName: "acme/relay",
            defaultBranch: "main",
            private: true,
            updatedAt: 1_000,
          },
        ],
        installationUrl: "https://github.com/apps/luke/installations/new",
      };

      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_REPOSITORIES), {
        failure: PLAN_CALL_FAILURE.UNANSWERED,
      });
      service.repositoriesAnswer = { ok: true, answer: listed };
      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_REPOSITORIES), { repositories: listed });
      assert.deepEqual(service.reads, ["repositories", "repositories"]);
    }),
);

it.effect(
  "giving a plan its repository draws it on the list's row and the open document as the service answered, and a refusal changes nothing",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
      const service = fakeService([invites]);
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

      service.repositoryUnreachable = true;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.PLANNING_SET_REPOSITORY, {
          planId: INVITES,
          repository: "acme/relay",
        }),
        { failure: PLAN_CALL_FAILURE.REPOSITORY_NOT_REACHABLE },
      );
      assert.equal(last()?.plans[0]?.repository, null);

      service.repositoryUnreachable = false;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.PLANNING_SET_REPOSITORY, {
          planId: INVITES,
          repository: "acme/relay",
        }),
        { repository: "acme/relay" },
      );
      const onRelay = { ...invites, repository: "acme/relay" };
      assert.deepEqual(last()?.plans, [summary(onRelay)]);
      assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: onRelay });

      assert.deepEqual(
        yield* call(GATEWAY_METHOD.PLANNING_SET_REPOSITORY, { planId: INVITES, repository: null }),
        { repository: null },
      );
      assert.equal(last()?.plans[0]?.repository, null);
      assert.deepEqual(service.reads, ["list", `open:${INVITES}`], "nothing is read again");
    }),
);

it.effect("leaving the plan leaves no plan active and draws the list", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last, planning } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    yield* call(GATEWAY_METHOD.PLANNING_CLOSE);

    assert.equal(last()?.activePlanId, undefined);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.IDLE });
    assert.equal(planning.activePlanId(), undefined);
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

it.effect("a list read that left before a plan started never marks the new plan missing", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    // The tab showing again sends a list read while the account holds no plan, held on the wire.
    const held = yield* Deferred.make<void>();
    service.listGate = Deferred.await(held);
    const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.PLANNING_REFRESH));
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

    const started = plan(INVITES, "Teammate invitations", "", 10);
    service.plans = [started];
    service.createAnswer = { ok: true, answer: started };
    const starting = yield* Effect.forkChild(
      call(GATEWAY_METHOD.PLANNING_START, { name: "Teammate invitations" }),
    );
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(refreshing);
    yield* Fiber.join(starting);

    assert.equal(last()?.activePlanId, INVITES);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: started });
    assert.deepEqual(last()?.plans, [summary(started)]);
  }),
);

it.effect(
  "only one plan is spoken: opening or starting another plan and leaving the plan each end the open plan's call, and a desk call or the same plan's call is left standing",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = plan(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const call: StandingCall = { about: { planId: INVITES } };
      const { call: ask } = yield* subject(service, { call });

      yield* ask(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      assert.deepEqual(call.about, { planId: INVITES });
      yield* ask(GATEWAY_METHOD.PLANNING_OPEN, { planId: BILLING });
      assert.equal(call.about, undefined);

      call.about = { planId: BILLING };
      const started = plan(INVITES, "Teammate invitations", "", 30);
      service.createAnswer = { ok: true, answer: started };
      yield* ask(GATEWAY_METHOD.PLANNING_START, { name: "Teammate invitations" });
      assert.equal(call.about, undefined);

      call.about = { planId: INVITES };
      yield* ask(GATEWAY_METHOD.PLANNING_CLOSE);
      assert.equal(call.about, undefined);

      call.about = { planId: undefined };
      yield* ask(GATEWAY_METHOD.PLANNING_OPEN, { planId: BILLING });
      yield* ask(GATEWAY_METHOD.PLANNING_CLOSE);
      assert.deepEqual(call.about, { planId: undefined });
    }),
);

it.effect(
  "a plan opened while the old plan's call is still closing is already the active one",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Teammate invitations", 10);
      const billing = plan(BILLING, "Billing export", "# Billing export", 20);
      const closed = yield* Deferred.make<void>();
      const standing: StandingCall = { about: undefined };
      const { call, last, planning } = yield* subject(fakeService([billing, invites]), {
        call: standing,
      });
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      standing.about = { planId: INVITES };
      standing.closing = Deferred.await(closed);

      const opening = yield* Effect.forkChild(
        call(GATEWAY_METHOD.PLANNING_OPEN, { planId: BILLING }),
      );
      for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
      // A press or an offer inside the wait reads the plan the window is moving to.
      assert.deepEqual(standing.about, { planId: INVITES });
      assert.equal(planning.activePlanId(), BILLING);
      assert.equal(last()?.activePlanId, BILLING);

      yield* Deferred.succeed(closed, undefined);
      yield* Fiber.join(opening);
      assert.equal(standing.about, undefined);
      assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: billing });
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

it.effect(
  "opening a plan draws its board, and a drawing the planning model settled on the call is read again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
        service.boards[INVITES] = { elements: [box("note")], appliedDrawing: 0 };
        const { call, last, planning } = yield* subject(service);
        yield* planning.lifetime;

        yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
        assert.deepEqual(last()?.board, service.boards[INVITES]);

        const drawn = { elements: [box("note")], appliedDrawing: 0, drawing: drawing(1) };
        service.boards[INVITES] = drawn;
        planning.showActivity(
          activityFrame(INVITES, { planner: { action: DRAW_ON_BOARD_TOOL_NAME }, notes: false }),
        );
        planning.showActivity(activityFrame(INVITES, { planner: {}, notes: false }));
        for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

        assert.deepEqual(last()?.board, drawn);
      }),
    ),
);

it.effect(
  "a look becoming the pending call reads the board again, so a draw made in the same step is on it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
        service.boards[INVITES] = { elements: [box("note")], appliedDrawing: 0 };
        const { call, last, planning } = yield* subject(service);
        yield* planning.lifetime;
        yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

        const drawn = { elements: [box("note")], appliedDrawing: 0, drawing: drawing(1) };
        service.boards[INVITES] = drawn;
        planning.showActivity(
          activityFrame(INVITES, { planner: { action: LOOK_AT_BOARD_TOOL_NAME }, notes: false }),
        );
        for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

        assert.deepEqual(last()?.board, drawn);
      }),
    ),
);

it.effect(
  "the planning model going quiet reads the board again, in case a drawing settled unseen",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
        const { call, last, planning } = yield* subject(service);
        yield* planning.lifetime;
        yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
        planning.showActivity(activityFrame(INVITES, { planner: {}, notes: false }));

        const drawn = { elements: [], appliedDrawing: 0, drawing: drawing(1) };
        service.boards[INVITES] = drawn;
        planning.showActivity(activityFrame(INVITES, { notes: false }));
        for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

        assert.deepEqual(last()?.board, drawn);
      }),
    ),
);

it.effect(
  "the panel's scene is saved for the open plan with any image it carries, and the board drawn is what the service kept",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.boards[INVITES] = { elements: [], appliedDrawing: 0, drawing: drawing(1) };
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

      const scene = [box("api"), box("note")];
      const saved = yield* call(GATEWAY_METHOD.PLANNING_BOARD_SAVE, {
        planId: INVITES,
        elements: scene,
        appliedDrawing: 1,
      });
      const elsewhere = yield* call(GATEWAY_METHOD.PLANNING_BOARD_SAVE, {
        planId: BILLING,
        elements: scene,
        appliedDrawing: 0,
      });

      const imaged = yield* call(GATEWAY_METHOD.PLANNING_BOARD_SAVE, {
        planId: INVITES,
        elements: scene,
        appliedDrawing: 1,
        image: "iVBORw0KGgo=",
      });

      assert.deepEqual(saved, { saved: true });
      assert.deepEqual(imaged, { saved: true });
      assert.equal(service.images[INVITES], "iVBORw0KGgo=");
      assert.deepEqual(elsewhere, { saved: false });
      assert.equal(service.boards[BILLING], undefined);
      assert.deepEqual(last()?.board, { elements: scene, appliedDrawing: 1, drawing: drawing(1) });
    }),
);

it.effect("leaving the open plan drops the board drawn for it", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.boards[INVITES] = { elements: [box("note")], appliedDrawing: 0 };
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    yield* call(GATEWAY_METHOD.PLANNING_CLOSE);

    assert.equal(last()?.board, undefined);
  }),
);

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

/** The open plan with its code loop running. */
function openPlan(service: FakeService) {
  return Effect.gen(function* () {
    const opened = yield* subject(service);
    yield* opened.call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    yield* opened.planning.lifetime;
    return opened;
  });
}

it.effect("code Luke names on the open plan's call is drawn as it arrived, coloured", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { planning, last } = yield* openPlan(service);

    planning.showCode(INVITES, shownCode({ path: "invite.ts", startLine: 1, endLine: 2 }));

    const { code } = last() ?? {};
    assert.deepEqual(code?.ref, { path: "invite.ts", startLine: 1, endLine: 2 });
    assert.equal(code?.repository, "acme/relay");
    assert.equal(code?.lineCount, 3);
    assert.equal(
      code?.lines[0]?.map((token) => token.text).join(""),
      "export function acceptInvite(token: string) {",
    );
    assert.ok(
      code?.lines[0]?.some((token) => token.color !== undefined),
      "the line is coloured",
    );
  }),
);

it.effect("the call's end clears the code it put on screen, and so does leaving the plan", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, planning, last } = yield* openPlan(service);
    const code = shownCode({ path: "invite.ts" });

    planning.showCode(INVITES, code);
    assert.notEqual(last()?.code, undefined);
    planning.callEnded(INVITES);
    assert.equal(last()?.code, undefined);

    planning.showCode(INVITES, code);
    assert.notEqual(last()?.code, undefined);
    yield* call(GATEWAY_METHOD.PLANNING_CLOSE);
    assert.equal(last()?.code, undefined);
  }),
);

it.effect("code named about a plan that is not open is not drawn", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { planning, told } = yield* openPlan(service);

    planning.showCode(BILLING, shownCode({ path: "invite.ts" }));
    planning.showCode(INVITES, shownCode({ path: "invite.ts", startLine: 3, endLine: 3 }));

    assert.deepEqual(
      told.flatMap((view) => (view.code === undefined ? [] : [view.code.ref])),
      [{ path: "invite.ts", startLine: 3, endLine: 3 }],
    );
  }),
);

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

it.effect(
  "opening a plan draws what was said on its calls, and a read that failed is drawn failed until a refresh lands",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, last } = yield* subject(service);

      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      assert.deepEqual(last()?.transcript, { status: PLANNING_READ.FAILED });

      service.transcripts[INVITES] = transcriptSaying("Invites should expire.");
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      assert.deepEqual(last()?.transcript, {
        status: PLANNING_READ.READY,
        transcript: service.transcripts[INVITES],
      });

      // A later read that fails keeps the transcript drawn.
      delete service.transcripts[INVITES];
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      assert.deepEqual(last()?.transcript, {
        status: PLANNING_READ.READY,
        transcript: transcriptSaying("Invites should expire."),
      });
    }),
);

it.effect(
  "a call's end about the open plan reads its transcript again, and once more for words written after it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
        service.transcripts[INVITES] = transcriptSaying("Invites should expire.");
        const { call, planning, last, told } = yield* subject(service);
        yield* planning.lifetime;
        yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

        // The read at the end lands before the call's last words reach the record.
        const partway = transcriptSaying("Seven");
        const whole = transcriptSaying("Seven days.");
        const answers = [partway, whole];
        service.readTranscript = () => Effect.sync(() => answers.shift() ?? whole);
        planning.callEnded(INVITES);
        for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
        yield* TestClock.adjust(Duration.seconds(5));
        for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;

        assert.deepEqual(last()?.transcript, {
          status: PLANNING_READ.READY,
          transcript: whole,
        });
        assert.ok(told.some((view) => isDeepStrictEqual(view.transcript?.transcript, partway)));
      }),
    ),
);

it.effect(
  "leaving the open plan drops its transcript, and a plan just started has said nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.transcripts[INVITES] = transcriptSaying("Invites should expire.");
      const started = plan(BILLING, "Billing export", "# Billing export", 20);
      service.createAnswer = { ok: true, answer: started };
      const { call, last } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

      yield* call(GATEWAY_METHOD.PLANNING_CLOSE);
      assert.equal(last()?.transcript, undefined);

      yield* call(GATEWAY_METHOD.PLANNING_START, { name: "Billing export" });
      assert.deepEqual(last()?.transcript, {
        status: PLANNING_READ.READY,
        transcript: { calls: [], earlierOmitted: false },
      });
    }),
);
