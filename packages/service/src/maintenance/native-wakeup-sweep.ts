import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { readAgent } from "@repo/database/models/agent-store";
import {
  agentWakeupStands,
  type ClaimedAgentWakeup,
  claimDueAgentWakeups,
  deleteAgentWakeup,
} from "@repo/database/models/agent-wakeups";
import { APP_LINE_METADATA, storeWriter } from "@repo/database/models/writer";
import { Duration, Effect, Option, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { agentLineSender, steerAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import type { SessionsForAccount } from "../automations/automation-runs.js";
import type { GitHubApp } from "../github/github-app.js";

export const NATIVE_WAKEUP_SWEEP = {
  MAX_DELIVERIES: 20,
  CONCURRENCY: 5,
  RETRY: Duration.minutes(5),
  MAX_ATTEMPTS: 3,
} as const;

export interface NativeWakeupSweepOutcome {
  delivered: number;
  failed: number;
}

function wakeupKey(wakeup: ClaimedAgentWakeup): string {
  return `native-wakeup:${wakeup.id}`;
}

const deliver = (sessionsFor: SessionsForAccount, wakeup: ClaimedAgentWakeup) =>
  Effect.gen(function* () {
    const agent = yield* readAgent(wakeup.userId, wakeup.agentId);
    if (Option.isNone(agent)) return true;
    if (!(yield* agentWakeupStands(wakeup.id))) return true;
    const eve = yield* sessionsFor(wakeup.userId);
    yield* steerAgent(eve, storeWriter({ tools: CODER_TOOL_SET }), wakeup.userId, agent.value, {
      text: wakeup.prompt,
      clientKey: wakeupKey(wakeup),
      sender: agentLineSender(agent.value),
      metadata: APP_LINE_METADATA,
    });
    yield* deleteAgentWakeup(wakeup.id);
    return true;
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("native wakeups: a wakeup was not delivered", {
          failure: "error" in failure ? failure.error : failure._tag,
        }),
        false,
      ),
    ),
  );

export const sweepNativeWakeups = /* @__PURE__ */ Effect.fn("web/sweepNativeWakeups")(function* (
  sessionsFor: SessionsForAccount,
  now: Date,
): Effect.fn.Return<
  NativeWakeupSweepOutcome,
  QueryError | Schema.SchemaError,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  const claimed = yield* Effect.result(
    claimDueAgentWakeups(
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
  const landed = yield* Effect.forEach(claimed.success, (wakeup) => deliver(sessionsFor, wakeup), {
    concurrency: NATIVE_WAKEUP_SWEEP.CONCURRENCY,
  });
  const delivered = landed.filter(Boolean).length;
  return { delivered, failed: landed.length - delivered };
});
