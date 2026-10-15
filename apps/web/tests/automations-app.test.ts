import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createPlan } from "@luke/database/models/plan-store";
import { member as memberTable } from "@luke/database/schemas/auth";
import { automation as automationTable } from "@luke/database/schemas/automation";
import { personalWorkspace } from "@luke/database/schemas/personal-workspace";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  startPlan,
} from "@luke/database/testing";
import {
  automationPath,
  automationRunPath,
  automationRunsPath,
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
} from "@luke/features";
import { SCHEDULE_PRESET } from "@luke/features/automation-schedule";
import {
  AUTOMATION_ACTION,
  AUTOMATION_BOUNDS,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_PAUSE,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
  automationAnswerSchema,
  automationListAnswerSchema,
  automationRunAnswerSchema,
  automationRunsAnswerSchema,
} from "@luke/features/automation-wire";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveSessions,
} from "@luke/service/agents/brain-host/eve-sessions";
import { HOSTED_HTTP_STATUS } from "@luke/service/http/http";
import { modelCatalogOf, type OfferedModel } from "@luke/service/providers/model-catalog";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
  openGithubUser,
} from "@luke/service/testing/github-app-fake";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Result, type Schema } from "effect";
import { HttpRouter } from "effect/http";
import { SqlClient } from "effect/sql";
import { automationsApp } from "../server/automations-app";

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
/**
 * The installations reaching the repository, one for each owner's workspace,
 * since one installation connects to one workspace and the suite's tests
 * share a database.
 */
const INSTALLATIONS: readonly InstallationFixture[] = Array.from({ length: 16 }, (_, index) => ({
  id: 7_000 + index,
  login: RELAY.owner,
  accountId: 70_000 + index,
  repositories: [RELAY],
}));
let installationsConnected = 0;

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
      githubReaching(INSTALLATIONS).layer,
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
        const segments = /^\/api\/automations\/([^/]+)(?:\/(runs?))?$/u.exec(path);
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

/** An owner with a plan on the repository of its workspace's installation, another account beside them, and the group. */
const openAccounts = Effect.gen(function* () {
  const owner = yield* openGithubUser();
  const other = yield* openGithubUser();
  const plan = yield* startPlan(owner, {
    name: "Issue triage",
    repository: `${RELAY.owner}/${RELAY.name}`,
  });
  const installation = INSTALLATIONS[installationsConnected++];
  assert.ok(installation);
  yield* connectWorkspaceGitHub(plan.workspaceId, installation);
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

/** A row an older build paused after its failed starts, as one may still stand; nothing pauses an automation now. */
const pausedByAnOlderBuild = (id: string) =>
  Database.use((db) =>
    db
      .update(automationTable)
      .set({ enabled: false, pausedReason: AUTOMATION_PAUSE.FAILURES, nextRunAt: null })
      .where(eq(automationTable.id, id)),
  );

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
        yield* pausedByAnOlderBuild(scheduled.id);
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

        yield* pausedByAnOlderBuild(hooked.id);
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
    "an automation keeps whose it is, where its runs land, and whether a successful run's agent is archived; a workspace scope in a personal workspace and an agent the account cannot read are refused",
    () =>
      Effect.gen(function* () {
        const { owner, plan, ask } = yield* openAccounts;
        const made = (body: WireBoundaryInput) =>
          ask(HOSTED_SERVICE_PATH.AUTOMATIONS, owner, { method: "POST", body });
        const { automation } = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* made(weekdays(plan.id)),
        );
        const { run } = readAnswer(
          automationRunAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* ask(automationRunPath(automation.id), owner, {
            method: "POST",
            body: { idempotencyKey: randomUUID() },
          }),
        );
        const agentId = run.agent?.id ?? "";

        const continued = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.OK,
          yield* ask(automationPath(automation.id), owner, {
            method: "PATCH",
            body: {
              target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId },
              archiveSuccessful: true,
            },
          }),
        ).automation;
        const strangerAgent = yield* ask(automationPath(automation.id), owner, {
          method: "PATCH",
          body: { target: { kind: AUTOMATION_TARGET.SAME_AGENT, agentId: randomUUID() } },
        });
        const personal = yield* openWorkspace(owner);
        yield* Database.use((db) =>
          db
            .insert(personalWorkspace)
            .values({ userId: owner, organizationId: personal, createdAt: new Date(0) }),
        );
        const personalPlan = yield* createPlan(owner, {
          name: "Just mine",
          repository: `${RELAY.owner}/${RELAY.name}`,
          organizationId: personal,
        });
        const inPersonalWorkspace = yield* made({
          ...weekdays(personalPlan.id),
          scope: AUTOMATION_SCOPE.WORKSPACE,
        });
        const shared = readAnswer(
          automationAnswerSchema,
          HOSTED_HTTP_STATUS.CREATED,
          yield* made({ ...weekdays(plan.id), scope: AUTOMATION_SCOPE.WORKSPACE }),
        ).automation;

        assert.deepEqual(
          [
            automation.scope,
            automation.repositories,
            automation.target,
            automation.archiveSuccessful,
          ],
          [
            AUTOMATION_SCOPE.PERSONAL,
            [`${RELAY.owner}/${RELAY.name}`],
            { kind: AUTOMATION_TARGET.NEW_AGENT },
            false,
          ],
          "a new automation is its owner's, on its plan's repository, a new agent each run",
        );
        assert.deepEqual(
          [continued.target, continued.archiveSuccessful],
          [{ kind: AUTOMATION_TARGET.SAME_AGENT, agentId }, true],
        );
        assert.deepEqual(strangerAgent.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
        assert.deepEqual(inPersonalWorkspace.body, { error: HOSTED_API_ERROR.INVALID_REQUEST });
        assert.equal(shared.scope, AUTOMATION_SCOPE.WORKSPACE);
      }),
  );

  it.effect(
    "a personal automation is its creator's, seen, paused, and deleted by owners and admins; a workspace one is seen, run, and paused by every member and changed by its creator and admins; a creator who left reaches nothing of theirs",
    () =>
      Effect.gen(function* () {
        const { owner, plan } = yield* openAccounts;
        const member = yield* openGithubUser();
        const admin = yield* openGithubUser();
        yield* joinWorkspace(plan.workspaceId, member, WORKSPACE_ROLE.MEMBER);
        yield* joinWorkspace(plan.workspaceId, admin, WORKSPACE_ROLE.MEMBER);
        // The plugin's role text may name several roles; this admin is one only among them.
        yield* Database.use((db) =>
          db
            .update(memberTable)
            .set({ role: `${WORKSPACE_ROLE.MEMBER},${WORKSPACE_ROLE.ADMIN}` })
            .where(eq(memberTable.userId, admin)),
        );
        const { ask } = yield* standing(
          new Map([
            [`Bearer ${owner}`, owner],
            [`Bearer ${member}`, member],
            [`Bearer ${admin}`, admin],
          ]),
        );
        const make = (by: string, body: WireBoundaryInput) =>
          Effect.map(
            ask(HOSTED_SERVICE_PATH.AUTOMATIONS, by, { method: "POST", body }),
            (answer) =>
              readAnswer(automationAnswerSchema, HOSTED_HTTP_STATUS.CREATED, answer).automation,
          );
        const listed = (by: string) =>
          Effect.map(ask(HOSTED_SERVICE_PATH.AUTOMATIONS, by), (answer) =>
            readAnswer(automationListAnswerSchema, HOSTED_HTTP_STATUS.OK, answer)
              .automations.map((each) => each.id)
              .toSorted(),
          );
        const patch = (by: string, id: string, body: WireBoundaryInput) =>
          Effect.map(
            ask(automationPath(id), by, { method: "PATCH", body }),
            (answer) => answer.status,
          );
        const runNow = (by: string, id: string) =>
          Effect.map(
            ask(automationRunPath(id), by, {
              method: "POST",
              body: { idempotencyKey: randomUUID() },
            }),
            (answer) => answer.status,
          );
        const remove = (by: string, id: string) =>
          Effect.map(ask(automationPath(id), by, { method: "DELETE" }), (answer) => answer.status);

        const personal = yield* make(owner, weekdays(plan.id));
        const shared = yield* make(owner, {
          ...weekdays(plan.id),
          scope: AUTOMATION_SCOPE.WORKSPACE,
        });
        const leavers = yield* make(member, weekdays(plan.id));

        assert.deepEqual(yield* listed(member), [shared.id, leavers.id].toSorted());
        assert.deepEqual(
          yield* listed(admin),
          [personal.id, shared.id, leavers.id].toSorted(),
          "owners and admins see every automation of the workspace",
        );
        assert.deepEqual(
          [
            yield* patch(member, shared.id, { name: "Renamed by a member" }),
            yield* patch(member, shared.id, { enabled: false }),
            yield* runNow(member, shared.id),
            yield* runNow(member, personal.id),
            yield* remove(member, shared.id),
          ],
          [
            HOSTED_HTTP_STATUS.FORBIDDEN,
            HOSTED_HTTP_STATUS.OK,
            HOSTED_HTTP_STATUS.CREATED,
            HOSTED_HTTP_STATUS.NOT_FOUND,
            HOSTED_HTTP_STATUS.FORBIDDEN,
          ],
          "a member runs and pauses the workspace's, changes and deletes none, and never sees a personal one",
        );
        assert.deepEqual(
          [
            yield* patch(admin, shared.id, { name: "Renamed by an admin" }),
            yield* patch(admin, personal.id, { name: "Not theirs to change" }),
            yield* patch(admin, personal.id, { enabled: false }),
            yield* runNow(admin, personal.id),
          ],
          [
            HOSTED_HTTP_STATUS.OK,
            HOSTED_HTTP_STATUS.FORBIDDEN,
            HOSTED_HTTP_STATUS.OK,
            HOSTED_HTTP_STATUS.FORBIDDEN,
          ],
          "an admin changes the workspace's, and pauses but neither changes nor runs a personal one",
        );

        yield* leaveWorkspace(plan.workspaceId, member);
        assert.deepEqual(yield* listed(member), [], "a creator who left reaches nothing of theirs");
        assert.equal(
          yield* remove(admin, leavers.id),
          HOSTED_HTTP_STATUS.OK,
          "and an admin deletes it",
        );
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
});
