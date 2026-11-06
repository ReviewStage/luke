import { randomUUID } from "node:crypto";
import {
  claimAgentRunnerLease,
  releaseAgentRunnerLease,
} from "@repo/database/models/agent-runner-lease";
import { failureKind } from "@repo/runtime/effect";
import { Clock, Data, Duration, Effect, Option } from "effect";
import { agentLogIds } from "./agent-log.js";
import { CODER } from "./bounds.js";

class RunnerLeaseBusy extends Data.TaggedError("RunnerLeaseBusy") {}

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

const released = (agentId: string, holder: string) =>
  releaseAgentRunnerLease(agentId, holder).pipe(
    Effect.catch((failure) =>
      Effect.logWarning(`a runner lease was not let go: ${failureKind(failure)}`).pipe(
        Effect.annotateLogs(agentLogIds({ id: agentId })),
      ),
    ),
  );

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
