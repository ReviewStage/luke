/**
 * runner-lease.ts -- an agent's runner lease, held around every call that writes to its runner or queues a line for it.
 *
 * The lease is one row per agent (`@luke/database/models/coding-agent-runner-lease`),
 * claimed for `CODER.RUNNER_LEASE.HOLD` and let go as the call ends. It is
 * what keeps a cloud runner's writes in order and a local agent's lines
 * committed in the order of their `seq` (`device-agent-store.ts`'s header).
 */

import { randomUUID } from "node:crypto";
import {
  claimCodingAgentRunnerLease,
  releaseCodingAgentRunnerLease,
} from "@luke/database/models/coding-agent-runner-lease";
import { Clock, Data, Duration, Effect } from "effect";
import { CODER } from "./bounds.js";

/** Another call held the agent's runner lease for as long as a call waits on it. */
class RunnerLeaseBusy extends Data.TaggedError("RunnerLeaseBusy") {}

/**
 * The agent's runner lease taken, waiting behind another call's for at most
 * `CODER.RUNNER_LEASE.WAIT`: the holder's id, which lets it go. Run where
 * nothing interrupts, so a claim that landed is always handed back to be let
 * go; only the waits between claims are given to `restore`, so a caller's
 * deadline interrupts a call waiting behind another's lease at once, holding
 * nothing.
 */
const claimRunnerLease = (
  agentId: string,
  restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const holder = randomUUID();
    const hold = Duration.toMillis(CODER.RUNNER_LEASE.HOLD);
    const startedAt = yield* Clock.currentTimeMillis;
    while (true) {
      const now = yield* Clock.currentTimeMillis;
      if (
        yield* claimCodingAgentRunnerLease(agentId, holder, new Date(now), new Date(now + hold))
      ) {
        return holder;
      }
      if (now - startedAt >= Duration.toMillis(CODER.RUNNER_LEASE.WAIT)) {
        return yield* new RunnerLeaseBusy();
      }
      yield* restore(Effect.sleep(CODER.RUNNER_LEASE.POLL));
    }
  });

/**
 * The body run holding the agent's runner lease, let go as it ends however
 * it ends, an interruption included. A release that fails leaves the lease
 * to lapse at its `HOLD`.
 */
export const holdingRunner = <A, E, R>(agentId: string, body: Effect.Effect<A, E, R>) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const holder = yield* claimRunnerLease(agentId, restore);
      return yield* restore(body).pipe(
        Effect.ensuring(
          releaseCodingAgentRunnerLease(agentId, holder).pipe(
            Effect.catch((failure) =>
              Effect.logWarning(`a runner lease was not let go: ${failure._tag}`),
            ),
          ),
        ),
      );
    }),
  );
