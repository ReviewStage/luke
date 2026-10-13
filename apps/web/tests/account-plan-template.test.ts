import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { db } from "@sidecar/database/core/query";
import {
  deleteAccount,
  readAccountPreferences,
  readPlanTemplate,
  restorePlanTemplate,
  writeAccountPreferences,
  writePlanTemplate,
} from "@sidecar/database/models/account-store";
import {
  listTemplateRevisions,
  readTemplateRevision,
} from "@sidecar/database/models/plan-template-revisions";
import { user } from "@sidecar/database/schemas/auth";
import { accountPreference } from "@sidecar/database/schemas/preferences";
import { getTestDB } from "@sidecar/database/testing";
import {
  type CatalogModel,
  CODING_AGENT_DEFAULT_CHOICE,
  MODEL_PROVIDER,
  type ModelChoice,
} from "@sidecar/hosted/models-wire";
import {
  DEFAULT_PLAN_TEMPLATE,
  PLAN_TEMPLATE_BOUNDS,
  type PlanTemplateAnswer,
  type PlanTemplateRevisionAnswer,
  type PlanTemplateRevisionsAnswer,
  planTemplateAnswerSchema,
  planTemplateRevisionAnswerSchema,
  planTemplateRevisionsAnswerSchema,
} from "@sidecar/hosted/plan-document-template";
import { PLAN_ACTOR, PLAN_HISTORY_BOUNDS } from "@sidecar/hosted/plan-wire";
import { LIVE_VOICE } from "@sidecar/live";
import { HTTP_METHOD, unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { Clock, Duration, Effect, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import { HttpRouter } from "effect/unstable/http";
import { SqlClient } from "effect/unstable/sql";
import { accountApp } from "../server/account-app";
import { HostedEnvironment, type HostedEnvironmentValues } from "../server/hosted/environment";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { modelCatalogOf } from "../server/hosted/model-catalog";
import { CONNECTOR_ASKED_NOTHING, integrationConnectOf } from "./support/integration-connect";
import { noNetwork } from "./support/no-network";

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
    // This suite deletes nothing, so it retires no session and reaches no eve.
    eveOrigin: () => undefined,
    standingSessions: () => Effect.die(new Error("this suite deletes no account")),
    deleteUser: deleteAccount,
    readPreferences: readAccountPreferences,
    writePreferences: writeAccountPreferences,
    readPlanTemplate,
    writePlanTemplate,
    listPlanTemplateRevisions: listTemplateRevisions,
    readPlanTemplateRevision: readTemplateRevision,
    restorePlanTemplate,
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
const SECOND_TEMPLATE = "## Why\n\nWhat prompted this, and who asked.\n";

/** The account's history as the wire reads it, failing the test where it is not the wire's. */
function historyOf(answered: Answer): PlanTemplateRevisionsAnswer {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const read = readEither(planTemplateRevisionsAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success;
}

/** One revision as the wire reads it, failing the test where it is not the wire's. */
function revisionOf(answered: Answer): PlanTemplateRevisionAnswer["revision"] {
  assert.equal(answered.status, HOSTED_HTTP_STATUS.OK, JSON.stringify(answered.body));
  const read = readEither(planTemplateRevisionAnswerSchema)(unparsedWire(answered.body));
  if (Result.isFailure(read)) return assert.fail(`not the wire's: ${read.failure.refusal}`);
  return read.success.revision;
}

const readHistory = (userId: string, before?: number) =>
  request(before === undefined ? REVISIONS_PATH : `${REVISIONS_PATH}?before=${before}`, userId);

/** The route a rewrite lands one revision's path on, its number moved into the query. */
const readRevision = (userId: string, seq: number | string) =>
  request(`${PLAN_TEMPLATE_PATH}/revision?seq=${seq}`, userId);

const restoreRevision = (userId: string, seq: number | string) =>
  request(`${PLAN_TEMPLATE_PATH}/restore?seq=${seq}`, userId, { method: HTTP_METHOD.POST });

/** Each line of a page as who wrote it, how many changes, and what it restored or whether it is the default, newest first. */
function linesOf(page: PlanTemplateRevisionsAnswer) {
  return page.revisions.map((line) => ({
    seq: line.seq,
    actor: line.lastEdit.actor,
    changes: line.changes,
    ...(line.restoredFrom === undefined ? undefined : { restoredFrom: line.restoredFrom.seq }),
    ...(line.default === undefined ? undefined : { default: line.default }),
  }));
}

it.layer(getTestDB())("the plan template route", (it) => {
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

  it.effect(
    "a first write keeps the template the account held, then the write, each read beside the one before it",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* TestClock.adjust(Duration.minutes(3));
        const at = yield* Clock.currentTimeMillis;
        yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));

        const page = historyOf(yield* ask(readHistory(owner)));
        assert.deepEqual(linesOf(page), [
          { seq: 2, actor: PLAN_ACTOR.DEVELOPER, changes: 12 },
          { seq: 1, actor: PLAN_ACTOR.EARLIER, changes: 0, default: true },
        ]);
        assert.deepEqual(page.revisions[0]?.lastEdit, {
          actor: PLAN_ACTOR.DEVELOPER,
          at,
          duringCall: false,
        });
        assert.equal(page.earlier, undefined);
        assert.deepEqual(revisionOf(yield* ask(readRevision(owner, 2))), {
          seq: 2,
          document: { body: FIRST_TEMPLATE, assumptions: [] },
          previous: { body: DEFAULT_PLAN_TEMPLATE, assumptions: [] },
        });
        assert.deepEqual(revisionOf(yield* ask(readRevision(owner, 1))), {
          seq: 1,
          document: { body: DEFAULT_PLAN_TEMPLATE, assumptions: [] },
          previous: null,
        });
      }),
  );

  it.effect("a template from before history is kept as its first revision, as itself", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      // Note that the template is written under the store, as one kept before its history began.
      yield* db.insert(accountPreference).values({ userId: owner, planTemplate: FIRST_TEMPLATE });
      yield* ask(writeTemplate(owner, { template: SECOND_TEMPLATE }));

      assert.deepEqual(linesOf(historyOf(yield* ask(readHistory(owner)))), [
        { seq: 2, actor: PLAN_ACTOR.DEVELOPER, changes: 1 },
        { seq: 1, actor: PLAN_ACTOR.EARLIER, changes: 0 },
      ]);
      assert.deepEqual(
        revisionOf(yield* ask(readRevision(owner, 1))).document.body,
        FIRST_TEMPLATE,
      );
    }),
  );

  it.effect(
    "writes within ten minutes of the last are one revision, and one after that starts another",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));
        yield* TestClock.adjust(Duration.minutes(10));
        yield* ask(writeTemplate(owner, { template: SECOND_TEMPLATE }));

        assert.deepEqual(linesOf(historyOf(yield* ask(readHistory(owner)))), [
          { seq: 2, actor: PLAN_ACTOR.DEVELOPER, changes: 13 },
          { seq: 1, actor: PLAN_ACTOR.EARLIER, changes: 0, default: true },
        ]);
        assert.deepEqual(
          revisionOf(yield* ask(readRevision(owner, 2))).document.body,
          SECOND_TEMPLATE,
        );

        yield* TestClock.adjust(Duration.minutes(11));
        yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));

        assert.deepEqual(linesOf(historyOf(yield* ask(readHistory(owner))))[0], {
          seq: 3,
          actor: PLAN_ACTOR.DEVELOPER,
          changes: 1,
        });
      }),
  );

  it.effect("a write that changes nothing keeps no revision", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(writeTemplate(owner, { template: null }));
      yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));
      yield* TestClock.adjust(Duration.minutes(30));
      yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));

      assert.deepEqual(
        historyOf(yield* ask(readHistory(owner))).revisions.map((line) => line.seq),
        [2, 1],
      );
    }),
  );

  it.effect(
    "a reset is a revision of its own, the default, which the next write does not join",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));
        yield* ask(writeTemplate(owner, { template: null }));
        yield* ask(writeTemplate(owner, { template: SECOND_TEMPLATE }));

        assert.deepEqual(linesOf(historyOf(yield* ask(readHistory(owner)))), [
          { seq: 4, actor: PLAN_ACTOR.DEVELOPER, changes: 12 },
          { seq: 3, actor: PLAN_ACTOR.DEVELOPER, changes: 12, default: true },
          { seq: 2, actor: PLAN_ACTOR.DEVELOPER, changes: 12 },
          { seq: 1, actor: PLAN_ACTOR.EARLIER, changes: 0, default: true },
        ]);
      }),
  );

  it.effect(
    "a restore puts the revision back as the template, a revision naming it that nothing joins",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));
        const firstAt = yield* Clock.currentTimeMillis;
        yield* TestClock.adjust(Duration.minutes(11));
        yield* ask(writeTemplate(owner, { template: SECOND_TEMPLATE }));

        assert.deepEqual(templateOf(yield* ask(restoreRevision(owner, 2))), {
          template: FIRST_TEMPLATE,
          custom: true,
        });
        yield* ask(writeTemplate(owner, { template: SECOND_TEMPLATE }));

        const page = historyOf(yield* ask(readHistory(owner)));
        assert.deepEqual(linesOf(page).slice(0, 2), [
          { seq: 5, actor: PLAN_ACTOR.DEVELOPER, changes: 1 },
          { seq: 4, actor: PLAN_ACTOR.DEVELOPER, changes: 1, restoredFrom: 2 },
        ]);
        assert.deepEqual(page.revisions[1]?.restoredFrom, { seq: 2, at: firstAt });
        assert.deepEqual(templateOf(yield* ask(readTemplate(owner))), {
          template: SECOND_TEMPLATE,
          custom: true,
        });
      }),
  );

  it.effect(
    "a restore of what already stands is still kept, naming the revision it asked for",
    () =>
      Effect.gen(function* () {
        const { owner, ask } = yield* openAccounts;
        yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));

        assert.deepEqual(templateOf(yield* ask(restoreRevision(owner, 2))), {
          template: FIRST_TEMPLATE,
          custom: true,
        });
        assert.deepEqual(linesOf(historyOf(yield* ask(readHistory(owner))))[0], {
          seq: 3,
          actor: PLAN_ACTOR.DEVELOPER,
          changes: 0,
          restoredFrom: 2,
        });
      }),
  );

  it.effect("restoring the default goes back to the default rather than to a copy of it", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));

      assert.deepEqual(templateOf(yield* ask(restoreRevision(owner, 1))), DEFAULT_ANSWER);
      assert.deepEqual(linesOf(historyOf(yield* ask(readHistory(owner))))[0], {
        seq: 3,
        actor: PLAN_ACTOR.DEVELOPER,
        changes: 12,
        restoredFrom: 1,
        default: true,
      });
    }),
  );

  it.effect("the history is read a page at a time, newest first", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      // Each write past the join's ten minutes is a revision of its own.
      for (let at = 0; at <= PLAN_HISTORY_BOUNDS.PAGE; at += 1) {
        yield* TestClock.adjust(Duration.minutes(11));
        yield* ask(writeTemplate(owner, { template: `## Why\n\nWrite ${at}.\n` }));
      }
      const newest = PLAN_HISTORY_BOUNDS.PAGE + 2;

      const first = historyOf(yield* ask(readHistory(owner)));
      assert.equal(first.revisions.length, PLAN_HISTORY_BOUNDS.PAGE);
      assert.equal(first.revisions[0]?.seq, newest);
      assert.equal(first.earlier, 3);
      const older = historyOf(yield* ask(readHistory(owner, first.earlier)));
      assert.deepEqual(
        older.revisions.map((line) => line.seq),
        [2, 1],
      );
      assert.equal(older.earlier, undefined);
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

  it.effect("a revision number that names none, or the wrong method, is refused", () =>
    Effect.gen(function* () {
      const { owner, ask } = yield* openAccounts;
      yield* ask(writeTemplate(owner, { template: FIRST_TEMPLATE }));
      const invalid = refusal(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
      const refused = refusal(
        HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
        HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
      );

      for (const seq of ["0", "1.5", "two"]) {
        assert.deepEqual(yield* ask(readRevision(owner, seq)), invalid, seq);
        assert.deepEqual(yield* ask(restoreRevision(owner, seq)), invalid, seq);
      }
      assert.deepEqual(
        yield* ask(request(`${PLAN_TEMPLATE_PATH}/revision?seq=9`, owner)),
        refusal(HOSTED_HTTP_STATUS.NOT_FOUND, HOSTED_API_ERROR.NOT_FOUND),
      );
      assert.deepEqual(
        yield* ask(request(REVISIONS_PATH, owner, { method: HTTP_METHOD.POST })),
        refused,
      );
      assert.deepEqual(yield* ask(request(`${PLAN_TEMPLATE_PATH}/restore?seq=2`, owner)), refused);
    }),
  );
});
