import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@sidecar/gateway";
import { type PlanCallResult, VOICE_SERVICE_FRAME } from "@sidecar/hosted";
import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import type { Plan, PlanCommand, PlanCommandResult, PlanSummary } from "@sidecar/hosted/plan-wire";
import {
  type GitHubCallFailure,
  PLAN_CALL_FAILURE,
  PLANNING_READ,
  type PlanActivity,
  type PlanCallFailure,
  type PlanningView,
  planningViewSchema,
} from "@sidecar/hosted/planning-view";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import type { WireRecord } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Deferred, Duration, Effect, Fiber, Layer, Result } from "effect";
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
    openedAt: updatedAt,
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
  /** Where a list read waits after reading the table and before answering, so a test can hold one on the wire. */
  listGate: Effect.Effect<void>;
  createAnswer: PlanCallResult<Plan, GitHubCallFailure>;
  repositoriesAnswer: PlanCallResult<
    { repositories: { owner: string; name: string; private: boolean }[]; truncated: boolean },
    GitHubCallFailure
  >;
  /** Every read the service answered, in order, so a test can see that nothing reads on a clock. */
  readonly reads: string[];
  /** The commands waiting for this Mac to claim, oldest first. */
  commands: PlanCommand[];
  /** What this Mac posted back, in order. */
  readonly settled: { planId: string; commandId: string; result: PlanCommandResult }[];
  /** Done once the first result is posted back. */
  readonly firstSettle: Deferred.Deferred<void>;
}

function fakeService(plans: Plan[]): FakeService {
  const service: FakeService = {
    plans,
    listFails: false,
    listGate: Effect.void,
    createAnswer: { ok: false, failure: PLAN_CALL_FAILURE.UNANSWERED },
    repositoriesAnswer: { ok: true, answer: { repositories: [], truncated: false } },
    reads: [],
    commands: [],
    settled: [],
    firstSettle: Deferred.makeUnsafe<void>(),
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

const SERVICE_BASE_URL = "https://luke.test";
const ACCOUNT_ID = "user-mac";

function subject(service: FakeService, options: { signedIn?: boolean; call?: StandingCall } = {}) {
  return Effect.gen(function* () {
    const told: PlanningView[] = [];
    const opened: string[] = [];
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
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service,
      folders: recordedFolders,
      endPlanCall: (keep) =>
        Effect.gen(function* () {
          const planId = standing.about?.planId;
          if (planId === undefined || planId === keep) return;
          yield* standing.closing ?? Effect.void;
          standing.about = undefined;
        }),
      connectGitHub: {
        serviceBaseUrl: SERVICE_BASE_URL,
        accountId: () => Effect.succeed(ACCOUNT_ID),
        openExternal: (url) => Effect.sync(() => void opened.push(url)),
      },
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = planning.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return Effect.orDie(handler(params, context));
    };
    const last = () => told.at(-1);
    return { planning, call, told, last, opened };
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

      service.createAnswer = { ok: false, failure: GITHUB_FAILURE.EMPTY_REPOSITORY };
      assert.deepEqual(yield* call(GATEWAY_METHOD.PLANNING_START, request), {
        failure: GITHUB_FAILURE.EMPTY_REPOSITORY,
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

it.effect(
  "Connect GitHub opens the page for this Mac's account, and nothing behind a closed gate",
  () =>
    Effect.gen(function* () {
      const signedIn = yield* subject(fakeService([]));
      const signedOut = yield* subject(fakeService([]), { signedIn: false });

      assert.deepEqual(yield* signedIn.call(GATEWAY_METHOD.PLANNING_CONNECT_GITHUB), {
        opened: true,
      });
      assert.deepEqual(yield* signedOut.call(GATEWAY_METHOD.PLANNING_CONNECT_GITHUB), {
        opened: false,
      });
      assert.deepEqual(signedIn.opened, [
        `${SERVICE_BASE_URL}/connect-github.html?account=${ACCOUNT_ID}`,
      ]);
      assert.deepEqual(signedOut.opened, []);
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
