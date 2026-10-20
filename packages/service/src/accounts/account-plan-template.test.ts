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
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
  type PlanTemplateRevisionsAnswer,
  planTemplateAnswerSchema,
  planTemplateRevisionsAnswerSchema,
} from "@luke/features/plan-document-template";
import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { noNetwork } from "@luke/wire/testing";
import { Clock, Effect, Layer, Option, Result } from "effect";
import { SqlClient } from "effect/sql";
import { anthropicFastAccess } from "../agents/coder-host/account-keys.js";
import { HostedEnvironment, type HostedEnvironmentValues } from "../environment.js";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import { HOSTED_BODY_CEILING_BYTES } from "../orpc/handler.js";
import { modelCatalogOf } from "../providers/model-catalog.js";
import { hostedAnswer } from "../testing/hosted-route.js";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "../testing/integration-connect.js";
import { accountProcedures } from "./account-procedures.js";

/**
 * The account's plan template, answered by the account procedures the way
 * the hosted oRPC route answers them, over a real dialect: the default until the account
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
  eveDeploymentSecret: undefined,
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

/** Two accounts behind their own bearers, and the procedures answering on the test's database and clock. */
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
  const procedures = accountProcedures({
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
  });
  const ask = (request: Request) => answer(procedures, request);
  /** The request's status, the two headers a caller reads, and its bytes. */
  const bytes = (request: Request) =>
    Effect.gen(function* () {
      const response = yield* respond(procedures, request);
      return {
        status: response.status,
        contentType: response.headers.get("content-type"),
        cacheControl: response.headers.get("cache-control"),
        text: yield* Effect.promise(() => response.text()),
      };
    });
  return { owner, other, ask, bytes };
});

/** The request as the route answers it, its bytes as they left the handler. */
const respond = (procedures: ReturnType<typeof accountProcedures>, request: Request) =>
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient;
    // The procedures run on oRPC's own fiber, so they are handed the test's clock and services.
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
    return yield* hostedAnswer({ account: procedures }, services, request);
  });

const answer = (procedures: ReturnType<typeof accountProcedures>, request: Request) =>
  Effect.gen(function* () {
    const response = yield* respond(procedures, request);
    const text = yield* Effect.promise(() => response.text());
    // SAFETY: the route answers JSON; the test compares it as the wire value it is.
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
    headers: {
      ...(userId === undefined ? undefined : { authorization: `Bearer ${userId}` }),
      ...(init.body === undefined ? undefined : { "content-type": "application/json" }),
    },
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

/** One revision's public path, its number in the path, as the rewrite carries it on to the router. */
const readRevision = (userId: string, seq: number | string) =>
  request(`${REVISIONS_PATH}/${seq}`, userId);

const restoreRevision = (userId: string, seq: number | string) =>
  request(`${REVISIONS_PATH}/${seq}/restore`, userId, { method: HTTP_METHOD.POST });

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

  it.effect(
    "the answers are byte for byte the old group's: a read under private, no-store, and each refusal bare",
    () =>
      Effect.gen(function* () {
        const { owner, bytes } = yield* openAccounts;
        const json = "application/json";
        assert.deepEqual(yield* bytes(readTemplate(owner)), {
          status: HOSTED_HTTP_STATUS.OK,
          contentType: json,
          cacheControl: "private, no-store",
          text: JSON.stringify(DEFAULT_ANSWER),
        });
        assert.deepEqual(yield* bytes(request(PLAN_TEMPLATE_PATH, undefined)), {
          status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
          contentType: json,
          cacheControl: null,
          text: '{"error":"invalid-token"}',
        });
        assert.deepEqual(
          yield* bytes(request(PLAN_TEMPLATE_PATH, owner, { method: HTTP_METHOD.POST })),
          {
            status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
            contentType: json,
            cacheControl: null,
            text: '{"error":"method-not-allowed"}',
          },
        );
        assert.deepEqual(yield* bytes(restoreRevision(owner, 99)), {
          status: HOSTED_HTTP_STATUS.NOT_FOUND,
          contentType: json,
          cacheControl: null,
          text: '{"error":"not-found"}',
        });
      }),
  );

  it.effect(
    "an unsigned write is refused as unsigned whatever its body, and a key the write does not name is refused",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        const unsigned = refusal(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        assert.deepEqual(
          yield* ask(
            request(PLAN_TEMPLATE_PATH, undefined, { method: HTTP_METHOD.PUT, body: { nope: 1 } }),
          ),
          unsigned,
        );
        assert.deepEqual(
          yield* ask(writeTemplate(owner, { template: OWN_TEMPLATE, also: true })),
          invalid,
        );
        assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), DEFAULT_ANSWER);
      }),
  );

  it.effect(
    "a write whose stated length is past the template's bound is refused as too large",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        const body = JSON.stringify({
          template: "x".repeat(PLAN_TEMPLATE_BOUNDS.MAX_CHARS * 6 + 1_100),
        });
        const tooLarge = new Request(new URL(PLAN_TEMPLATE_PATH, ORIGIN), {
          method: HTTP_METHOD.PUT,
          headers: {
            authorization: `Bearer ${owner}`,
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          },
          body,
        });

        assert.deepEqual(
          yield* ask(tooLarge),
          refusal(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
        );
      }),
  );

  it.effect(
    "a write that states no length is bounded by the handler's ceiling, and refused as too large past it",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        // A body handed as text states no length of its own here, so only the ceiling bounds it.
        const streamed = new Request(new URL(PLAN_TEMPLATE_PATH, ORIGIN), {
          method: HTTP_METHOD.PUT,
          headers: { authorization: `Bearer ${owner}`, "content-type": "application/json" },
          body: "x".repeat(HOSTED_BODY_CEILING_BYTES + 1),
        });
        assert.equal(streamed.headers.get("content-length"), null);

        assert.deepEqual(
          yield* ask(streamed),
          refusal(HOSTED_HTTP_STATUS.PAYLOAD_TOO_LARGE, HOSTED_API_ERROR.REQUEST_TOO_LARGE),
        );
      }),
  );

  it.effect(
    "a revision's path naming no revision number is refused as a request that does not read, before the caller is",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);

        for (const seq of ["0", "1.5", "abc"]) {
          assert.deepEqual(yield* ask(readRevision(owner, seq)), invalid);
          assert.deepEqual(yield* ask(restoreRevision(owner, seq)), invalid);
        }
        assert.deepEqual(yield* ask(request(`${REVISIONS_PATH}/abc`, undefined)), invalid);
        assert.deepEqual(yield* ask(readHistory(owner, 0)), invalid);
      }),
  );
});
