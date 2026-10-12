import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { type CatalogModel, MODEL_PROVIDER, type ModelChoice } from "@sidecar/hosted/models-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
  planTemplateAnswerSchema,
} from "@sidecar/hosted/plan-document-template";
import { LIVE_VOICE } from "@sidecar/live";
import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Duration, Effect, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { accountApp } from "../server/account-app";
import { user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import {
  deleteAccount,
  readAccountPreferences,
  readPlanTemplate,
  writeAccountPreferences,
  writePlanTemplate,
} from "../server/hosted/account-store";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { CODING_AGENT_DEFAULT_CHOICE, modelCatalogOf } from "../server/hosted/model-catalog";
import { noNetwork } from "./support/no-network";
import { testSqlClient } from "./support/sql-client";

/**
 * The account's plan template, answered by the account group the way its
 * function answers it, over a real dialect: the default until the account
 * keeps its own, the account's own kept verbatim, a reset back to the
 * default, and a write that leaves the preferences snapshot beside it
 * exactly as it stood. The bearer names the account and nothing else does.
 *
 * Synthetic accounts and bearers throughout.
 */

const ORIGIN = "https://luke.test";
const PLAN_TEMPLATE_PATH = "/api/account/plan-template";
const PREFERENCES_PATH = "/api/account/preferences";

const NO_ENVIRONMENT: HostedEnvironmentValues = {
  openAiKey: undefined,
  anthropicKey: undefined,
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: undefined,
};

/** The catalog a coding-agent choice is checked against: the default model and one other. */
const CATALOG: readonly CatalogModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "xhigh", "max"],
  },
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "medium", "high"],
  },
];

const SOL_AT_HIGH = { model: "openai/gpt-6.1-sol", effort: "high" } as const satisfies ModelChoice;

/** A template with the edges a trim would take, so verbatim is what is checked. */
const OWN_TEMPLATE = "\n## Why\n\nWhat prompted this.  \n\n## Done when\n\n  - \n";

const DEFAULT_ANSWER: PlanTemplateAnswer = { template: DEFAULT_PLAN_TEMPLATE, custom: false };

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts behind their own bearers, and the group answering on the test's database and clock. */
const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  const bearers = new Map([
    [`Bearer ${owner}`, owner],
    [`Bearer ${other}`, other],
  ]);
  const app = accountApp({
    resolveUserId: (incoming) =>
      Effect.succeed(
        Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
      ),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    writePreferences: writeAccountPreferences,
    readPlanTemplate,
    writePlanTemplate,
  });
  const ask = (request: Request) => answer(app, request);
  return { owner, other, ask };
});

const answer = (app: ReturnType<typeof accountApp>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The handler runs on the router's own fiber, so it is handed the test's clock and services.
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, client),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      noNetwork,
      modelCatalogOf(CATALOG),
    );
    const { handler, dispose } = HttpRouter.toWebHandler(
      app.pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    const response = yield* Effect.promise(() => handler(request));
    const text = yield* Effect.promise(() => response.text());
    yield* Effect.promise(() => dispose());
    // SAFETY: the group answers JSON; the test compares it as the wire value it is.
    const body = JSON.parse(text) as WireBoundaryInput;
    return { status: response.status, body } satisfies Answer;
  });

function request(
  path: string,
  userId: string | undefined,
  init: { method?: string; body?: WireBoundaryInput } = {},
) {
  return new Request(new URL(path, ORIGIN), {
    method: init.method ?? HTTP_METHOD.GET,
    headers: userId === undefined ? {} : { authorization: `Bearer ${userId}` },
    ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
  });
}

const readTemplate = (userId: string) => request(PLAN_TEMPLATE_PATH, userId);

const writeTemplate = (userId: string, body: WireBoundaryInput) =>
  request(PLAN_TEMPLATE_PATH, userId, { method: HTTP_METHOD.PUT, body });

/** The answer as the wire reads it, failing the test where it is not the wire's. */
function templateOf(answered: Answer): PlanTemplateAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const read = readEither(planTemplateAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

const refusal = (status: number, error: string): Answer => ({ status, body: { error } });

it.layer(testSqlClient)("the plan template route", (it) => {
  it.effect("an account that kept no template reads the default, and not as its own", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;

      assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), DEFAULT_ANSWER);
    }),
  );

  it.effect("a template written is answered and read back verbatim as the account's own", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const own: PlanTemplateAnswer = { template: OWN_TEMPLATE, custom: true };

      assert.deepEqual(
        templateOf(yield* ask(writeTemplate(owner, { template: OWN_TEMPLATE }))),
        own,
      );
      assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), own);
    }),
  );

  it.effect("an empty template is kept as the account's own rather than read as the default", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(writeTemplate(owner, { template: "" }));

      assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), { template: "", custom: true });
    }),
  );

  it.effect("a template at the bound is kept whole", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const longest = "a".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS);
      yield* ask(writeTemplate(owner, { template: longest }));

      assert.equal(templateOf(yield* ask(readTemplate(owner))).template, longest);
    }),
  );

  it.effect("a null template goes back to the default", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(writeTemplate(owner, { template: OWN_TEMPLATE }));

      assert.deepEqual(
        templateOf(yield* ask(writeTemplate(owner, { template: null }))),
        DEFAULT_ANSWER,
      );
      assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), DEFAULT_ANSWER);
    }),
  );

  it.effect(
    "a template write leaves the preferences snapshot as it stood, its instant included",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* ask(
          request(PREFERENCES_PATH, owner, {
            method: HTTP_METHOD.PUT,
            body: { preferences: { voice: LIVE_VOICE.MARIN }, codingAgent: SOL_AT_HIGH },
          }),
        );
        const before = yield* ask(request(PREFERENCES_PATH, owner));

        yield* TestClock.adjust(Duration.minutes(5));
        yield* ask(writeTemplate(owner, { template: OWN_TEMPLATE }));
        yield* ask(writeTemplate(owner, { template: null }));

        assert.deepEqual(yield* ask(request(PREFERENCES_PATH, owner)), before);
      }),
  );

  it.effect(
    "a template on an account that never synced its settings answers no preferences snapshot to take",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        const untouched = yield* ask(request(PREFERENCES_PATH, owner));

        yield* ask(writeTemplate(owner, { template: OWN_TEMPLATE }));

        assert.deepEqual(yield* ask(request(PREFERENCES_PATH, owner)), untouched);
      }),
  );

  it.effect("a write past the bound or of any other shape is refused and keeps nothing", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      const bodies: readonly WireBoundaryInput[] = [
        { template: "a".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS + 1) },
        { template: OWN_TEMPLATE, custom: true },
        { template: 42 },
        {},
        OWN_TEMPLATE,
      ];

      for (const body of bodies) {
        assert.deepEqual(yield* ask(writeTemplate(owner, body)), invalid, JSON.stringify(body));
      }
      assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), DEFAULT_ANSWER);
    }),
  );

  it.effect("another account's template is never read", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      yield* ask(writeTemplate(owner, { template: OWN_TEMPLATE }));

      assert.deepEqual(templateOf(yield* ask(readTemplate(other))), DEFAULT_ANSWER);
    }),
  );

  it.effect("a request with no bearer the store knows is refused and keeps nothing", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const unknown = refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);

      assert.deepEqual(yield* ask(request(PLAN_TEMPLATE_PATH, undefined)), unknown);
      assert.deepEqual(
        yield* ask(
          request(PLAN_TEMPLATE_PATH, `user-${randomUUID()}`, {
            method: HTTP_METHOD.PUT,
            body: { template: OWN_TEMPLATE },
          }),
        ),
        unknown,
      );
      assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), DEFAULT_ANSWER);
    }),
  );

  it.effect("a method other than a read or a write is refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      const refused = refusal(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );

      for (const method of [HTTP_METHOD.POST, HTTP_METHOD.DELETE]) {
        assert.deepEqual(yield* ask(request(PLAN_TEMPLATE_PATH, owner, { method })), refused);
      }
    }),
  );
});
