import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  createAutomation,
  listAutomationRuns,
  queuedAutomationRuns,
  updateAutomation,
} from "@luke/database/models/automation-store";
import { getTestDB, leaveWorkspace, startPlan } from "@luke/database/testing";
import { automationPath, automationWebhookPath, HOSTED_API_ERROR } from "@luke/features";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_TRIGGER,
  AUTOMATION_WEBHOOK,
  automationAnswerSchema,
} from "@luke/features/automation-wire";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { githubReaching, openGithubUser } from "../testing/github-app-fake.js";
import { automationWebhookApp } from "./automation-webhook-app.js";
import { automationsApp } from "./automations-app.js";

/**
 * An automation's webhook address, answered by its group the way a function
 * answers it, over a real dialect: a call under the trigger's secret, as a
 * bearer or as the address's token, queues one run with its body kept for
 * the agent; a retry under the same key queues none; a paused automation
 * takes the call and queues nothing; a body past the bound or not UTF-8 is
 * refused; and a wrong secret, an id that names no webhook, a secret
 * rotated away, and a departed owner's address are refused alike.
 * Synthetic accounts and words throughout.
 */

const ORIGIN = "https://luke.test";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The webhook group and the automation routes over the test's own database, a bearer naming its account directly. */
const standing = Effect.gen(function* () {
  const services = Layer.mergeAll(
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
    Layer.succeed(Database, yield* Database),
    Layer.succeed(Clock.Clock, yield* Clock.Clock),
    githubReaching([]).layer,
    modelCatalogOf([]),
  );
  const webhook = HttpRouter.toWebHandler(
    automationWebhookApp().pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );
  const automations = HttpRouter.toWebHandler(
    automationsApp({
      resolveUserId: (incoming: Request) =>
        Effect.succeed(
          Option.fromNullishOr(incoming.headers.get("authorization")?.replace("Bearer ", "")),
        ),
      eveOrigin: () => undefined,
    }).pipe(HttpRouter.provideRequest(services)),
    { disableLogger: true },
  );
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => Promise.all([webhook.dispose(), automations.dispose()])),
  );
  /** A request as the rewrite hands it on: the path's id moved into the `id` query. */
  const ask = (path: string, init: RequestInit & { readonly query?: string } = {}) =>
    Effect.gen(function* () {
      const [, id, tail] = /^\/api\/automations\/([^/]+)(?:\/(.+))?$/u.exec(path) ?? [];
      const routed = `/api/automations/${tail ?? "automation"}?id=${id}${init.query ?? ""}`;
      const handler = tail === "webhook" ? webhook.handler : automations.handler;
      const response = yield* Effect.promise(() =>
        handler(new Request(`${ORIGIN}${routed}`, init)),
      );
      // SAFETY: the groups answer JSON; the test reads it as the wire value it is.
      const body = (yield* Effect.promise(() => response.json())) as WireBoundaryInput;
      return { status: response.status, body } satisfies Answer;
    });
  return { ask };
});

/** An owner with a webhook automation on a workspace, and its secret as the routes would have answered it. */
const openWebhook = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const plan = yield* startPlan(owner, { name: "Alerts", repository: null });
  const secret = randomBytes(32).toString("base64url");
  const made = yield* createAutomation(owner, {
    planId: null,
    organizationId: plan.workspaceId,
    repositories: ["Acme/Relay"],
    name: "Fix Sentry alerts",
    trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
    action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: "Fix the error the alert names." },
    guards: AUTOMATION_DEFAULT_GUARDS,
    nextRunAt: null,
    webhookSecretHash: createHash("sha256").update(secret).digest("hex"),
  });
  return { owner, automation: Option.getOrThrow(made), secret, workspaceId: plan.workspaceId };
});

const ALERT = JSON.stringify({ title: "TypeError in checkout", culprit: "cart.ts" });

const call = (secret: string, init: { readonly key?: string; readonly body?: string } = {}) => ({
  method: "POST",
  headers: {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
    ...(init.key === undefined ? undefined : { [AUTOMATION_WEBHOOK.IDEMPOTENCY_HEADER]: init.key }),
  },
  body: init.body ?? ALERT,
});

const INVALID = {
  status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
  body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
};

it.layer(getTestDB())("an automation's webhook", (it) => {
  it.effect(
    "a call under the secret queues one run with its body, a retry under the same key queues none, and the token query admits a sender that sets no header",
    () =>
      Effect.gen(function* () {
        const { owner, automation, secret } = yield* openWebhook;
        const { ask } = yield* standing;
        const path = automationWebhookPath(automation.id);
        const key = randomUUID();

        const first = yield* ask(path, call(secret, { key }));
        const retry = yield* ask(path, call(secret, { key }));
        const byToken = yield* ask(path, {
          method: "POST",
          body: "plain text",
          query: `&${AUTOMATION_WEBHOOK.TOKEN_QUERY}=${secret}`,
        });

        assert.deepEqual(
          [first, retry, byToken],
          [
            { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 1 } },
            { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 0 } },
            { status: HOSTED_HTTP_STATUS.ACCEPTED, body: { queued: 1 } },
          ],
        );
        // The body rides only the queued run the sweep acts on, so it is read as the sweep reads it.
        const queued = (yield* queuedAutomationRuns(new Date(0), 100)).filter(
          (run) => run.automationId === automation.id,
        );
        assert.equal((yield* listAutomationRuns(owner, automation.id)).length, 2);
        assert.deepEqual(
          queued.map((run) => [run.firing, run.payload]).sort(),
          [
            [{ kind: AUTOMATION_FIRING.WEBHOOK, bytes: ALERT.length }, ALERT],
            [{ kind: AUTOMATION_FIRING.WEBHOOK, bytes: "plain text".length }, "plain text"],
          ].sort(),
        );
      }),
  );

  it.effect(
    "a wrong secret, an id that names no webhook, no secret, and a secret rotated away are refused alike, and a paused automation queues nothing",
    () =>
      Effect.gen(function* () {
        const { owner, automation, secret } = yield* openWebhook;
        const { ask } = yield* standing;
        const path = automationWebhookPath(automation.id);

        assert.deepEqual(yield* ask(path, call("not-the-secret")), INVALID);
        assert.deepEqual(yield* ask(automationWebhookPath(randomUUID()), call(secret)), INVALID);
        assert.deepEqual(yield* ask(path, { method: "POST", body: ALERT }), INVALID);

        const rotated = yield* ask(automationPath(automation.id), {
          method: "PATCH",
          headers: { authorization: `Bearer ${owner}`, "content-type": "application/json" },
          body: JSON.stringify({ rotateWebhookSecret: true }),
        });
        assert.equal(rotated.status, HOSTED_HTTP_STATUS.OK);
        const read = readEither(automationAnswerSchema)(unparsedWire(rotated.body));
        const fresh = Result.isSuccess(read) ? (read.success.webhookSecret ?? "") : "";
        assert.ok(fresh.length > 0, "a fresh secret is answered once");
        assert.deepEqual(yield* ask(path, call(secret)), INVALID, "the secret before stops");
        assert.deepEqual(yield* ask(path, call(fresh)), {
          status: HOSTED_HTTP_STATUS.ACCEPTED,
          body: { queued: 1 },
        });

        yield* updateAutomation(owner, automation.id, { enabled: false });
        assert.deepEqual(yield* ask(path, call(fresh)), {
          status: HOSTED_HTTP_STATUS.OK,
          body: { queued: 0 },
        });
        assert.equal((yield* listAutomationRuns(owner, automation.id)).length, 1);
      }),
  );

  it.effect(
    "a body past the bound or not UTF-8 is refused, and a rotation asked of an automation that is no webhook is refused",
    () =>
      Effect.gen(function* () {
        const { owner, automation, secret } = yield* openWebhook;
        const { ask } = yield* standing;
        const path = automationWebhookPath(automation.id);

        const tooLarge = yield* ask(
          path,
          call(secret, { body: "x".repeat(AUTOMATION_WEBHOOK.MAX_BODY_BYTES + 1) }),
        );
        const binary = yield* ask(path, {
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body: new Uint8Array([0xff, 0xfe, 0x00, 0x41]),
        });
        yield* updateAutomation(owner, automation.id, {
          trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * *", timezone: "UTC" },
        });
        const notWebhook = yield* ask(automationPath(automation.id), {
          method: "PATCH",
          headers: { authorization: `Bearer ${owner}`, "content-type": "application/json" },
          body: JSON.stringify({ rotateWebhookSecret: true }),
        });

        assert.equal(tooLarge.status, HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE);
        assert.deepEqual(binary.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
        assert.equal(notWebhook.status, HOSTED_HTTP_STATUS.BAD_REQUEST);
        assert.equal((yield* listAutomationRuns(owner, automation.id)).length, 0);
      }),
  );

  it.effect(
    "a retry key of any length names one run, and a short key that spells a long key's digest is a call of its own",
    () =>
      Effect.gen(function* () {
        const { owner, automation, secret } = yield* openWebhook;
        const { ask } = yield* standing;
        const path = automationWebhookPath(automation.id);
        const long = "k".repeat(500);
        const digest = createHash("sha256").update(long).digest("hex");

        const answers = [
          yield* ask(path, call(secret, { key: long })),
          yield* ask(path, call(secret, { key: long })),
          yield* ask(path, call(secret, { key: digest })),
        ];

        assert.deepEqual(
          answers.map((each) => each.body),
          [{ queued: 1 }, { queued: 0 }, { queued: 1 }],
        );
        assert.equal((yield* listAutomationRuns(owner, automation.id)).length, 2);
      }),
  );

  it.effect("a departed owner's address answers as no automation and records nothing", () =>
    Effect.gen(function* () {
      const { owner, automation, secret, workspaceId } = yield* openWebhook;
      const { ask } = yield* standing;
      yield* leaveWorkspace(workspaceId, owner);

      assert.deepEqual(yield* ask(automationWebhookPath(automation.id), call(secret)), INVALID);
      const queued = (yield* queuedAutomationRuns(new Date(0), 100)).filter(
        (run) => run.automationId === automation.id,
      );
      assert.deepEqual(queued, []);
    }),
  );
});
