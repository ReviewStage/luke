import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import {
  type StandingSession,
  standingSessionsNamed,
} from "@repo/database/models/recorded-session";
import { CONVERSATION_KIND } from "@repo/database/storage-vocabulary";
import { Duration, Effect, Option, Ref, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { routedSessions } from "./coder-host/runtime-sessions.js";
import {
  type AgentSessions,
  describeUnreachable,
  EVE_RESET_OUTCOME,
} from "./eve-host/eve-sessions.js";

const RETIRE_SESSIONS = {
  CONCURRENCY: 4,
  TIMEOUT: Duration.seconds(35),
  BUDGET: Duration.seconds(60),
} as const;

export type Retiring = Pick<AgentSessions, "reset">;

export const retiringReach = (account: string): Effect.Effect<Retiring, never, DatabaseServices> =>
  routedSessions(account);

const retireOne = (
  retiring: Retiring,
  session: StandingSession,
): Effect.Effect<void, never, HttpClient.HttpClient | DatabaseServices> =>
  retiring.reset(session.sessionId).pipe(
    Effect.timeoutOption(RETIRE_SESSIONS.TIMEOUT),
    Effect.flatMap((answered) => {
      if (Option.isNone(answered)) return Effect.logWarning("A session was not retired in time");
      const reset = answered.value;
      return reset.outcome === EVE_RESET_OUTCOME.FAILED
        ? Effect.logWarning(`A session was not retired: ${reset.status}`)
        : Effect.void;
    }),
    Effect.catchTag("EveUnreachable", (failure) =>
      Effect.logWarning(
        `A session could not be reached to retire it: ${describeUnreachable(failure)}`,
      ),
    ),
  );

export function retireSessions(
  retiring: Retiring,
  sessions: readonly StandingSession[],
): Effect.Effect<void, never, HttpClient.HttpClient | DatabaseServices> {
  return Effect.gen(function* () {
    const settled = yield* Ref.make(0);
    const agents = sessions.filter((session) => session.kind === CONVERSATION_KIND.AGENT);
    const all = Effect.forEach(
      agents,
      (session) =>
        Effect.andThen(
          retireOne(retiring, session),
          Ref.update(settled, (n) => n + 1),
        ),
      { concurrency: RETIRE_SESSIONS.CONCURRENCY, discard: true },
    );
    const finished = yield* Effect.timeoutOption(all, RETIRE_SESSIONS.BUDGET);
    if (Option.isSome(finished)) return;
    const skipped = agents.length - (yield* Ref.get(settled));
    yield* Effect.logWarning(
      `${skipped} of ${agents.length} sessions were not retired within the delete's budget`,
    );
  });
}

export function retiredBeforeDelete(
  retiring: Retiring,
): (
  conversationIds: readonly string[],
) => Effect.Effect<
  void,
  QueryError | Schema.SchemaError,
  HttpClient.HttpClient | DatabaseServices
> {
  return (conversationIds) =>
    Effect.flatMap(standingSessionsNamed(conversationIds), (sessions) =>
      retireSessions(retiring, sessions),
    );
}
