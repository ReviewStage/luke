import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@sidecar/gateway";
import type { PlanCallResult } from "@sidecar/hosted";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import type { Plan, PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  type GitHubCallFailure,
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanCallFailure,
  type PlanningView,
  planningViewSchema,
} from "@sidecar/hosted/planning-view";
import type { WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Duration, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { composePlanning, type PlanningClient } from "./compose-planning.js";

const INTERVAL_MS = 1_000;
const COMMIT = "4f2c9e1a0b3d5c7e9f1a2b3c4d5e6f708192a3b4";
const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function plan(id: string, name: string, body: string, updatedAt: number): Plan {
  return {
    id,
    name,
    repository: { owner: "acme", name: "relay", branch: "main", commit: COMMIT },
    createdAt: 1_000,
    updatedAt,
    openedAt: updatedAt,
    document: {
      body,
      assumptions: [{ text: "An invite expires after 7 days.", confirmed: false }],
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
  /** Where a list read waits after reading the table and before answering, so a test can hold one on the wire. */
  listGate: Effect.Effect<void>;
  createAnswer: PlanCallResult<Plan, GitHubCallFailure>;
  repositoriesAnswer: PlanCallResult<
    { repositories: { owner: string; name: string; private: boolean }[]; truncated: boolean },
    GitHubCallFailure
  >;
  /** Every read the service answered, in order, so a test can see a closed window reads nothing. */
  readonly reads: string[];
}

function fakeService(plans: Plan[]): FakeService {
  const service: FakeService = {
    plans,
    listFails: false,
    listGate: Effect.void,
    createAnswer: { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED },
    repositoriesAnswer: { ok: true, answer: { repositories: [], truncated: false } },
    reads: [],
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
    repositories: () => Effect.sync(() => service.repositoriesAnswer),
  };
  return service;
}

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

/** The one voice call as the live composer holds it: about a plan, about the desk, or none. */
interface StandingCall {
  about: { readonly planId: string | undefined } | undefined;
}

function subject(service: FakeService, options: { signedIn?: boolean; call?: StandingCall } = {}) {
  return Effect.gen(function* () {
    const told: PlanningView[] = [];
    const standing = options.call ?? { about: undefined };
    const planning = yield* composePlanning({
      kernel: {
        runMode: { sendsNetwork: true },
        emit: (kind, payload) => {
          if (kind !== GATEWAY_EVENT.PLANNING_CHANGED) return;
          const read = readEither(planningViewSchema)(payload);
          assert.ok(Result.isSuccess(read), "the planning event carries a view");
          told.push(read.success);
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service,
      endPlanCall: (keep) =>
        Effect.sync(() => {
          const planId = standing.about?.planId;
          if (planId !== undefined && planId !== keep) standing.about = undefined;
        }),
      pollIntervalMs: INTERVAL_MS,
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = planning.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return Effect.orDie(handler(params, context));
    };
    const last = () => told.at(-1);
    return { planning, call, told, last };
  });
}

/** The cadence's next beat let run: the clock moved, and the fiber the beat resumed given turns. */
function nextBeat(): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* TestClock.adjust(Duration.millis(INTERVAL_MS));
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
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

it.effect("a save the planning model makes is drawn within one beat of the cadence", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    const saved: Plan = {
      ...plan(INVITES, "Teammate invitations", "# Teammate invitations\n\n## Goal", 11),
      document: {
        body: "# Teammate invitations\n\n## Goal",
        assumptions: [{ text: "Members and admins can both invite.", confirmed: true }],
      },
    };
    service.plans = [saved];
    yield* nextBeat();

    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: saved });
  }),
);

it.effect("a plan deleted elsewhere is drawn as missing, never as its last copy", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    service.plans = [];
    yield* nextBeat();

    assert.deepEqual(last()?.document, { status: PLANNING_READ.MISSING });
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
    yield* nextBeat();

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

it.effect("starting a plan makes it the active one; a refusal starts nothing and says why", () =>
  Effect.gen(function* () {
    const started = plan(INVITES, "Teammate invitations", "", 10);
    const service = fakeService([]);
    const { call, last } = yield* subject(service);
    const request = { name: "Teammate invitations", repository: { owner: "acme", name: "relay" } };

    service.createAnswer = { ok: false, failure: GITHUB_FAILURE.EMPTY_REPOSITORY };
    assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_START, request), {
      failure: GITHUB_FAILURE.EMPTY_REPOSITORY,
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

it.effect("the repository picker hears the list, or why the connection could not be read", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service);
    const answer = {
      repositories: [{ owner: "acme", name: "relay", private: true }],
      truncated: true,
    };

    service.repositoriesAnswer = { ok: true, answer };
    assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_REPOSITORIES), answer);

    service.repositoriesAnswer = { ok: false, failure: GITHUB_FAILURE.NOT_CONNECTED };
    assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_REPOSITORIES), {
      failure: GITHUB_FAILURE.NOT_CONNECTED,
    });
  }),
);

it.effect("closing the window leaves no plan active and stops following the service", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, last, planning } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    yield* call(GATEWAY_METHOD.PLANNING_OPEN, { planId: INVITES });

    yield* call(GATEWAY_METHOD.PLANNING_CLOSE);
    const readsAtClose = service.reads.length;
    yield* nextBeat();
    yield* nextBeat();

    assert.equal(last()?.activePlanId, undefined);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.IDLE });
    assert.equal(planning.activePlanId(), undefined);
    assert.deepEqual(service.reads.slice(readsAtClose), []);
  }),
);

it.effect("behind a closed account gate nothing is read and nothing starts", () =>
  Effect.gen(function* () {
    const service = fakeService([plan(INVITES, "Teammate invitations", "# Draft", 10)]);
    const { call, told } = yield* subject(service, { signedIn: false });

    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);
    const started = yield* call(GATEWAY_METHOD.PLANNING_START, {
      name: "Teammate invitations",
      repository: { owner: "acme", name: "relay" },
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
    });
  }),
);

it.effect("a list read that left before a plan started never marks the new plan missing", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call, last } = yield* subject(service);
    yield* call(GATEWAY_METHOD.PLANNING_REFRESH);

    // A beat's list read leaves while the account holds no plan, and is held on the wire.
    const held = yield* Deferred.make<void>();
    service.listGate = Deferred.await(held);
    yield* nextBeat();

    const started = plan(INVITES, "Teammate invitations", "", 10);
    service.plans = [started];
    service.createAnswer = { ok: true, answer: started };
    const starting = yield* Effect.forkChild(
      call(GATEWAY_METHOD.PLANNING_START, {
        name: "Teammate invitations",
        repository: { owner: "acme", name: "relay" },
      }),
    );
    for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(starting);

    assert.equal(last()?.activePlanId, INVITES);
    assert.deepEqual(last()?.document, { status: PLANNING_READ.READY, plan: started });
    assert.deepEqual(last()?.plans, [summary(started)]);
  }),
);

it.effect(
  "only one plan is spoken: opening or starting another plan and closing the window each end the open plan's call, and a desk call or the same plan's call is left standing",
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
        repository: { owner: "acme", name: "relay" },
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
