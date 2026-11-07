import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import { STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import {
  AUTOMATION_RUNS_READ,
  AUTOMATION_WORKSPACE_RUNS_READ,
  AUTOMATIONS_READ,
  type AutomationRunsLiveAnswer,
  type AutomationRunsLiveRows,
  type AutomationsLiveRows,
} from "@repo/features/automation-live";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationFollow,
} from "@repo/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
} from "@repo/features/automation-wire";
import { LIVE_POLL_URL, LIVE_READ, LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import { GATEWAY_EVENT, type GatewayEventKind } from "@repo/gateway";
import { entityPool } from "@repo/sync";
import type { WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Deferred, Duration, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import { vi } from "vitest";
import type { AppAutomationReads } from "./app-state.js";
import { type AutomationsClient, composeAutomations } from "./compose-automations.js";
import { type PolledLive, polledLive } from "./testing/polled-live.js";
import { tellingsOf } from "./testing/told-live.js";

/**
 * The automations concern: behind a closed gate nothing is asked of the
 * service, a write's params reach the service as the window named them,
 * the window hears the service's answer whole, and params of the wrong
 * shape are refused before anything travels. What a window holds is laid
 * on its app-state slice as it stands and each time it moves, for the
 * account signed in as it started, until let go for good or signed out.
 * Synthetic ids and words.
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
  slackDelivery: false,
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

/** A run whose agent started at the clock's first instant and has taken no turn yet, as the runs' statement answers it. */
const STARTING_RUN: AutomationRunsLiveRows["runs"][number] = {
  id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8e",
  firing: { kind: AUTOMATION_FIRING.MANUAL, userId: ACCOUNT_ID },
  status: AUTOMATION_RUN_STATUS.STARTED,
  reason: null,
  firedAt: 0,
  settledAt: 0,
  agentId: "agent-1",
  agentTitle: null,
  agentCreatedAt: 0,
  ownKey: false,
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
  /** What a change, a create, and a Run now answer, and what a create waits on before it answers, which a test may replace. */
  const replies: {
    change: Effect.Success<ReturnType<AutomationsClient["change"]>>;
    create: Effect.Success<ReturnType<AutomationsClient["create"]>>;
    createAnswered: Effect.Effect<void>;
    run: Effect.Success<ReturnType<AutomationsClient["runNow"]>>;
  } = {
    change: { automation: SUMMARY },
    create: { automation: SUMMARY },
    createAnswered: Effect.void,
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
    create: (params) =>
      Effect.andThen(
        Effect.suspend(() => replies.createAnswered),
        answer("create", () => replies.create)(params),
      ),
    change: answer("change", () => replies.change),
    remove: answer("remove", () => ({ deleted: true }) as const),
    runNow: answer("run", () => replies.run),
    replaceWebhookSecret: answer("replace", () =>
      options.replaceRefused === true
        ? { failure: AUTOMATION_CALL_FAILURE.NOT_PERMITTED }
        : { automation: SUMMARY },
    ),
    // SAFETY: each declared read the client is asked for answers its own script's rows, as its declaration's answer.
    liveRead: ((
      read: { readonly name: string },
      params: { readonly workspaceId?: string; readonly id?: string; readonly userId?: string },
      poll?: { readonly after?: string | undefined },
    ) =>
      Effect.suspend((): Effect.Effect<unknown> => {
        switch (read.name) {
          case AUTOMATIONS_READ.name:
            return poll !== undefined
              ? live.list.poll(poll.after)
              : Effect.sync(() => {
                  asked.push(["list-live", params.workspaceId, params.userId]);
                  return live.list.first();
                });
          case AUTOMATION_RUNS_READ.name:
            return poll !== undefined
              ? live.runsPolled === undefined
                ? Effect.never
                : // A poll is held a while before it answers, as the service holds one.
                  Effect.as(Effect.repeat(Effect.yieldNow, { times: 20 }), live.runsPolled)
              : Effect.sync(() => {
                  asked.push(["runs-live", params.id, params.userId]);
                  return live.runs ?? { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND };
                });
          case AUTOMATION_WORKSPACE_RUNS_READ.name:
            return poll !== undefined
              ? live.workspaceRuns.poll(poll.after)
              : Effect.sync(() => live.workspaceRuns.first());
          default:
            return assert.fail(`no script answers the live read ${read.name}`);
        }
      })) as AutomationsClient["liveRead"],
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
        // Note that the id the host mints for a new automation is the one the service answers it under.
        createId: () => AUTOMATION_ID,
        hostedServiceBaseUrl: "https://service.example",
        emit: (kind, payload) => emitted.push({ kind, payload }),
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      accountId: () => (options.signedIn === false ? undefined : ACCOUNT_ID),
      client: service.client,
      pool: yield* entityPool(),
    }).pipe(Effect.provide(noNetwork));
    /** One window's hold on what `key` names, for the caller's scope. */
    const hold = (key: AutomationFollow) => composer.acts.AUTOMATIONS_FOLLOW.hold(key);
    /** Each time `read`'s slice was told, in order. */
    const toldOf = <Read extends keyof AppAutomationReads>(read: Read) =>
      // SAFETY: the host tells each automations slice whole, as built.
      tellingsOf(emitted, read) as AppAutomationReads[Read][];
    /** What the held reads told the windows' app state, in order. */
    const told = () =>
      emitted.flatMap((each) =>
        each.kind === GATEWAY_EVENT.LIVE_READ_CHANGED ? [each.payload] : [],
      );
    /** The workspace's list as each tell laid it, by its automations' ids and whether each is on, where it held rows. */
    const listed = () =>
      toldOf(LIVE_READ.AUTOMATIONS).flatMap((held) => {
        const automations = held[WORKSPACE_ID]?.rows;
        return automations === undefined
          ? []
          : [automations.map(({ id, enabled }) => ({ id, enabled }))];
      });
    return {
      hold,
      /** The composer's declared acts, each handed its input as the port reads it. */
      acts: composer.acts,
      asked: service.asked,
      live: service.live,
      replies: service.replies,
      told,
      toldOf,
      listed,
      open: composer.open,
      reset: composer.reset,
      options,
    };
  });
}

const WORKSPACE = { kind: AUTOMATION_FOLLOW.WORKSPACE, id: WORKSPACE_ID } as const;
const RUNS = { kind: AUTOMATION_FOLLOW.RUNS, id: AUTOMATION_ID } as const;

it.effect("behind a closed account gate, or on a run that sends nothing, nothing is asked", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
      const { hold, acts, asked, told } = yield* subject(options);
      yield* hold(WORKSPACE);
      yield* settled;
      assert.deepEqual(yield* acts.AUTOMATIONS_CREATE(CREATE), {
        failure: AUTOMATION_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(asked, []);
      assert.deepEqual(told(), []);
    }
  }),
);

it.effect(
  "a write's params reach the service as the window named them, a new automation under the id the host minted, and the window hears the answer whole",
  () =>
    Effect.gen(function* () {
      const { acts, asked } = yield* subject();
      const named = { automationId: AUTOMATION_ID };
      const change = { ...named, change: { enabled: false } };

      const made = yield* acts.AUTOMATIONS_CREATE(CREATE);
      const changed = yield* acts.AUTOMATIONS_CHANGE(change);
      const ran = yield* acts.AUTOMATIONS_RUN({
        ...named,
        idempotencyKey: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
      });
      const deleted = yield* acts.AUTOMATIONS_DELETE(named);

      assert.deepEqual(made, { automation: SUMMARY });
      assert.deepEqual(changed, { automation: SUMMARY });
      assert.deepEqual(ran, { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(deleted, { deleted: true });
      assert.deepEqual(asked.slice(0, 2), [
        ["create", { ...CREATE, id: AUTOMATION_ID }],
        ["change", change],
      ]);
    }),
);

it.effect(
  "a new webhook secret is minted here, only its hash is sent to the service, and the secret is answered to the window that asked, as a webhook's made or changed to is, never on app state; a refused replacement answers no secret",
  () =>
    Effect.gen(function* () {
      const { hold, acts, asked, live, replies, told } = yield* subject();
      const refusing = yield* subject({ replaceRefused: true });
      const closed = yield* subject({ signedIn: false });
      const named = { automationId: AUTOMATION_ID };
      const webhook = { ...SUMMARY, trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } } as const;
      live.list.set({ automations: [ROW] });
      yield* hold(WORKSPACE);
      yield* settled;
      replies.create = {
        automation: { ...webhook, id: "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e" },
        webhookSecret: "secret-the-service-made",
      };
      replies.change = { automation: webhook, webhookSecret: "secret-a-change-made" };

      const created = yield* acts.AUTOMATIONS_CREATE({
        ...CREATE,
        trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
      });
      const changed = yield* acts.AUTOMATIONS_CHANGE({
        ...named,
        change: { trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } },
      });
      const made = yield* acts.AUTOMATIONS_NEW_WEBHOOK_SECRET(named);
      const refused = yield* refusing.acts.AUTOMATIONS_NEW_WEBHOOK_SECRET(named);
      const unasked = yield* closed.acts.AUTOMATIONS_NEW_WEBHOOK_SECRET(named);

      const secret = "webhookSecret" in made ? (made.webhookSecret ?? "") : "";
      assert.match(
        secret,
        /^[A-Za-z0-9_-]{43}$/,
        "a secret of 32 random bytes is answered as unpadded base64url",
      );
      assert.deepEqual(made, { automation: SUMMARY, webhookSecret: secret });
      assert.deepEqual(created, replies.create);
      assert.deepEqual(changed, replies.change);
      assert.deepEqual(
        asked.filter((each) => Array.isArray(each) && each[0] === "replace"),
        [
          [
            "replace",
            { ...named, webhookSecretHash: createHash("sha256").update(secret).digest("hex") },
          ],
        ],
      );
      assert.ok(!JSON.stringify(asked).includes(secret), "the service is sent the hash alone");
      assert.ok(told().length > 1, "the writes were drawn on the held list");
      for (const minted of [secret, "secret-the-service-made", "secret-a-change-made"]) {
        assert.ok(!JSON.stringify(told()).includes(minted), "no window's app state holds a secret");
      }
      assert.deepEqual(refused, { failure: AUTOMATION_CALL_FAILURE.NOT_PERMITTED });
      assert.deepEqual(unasked, { failure: AUTOMATION_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(closed.asked, []);
    }),
);

it.effect(
  "a webhook secret Web Crypto cannot hash is never sent, and the window hears the call unanswered",
  () =>
    Effect.gen(function* () {
      const { acts, asked } = yield* subject();
      vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
        new DOMException("The operation is insecure.", "SecurityError"),
      );

      const answered = yield* acts.AUTOMATIONS_NEW_WEBHOOK_SECRET({
        automationId: AUTOMATION_ID,
      });

      assert.deepEqual(answered, { failure: AUTOMATION_CALL_FAILURE.UNANSWERED });
      assert.deepEqual(asked, []);
    }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks()))),
);

it.effect(
  "a held list is laid as it stands for the account signed in, a gone automation's runs are laid failed, and a sign-out lets every follow go and lays none",
  () =>
    Effect.gen(function* () {
      const { hold, asked, toldOf, reset } = yield* subject();

      yield* hold(WORKSPACE);
      yield* settled;
      yield* hold(RUNS);
      yield* settled;
      assert.deepEqual(toldOf(LIVE_READ.AUTOMATIONS).at(-1), { [WORKSPACE_ID]: { rows: [] } });
      assert.deepEqual(toldOf(LIVE_READ.AUTOMATION_RUNS).at(-1), {
        [AUTOMATION_ID]: { failed: true },
      });
      assert.deepEqual(asked, [
        ["list-live", WORKSPACE_ID, ACCOUNT_ID],
        ["runs-live", AUTOMATION_ID, ACCOUNT_ID],
      ]);

      yield* reset;
      yield* settled;
      assert.deepEqual(toldOf(LIVE_READ.AUTOMATIONS).at(-1), {});
      assert.deepEqual(toldOf(LIVE_READ.AUTOMATION_RUNS).at(-1), {});

      const signedOut = yield* subject();
      signedOut.live.list.refuse(LIVE_SIGNED_OUT);
      yield* signedOut.hold(WORKSPACE);
      yield* settled;
      assert.deepEqual(signedOut.told(), []);
      assert.equal(signedOut.asked.length, 1);
    }),
);

it.effect("two holds of a list and a remount read it once", () =>
  Effect.gen(function* () {
    const { hold, asked, listed } = yield* subject();

    const remounted = yield* Scope.make();
    yield* hold(WORKSPACE).pipe(Scope.provide(remounted));
    yield* hold(WORKSPACE);
    yield* settled;
    yield* Scope.close(remounted, Exit.void);
    yield* hold(WORKSPACE);
    yield* settled;

    assert.deepEqual(asked, [["list-live", WORKSPACE_ID, ACCOUNT_ID]]);
    assert.deepEqual(listed(), [[]]);
  }),
);

it.effect(
  "an automation deleted while its runs are held keeps them laid as they stood, and the follow ends without asking again",
  () =>
    Effect.gen(function* () {
      const { hold, asked, toldOf, live } = yield* subject();
      live.runs = POLLED_RUNS;
      live.runsPolled = { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND };

      yield* hold(RUNS);
      yield* settled;

      assert.deepEqual(toldOf(LIVE_READ.AUTOMATION_RUNS), [{ [AUTOMATION_ID]: { rows: [] } }]);
      assert.deepEqual(asked, [["runs-live", AUTOMATION_ID, ACCOUNT_ID]], "nothing asks again");
    }),
);

it.effect("a run's agent passing its grace with no row moving is redrawn on the held runs", () =>
  Effect.gen(function* () {
    const { hold, toldOf, live } = yield* subject();
    const rows = POLLED_RUNS.queries.runs;
    live.runs = { ...POLLED_RUNS, queries: { runs: { ...rows, rows: [STARTING_RUN] } } };
    yield* hold(RUNS);
    yield* settled;
    const statuses = () =>
      toldOf(LIVE_READ.AUTOMATION_RUNS).map((held) =>
        held[AUTOMATION_ID]?.rows?.map((run) => run.agent?.status),
      );
    assert.deepEqual(statuses(), [[AGENT_STATUS.STARTING]]);

    yield* TestClock.adjust(Duration.millis(STARTING_GRACE_MILLIS + 1));
    yield* settled;

    assert.deepEqual(statuses(), [[AGENT_STATUS.STARTING], [AGENT_STATUS.FAILED]]);
  }),
);

it.effect(
  "a switch turned stands from the press until the held list carries its transaction, through an answer from before it, and a refused one is put back",
  () =>
    Effect.gen(function* () {
      const { hold, acts, live, replies, listed } = yield* subject();
      live.list.set({ automations: [ROW] });
      yield* hold(WORKSPACE);
      yield* settled;
      // An answer Sync woke hands the follow its wait for a write's transaction.
      live.list.set({ automations: [ROW] }, ["1"]);
      yield* nextPoll;

      replies.change = { automation: { ...SUMMARY, enabled: false }, txid: "2" };
      const from = listed().length;
      const off = yield* Effect.forkChild(
        acts.AUTOMATIONS_CHANGE({
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
        yield* acts.AUTOMATIONS_CHANGE({
          automationId: AUTOMATION_ID,
          change: { enabled: true },
        }),
        replies.change,
      );
      assert.deepEqual(listed().at(-1), [{ id: AUTOMATION_ID, enabled: false }]);
    }),
);

it.effect(
  "a new automation stands on its held list from the press, before the service answers, and one the service refused is taken back",
  () =>
    Effect.gen(function* () {
      const { hold, acts, listed, replies } = yield* subject();
      yield* hold(WORKSPACE);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      replies.createAnswered = Deferred.await(answered);
      replies.create = { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND };

      const create = yield* Effect.forkChild(acts.AUTOMATIONS_CREATE(CREATE));
      yield* settled;
      const drawn = listed().at(-1);
      yield* Deferred.succeed(answered, undefined);
      const refused = yield* Fiber.join(create);

      assert.deepEqual(drawn, [{ id: AUTOMATION_ID, enabled: true }], "drawn before it answers");
      assert.deepEqual(refused, { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND });
      assert.deepEqual(listed().at(-1), [], "taken back once refused");
    }),
);

it.effect("a Run now answers once its workspace's held runs carry it, as its list does", () =>
  Effect.gen(function* () {
    const { hold, acts, live, replies } = yield* subject();
    live.list.set({ automations: [ROW] });
    yield* hold(WORKSPACE);
    yield* hold({
      kind: AUTOMATION_FOLLOW.WORKSPACE_RUNS,
      id: WORKSPACE_ID,
    });
    yield* settled;
    // Answers Sync woke hand both follows their waits for a write's transaction.
    live.list.set({ automations: [ROW] }, ["1"]);
    live.workspaceRuns.set({ runs: [] }, ["1"]);
    yield* nextPoll;

    replies.run = { run: RUN, txid: "2" };
    let answered = false;
    const run = yield* Effect.forkChild(
      acts
        .AUTOMATIONS_RUN({
          automationId: AUTOMATION_ID,
          idempotencyKey: "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3",
        })
        .pipe(
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
