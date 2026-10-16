import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  deleteAccount,
  readAccountPreferences,
  readPlanTemplate,
  restorePlanTemplate,
  writeAccountPreferences,
  writePlanTemplate,
} from "@luke/database/models/account-store";
import {
  listTemplateRevisions,
  readTemplateRevision,
} from "@luke/database/models/plan-template-revisions";
import { user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import {
  type CatalogModel,
  CODING_AGENT_DEFAULT_CHOICE,
  MODEL_PROVIDER,
} from "@luke/features/models-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  type PlanTemplateAnswer,
  type PlanTemplateRevisionsAnswer,
  planTemplateAnswerSchema,
  planTemplateRevisionsAnswerSchema,
} from "@luke/features/plan-document-template";
import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { noNetwork } from "../testing/no-network.js";
import { accountApp } from "./account-app.js";

/**
 * The account's plan template, answered by the account group the way its
 * function answers it, over a real dialect: the default until the account
 * keeps its own, the account's own kept verbatim, a reset back to the
 * default, and a write that leaves the preferences snapshot beside it
 * exactly as it stood. The bearer names the account and nothing else does.
 * Every write that changes the template is kept as a revision, the
 * developer's writes within ten minutes as one, read a page at a time and
 * one at a time, and put back by a restore that is a revision of its own.
 *
 * Synthetic accounts and bearers throughout.
 */

const ORIGIN = "https://luke.test";
const PLAN_TEMPLATE_PATH = "/api/account/plan-template";

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

/** A template with the edges a trim would take, so verbatim is what is checked. */
const OWN_TEMPLATE = "\n## Why\n\nWhat prompted this.  \n\n## Done when\n\n  - \n";

const DEFAULT_ANSWER: PlanTemplateAnswer = { template: DEFAULT_PLAN_TEMPLATE, custom: false };

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** Two accounts behind their own bearers, and the group answering on the test's database and clock. */
const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
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
    // This suite deletes nothing, so it retires no session and reaches no eve.
    eveOrigin: () => undefined,
    standingSessions: () => Effect.die(new Error("this suite deletes no account")),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    anthropicFastAccess,
    writePreferences: writeAccountPreferences,
    readPlanTemplate,
    writePlanTemplate,
    listPlanTemplateRevisions: listTemplateRevisions,
    readPlanTemplateRevision: readTemplateRevision,
    restorePlanTemplate,
    // The memories' path is answered over a real dialect in `account-memories.test.ts`.
    readMemories: () => Effect.die(new Error("this suite reads no memory")),
    forgetMemory: () => Effect.die(new Error("this suite forgets no memory")),
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
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      Layer.succeed(HostedEnvironment, NO_ENVIRONMENT),
      noNetwork,
      modelCatalogOf(CATALOG),
      // Only a delete asks Connect anything, and this suite deletes nothing.
      integrationConnectOf(() => CONNECTOR_ASKED_NOTHING),
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

const REVISIONS_PATH = `${PLAN_TEMPLATE_PATH}/revisions`;

/** Two templates a minute's edit apart: the first adds one section the default lacks and drops its eleven, the second changes that one section. */
const FIRST_TEMPLATE = "## Why\n\nWhat prompted this.\n";

/** The account's history as the wire reads it, failing the test where it is not the wire's. */
function historyOf(answered: Answer): PlanTemplateRevisionsAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const read = readEither(planTemplateRevisionsAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

const readHistory = (userId: string, before?: number) =>
  request(before === undefined ? REVISIONS_PATH : `${REVISIONS_PATH}?before=${before}`, userId);

/** The route a rewrite lands one revision's path on, its number moved into the query. */
const readRevision = (userId: string, seq: number | string) =>
  request(`${PLAN_TEMPLATE_PATH}/revision?seq=${seq}`, userId);

const restoreRevision = (userId: string, seq: number | string) =>
  request(`${PLAN_TEMPLATE_PATH}/restore?seq=${seq}`, userId, { method: HTTP_METHOD.POST });

it.layer(getTestDB())("the plan template route", (it) => {
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

  it.effect("another account reads none of the history and restores none of it", () =>
    Effect.gen(function* () {
      const { owner, other, ask } = yield* openAccounts;
      yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));
      const notFound = refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND);

      assert.deepEqual(historyOf(yield* ask(readHistory(other))), { revisions: [] });
      assert.deepEqual(yield* ask(readRevision(other, 2)), notFound);
      assert.deepEqual(yield* ask(restoreRevision(other, 2)), notFound);
      assert.deepEqual(templateOf(yield* ask(readTemplate(other))), DEFAULT_ANSWER);
    }),
  );
});
