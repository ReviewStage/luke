import type { DatabaseServices } from "@sidecar/database/core/query";
import {
  type Automation,
  type AutomationRun,
  type AutomationRunOutcome,
  attachRunAgent,
  automationRunsSince,
  claimAutomationRun,
  claimedRunsStarting,
  failClaimedRun,
  latestAutomationStarts,
  pauseAutomation,
  readAutomationToRun,
  type StrandedRun,
  settleAutomationRun,
  startedRunAgents,
  withAutomationLocked,
} from "@sidecar/database/models/automation-store";
import {
  awaitingLinesOfReached,
  discardCodingAgent,
  latestTurnsOfReached,
  readCodingAgentByKey,
} from "@sidecar/database/models/coding-agent-store";
import {
  AUTOMATION_FIRING,
  AUTOMATION_PAUSE,
  AUTOMATION_RUN_REASON,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_TRIGGER,
  type AutomationRunReason,
} from "@sidecar/hosted/automation-wire";
import { CODING_AGENT_STATUS, type CodingAgentStatus } from "@sidecar/hosted/coding-agent-wire";
import { failureKind } from "@sidecar/runtime/effect";
import { Clock, Duration, Effect, Option, Result } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { EveSessions } from "./brain-host/eve-sessions.js";
import { CODER } from "./coder-host/bounds.js";
import { type StartServices, startCodingAgent } from "./coder-host/start.js";
import { codingAgentStatusOf } from "./coder-host/status.js";
import { HOSTED_API_ERROR } from "./http.js";
import type { HostedRefusal } from "./http-effect.js";
import type { ModelChoiceRefused } from "./model-catalog.js";

/**
 * automation-runs.ts -- one queued automation run acted on: its guards read, its coding agent started as the deployment acting for the owner, and the run settled.
 *
 * A run is a Start with a task, on the one path a Start takes
 * (`coder-host/start.ts`), so the plan, its repository, the owner's reach
 * of it through the Luke GitHub App, and the model are checked exactly as
 * they are for the developer's own Start, and the agent runs as the owner
 * on the owner's keys. eve is reached as the deployment acting for the
 * owner, the opening the coder channel already admits for the voice
 * brain (`coder-host/channel.ts`), since no request of the owner's is in
 * hand. The run's own id is the Start's key, so a run acted on twice, by two
 * sweeps or a sweep and its trigger, starts one agent.
 *
 * Before the start, the guards: a run whose automation was paused after it
 * was queued is skipped, but for the owner's own "Run now"; and a run past
 * the daily cap (runs started in the last twenty-four hours) or past the
 * concurrency guard (agents its runs started that are still starting or
 * running, read as each agent's tab reads it) is skipped, never queued. The
 * guards read what earlier runs settled, so the sweep acts on one
 * automation's runs one after another (`automation-sweep.ts`); a noisy
 * trigger costs nothing past
 * its caps. A start refused is a failed run with one fixed word for why,
 * and an automation whose last three starts all failed is paused, so a
 * lapsed GitHub sign-in or a deleted repository stops firing rather than
 * failing every minute it is due.
 */

/** How long a claimed run counts as starting; a start runs in seconds, and one older is the sweep's to recover. */
const CLAIM_WINDOW_MS = 10 * 60_000;

const AUTOMATION_RUNS = {
  /** The window the daily cap counts started runs over. */
  CAP_WINDOW: Duration.days(1),
  /** How many failed starts in a row pause an automation. */
  FAILURES_TO_PAUSE: 3,
} as const;

/** The statuses under which an agent counts against the concurrency guard. */
const WORKING: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** eve's coding-agent service as the deployment acting for one account, or the refusal where this deployment cannot reach it. */
export type EveForAccount = (
  userId: string,
) => Effect.Effect<EveSessions, HostedRefusal, HttpClient.HttpClient>;

/** Why this run was fired, in the words the agent's task closes with. */
function firingSentence(automation: Automation, run: AutomationRun): string {
  const { firing } = run;
  switch (firing.kind) {
    case AUTOMATION_FIRING.SCHEDULE:
      return automation.trigger.kind === AUTOMATION_TRIGGER.SCHEDULE
        ? `its schedule (\`${automation.trigger.cron}\` in ${automation.trigger.timezone}) was due at ${new Date(firing.dueAt).toISOString()}`
        : `its schedule was due at ${new Date(firing.dueAt).toISOString()}`;
    case AUTOMATION_FIRING.MANUAL:
      return "its owner asked for a run now";
    default:
      return `it was fired by ${firing.kind}`;
  }
}

/**
 * The task the run's agent is handed: the automation's prompt, then a line
 * saying which automation started it and why, so the agent and the
 * developer reading its tab both know it was not typed by hand.
 */
function automationTask(automation: Automation, run: AutomationRun): string {
  return [
    automation.action.prompt,
    "---",
    `Luke started this run for the automation "${automation.name}" because ${firingSentence(automation, run)}. No one is watching it as it runs: decide on your own, and post to the inbox only what needs the developer.`,
  ].join("\n\n");
}

/** The fixed word for why a start was refused, so nothing a provider or GitHub said reaches the history. */
function reasonOfRefusal(refusal: HostedRefusal | ModelChoiceRefused): AutomationRunReason {
  if ("_tag" in refusal) return AUTOMATION_RUN_REASON.MODEL;
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
    case HOSTED_API_ERROR.PLAN_ARCHIVED:
      return AUTOMATION_RUN_REASON.PLAN_UNREACHABLE;
    case HOSTED_API_ERROR.NO_REPOSITORY:
      return AUTOMATION_RUN_REASON.NO_REPOSITORY;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return AUTOMATION_RUN_REASON.REPOSITORY_UNREACHABLE;
    case HOSTED_API_ERROR.GITHUB_SIGN_IN_REQUIRED:
      return AUTOMATION_RUN_REASON.GITHUB_SIGN_IN;
    default:
      return AUTOMATION_RUN_REASON.UNAVAILABLE;
  }
}

/** How many of the agents the automation's runs started are still at work at `now`. */
const workingAgents = Effect.fnUntraced(function* (automation: Automation, now: number) {
  // An agent's run is bounded by its sandbox's day, so a run older than that holds no agent at work.
  const since = new Date(now - CODER.SANDBOX_TIMEOUT_MS - Duration.toMillis(Duration.hours(1)));
  const agents = yield* startedRunAgents(automation.id, since);
  const conversations = agents.map((agent) => agent.conversationId);
  const turns = yield* latestTurnsOfReached(conversations);
  const awaiting = yield* awaitingLinesOfReached(conversations);
  return agents.filter((agent) =>
    WORKING.has(
      codingAgentStatusOf(turns.get(agent.conversationId), {
        createdAt: agent.createdAt,
        now,
        lineAwaits: awaiting.has(agent.conversationId),
      }),
    ),
  ).length;
});

/** The guard that holds this run back, if one does. */
const heldBack = Effect.fnUntraced(function* (automation: Automation, now: number) {
  const recent = yield* automationRunsSince(
    automation.id,
    new Date(now - Duration.toMillis(AUTOMATION_RUNS.CAP_WINDOW)),
  );
  const started = recent.filter((run) => run.status === AUTOMATION_RUN_STATUS.STARTED).length;
  if (started >= automation.guards.dailyRunCap) return AUTOMATION_RUN_REASON.DAILY_CAP;
  const working = yield* workingAgents(automation, now);
  // A run claimed and still starting holds a place as an agent at work does.
  const starting = yield* claimedRunsStarting(automation.id, new Date(now - CLAIM_WINDOW_MS));
  if (working + starting >= automation.guards.maxConcurrentRuns) {
    return AUTOMATION_RUN_REASON.CONCURRENCY;
  }
  return undefined;
});

/** Pauses the automation where its newest starts, skips aside, all failed. */
const pauseAfterFailures = Effect.fnUntraced(function* (automation: Automation) {
  const starts = yield* latestAutomationStarts(automation.id, AUTOMATION_RUNS.FAILURES_TO_PAUSE);
  if (
    starts.length === AUTOMATION_RUNS.FAILURES_TO_PAUSE &&
    starts.every((run) => run.status === AUTOMATION_RUN_STATUS.FAILED)
  ) {
    yield* pauseAutomation(automation.id, AUTOMATION_PAUSE.FAILURES);
  }
});

/** What the locked look at a run came to: held back by a guard, claimed for its start, or settled by another act already. */
const DECISION = {
  HELD: "held",
  CLAIMED: "claimed",
  TAKEN: "taken",
} as const;

type Decision =
  | { readonly kind: typeof DECISION.HELD; readonly reason: AutomationRunReason }
  | { readonly kind: typeof DECISION.CLAIMED }
  | { readonly kind: typeof DECISION.TAKEN };

/**
 * The guards read and the run claimed under the automation's row lock, so
 * two acts on its runs, a sweep and a "Run now" among them, never both read
 * room for one more agent: a run held back is settled skipped there, and
 * one let through is claimed, started with no agent yet, which the next
 * act's concurrency counts.
 */
const decide = (automation: Automation, run: AutomationRun) =>
  withAutomationLocked(
    automation.id,
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      // A run queued before its automation was paused starts nothing; the owner's own "Run now" still runs.
      const paused = !automation.enabled && run.firing.kind !== AUTOMATION_FIRING.MANUAL;
      const held = paused ? AUTOMATION_RUN_REASON.PAUSED : yield* heldBack(automation, now);
      if (held !== undefined) {
        const settled = yield* settleAutomationRun(run.id, {
          status: AUTOMATION_RUN_STATUS.SKIPPED,
          reason: held,
        });
        return settled
          ? ({ kind: DECISION.HELD, reason: held } satisfies Decision)
          : ({ kind: DECISION.TAKEN } satisfies Decision);
      }
      const claimed = yield* claimAutomationRun(run.id);
      return claimed
        ? ({ kind: DECISION.CLAIMED } satisfies Decision)
        : ({ kind: DECISION.TAKEN } satisfies Decision);
    }),
  );

/** A claimed run's agent started, the run settled with it, or failed with the start's refusal in one fixed word. */
const startClaimed = Effect.fnUntraced(function* (
  eveFor: EveForAccount,
  automation: Automation,
  run: AutomationRun,
) {
  const start = yield* Effect.result(
    startCodingAgent(eveFor(automation.userId), automation.userId, {
      planId: automation.planId,
      idempotencyKey: run.id,
      choice: automation.action.choice,
      task: automationTask(automation, run),
      rememberChoice: false,
    }),
  );
  if (Result.isSuccess(start)) {
    yield* attachRunAgent(run.id, start.success.agent.id);
    const outcome: AutomationRunOutcome = {
      status: AUTOMATION_RUN_STATUS.STARTED,
      codingAgentId: start.success.agent.id,
    };
    return outcome;
  }
  const reason = reasonOfRefusal(start.failure);
  yield* failClaimedRun(run.id, reason);
  const outcome: AutomationRunOutcome = { status: AUTOMATION_RUN_STATUS.FAILED, reason };
  return outcome;
});

/**
 * The run acted on: settled as the start a function before this one made
 * under its key where one did, else decided under the lock and, claimed,
 * started; nothing where another act settled it first.
 */
const outcomeOf = Effect.fnUntraced(function* (
  eveFor: EveForAccount,
  automation: Automation,
  run: AutomationRun,
) {
  // A run whose agent a start already made, its settling lost after, is that start's, whatever the guards read now.
  const started = yield* readCodingAgentByKey(automation.userId, run.id);
  if (Option.isSome(started)) {
    yield* attachRunAgent(run.id, started.value.id);
    return {
      status: AUTOMATION_RUN_STATUS.STARTED,
      codingAgentId: started.value.id,
    } satisfies AutomationRunOutcome;
  }
  const decision = yield* decide(automation, run);
  switch (decision.kind) {
    case DECISION.HELD:
      return {
        status: AUTOMATION_RUN_STATUS.SKIPPED,
        reason: decision.reason,
      } satisfies AutomationRunOutcome;
    case DECISION.TAKEN:
      return undefined;
    case DECISION.CLAIMED:
      return yield* startClaimed(eveFor, automation, run);
  }
});

/**
 * Acts on one queued run and settles it, answering how it came out;
 * nothing where its automation is gone. A store that fails midway is
 * logged and the run left queued, so the next sweep acts on it again under
 * the same key.
 */
export const executeAutomationRun = /* @__PURE__ */ Effect.fn("web/executeAutomationRun")(
  function* (
    eveFor: EveForAccount,
    run: AutomationRun,
  ): Effect.fn.Return<AutomationRunOutcome | undefined, never, StartServices> {
    return yield* Effect.gen(function* () {
      const automation = yield* readAutomationToRun(run.automationId);
      if (Option.isNone(automation)) return undefined;
      const outcome = yield* outcomeOf(eveFor, automation.value, run);
      if (outcome?.status === AUTOMATION_RUN_STATUS.FAILED) {
        yield* pauseAfterFailures(automation.value);
      }
      return outcome;
    }).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`an automation run could not be acted on: ${failureKind(failure)}`),
          undefined,
        ),
      ),
    );
  },
);

/**
 * A claimed run whose function died between the claim and its agent,
 * settled as the start its key made where that agent's session ran, and
 * failed as unavailable where none did, an agent made but never opened let
 * go with it, so no run is left starting for good.
 */
export const recoverStrandedRun = /* @__PURE__ */ Effect.fn("web/recoverStrandedRun")(function* (
  stranded: StrandedRun,
): Effect.fn.Return<void, unknown, DatabaseServices> {
  const started = yield* readCodingAgentByKey(stranded.userId, stranded.id);
  // Note that an agent made under the key whose session never ran a turn was never opened, the
  // function gone between making it and eve taking it, so it is let go rather than taken as started.
  const opened = Option.isSome(started)
    ? (yield* latestTurnsOfReached([started.value.conversationId])).size > 0
    : false;
  if (Option.isSome(started) && opened) {
    yield* attachRunAgent(stranded.id, started.value.id);
    return;
  }
  if (Option.isSome(started)) yield* discardCodingAgent(stranded.userId, started.value.id);
  yield* failClaimedRun(stranded.id, AUTOMATION_RUN_REASON.UNAVAILABLE);
});
