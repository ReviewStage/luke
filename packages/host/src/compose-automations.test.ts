import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import type { AutomationRunsLiveAnswer } from "@luke/features/automation-live";
import {
  AUTOMATION_CALL_FAILURE,
  AUTOMATION_FOLLOW,
  type AutomationFollowed,
  automationFollowedSchema,
  automationViewSchema,
} from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { CODING_AGENT_FAILURE, CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethod,
} from "@luke/gateway";
import { unparsedWire, type WireRecord } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Duration, Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { type AutomationsClient, composeAutomations } from "./compose-automations.js";
import type { LiveClient } from "./live-follow.js";

/**
 * The automations concern: behind a closed gate nothing is asked of the
 * service, a write's params reach the service as the window named them,
 * the window hears the service's answer whole, and params of the wrong
 * shape are refused before anything travels. Synthetic ids and words.
 */

const AUTOMATION_ID = "3f0e6f5c-7d1a-4f6e-9a55-1b2c3d4e5f60";
const WORKSPACE_ID = "workspace-1";

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
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Triage the issues opened today." },
  guards: AUTOMATION_DEFAULT_GUARDS,
  nextRunAt: 10,
  lastRun: null,
  createdAt: 1,
} as const;

const CREATE = {
  workspaceId: WORKSPACE_ID,
  repositories: ["acme/web"],
  name: SUMMARY.name,
  trigger: SCHEDULE,
  action: SUMMARY.action,
};

/** The service as a script that writes down every ask it hears, as the ask runs. */
function fakeService(
  options: { replaceRefused?: boolean; runsLive?: AutomationRunsLiveAnswer } = {},
) {
  const asked: unknown[] = [];
  const answer =
    <A>(name: string, value: A) =>
    (params: Parameters<AutomationsClient[keyof AutomationsClient]>[0]) =>
      Effect.sync(() => {
        asked.push([name, params]);
        return value;
      });
  const client: AutomationsClient = {
    list: answer("list", { automations: [SUMMARY] }),
    create: answer("create", { automation: SUMMARY }),
    change: answer("change", { automation: SUMMARY }),
    remove: answer("remove", { deleted: true } as const),
    runNow: answer("run", { failure: AUTOMATION_CALL_FAILURE.NOT_FOUND }),
    runs: answer("runs", { runs: [] }),
    replaceWebhookSecret: answer(
      "replace",
      options.replaceRefused === true
        ? { failure: AUTOMATION_CALL_FAILURE.NOT_PERMITTED }
        : { automation: SUMMARY },
    ),
    listLive: answer("listLive", { failure: AUTOMATION_CALL_FAILURE.UNANSWERED }),
    runsLive: answer(
      "runsLive",
      options.runsLive ?? { failure: AUTOMATION_CALL_FAILURE.UNANSWERED },
    ),
  };
  return { client, asked };
}

function subject(
  options: {
    signedIn?: boolean;
    sendsNetwork?: boolean;
    replaceRefused?: boolean;
    runsLive?: AutomationRunsLiveAnswer;
    openLive?: (url: string) => LiveClient;
  } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(options);
    const followed: AutomationFollowed[] = [];
    const composer = yield* composeAutomations({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        now: () => LIVE_NOW,
        hostedServiceBaseUrl: "https://luke.test",
        emit: (kind, payload) => {
          if (kind !== GATEWAY_EVENT.AUTOMATIONS_CHANGED) return;
          const read = readEither(automationFollowedSchema)(payload);
          assert.ok(Result.isSuccess(read), "the event carries what was followed");
          followed.push(read.success);
        },
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
      ...(options.openLive === undefined ? undefined : { openLive: options.openLive }),
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, asked: service.asked, followed };
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
      assert.ok(secret.length >= 40, "a secret of 32 random bytes is answered");
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

/** The host's clock, which renewals are timed by and the test's clock is set to. */
const LIVE_NOW = 1_800_000_000_000;

/** Lets what was delivered or read reach the events, through the fibers that carry it. */
const settled = Effect.repeat(Effect.yieldNow, { times: 20 });

/** Realtime as a script: each subscription by its capability, and a way to deliver its rows. */
function fakeRealtime() {
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const open = (): LiveClient => ({
    subscribe: (query) => ({
      onChange: (listener) => {
        listeners.set(query.capability, listener);
        return () => listeners.delete(query.capability);
      },
      renew: () => Promise.resolve(),
      unsubscribe: () => void listeners.delete(query.capability),
    }),
    close: () => undefined,
  });
  const deliver = (capability: string, data: readonly unknown[]) => {
    const listener = listeners.get(capability);
    assert.ok(listener, `no subscription to ${capability}`);
    listener({ status: "live", data });
  };
  return { open, deliver, subscribed: () => [...listeners.keys()] };
}

it.effect(
  "a workspace the service seals nothing for is read for its follower at once and each minute after, and nothing once it is let go",
  () =>
    Effect.gen(function* () {
      const { call, asked, followed } = yield* subject();
      const scope = { kind: AUTOMATION_FOLLOW.WORKSPACE, id: WORKSPACE_ID };

      yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, scope);
      yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, scope);
      yield* settled;
      assert.deepEqual(followed, [{ scope, view: { automations: [SUMMARY] } }]);
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;
      assert.equal(followed.length, 2);

      yield* call(GATEWAY_METHOD.AUTOMATIONS_UNFOLLOW, scope);
      yield* TestClock.adjust(Duration.minutes(3));
      assert.equal(followed.length, 2);
      assert.equal(asked.filter((each) => Array.isArray(each) && each[0] === "list").length, 2);
    }),
);

it.effect(
  "an automation's runs the service seals are pushed from their live rows, a run's agent read failed once its grace ends, with no read on a clock",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(LIVE_NOW);
      const realtime = fakeRealtime();
      const runsLive: AutomationRunsLiveAnswer = {
        url: "wss://realtime.example/v1",
        queries: {
          runs: { capability: "runs", queryFingerprint: "runs", expiresAt: LIVE_NOW + 60_000 },
        },
      };
      const { call, asked, followed } = yield* subject({ runsLive, openLive: realtime.open });
      const scope = { kind: AUTOMATION_FOLLOW.RUNS, id: AUTOMATION_ID };

      yield* call(GATEWAY_METHOD.AUTOMATIONS_FOLLOW, scope);
      yield* settled;
      realtime.deliver("runs", [
        {
          id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
          firing: { kind: AUTOMATION_FIRING.MANUAL },
          status: AUTOMATION_RUN_STATUS.STARTED,
          reason: null,
          firedAt: LIVE_NOW - 60_000,
          settledAt: LIVE_NOW - 60_000,
          agentId: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
          agentTitle: null,
          agentCreatedAt: LIVE_NOW - 60_000,
          ownKey: true,
          turnId: null,
          turnStatus: null,
          cancelRequested: null,
          lineAwaits: false,
          failureWord: CODING_AGENT_FAILURE.NOT_STARTED,
        },
      ]);
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(5));
      yield* settled;

      const agents = followed.map(({ view }) =>
        "runs" in view ? view.runs.map((run) => [run.agent?.status, run.agent?.failureReason]) : [],
      );
      assert.deepEqual(agents, [
        [[CODING_AGENT_STATUS.STARTING, undefined]],
        [[CODING_AGENT_STATUS.FAILED, CODING_AGENT_FAILURE.NOT_STARTED]],
      ]);
      assert.equal(asked.filter((each) => Array.isArray(each) && each[0] === "runs").length, 0);
    }),
);
