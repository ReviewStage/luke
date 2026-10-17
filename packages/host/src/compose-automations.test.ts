import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "@effect/vitest";
import { AUTOMATION_CALL_FAILURE, automationViewSchema } from "@luke/features/automation-view";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@luke/gateway";
import { unparsedWire, type WireRecord } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { noNetwork } from "@luke/wire/testing";
import { Effect, Result } from "effect";
import { type AutomationsClient, composeAutomations } from "./compose-automations.js";

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
function fakeService(options: { replaceRefused?: boolean } = {}) {
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
  };
  return { client, asked };
}

function subject(
  options: { signedIn?: boolean; sendsNetwork?: boolean; replaceRefused?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(options);
    const composer = yield* composeAutomations({
      kernel: { runMode: { sendsNetwork: options.sendsNetwork ?? true } },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      client: service.client,
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    return { call, asked: service.asked };
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
