/**
 * native-wakeup-sweep.ts -- the scheduled sweep's delivery of the wakeups a native agent's released wait left.
 *
 * A Claude Code agent that waited on one-shot wakeups alone was released:
 * its runner ended the launch, so its sandbox stopped, and named each wakeup
 * with the instant it comes due (`@luke/agent-runner/protocol`'s
 * `RUNNER_RELEASE`), which the events route kept
 * (`@luke/database/models/coding-agent-wakeups`). Once a wakeup is due, the
 * sweep hands its prompt to the agent as a message from Luke, the one way a
 * message reaches an agent (`steerCodingAgent`), which relaunches the CLI on
 * the session it resumes, as the wakeup would have started a turn in the
 * CLI that waited. The message goes under a key of the wakeup's own, so a
 * delivery repeated after one that landed is told once.
 *
 * A delivery takes its wakeup before it sends, so one a Stop or a launch
 * deleted since the claim is never sent; one refused or failed is said in
 * the log by its kind, put back, and claimed again `RETRY` later, at most
 * `MAX_ATTEMPTS` times. Each call is bounded so the sweep's minute holds.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { readCodingAgent } from "@luke/database/models/coding-agent-store";
import {
  type ClaimedCodingAgentWakeup,
  claimDueCodingAgentWakeups,
  restoreCodingAgentWakeup,
  takeCodingAgentWakeup,
} from "@luke/database/models/coding-agent-wakeups";
import { storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { Duration, Effect, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { steerCodingAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { EveForAccount } from "../automations/automation-runs.js";
import type { GitHubApp } from "../github/github-app.js";

export const NATIVE_WAKEUP_SWEEP = {
  /** The most wakeups one sweep delivers; the rest wait for the next minute. */
  MAX_DELIVERIES: 20,
  CONCURRENCY: 5,
  /** How long after a delivery that failed the wakeup is claimed again. */
  RETRY: Duration.minutes(5),
  /** How many deliveries of one wakeup are tried before it is given up. */
  MAX_ATTEMPTS: 3,
} as const;

/** What one sweep of the wakeups due came to: delivered, and not delivered this time. */
export interface NativeWakeupSweepOutcome {
  delivered: number;
  failed: number;
}

/** The key a wakeup's message is sent under, so a delivery repeated is told once. */
function wakeupKey(wakeup: ClaimedCodingAgentWakeup): string {
  return `native-wakeup:${wakeup.id}`;
}

/**
 * One wakeup handed to its agent as a message from Luke; whether it landed.
 * It is taken from the table before it is sent, so one a Stop or a launch
 * deleted since the claim is not sent, and it is put back as claimed where
 * the send failed.
 */
const deliver = (eveFor: EveForAccount, wakeup: ClaimedCodingAgentWakeup) =>
  Effect.gen(function* () {
    const agent = yield* readCodingAgent(wakeup.userId, wakeup.agentId);
    // An agent gone since is no one's to tell, and its wakeups went with it.
    if (Option.isNone(agent)) return true;
    const taken = yield* takeCodingAgentWakeup(wakeup.id);
    if (Option.isNone(taken)) return true;
    yield* Effect.gen(function* () {
      const eve = yield* eveFor(wakeup.userId);
      yield* steerCodingAgent(
        eve,
        storeWriter({ tools: CODER_TOOL_SET }),
        wakeup.userId,
        agent.value,
        {
          text: wakeup.prompt,
          clientKey: wakeupKey(wakeup),
          sender: { kind: MESSAGE_SENDER.LUKE },
        },
      );
    }).pipe(Effect.tapError(() => Effect.ignore(restoreCodingAgentWakeup(taken.value))));
    return true;
  }).pipe(
    // The failure's kind alone: nothing of the prompt or the agent rides the line.
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("native wakeups: a wakeup was not delivered", {
          failure: "error" in failure ? failure.error : failure._tag,
        }),
        false,
      ),
    ),
  );

/**
 * Delivers the native agents' wakeups due at `now`, a sweep's worth,
 * `CONCURRENCY` at a time. A claim the store refused delivers nothing this
 * minute rather than failing the sweeps after it.
 */
export const sweepNativeWakeups = /* @__PURE__ */ Effect.fn("web/sweepNativeWakeups")(function* (
  eveFor: EveForAccount,
  now: Date,
): Effect.fn.Return<
  NativeWakeupSweepOutcome,
  QueryError | Schema.SchemaError,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  const claimed = yield* Effect.result(
    claimDueCodingAgentWakeups(
      now,
      new Date(now.getTime() + Duration.toMillis(NATIVE_WAKEUP_SWEEP.RETRY)),
      NATIVE_WAKEUP_SWEEP.MAX_DELIVERIES,
      NATIVE_WAKEUP_SWEEP.MAX_ATTEMPTS,
    ),
  );
  if (Result.isFailure(claimed)) {
    yield* Effect.logWarning(`native wakeups: none were claimed: ${claimed.failure._tag}`);
    return { delivered: 0, failed: 0 };
  }
  const landed = yield* Effect.forEach(claimed.success, (wakeup) => deliver(eveFor, wakeup), {
    concurrency: NATIVE_WAKEUP_SWEEP.CONCURRENCY,
  });
  const delivered = landed.filter(Boolean).length;
  return { delivered, failed: landed.length - delivered };
});
