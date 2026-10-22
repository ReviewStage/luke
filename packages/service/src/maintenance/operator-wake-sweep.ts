/**
 * operator-wake-sweep.ts -- the scheduled sweep's wake of an operator whose member's agent failed.
 *
 * An operator reads what its member's agents did as notices on its next
 * turn (`@luke/database/models/operator-notices`), never one wake per
 * event; a failure alone wakes it at once, which here is within the
 * sweep's minute: a failure notice still unread that no wake answered
 * within `HOLD` before it is handed to the operator as a short line from
 * Luke naming the agent, the one way a message reaches an agent
 * (`steerCodingAgent`). So an agent that fails again within the hour of
 * a wake wakes nothing, and its notice waits on the desk; one that fails
 * past the hour wakes it again. An operator's own turns leave no notice,
 * so never wake it.
 *
 * The wake is recorded only once the steer landed, under the sweep's own
 * instant, so a wake refused or cut off is tried again next minute and holds
 * no hour; its message goes under a key of the failure's own, so one that
 * landed before its record is told once. A failure older than `HOLD` is
 * left to the desk, so a wake that keeps failing stops being tried. Each
 * call is bounded so the sweep's minute holds.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import {
  type DueOperatorWake,
  dueOperatorWakes,
  recordOperatorWake,
} from "@luke/database/models/operator-notices";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import { MENTION_KIND } from "@luke/features/mention-link";
import { Duration, Effect, Option, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { steerCodingAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { workspaceStepOf, writtenMention } from "../agents/written-mentions.js";
import type { EveForAccount } from "../automations/automation-runs.js";
import type { GitHubApp } from "../github/github-app.js";

export const OPERATOR_WAKE_SWEEP = {
  /** How long after a wake for one agent's failure another failure of it wakes nothing. */
  HOLD: Duration.hours(1),
  /** The most wakes one sweep sends; the rest wait for the next minute. */
  MAX_WAKES: 20,
  CONCURRENCY: 5,
} as const;

/** What one sweep of the failures due a wake came to: operators woken, and wakes not sent this time. */
export interface OperatorWakeSweepOutcome {
  woken: number;
  failed: number;
}

/** The key a failure's wake is sent under: the notice and the failure it stands for now, so a repeat is told once. */
function wakeKey(wake: DueOperatorWake): string {
  return `operator-wake:${wake.noticeId}:${wake.at.getTime()}`;
}

/** The line that wakes the operator, naming the agent that failed. */
function wakeLine(wake: DueOperatorWake, step: string): string {
  const name = wake.agentPersonaName ?? wake.agentTitle ?? wake.agentModel;
  const task = wake.taskId === null ? undefined : { taskId: wake.taskId };
  const mention = writtenMention(
    { kind: MENTION_KIND.AGENT, ...task, agentId: wake.agentId },
    name,
    step,
  );
  return `${mention}, one of your member's agents, failed a turn just now. ${AGENT_TOOL.READ_AGENT} reads why; act on it as your policy lets you.`;
}

/**
 * One failure's wake handed to its operator; whether it landed. An
 * operator gone or archived since is woken by no one, and counts as done.
 */
const wake = (eveFor: EveForAccount, due: DueOperatorWake, now: Date) =>
  Effect.gen(function* () {
    const operator = yield* readCodingAgent(due.userId, due.operatorId);
    if (Option.isNone(operator) || operator.value.archivedAt !== null) return true;
    const step = yield* workspaceStepOf(due.userId, due.organizationId);
    const eve = yield* eveFor(due.userId);
    yield* steerCodingAgent(
      eve,
      storeWriter({ tools: CODER_TOOL_SET }),
      due.userId,
      operator.value,
      {
        text: wakeLine(due, step),
        clientKey: wakeKey(due),
        sender: { kind: MESSAGE_SENDER.LUKE },
      },
    );
    yield* recordOperatorWake(due.operatorId, due.agentId, now);
    return true;
  }).pipe(
    // The failure's kind alone: nothing of the agent or its member rides the line.
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("operator wakes: a failure's wake was not sent", {
          failure: "error" in failure ? failure.error : failure._tag,
        }),
        false,
      ),
    ),
  );

/**
 * Wakes the operators whose member's agents failed and are due a wake at
 * `now`, a sweep's worth, `CONCURRENCY` at a time.
 */
export const sweepOperatorWakes = /* @__PURE__ */ Effect.fn("web/sweepOperatorWakes")(function* (
  eveFor: EveForAccount,
  now: Date,
): Effect.fn.Return<
  OperatorWakeSweepOutcome,
  QueryError | Schema.SchemaError,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  const holdMs = Duration.toMillis(OPERATOR_WAKE_SWEEP.HOLD);
  const due = yield* dueOperatorWakes(
    new Date(now.getTime() - holdMs),
    holdMs,
    OPERATOR_WAKE_SWEEP.MAX_WAKES,
  );
  const landed = yield* Effect.forEach(due, (each) => wake(eveFor, each, now), {
    concurrency: OPERATOR_WAKE_SWEEP.CONCURRENCY,
  });
  const woken = landed.filter(Boolean).length;
  return { woken, failed: landed.length - woken };
});
