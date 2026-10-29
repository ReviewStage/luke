/**
 * runner-lease.ts -- an agent's runner lease, held around every call that writes to its runner or queues a line for it.
 *
 * The lease is one row per agent (`@luke/database/models/agent-runner-lease`),
 * claimed for `CODER.RUNNER_LEASE.HOLD` and let go as the call ends. It is
 * what keeps a cloud runner's writes in order and a local agent's lines
 * committed in the order of their `seq` (`device-agent-store.ts`'s header).
 */

import { randomUUID } from "node:crypto";
import {
  claimAgentRunnerLease,
  releaseAgentRunnerLease,
} from "@luke/database/models/agent-runner-lease";
import { failureKind } from "@luke/runtime/effect";
import { Clock, Data, Duration, Effect, Option } from "effect";
import { agentLogIds } from "./agent-log.js";
import { CODER } from "./bounds.js";

/** Another call held the agent's runner lease for as long as a call waits on it. */
class RunnerLeaseBusy extends Data.TaggedError("RunnerLeaseBusy") {}

/**
 * The agent's runner lease taken, waiting behind another call's for at most
 * `wait`: the holder's id, which lets it go. Run where
 * nothing interrupts, so a claim that landed is always handed back to be let
 * go; only the waits between claims are given to `restore`, so a caller's
 * deadline interrupts a call waiting behind another's lease at once, holding
 * nothing.
 */
const claimRunnerLease = (
  agentId: string,
  wait: Duration.Duration,
  restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const holder = randomUUID();
    const hold = Duration.toMillis(CODER.RUNNER_LEASE.HOLD);
    const startedAt = yield* Clock.currentTimeMillis;
    while (true) {
      const now = yield* Clock.currentTimeMillis;
      if (yield* claimAgentRunnerLease(agentId, holder, new Date(now), new Date(now + hold))) {
        return holder;
      }
      if (now - startedAt >= Duration.toMillis(wait)) {
        return yield* new RunnerLeaseBusy();
      }
      yield* restore(Effect.sleep(CODER.RUNNER_LEASE.POLL));
    }
  });

/** The lease let go, where the holder still holds it; a release that fails leaves it to lapse at its `HOLD`, said in the log naming the agent. */
const released = (agentId: string, holder: string) =>
  releaseAgentRunnerLease(agentId, holder).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`a runner lease was not let go: ${failureKind(failure)}`).pipe(
        Effect.annotateLogs(agentLogIds({ id: agentId })),
      ),
    ),
  );

/**
 * The body run holding the agent's runner lease, waiting behind another
 * call's for at most `wait` (`CODER.RUNNER_LEASE.WAIT` unless the caller
 * names longer, as work past a request's answer may), let go as it ends
 * however it ends, an interruption included.
 */
export const holdingRunner = <A, E, R>(
  agentId: string,
  body: Effect.Effect<A, E, R>,
  wait: Duration.Duration = CODER.RUNNER_LEASE.WAIT,
) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const holder = yield* claimRunnerLease(agentId, wait, restore);
      return yield* restore(body).pipe(Effect.ensuring(released(agentId, holder)));
    }),
  );

/**
 * As `holdingRunner`, but only where no other call holds the lease now:
 * the body's result, or none at once where one does, so a sweep passes the
 * agent by until its next run rather than waiting behind a call.
 */
export const holdingRunnerIfFree = <A, E, R>(agentId: string, body: Effect.Effect<A, E, R>) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const holder = randomUUID();
      const now = yield* Clock.currentTimeMillis;
      const until = now + Duration.toMillis(CODER.RUNNER_LEASE.HOLD);
      if (!(yield* claimAgentRunnerLease(agentId, holder, new Date(now), new Date(until)))) {
        return Option.none<A>();
      }
      return Option.some(yield* restore(body).pipe(Effect.ensuring(released(agentId, holder))));
    }),
  );
