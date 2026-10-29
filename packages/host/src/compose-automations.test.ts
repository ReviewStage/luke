import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import type { AutomationRunsLiveAnswer, AutomationsLiveRows } from "@luke/features/automation-live";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  automationViewSchema,
} from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  type AutomationSummary,
} from "@luke/features/automation-wire";
import { LIVE_POLL_URL, LIVE_SIGNED_OUT } from "@luke/features/live-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { unparsedWire, type WireRecord, type WireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { noNetwork } from "@luke/wire/testing";
import { Duration, Effect, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import { type AutomationsClient, composeAutomations } from "./compose-automations.js";
import { type PolledLive, polledLive } from "./testing/polled-live.js";

/**
 * The automations concern: behind a closed gate nothing is asked of the
 * service, a write's params reach the service as the window named them,
 * the window hears the service's answer whole, and params of the wrong
 * shape are refused before anything travels. What a window follows is
 * emitted as it stands and each time it moves, for the account signed in as
 * it started, until let go or signed out. Synthetic ids and words.
 */

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

const ACCOUNT_ID = "account-1";

/** An automation with no runs yet, its live read answered polled. */
const POLLED_RUNS: AutomationRunsLiveAnswer = {
  url: LIVE_POLL_URL,
  queries: {
    runs: {
      capability: "",
      queryFingerprint: "",
      expiresAt: Number.MAX_SAFE_INTEGER,
      rows: [],
      digest: "r1",
    },
  },
};

const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** `settled`, then the host's next poll asked, which waits half a second after the last answered (`live-follow.ts`), then `settled` again. */
const nextPoll = Effect.andThen(
  settled,
  Effect.andThen(TestClock.adjust(Duration.millis(500)), settled),
);

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

const SCHEDULE = {
  kind: AUTOMATION_TRIGGER.SCHEDULE,
  cron: "0 9 * * 1-5",
  timezone: "UTC",
} as const;

const SUMMARY = {
  id: AUTOMATION_ID,
  planId: null,
  planName: null,
  workspaceId: WORKSPACE_ID,
  name: "Triage new issues",
  enabled: true,
  pausedReason: null,
  trigger: SCHEDULE,
  action: { kind: AUTOMATION_ACTION.AGENT, prompt: "Triage the issues opened today." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: 10,
  lastRun: null,
  createdAt: 1,
} as const;

/** `SUMMARY` as the list's statement answers its row, with no run yet. */
const ROW: AutomationsLiveRows["automations"][number] = {
  id: AUTOMATION_ID,
  userId: ACCOUNT_ID,
  taskId: null,
  taskName: null,
  name: SUMMARY.name,
  enabled: true,
  trigger: SCHEDULE,
  action: SUMMARY.action,
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: 10,
  organizationId: WORKSPACE_ID,
  scope: AUTOMATION_SCOPE.PERSONAL,
  repositories: ["acme/web"],
  taskRepository: null,
  targetKind: AUTOMATION_TARGET.NEW_AGENT,
  targetAgentId: null,
  archiveSuccessful: false,
  createdAt: 1,
  mine: true,
  runId: null,
  runFiring: null,
  runStatus: null,
  runReason: null,
  runFiredAt: null,
  runSettledAt: null,
  agentId: null,
  agentTitle: null,
  agentCreatedAt: null,
  ownKey: null,
  turnId: null,
  turnStatus: null,
  cancelRequested: null,
  turnQueuedAt: null,
  turnSettledAt: null,
  turnSessionEnded: null,
  awaitingLineAt: null,
  failureWord: null,
};

/** A run "Run now" made, as the service answers it. */
const RUN = {
  id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d",
  firing: { kind: AUTOMATION_FIRING.MANUAL },
  status: AUTOMATION_RUN_STATUS.QUEUED,
  reason: null,
  agent: null,
  firedAt: 20,
  settledAt: null,
} as const;

const CREATE = {
  workspaceId: WORKSPACE_ID,
  repositories: ["acme/web"],
  name: SUMMARY.name,
  trigger: SCHEDULE,
  action: SUMMARY.action,
};

/** The service as a script that writes down every ask it hears, as the ask runs. */
function fakeService(options: { replaceRefused?: boolean } = {}) {
  const asked: unknown[] = [];
  /** The live reads as the service answers them polled (`testing/polled-live.ts`): a workspace's list, every run of it, and one automation's runs. */
  const live: {
    readonly list: PolledLive<"automations", typeof LIVE_SIGNED_OUT>;
    readonly workspaceRuns: PolledLive<"runs">;
    /** What the runs' live read answers first, and what a poll past it answers; not found, and held, where unsaid. */
    runs?: AutomationRunsLiveAnswer;
    runsPolled?: { readonly failure: typeof AUTOMATION_CALL_FAILURE.NOT_FOUND };
  } = {
    list: polledLive<"automations", typeof LIVE_SIGNED_OUT>(["automations"]),
    workspaceRuns: polledLive<"runs">(["runs"]),
  };
  // A workspace with no automations, and none of their runs, until a test says otherwise.
  live.list.set({ automations: [] });
  live.workspaceRuns.set({ runs: [] });
  /** What a change, a create, and a Run now answer, which a test may replace. */
  const replies: {
    change: Effect.Success<ReturnType<AutomationsClient["change"]>>;
    create: Effect.Success<ReturnType<AutomationsClient["create"]>>;
    run: Effect.Success<ReturnType<AutomationsClient["runNow"]>>;
  } = {
    change: { automation: SUMMARY },
    create: { automation: SUMMARY },
    run: { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND },
  };
  const answer =
    <A>(name: string, value: () => A) =>
    (params: Parameters<AutomationsClient[keyof AutomationsClient]>[0]) =>
      Effect.sync(() => {
        asked.push([name, params]);
        return value();
      });
  const client: AutomationsClient = {
    list: answer("list", () => ({ automations: [SUMMARY] })),
    create: answer("create", () => replies.create),
    change: answer("change", () => replies.change),
    remove: answer("remove", () => ({ deleted: true }) as const),
    runNow: answer("run", () => replies.run),
    runs: answer("runs", () => ({ runs: [] })),
    replaceWebhookSecret: answer("replace", () =>
      options.replaceRefused === true
        ? { failure: AUTOMATION_CALL_FAILURE.NOT_PERMITTED }
        : { automation: SUMMARY },
    ),
    listLive: (workspaceId, userId, poll, after) =>
      poll
        ? live.list.poll(after)
        : Effect.sync(() => {
            asked.push(["list-live", workspaceId, userId]);
            return live.list.first();
          }),
    runsLive: (automationId, userId, poll) =>
      poll
        ? live.runsPolled === undefined
          ? Effect.never
          : // A poll is held a while before it answers, as the service holds one.
            Effect.as(Effect.repeat(Effect.yieldNow, { times: 20 }), live.runsPolled)
        : Effect.sync(() => {
            asked.push(["runs-live", automationId, userId]);
            return live.runs ?? { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND };
          }),
    workspaceRunsLive: (_workspaceId, _userId, poll, after) =>
      poll ? live.workspaceRuns.poll(after) : Effect.sync(() => live.workspaceRuns.first()),
  };
  return { client, asked, live, replies };
}

function subject(
  options: { signedIn?: boolean; sendsNetwork?: boolean; replaceRefused?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(options);
    const emitted: { kind: GatewayEventKind; payload: WireValue }[] = [];
    const composer = yield* composeAutomations({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        now: () => 0,
        hostedServiceBaseUrl: "https://service.example",
        emit: (kind, payload) => emitted.push({ kind, payload }),
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      accountId: () => (options.signedIn === false ? undefined : ACCOUNT_ID),
      client: service.client,
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /** What the follows told the windows, in order. */
    const changed = () =>
      emitted
        .filter((each) => each.kind === GATEWAY_EVENT.AUTOMATIONS_CHANGED)
        .map((each) => each.payload);
    /** The workspace's list as the follows last told it, by its automations' names and whether each is on. */
    const listed = () => {
      const lists = changed().flatMap((payload) => {
        const told = payload as { view: { automations?: readonly AutomationSummary[] } };
        return told.view.automations === undefined ? [] : [told.view.automations];
      });
      return lists.map((automations) => automations.map(({ id, enabled }) => ({ id, enabled })));
    };
    return {
      call,
      asked: service.asked,
      live: service.live,
      replies: service.replies,
      changed,
      listed,
      reset: composer.reset,
      options,
    };
  });
}

it.effect("behind a closed account gate, or on a run that sends nothing, nothing is asked", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
      const { call, asked } = yield* subject(options);
      assert.deepEqual(yield* call(GATEWAY_METHOD.AUTOMATIONS_LIST), {
        failure: AUTOMATION_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(yield* call(GATEWAY_METHOD.AUTOMATIONS_CREATE, CREATE), {
        failure: AUTOMATION_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(asked, []);
    }
  }),
);

it.effect(
  "a write's params reach the service as the window named them, and the window hears the answer whole",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const named = { automationId: AUTOMATION_ID };
      const change = { ...named, change: { enabled: false } };

      const listed = yield* call(GATEWAY_METHOD.AUTOMATIONS_LIST, { workspaceId: WORKSPACE_ID });
      const made = yield* call(GATEWAY_METHOD.AUTOMATIONS_CREATE, CREATE);
      const changed = yield* call(GATEWAY_METHOD.AUTOMATIONS_CHANGE, change);
      const ran = yield* call(GATEWAY_METHOD.AUTOMATIONS_RUN, {
        ...named,
        idempotencyKey: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
      });
      const runs = yield* call(GATEWAY_METHOD.AUTOMATIONS_RUNS, named);
      const deleted = yield* call(GATEWAY_METHOD.AUTOMATIONS_DELETE, named);

      assert.deepEqual(listed, { automations: [SUMMARY] });
      assert.deepEqual(made, { automation: SUMMARY });
      assert.deepEqual(changed, { automation: SUMMARY });
      assert.deepEqual(ran, { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(runs, { runs: [] });
      assert.deepEqual(deleted, { deleted: true });
      assert.deepEqual(asked.slice(0, 3), [
        ["list", { workspaceId: WORKSPACE_ID }],
        ["create", CREATE],
        ["change", change],
      ]);
    }),
);

it.effect("params of the wrong shape are refused before anything travels", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    const refused = yield* Effect.flip(
      call(GATEWAY_METHOD.AUTOMATIONS_RUN, { automationId: "not-an-id", idempotencyKey: "key" }),
    );

    assert.equal(refused._tag, "InvalidParamsRefusal");
    assert.deepEqual(asked, []);
  }),
);

it.effect(
  "a new webhook secret is minted here, only its hash is sent to the service, and the secret is answered to the window that asked; a refused replacement answers no secret",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      const refusing = yield* subject({ replaceRefused: true });
      const closed = yield* subject({ signedIn: false });
      const named = { automationId: AUTOMATION_ID };

      const made = yield* call(GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET, named);
      const refused = yield* refusing.call(GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET, named);
      const unasked = yield* closed.call(GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET, named);

      const read = readEither(automationViewSchema)(unparsedWire(made));
      const secret =
        Result.isSuccess(read) && "webhookSecret" in read.success
          ? (read.success.webhookSecret ?? "")
          : "";
      assert.match(
        secret,
        /^[A-Za-z0-9_-]{43}$/,
        "a secret of 32 random bytes is answered as unpadded base64url",
      );
      assert.deepEqual(made, { automation: SUMMARY, webhookSecret: secret });
      assert.deepEqual(asked, [
        [
          "replace",
          { ...named, webhookSecretHash: createHash("sha256").update(secret).digest("hex") },
        ],
      ]);
      assert.ok(!JSON.stringify(asked).includes(secret), "the service is sent the hash alone");
      assert.deepEqual(refused, { failure: AUTOMATION_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(unasked, { failure: AUTOMATION_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(closed.asked, []);
    }),
);

it.effect(
  "a webhook secret Web Crypto cannot hash is never sent, and the window hears the call unanswered",
  () =>
    Effect.gen(function* () {
      const { call, asked } = yield* subject();
      vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
        new DOMException("The operation is insecure.", "SecurityError"),
      );

      const answered = yield* call(GATEWAY_METHOD.AUTOMATIONS_NEW_WEBHOOK_SECRET, {
        automationId: AUTOMATION_ID,
      });

      assert.deepEqual(answered, { failure: AUTOMATION_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, []);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks()))),
);

it.effect(
  "a followed list is told as it stands for the account signed in, a gone automation's runs are told not found, and a sign-out ends the follows",
  () =>
    Effect.gen(function* () {
      const workspace = { kind: AUTOMATION_FOLLOW.WORKSPACE, id: WORKSPACE_ID };
      const runs = { kind: AUTOMATION_FOLLOW.RUNS, id: AUTOMATION_ID };
      const { call, asked, changed, reset } = yield* subject();

      assert.deepEqual(yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, workspace), {});
      yield* settled;
      assert.deepEqual(yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, runs), {});
      yield* settled;
      assert.deepEqual(changed(), [
        { scope: workspace, view: { automations: [] } },
        { scope: runs, view: { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND } },
      ]);
      assert.deepEqual(asked, [
        ["list-live", WORKSPACE_ID, ACCOUNT_ID],
        ["runs-live", AUTOMATION_ID, ACCOUNT_ID],
      ]);

      // Following again starts over, so a second window hears the list at once.
      yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, workspace);
      yield* settled;
      assert.equal(changed().length, 3);

      yield* reset;
      yield* settled;
      assert.equal(changed().length, 3);

      const signedOut = yield* subject();
      signedOut.live.list.refuse(LIVE_SIGNED_OUT);
      yield* signedOut.call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, workspace);
      yield* settled;
      assert.deepEqual(signedOut.changed(), []);
      assert.equal(signedOut.asked.length, 1);
    }),
);

it.effect(
  "an automation deleted while its runs are followed is told not found at once, and the follow ends",
  () =>
    Effect.gen(function* () {
      const runs = { kind: AUTOMATION_FOLLOW.RUNS, id: AUTOMATION_ID };
      const { call, asked, changed, live } = yield* subject();
      live.runs = POLLED_RUNS;
      live.runsPolled = { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND };

      yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, runs);
      yield* settled;

      assert.deepEqual(changed(), [
        { scope: runs, view: { runs: [] } },
        { scope: runs, view: { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND } },
      ]);
      assert.deepEqual(asked, [["runs-live", AUTOMATION_ID, ACCOUNT_ID]], "nothing asks again");
    }),
);

it.effect(
  "a switch turned stands from the press until the followed list carries its transaction, through an answer from before it, and a refused one is put back",
  () =>
    Effect.gen(function* () {
      const workspace = { kind: AUTOMATION_FOLLOW.WORKSPACE, id: WORKSPACE_ID };
      const { call, live, replies, listed } = yield* subject();
      live.list.set({ automations: [ROW] });
      yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, workspace);
      yield* settled;
      // An answer Luke Sync woke hands the follow its wait for a write's transaction.
      live.list.set({ automations: [ROW] }, ["1"]);
      yield* nextPoll;

      replies.change = { automation: { ...SUMMARY, enabled: false }, txid: "2" };
      const from = listed().length;
      const off = yield* Effect.forkChild(
        call(GATEWAY_METHOD.AUTOMATIONS_CHANGE, {
          automationId: AUTOMATION_ID,
          change: { enabled: false },
        }),
      );
      yield* settled;
      // Another window's rename from before the switch landed is answered without it.
      live.list.set({ automations: [{ ...ROW, name: "Triage" }] }, ["3"]);
      yield* nextPoll;
      live.list.set({ automations: [{ ...ROW, name: "Triage", enabled: false }] }, ["2"]);
      yield* nextPoll;

      assert.deepEqual(yield* Fiber.join(off), replies.change);
      assert.ok(listed().length > from);
      assert.deepEqual(
        listed()
          .slice(from)
          .filter((automations) => automations.some((each) => each.enabled)),
        [],
        "the switch is never drawn back on",
      );

      replies.change = { failure: AUTOMATION_CALL_FAILURE.NOT_PERMITTED };
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.AUTOMATIONS_CHANGE, {
          automationId: AUTOMATION_ID,
          change: { enabled: true },
        }),
        replies.change,
      );
      assert.deepEqual(listed().at(-1), [{ id: AUTOMATION_ID, enabled: false }]);
    }),
);

it.effect(
  "a new automation stands on its followed list as its create answers, before Luke Sync hands the list a wait",
  () =>
    Effect.gen(function* () {
      const workspace = { kind: AUTOMATION_FOLLOW.WORKSPACE, id: WORKSPACE_ID };
      const { call, listed } = yield* subject();
      yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, workspace);
      yield* settled;

      yield* call(GATEWAY_METHOD.AUTOMATIONS_CREATE, CREATE);

      assert.deepEqual(listed().at(-1), [{ id: AUTOMATION_ID, enabled: true }]);
    }),
);

it.effect("a Run now answers once its workspace's followed runs carry it, as its list does", () =>
  Effect.gen(function* () {
    const { call, live, replies } = yield* subject();
    live.list.set({ automations: [ROW] });
    yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, {
      kind: AUTOMATION_FOLLOW.WORKSPACE,
      id: WORKSPACE_ID,
    });
    yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, {
      kind: AUTOMATION_FOLLOW.WORKSPACE_RUNS,
      id: WORKSPACE_ID,
    });
    yield* settled;
    // Answers Luke Sync woke hand both follows their waits for a write's transaction.
    live.list.set({ automations: [ROW] }, ["1"]);
    live.workspaceRuns.set({ runs: [] }, ["1"]);
    yield* nextPoll;

    replies.run = { run: RUN, txid: "2" };
    let answered = false;
    const run = yield* Effect.forkChild(
      call(GATEWAY_METHOD.AUTOMATIONS_RUN, {
        automationId: AUTOMATION_ID,
        idempotencyKey: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            answered = true;
          }),
        ),
      ),
    );
    yield* settled;
    live.list.set({ automations: [{ ...ROW, runId: RUN.id }] }, ["2"]);
    yield* nextPoll;
    const outAfterList = !answered;
    live.workspaceRuns.set({ runs: [] }, ["2"]);
    yield* nextPoll;

    assert.ok(outAfterList, "the Run now still waits on the Runs tab");
    assert.deepEqual(yield* Fiber.join(run), replies.run);
  }),
);
