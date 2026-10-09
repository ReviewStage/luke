import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@sidecar/gateway";
import { type PlanCallResult, VOICE_SERVICE_FRAME } from "@sidecar/hosted";
import { BOARD_ELEMENT_TYPE, DRAW_ON_BOARD_TOOL_NAME } from "@sidecar/hosted/board-vocabulary";
import type { Board, BoardElement, BoardLook, BoardLookResult } from "@sidecar/hosted/board-wire";
import type { Plan, PlanCommand, PlanCommandResult, PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanActivity,
  type PlanCallFailure,
  type PlanningView,
  planningViewSchema,
} from "@sidecar/hosted/planning-view";
import type { PlanTranscript } from "@sidecar/hosted/transcript-wire";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import type { WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Duration, Effect, Fiber, FileSystem, Layer, Result } from "effect";
import { TestClock } from "effect/testing";
import { composePlanning, type PlanFolders, type PlanningClient } from "./compose-planning.js";
import type { JsonStateFile } from "./json-state-file.js";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function plan(id: string, name: string, body: string, updatedAt: number): Plan {
  return {
    id,
    name,
    createdAt: 1_000,
    updatedAt,
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
  createAnswer: PlanCallResult<Plan, typeof PLAN_CALL_FAILURE.UNANSWERED>;
  /** Every read the service answered, in order, so a test can see that nothing reads on a clock. */
  readonly reads: string[];
  /** The commands waiting for this Mac to claim, oldest first. */
  commands: PlanCommand[];
  /** What this Mac posted back, in order. */
  readonly settled: { planId: string; commandId: string; result: PlanCommandResult }[];
  /** Done once the first result is posted back. */
  readonly firstSettle: Deferred.Deferred<void>;
  /** The looks at the board waiting for this Mac to claim, oldest first. */
  looks: BoardLook[];
  /** What this Mac posted back for each look, in order. */
  readonly lookSettled: { planId: string; lookId: string; result: BoardLookResult }[];
  /** Done once the first look is posted back. */
  readonly firstLook: Deferred.Deferred<void>;
  /** Each plan's board, by plan id; a plan with none answers no board, as a service that did not answer. */
  boards: Record<string, Board>;
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
    reads: [],
    commands: [],
    settled: [],
    firstSettle: Deferred.makeUnsafe<void>(),
    looks: [],
    lookSettled: [],
    firstLook: Deferred.makeUnsafe<void>(),
    boards: {},
    transcripts: {},
    readBoard: (planId) => Effect.sync(() => service.boards[planId]),
    readTranscript: (planId) => Effect.sync(() => service.transcripts[planId]),
    // The service keeps the last scene written, beside whatever drawing it holds.
    saveBoard: (planId, elements, appliedDrawing) =>
      Effect.sync(() => {
        const board = { ...service.boards[planId], elements, appliedDrawing };
        service.boards[planId] = board;
        return board;
      }),
    // An empty queue holds the claim open, as the service does, rather than answering at once.
    claimCommand: () =>
      Effect.suspend(() => {
        const next = service.commands.shift();
        return next === undefined
          ? Effect.as(Effect.sleep(Duration.seconds(20)), null)
          : Effect.succeed(next);
      }),
    settleCommand: (planId, commandId, result) =>
      Effect.sync(() => {
        service.settled.push({ planId, commandId, result });
        Deferred.doneUnsafe(service.firstSettle, Effect.void);
        return true;
      }),
    claimBoardLook: () =>
      Effect.suspend(() => {
        const next = service.looks.shift();
        return next === undefined
          ? Effect.as(Effect.sleep(Duration.seconds(20)), null)
          : Effect.succeed(next);
      }),
    settleBoardLook: (planId, lookId, result) =>
      Effect.sync(() => {
        service.lookSettled.push({ planId, lookId, result });
        Deferred.doneUnsafe(service.firstLook, Effect.void);
        return true;
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

/** This Mac's record of each plan's folder, held in memory as the file holds it on disk. */
function folderRecord(): JsonStateFile<PlanFolders> {
  let stored: PlanFolders | undefined;
  return {
    read: () => stored,
    update: (mutate) => {
      stored = mutate(stored);
      return stored;
    },
  };
}

/** The one voice call as the live composer holds it: about a plan, about the desk, or none. */
interface StandingCall {
  about: { readonly planId: string | undefined } | undefined;
  /** Where ending a call waits before it lands, as a real call's close does. */
  closing?: Effect.Effect<void>;
}

/** The desktop's drawing of a board: a PNG named for the elements it holds, so a test can see which board was drawn. */
function drawnBoard(board: Board): Effect.Effect<BoardLookResult> {
  return Effect.succeed({ image: btoa(board.elements.map((element) => element.id).join(",")) });
}

function subject(service: FakeService, options: { signedIn?: boolean; call?: StandingCall } = {}) {
  return Effect.gen(function* () {
    const told: PlanningView[] = [];
    const waiters: {
      wanted: (view: PlanningView) => boolean;
      seen: Deferred.Deferred<PlanningView>;
    }[] = [];
    const standing = options.call ?? { about: undefined };
    const recordedFolders = folderRecord();
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
      renderBoard: drawnBoard,
      folders: recordedFolders,
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

it.effect(
  "deleting the open plan ends its call, drops it and its folder, and leaves no plan active",
  () =>
    Effect.gen(function* () {
      const invites = plan(INVITES, "Teammate invitations", "# Draft", 10);
      const billing = plan(BILLING, "Billing export", "# Billing export", 20);
      const service = fakeService([billing, invites]);
      const standing: StandingCall = { about: { planId: INVITES } };
      const { call, last, planning } = yield* subject(service, { call: standing });
      yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      yield* call(GATEWAY_METHOD.PLANNING_SET_FOLDER, {
        planId: INVITES,
        folderPath: "/Users/dev/relay",
      });

      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_DELETE, { planId: INVITES }), {
        deleted: true,
      });

      assert.equal(standing.about, undefined);
      assert.equal(planning.activePlanId(), undefined);
      assert.deepEqual(last()?.plans, [summary(billing)]);
      assert.deepEqual(last()?.folders, {});
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
  "starting a plan makes it the active one and keeps its folder on this Mac; a refusal starts nothing and says why",
  () =>
    Effect.gen(function* () {
      const started = plan(INVITES, "Teammate invitations", "", 10);
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      const request = { name: "Teammate invitations", folderPath: "/Users/dev/relay" };

      service.createAnswer = { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED };
      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_START, request), {
        failure: PLAN_CALL_FAILURE.UNANSWERED,
      });
      assert.equal(last()?.activePlanId, undefined);

      service.createAnswer = { ok: true, answer: started };
      service.plans = [started];
      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_START, request), { planId: INVITES });
      assert.equal(last()?.activePlanId, INVITES);
      assert.deepEqual(last()?.folders, { [INVITES]: "/Users/dev/relay" });
      assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: started });
      assert.deepEqual(last()?.plans, [summary(started)]);
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
    const started = yield* call(GATEWAY_METHOD.PLANNING_START, {
      name: "Teammate invitations",
      folderPath: "/Users/dev/relay",
    });

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
      folders: {},
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
      call(GATEWAY_METHOD.PLANNING_START, {
        name: "Teammate invitations",
        folderPath: "/Users/dev/relay",
      }),
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
      yield* ask(GATEWAY_METHOD.PLANNING_START, {
        name: "Teammate invitations",
        folderPath: "/Users/dev/relay",
      });
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

it.effect("the open plan's command runs in its folder on this Mac and its output goes back", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const folder = yield* temporaryDirectoryScoped("luke-plan-folder-");
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, planning } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      yield* call(GATEWAY_METHOD.PLANNING_SET_FOLDER, { planId: INVITES, folderPath: folder });
      service.commands.push({
        id: "3d8e4f2a-6b1c-4a9d-8e7f-0a1b2c3d4e5f",
        command: "pwd && echo invites >&2 && exit 3",
      });

      yield* planning.lifetime;
      yield* Deferred.await(service.firstSettle);

      const [settled] = service.settled;
      assert.equal(settled?.planId, INVITES);
      assert.equal(settled?.commandId, "3d8e4f2a-6b1c-4a9d-8e7f-0a1b2c3d4e5f");
      assert.equal(settled?.result.exitCode, 3);
      assert.equal(settled?.result.stdout.trim().endsWith(folder.split("/").at(-1) ?? "?"), true);
      assert.equal(settled?.result.stderr.trim(), "invites");
    }),
  ).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect("a look at the open plan's board is drawn by the desktop and its image goes back", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.boards[INVITES] = {
        elements: [{ id: "their-sketch", type: "rectangle", x: 0, y: 0, width: 200, height: 80 }],
        appliedDrawing: 0,
      };
      const { call, planning } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      service.looks.push({ id: "5c2a7e1b-9d3f-4b8a-a6c4-1e2f3a4b5c6d" });

      yield* planning.lifetime;
      yield* Deferred.await(service.firstLook);

      assert.deepEqual(service.lookSettled, [
        {
          planId: INVITES,
          lookId: "5c2a7e1b-9d3f-4b8a-a6c4-1e2f3a4b5c6d",
          result: { image: btoa("their-sketch") },
        },
      ]);
    }),
  ),
);

it.effect("a look whose board the service will not hand over goes back as why", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, planning } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      service.looks.push({ id: "5c2a7e1b-9d3f-4b8a-a6c4-1e2f3a4b5c6d" });

      yield* planning.lifetime;
      yield* Deferred.await(service.firstLook);

      const [settled] = service.lookSettled;
      assert.ok(settled !== undefined && "failure" in settled.result);
    }),
  ),
);

/** The one command `command` run in a fresh plan folder on this Mac, and what it settled. */
function runInFolder(
  command: string,
  prepare: (folder: string) => Effect.Effect<void> = () => Effect.void,
) {
  return Effect.gen(function* () {
    const folder = yield* temporaryDirectoryScoped("luke-plan-folder-");
    yield* prepare(folder);
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, planning } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    yield* call(GATEWAY_METHOD.PLANNING_SET_FOLDER, { planId: INVITES, folderPath: folder });
    service.commands.push({ id: "3d8e4f2a-6b1c-4a9d-8e7f-0a1b2c3d4e5f", command });
    yield* planning.lifetime;
    yield* Deferred.await(service.firstSettle);
    const [settled] = service.settled;
    assert.ok(settled, "the command settled");
    return { folder, result: settled.result };
  });
}

const nodeFiles = Layer.merge(NodeFileSystem.layer, NodePath.layer);

it.effect("a command sees none of Luke's own environment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      assert.equal(process.env.VITEST, "true");
      const { result } = yield* runInFolder('echo "${VITEST-none}"');
      assert.equal(result.stdout.trim(), "none");
    }),
  ).pipe(Effect.provide(nodeFiles)),
);

it.effect.runIf(process.platform === "darwin")(
  "on macOS a command can neither write, nor read outside the folder or a .env inside it",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const outside = yield* temporaryDirectoryScoped("luke-plan-outside-");
        const fs = yield* FileSystem.FileSystem;
        yield* Effect.orDie(fs.writeFileString(`${outside}/secret`, "hunter2"));
        const { folder, result } = yield* runInFolder(
          `cat ${outside}/secret .env.local; echo x > made; echo x > ${outside}/made; ls`,
          (inside) =>
            Effect.orDie(
              Effect.all([
                fs.writeFileString(`${inside}/notes.md`, "invites"),
                fs.writeFileString(`${inside}/.env.local`, "STRIPE_KEY=sk_live_x"),
              ]),
            ),
        );
        assert.equal(result.stdout.trim(), "notes.md");
        assert.doesNotMatch(result.stdout, /hunter2|sk_live_x/u);
        assert.equal(yield* Effect.orDie(fs.exists(`${folder}/made`)), false);
        assert.equal(yield* Effect.orDie(fs.exists(`${outside}/made`)), false);
      }),
    ).pipe(Effect.provide(nodeFiles)),
);

it.effect("with no plan open, no command is claimed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { planning } = yield* subject(service);
      service.commands.push({
        id: "3d8e4f2a-6b1c-4a9d-8e7f-0a1b2c3d4e5f",
        command: "echo nothing",
      });

      yield* planning.lifetime;
      yield* TestClock.adjust(Duration.minutes(1));

      assert.equal(service.commands.length, 1);
      assert.deepEqual(service.settled, []);
    }),
  ),
);

it.effect("a command for a plan this Mac holds no folder for runs nothing and says why", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, planning } = yield* subject(service);
      yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
      service.commands.push({ id: "3d8e4f2a-6b1c-4a9d-8e7f-0a1b2c3d4e5f", command: "touch x" });

      yield* planning.lifetime;
      yield* Deferred.await(service.firstSettle);

      const [settled] = service.settled;
      assert.equal(settled?.result.exitCode, 1);
      assert.match(settled?.result.stderr ?? "", /no folder is chosen for this plan on this Mac/u);
    }),
  ),
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
  "the panel's scene is saved for the open plan, and the board drawn is what the service kept",
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

      assert.deepEqual(saved, { saved: true });
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

const INVITE_SOURCE = "export function acceptInvite(token: string) {\n  return token;\n}\n";

/** The open plan on a folder holding one source file, with its code loop running. */
function planOnFolder(service: FakeService) {
  return Effect.gen(function* () {
    const folder = yield* temporaryDirectoryScoped("luke-plan-code-");
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.orDie(fs.writeFileString(`${folder}/invite.ts`, INVITE_SOURCE));
    const opened = yield* subject(service);
    yield* opened.call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });
    yield* opened.call(GATEWAY_METHOD.PLANNING_SET_FOLDER, { planId: INVITES, folderPath: folder });
    yield* opened.planning.lifetime;
    return opened;
  });
}

it.effect("code Luke names on the open plan's call is read from its folder and drawn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { planning, viewWhere } = yield* planOnFolder(service);
      const drawn = viewWhere((view) => view.code !== undefined);

      planning.showCode(INVITES, { path: "invite.ts", startLine: 1, endLine: 2 });

      const { code } = yield* drawn;
      assert.deepEqual(code?.ref, { path: "invite.ts", startLine: 1, endLine: 2 });
      assert.equal(
        code?.lines?.[0]?.map((token) => token.text).join(""),
        "export function acceptInvite(token: string) {",
      );
    }),
  ).pipe(Effect.provide(nodeFiles)),
);

it.effect("the call's end clears the code it put on screen, and so does leaving the plan", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, planning, viewWhere, last } = yield* planOnFolder(service);
      const ref = { path: "invite.ts" };

      const first = viewWhere((view) => view.code !== undefined);
      planning.showCode(INVITES, ref);
      yield* first;
      planning.callEnded(INVITES);
      assert.equal(last()?.code, undefined);

      const second = viewWhere((view) => view.code !== undefined);
      planning.showCode(INVITES, ref);
      yield* second;
      yield* call(GATEWAY_METHOD.PLANNING_CLOSE);
      assert.equal(last()?.code, undefined);
    }),
  ).pipe(Effect.provide(nodeFiles)),
);

it.effect("code named about a plan that is not open is not drawn", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { planning, told, viewWhere } = yield* planOnFolder(service);

      planning.showCode(BILLING, { path: "invite.ts" });
      // Note that the plan's own code, named after, is drawn, so the other was dropped rather than still out.
      const drawn = viewWhere((view) => view.code !== undefined);
      planning.showCode(INVITES, { path: "invite.ts", startLine: 3, endLine: 3 });
      yield* drawn;

      assert.deepEqual(
        told.flatMap((view) => (view.code === undefined ? [] : [view.code.ref])),
        [{ path: "invite.ts", startLine: 3, endLine: 3 }],
      );
    }),
  ).pipe(Effect.provide(nodeFiles)),
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

      yield* call(GATEWAY_METHOD.PLANNING_START, {
        name: "Billing export",
        folderPath: "/tmp/billing",
      });
      assert.deepEqual(last()?.transcript, {
        status: PLANNING_READ.READY,
        transcript: { calls: [], earlierOmitted: false },
      });
    }),
);
