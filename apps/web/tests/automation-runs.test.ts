import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { readAccountPreferences } from "@sidecar/database/models/account-store";
import {
  type Automation,
  createAutomation,
  listAutomationRuns,
  readAutomation,
  recordAutomationRun,
} from "@sidecar/database/models/automation-store";
import { readCodingAgent } from "@sidecar/database/models/coding-agent-store";
import { getTestDB } from "@sidecar/database/testing";
import {
  AUTOMATION_ACTION,
  AUTOMATION_DEFAULT_GUARDS,
  AUTOMATION_FIRING,
  AUTOMATION_PAUSE,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationGuards,
} from "@sidecar/hosted/automation-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { Clock, Effect, Layer, Option } from "effect";
import { executeAutomationRun } from "../server/hosted/automation-runs";
import { sweepAutomations } from "../server/hosted/automation-sweep";
import {
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveSessions,
} from "../server/hosted/brain-host/eve-sessions";
import { modelCatalogOf, type OfferedModel } from "../server/hosted/model-catalog";
import { githubReaching, openGithubUser } from "./support/github-app-fake";
import { startPlan } from "./support/workspaces";

/**
 * An automation's runs acted on, over a real dialect: a due schedule starts
 * one coding agent on the plan's repository as the deployment acting for
 * the owner, handed the prompt as its task, and a sweep after it starts
 * nothing; a run past the concurrency guard or the daily cap is skipped and
 * starts nothing; and three failed starts in a row pause the automation. eve
 * is a fake at the client's boundary, GitHub a script, the catalog fixed,
 * and the store PGlite. Synthetic accounts, plans, and words throughout.
 */

const RELAY = { owner: "Acme", name: "Relay" } as const;
const INSTALLATION = { id: 7, login: RELAY.owner, repositories: [RELAY] } as const;
const SOL = "openai/gpt-6.1-sol";

const CATALOG: readonly OfferedModel[] = [
  {
    id: CODING_AGENT_DEFAULT_CHOICE.model,
    name: "Claude Opus 5.5",
    provider: MODEL_PROVIDER.ANTHROPIC,
    efforts: ["low", "medium", "high", "max"],
  },
  { id: SOL, name: "GPT-6.1 Sol", provider: MODEL_PROVIDER.OPENAI, efforts: ["low", "high"] },
];

const PROMPT = "Find the flakiest test in CI this week and fix it.";

/** One session opened, as the fake eve saw it: whom for, and its first message. */
interface Opened {
  readonly account: string;
  readonly message: EveMessage;
}

/** eve's coding-agent service as the deployment reaches it for each account, writing down every open. */
function fakeEve() {
  const opened: Opened[] = [];
  const sessions = (account: string): EveSessions => ({
    open: (message) =>
      Effect.sync(() => {
        opened.push({ account, message });
        return { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
      }),
    send: () => Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status: 500 }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
  });
  return { opened, eveFor: (account: string) => Effect.succeed(sessions(account)) };
}

/** What a run reaches beside the store: GitHub reaching the repository, and the catalog. */
const services = Layer.mergeAll(githubReaching([INSTALLATION]).layer, modelCatalogOf(CATALOG));

/** An owner signed in with GitHub, a plan on the repository (or none), and an automation on it due a minute ago. */
const openAutomation = (
  options: { readonly repository?: string | null; readonly guards?: AutomationGuards } = {},
) =>
  Effect.gen(function* () {
    const owner = yield* openGithubUser();
    const plan = yield* startPlan(owner, {
      name: "Flaky tests",
      repository: options.repository === undefined ? `${RELAY.owner}/${RELAY.name}` : null,
    });
    const now = yield* Clock.currentTimeMillis;
    const made = yield* createAutomation(owner, {
      planId: plan.id,
      name: "Flaky-test sweep",
      trigger: { kind: AUTOMATION_TRIGGER.SCHEDULE, cron: "0 9 * * 1-5", timezone: "UTC" },
      action: {
        kind: AUTOMATION_ACTION.CODING_AGENT,
        prompt: PROMPT,
        choice: { model: SOL, effort: "low" },
      },
      guards: options.guards ?? AUTOMATION_DEFAULT_GUARDS,
      nextRunAt: new Date(now - 60_000),
      webhookSecretHash: null,
    });
    return { owner, automation: Option.getOrThrow(made), now };
  });

/** A "Run now" of the automation, queued. */
const runNow = (automation: Automation) =>
  Effect.map(
    recordAutomationRun(automation, {
      dedupeKey: randomUUID(),
      firing: { kind: AUTOMATION_FIRING.MANUAL },
      firedAt: new Date(),
    }),
    Option.getOrThrow,
  );

it.layer(getTestDB())("an automation's runs", (it) => {
  it.effect(
    "a due schedule starts one coding agent as the deployment acting for its owner, handed the prompt as its task, and a sweep after it starts nothing",
    () =>
      Effect.gen(function* () {
        const { owner, automation, now } = yield* openAutomation();
        const eve = fakeEve();

        const first = yield* sweepAutomations(eve.eveFor, now).pipe(Effect.provide(services));
        const second = yield* sweepAutomations(eve.eveFor, now).pipe(Effect.provide(services));

        assert.deepEqual(first, { fired: 1, started: 1, skipped: 0, failed: 0 });
        assert.deepEqual(second, { fired: 0, started: 0, skipped: 0, failed: 0 });
        const [run] = yield* listAutomationRuns(owner, automation.id);
        assert.equal(run?.status, AUTOMATION_RUN_STATUS.STARTED);
        assert.equal(run?.firing.kind, AUTOMATION_FIRING.SCHEDULE);
        const agent = Option.getOrThrow(yield* readCodingAgent(owner, run?.codingAgentId ?? ""));
        assert.equal(agent.model, SOL);
        assert.equal(agent.effort, "low");
        assert.ok(agent.task?.startsWith(PROMPT), "the prompt is the agent's task");
        assert.match(agent.task ?? "", /the automation "Flaky-test sweep"/u);
        assert.deepEqual(
          eve.opened.map((each) => [each.account, each.message.conversationId]),
          [[owner, agent.conversationId]],
        );
        assert.equal(
          yield* readAccountPreferences(owner),
          undefined,
          "an automation's choice does not become the account's default",
        );
      }),
  );

  it.effect("a run past the concurrency guard or the daily cap is skipped and starts nothing", () =>
    Effect.gen(function* () {
      const eve = fakeEve();
      const execute = (automation: Automation) =>
        Effect.flatMap(runNow(automation), (run) =>
          executeAutomationRun(eve.eveFor, run).pipe(Effect.provide(services)),
        );
      const concurrent = yield* openAutomation({
        guards: { maxConcurrentRuns: 1, dailyRunCap: 10 },
      });
      const capped = yield* openAutomation({
        guards: { maxConcurrentRuns: 5, dailyRunCap: 1 },
      });

      const whileWorking = [
        yield* execute(concurrent.automation),
        yield* execute(concurrent.automation),
      ];
      const pastCap = [yield* execute(capped.automation), yield* execute(capped.automation)];

      assert.deepEqual(
        whileWorking.map((outcome) => outcome?.status),
        [AUTOMATION_RUN_STATUS.STARTED, AUTOMATION_RUN_STATUS.SKIPPED],
      );
      assert.deepEqual(whileWorking[1], {
        status: AUTOMATION_RUN_STATUS.SKIPPED,
        reason: AUTOMATION_RUN_REASON.CONCURRENCY,
      });
      assert.deepEqual(pastCap[1], {
        status: AUTOMATION_RUN_STATUS.SKIPPED,
        reason: AUTOMATION_RUN_REASON.DAILY_CAP,
      });
      assert.equal(eve.opened.length, 2, "only the two started runs opened a session");
    }),
  );

  it.effect(
    "three failed starts in a row pause the automation, each failure named in one fixed word",
    () =>
      Effect.gen(function* () {
        const { owner, automation } = yield* openAutomation({ repository: null });
        const eve = fakeEve();

        const outcomes = [];
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const run = yield* runNow(automation);
          outcomes.push(
            yield* executeAutomationRun(eve.eveFor, run).pipe(Effect.provide(services)),
          );
        }

        assert.deepEqual(
          outcomes.map(
            (outcome) => outcome?.status === AUTOMATION_RUN_STATUS.FAILED && outcome.reason,
          ),
          [
            AUTOMATION_RUN_REASON.NO_REPOSITORY,
            AUTOMATION_RUN_REASON.NO_REPOSITORY,
            AUTOMATION_RUN_REASON.NO_REPOSITORY,
          ],
        );
        const paused = Option.getOrThrow(yield* readAutomation(owner, automation.id));
        assert.equal(paused.enabled, false);
        assert.equal(paused.pausedReason, AUTOMATION_PAUSE.FAILURES);
        assert.equal(paused.nextRunAt, null);
        assert.deepEqual(eve.opened, []);
      }),
  );
});
