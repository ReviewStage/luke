import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { pauseAutomation } from "@sidecar/database/models/automation-store";
import { automation as automationTable } from "@sidecar/database/schemas/automation";
import { getTestDB } from "@sidecar/database/testing";
import {
  automationPath,
  automationRunPath,
  automationRunsPath,
  automationWebhookSecretPath,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
} from "@sidecar/hosted";
import { SCHEDULE_PRESET } from "@sidecar/hosted/automation-schedule";
import {
  AUTOMATION_ACTION,
  AUTOMATION_BOUNDS,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_PAUSE,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  automationAnswerSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunsAnswerSchema,
} from "@sidecar/hosted/automation-wire";
import { CODING_AGENT_STATUS } from "@sidecar/hosted/coding-agent-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { automationsApp } from "../server/automations-app";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { HOSTED_HTTP_STATUS } from "../server/hosted/http";
import { modelCatalogOf, type OfferedModel } from "../server/hosted/model-catalog";
import { githubReaching, openGithubUser } from "./support/github-app-fake";
import { startPlan } from "./support/workspaces";

/**
 * The automation routes, answered by the group the way a function answers
 * them, over a real dialect: an automation is made on the account's plan
 * with its schedule's first due instant, refused where its schedule, model,
 * or plan will not do, read and changed by its own account alone, paused
 * and resumed with its due instant cleared and computed again, a webhook's
 * secret answered once and kept only as its hash, and a "Run now" one run
 * per key that starts its agent. eve is a fake at the client's boundary,
 * GitHub a script, the catalog fixed, and the store PGlite. Synthetic
 * accounts, bearers, plans, and words throughout.
 */

const ORIGIN = "https://luke.test";
const RELAY = { owner: "Acme", name: "Relay" } as const;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;

const CATALOG: readonly OfferedModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
];

const PROMPT = "Triage the issues opened since yesterday and fix the smallest one.";

interface Answer {
  readonly status: number;
  readonly body: WireBoundaryInput;
}

/** The group over the test's own database, GitHub, and a fake eve that writes down every session it opens. */
const standing = (bearers: ReadonlyMap<string, string>) =>
  Effect.gen(function* () {
    const opened: string[] = [];
    const sessions: EveSessions = {
      open: (message) =>
        Effect.sync(() => {
          opened.push(message.conversationId);
          return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
        }),
      send: () => Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status: 500 }),
      cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
      reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
    };
    const services = Layer.mergeAll(
      Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
      Layer.succeed(Database, yield* Database),
      Layer.succeed(Clock.Clock, yield* Clock.Clock),
      githubReaching([INSTALLATION]).layer,
      modelCatalogOf(CATALOG),
    );
    const app = HttpRouter.toWebHandler(
      automationsApp({
        resolveUserId: (incoming: Request) =>
          Effect.succeed(
            Option.fromNullishOr(bearers.get(incoming.headers.get("authorization") ?? "")),
          ),
        eveOrigin: () => ORIGIN,
        eve: () => sessions,
      }).pipe(HttpRouter.provideRequest(services)),
      { disableLogger: true },
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
    const ask = (
      path: string,
      bearer: string,
      init: { readonly method?: string; readonly body?: unknown } = {},
    ) =>
      Effect.gen(function* () {
        // Note that the rewrite moves a path's id into the `id` query, which the group reads.
        const segments = /^\/api\/automations\/([^/]+)(?:\/(runs?|webhook-secret))?$/u.exec(path);
        const routed =
          segments === null
            ? path
            : `/api/automations/${segments[2] ?? "automation"}?id=${segments[1]}`;
        const response = yield* Effect.promise(() =>
          app.handler(
            new Request(`${ORIGIN}${routed}`, {
              method: init.method ?? "GET",
              headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" },
              ...(init.body === undefined ? undefined : { body: JSON.stringify(init.body) }),
            }),
          ),
        );
        const text = yield* Effect.promise(() => response.text());
        // SAFETY: the group answers JSON; the test reads it as the wire value it is.
        const body = (text.length === 0 ? text : JSON.parse(text)) as WireBoundaryInput;
        return { status: response.status, body } satisfies Answer;
      });
    return { ask, opened };
  });

/** The answer read through its schema, failing the test where the status or the body is not what it should be. */
function readAnswer<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  status: number,
  answer: Answer,
): S["Type"] {
  assert.equal(answer.status, status, JSON.stringify(answer.body));
  const read = readEither(schema)(unparsedWire(answer.body));
  if (Result.isFailure(read)) assert.fail(`not the answer: ${JSON.stringify(answer.body)}`);
  return read.success;
}

/** An owner with a plan on the repository, another account beside them, and the group. */
const openAccounts = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const other = yield* openGithubUser();
  const plan = yield* startPlan(owner, {
    name: "Issue triage",
    repository: `${RELAY.owner}/${RELAY.name}`,
  });
  const bare = yield* startPlan(owner, { name: "No repository yet" });
  const { ask, opened } = yield* standing(
    new Map([
      [`Bearer ${owner}`, owner],
      [`Bearer ${other}`, other],
    ]),
  );
  return { owner, other, plan, bare, ask, opened };
});

const weekdays = (planId: string) => ({
  planId,
  name: "Morning triage",
  trigger: {
    kind: AUTOMATION_TRIGGER.SCHEDULE,
    cron: SCHEDULE_PRESET.WEEKDAYS,
    timezone: "America/New_York",
  },
  action: { kind: AUTOMATION_ACTION.CODING_AGENT, prompt: PROMPT },
});

it.layer(getTestDB())("the automation routes", (it) => {
  it.effect(
    "an automation is made with its schedule's first due instant and read, changed, and deleted by its own account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other, plan, ask } = yield* openAccounts;
        const now = yield* Clock.currentTimeMillis;

        const made = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
            method: "POST",
            body: weekdays(plan.id),
          }),
        );

        const { automation } = made;
        assert.equal(made.webhookSecret, undefined, "a schedule has no secret");
        assert.equal(automation.enabled, true);
        assert.equal(automation.planName, "Issue triage");
        assert.deepEqual(automation.guards, AUTOMATION_DEFAULT_GUARDS);
        assert.equal(automation.lastRun, null);
        assert.ok(automation.nextRunAt !== null && automation.nextRunAt > now);
        // Nine in New York is 13:00 or 14:00 UTC, whichever side of daylight saving it falls.
        assert.ok([13, 14].includes(new Date(automation.nextRunAt).getUTCHours()));

        const listed = readAnswer(
          automationListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(`${HOSTED_SERVICE_PATH.AUTOMATIONS}?planId=${plan.id}`, owner),
        );
        assert.deepEqual(
          listed.automations.map((each) => each.id),
          [automation.id],
        );
        const othersList = readAnswer(
          automationListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, other),
        );
        assert.deepEqual(othersList.automations, []);
        for (const [path, method] of [
          [automationPath(automation.id), "GET"],
          [automationPath(automation.id), "PATCH"],
          [automationPath(automation.id), "DELETE"],
          [automationRunsPath(automation.id), "GET"],
        ] as const) {
          const refused = yield* ask(path, other, {
            method,
            ...(method === "PATCH" ? { body: { enabled: false } } : undefined),
          });
          assert.equal(refused.status, HOSTED_HTTP_STATUS.NOT_FOUND, `${method} ${path}`);
        }

        const renamed = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationPath(automation.id), owner, {
            method: "PATCH",
            body: { name: "Weekday triage" },
          }),
        );
        assert.equal(renamed.automation.name, "Weekday triage");
        assert.equal(
          renamed.automation.nextRunAt,
          automation.nextRunAt,
          "a rename keeps the due instant",
        );

        const deleted = yield* ask(automationPath(automation.id), owner, { method: "DELETE" });
        assert.equal(deleted.status, HOSTED_HTTP_STATUS.OK);
        const gone = yield* ask(automationPath(automation.id), owner);
        assert.equal(gone.status, HOSTED_HTTP_STATUS.NOT_FOUND);
      }),
  );

  it.effect(
    "an automation is refused where its schedule fires too often, its model is not offered, its plan names no repository, or its body names a key it should not",
    () =>
      Effect.gen(function* () {
        const { owner, plan, bare, ask } = yield* openAccounts;
        const make = (body: WireBoundaryInput) =>
          ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, { method: "POST", body });
        const base = weekdays(plan.id);

        const tooOften = yield* make({ ...base, trigger: { ...base.trigger, cron: "* * * * *" } });
        const unknownZone = yield* make({
          ...base,
          trigger: { ...base.trigger, timezone: "Mars/Olympus_Mons" },
        });
        const unknownModel = yield* make({
          ...base,
          action: { ...base.action, choice: { model: "acme/unknown-1", effort: "high" } },
        });
        const noRepository = yield* make(weekdays(bare.id));
        const excess = yield* make({ ...base, owner: "someone-else" });

        for (const refused of [tooOften, unknownZone, unknownModel, excess]) {
          assert.equal(
            refused.status,
            HOSTED_HTTP_STATUS.BAD_REQUEST,
            JSON.stringify(refused.body),
          );
          assert.deepEqual(refused.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
        }
        assert.deepEqual(noRepository.body, { error: HOSTED_API_ERROR.NO_REPOSITORY });
        const listed = readAnswer(
          automationListAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner),
        );
        assert.deepEqual(listed.automations, [], "nothing refused was made");
      }),
  );

  it.effect(
    "a webhook's secret is answered once and kept only as its hash, and a paused automation resumed is due again with why it was paused cleared",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask } = yield* openAccounts;

        const hooked = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
            method: "POST",
            body: { ...weekdays(plan.id), trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } },
          }),
        );
        const secret = hooked.webhookSecret ?? "";
        assert.equal(
          hooked.automation.webhookUrl,
          `${ORIGIN}/api/automations/${hooked.automation.id}/webhook`,
          "the address is spelled on the origin the request came to",
        );
        assert.ok(secret.length >= 40, "a secret of real length is answered");
        const [row] = yield* Database.use((db) =>
          db
            .select({ hash: automationTable.webhookSecretHash })
            .from(automationTable)
            .where(eq(automationTable.id, hooked.automation.id)),
        );
        assert.equal(row?.hash, createHash("sha256").update(secret).digest("hex"));
        const read = yield* ask(automationPath(hooked.automation.id), owner);
        assert.equal(JSON.stringify(read.body).includes(secret), false, "a read never answers it");

        const scheduled = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
            method: "POST",
            body: weekdays(plan.id),
          }),
        ).automation;
        yield* pauseAutomation(scheduled.id, AUTOMATION_PAUSE.FAILURES);
        const paused = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationPath(scheduled.id), owner),
        ).automation;
        const resumed = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationPath(scheduled.id), owner, {
            method: "PATCH",
            body: { enabled: true },
          }),
        ).automation;

        assert.equal(paused.enabled, false);
        assert.equal(paused.pausedReason, AUTOMATION_PAUSE.FAILURES);
        assert.equal(paused.nextRunAt, null);
        assert.equal(resumed.enabled, true);
        assert.equal(resumed.pausedReason, null);
        assert.equal(resumed.nextRunAt, scheduled.nextRunAt);
      }),
  );

  it.effect(
    "a Run now is one run per key that starts the automation's agent, read back in the history with the agent's status",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask, opened } = yield* openAccounts;
        const { automation } = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
            method: "POST",
            body: weekdays(plan.id),
          }),
        );
        const key = randomUUID();

        const first = readAnswer(
          automationRunAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(automationRunPath(automation.id), owner, {
            method: "POST",
            body: { idempotencyKey: key },
          }),
        );
        const again = readAnswer(
          automationRunAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationRunPath(automation.id), owner, {
            method: "POST",
            body: { idempotencyKey: key },
          }),
        );
        const history = readAnswer(
          automationRunsAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationRunsPath(automation.id), owner),
        );

        assert.equal(first.run.status, AUTOMATION_RUN_STATUS.STARTED);
        assert.deepEqual(first.run.firing, { kind: AUTOMATION_FIRING.MANUAL });
        assert.equal(first.run.agent?.status, CODING_AGENT_STATUS.STARTING);
        assert.deepEqual(again.run, first.run, "the same key answers the run it made");
        assert.equal(opened.length, 1, "and starts nothing again");
        assert.deepEqual(
          history.runs.map((run) => run.id),
          [first.run.id],
        );
      }),
  );

  it.effect(
    "a webhook sent again keeps its secret, the owner's own pause clears why the service paused it, a prompt at its bound fits however JSON spells it, and a Run now key must be a UUID",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask } = yield* openAccounts;
        const hooked = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
            method: "POST",
            body: { ...weekdays(plan.id), trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } },
          }),
        ).automation;
        const hashOf = (id: string) =>
          Effect.map(
            Database.use((db) =>
              db
                .select({ hash: automationTable.webhookSecretHash })
                .from(automationTable)
                .where(eq(automationTable.id, id)),
            ),
            (rows) => rows[0]?.hash,
          );
        const before = yield* hashOf(hooked.id);

        const resent = yield* ask(automationPath(hooked.id), owner, {
          method: "PATCH",
          body: { name: "Renamed", trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK } },
        });
        assert.equal(resent.status, HOSTED_HTTP_STATUS.OK);
        assert.equal(yield* hashOf(hooked.id), before, "the secret stands");

        yield* pauseAutomation(hooked.id, AUTOMATION_PAUSE.FAILURES);
        const pausedByOwner = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationPath(hooked.id), owner, {
            method: "PATCH",
            body: { enabled: false },
          }),
        ).automation;
        assert.equal(pausedByOwner.pausedReason, null);

        const escaped = yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
          method: "POST",
          body: {
            ...weekdays(plan.id),
            action: {
              kind: AUTOMATION_ACTION.CODING_AGENT,
              prompt: `${"\u0001".repeat(AUTOMATION_BOUNDS.MAX_PROMPT_CHARS - 1)}x`,
            },
          },
        });
        assert.equal(escaped.status, HOSTED_HTTP_STATUS.CREATED);

        const notUuid = yield* ask(automationRunPath(hooked.id), owner, {
          method: "POST",
          body: { idempotencyKey: "2026-10-15T09:00:00.000Z" },
        });
        assert.deepEqual(notUuid.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
      }),
  );

  it.effect(
    "sending enabled as it stands moves no due instant, and a plan filter that names no plan is refused as invalid",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask } = yield* openAccounts;
        const { automation } = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
            method: "POST",
            body: weekdays(plan.id),
          }),
        );
        // The due instant as the sweep leaves it once it has moved a schedule on.
        const later = new Date((automation.nextRunAt ?? 0) + 7 * 24 * 60 * 60_000);
        yield* Database.use((db) =>
          db
            .update(automationTable)
            .set({ nextRunAt: later })
            .where(eq(automationTable.id, automation.id)),
        );

        const resent = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationPath(automation.id), owner, {
            method: "PATCH",
            body: { enabled: true, name: "Renamed" },
          }),
        );
        const malformed = yield* ask(`${HOSTED_SERVICE_PATH.AUTOMATIONS}?planId=not-a-plan`, owner);

        assert.equal(
          resent.automation.nextRunAt,
          later.getTime(),
          "the instant the sweep set stands",
        );
        assert.deepEqual(malformed.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
      }),
  );
  it.effect(
    "a webhook secret the client names is kept as its hash and never answered back, on a make and on a rotation, and one too short to be a secret is refused",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask } = yield* openAccounts;
        const named = `named-by-the-window-${randomUUID()}`;
        const hashed = (secret: string) => createHash("sha256").update(secret).digest("hex");
        const hashOf = (id: string) =>
          Effect.map(
            Database.use((db) =>
              db
                .select({ hash: automationTable.webhookSecretHash })
                .from(automationTable)
                .where(eq(automationTable.id, id)),
            ),
            (rows) => rows[0]?.hash,
          );

        const made = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
            method: "POST",
            body: {
              ...weekdays(plan.id),
              trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
              webhookSecret: named,
            },
          }),
        );
        assert.equal(made.webhookSecret, undefined, "the client holds it already");
        assert.equal(yield* hashOf(made.automation.id), hashed(named));

        const renamed = `${named}-again`;
        const rotated = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationWebhookSecretPath(made.automation.id), owner, {
            method: "POST",
            body: { webhookSecret: renamed },
          }),
        );
        assert.equal(rotated.webhookSecret, undefined);
        assert.equal(yield* hashOf(made.automation.id), hashed(renamed));

        const short = yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
          method: "POST",
          body: {
            ...weekdays(plan.id),
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            webhookSecret: "guessable",
          },
        });
        assert.deepEqual(short.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
        const repeated = yield* ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, {
          method: "POST",
          body: {
            ...weekdays(plan.id),
            trigger: { kind: AUTOMATION_TRIGGER.WEBHOOK },
            webhookSecret: "ab".repeat(40),
          },
        });
        assert.deepEqual(
          repeated.body,
          { error: HOSTED_API_ERROR.INVALID_REQUEST },
          "a long run of a short pattern is no secret",
        );
      }),
  );
});
