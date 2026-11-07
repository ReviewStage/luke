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
  SESSION_RESET_OUTCOME,
} from "./sessions/agent-sessions.js";

/**
 * retire-sessions.ts -- the agents' sessions we let go of, retired for good: a task's or an agent's at its delete, an account's at its deletion.
 *
 * A session retired ends its runner and takes nothing again, so its
 * sandbox can be deleted with nothing left to resume it. The reset is
 * asked while the session's conversation still stands, since the session
 * is found through it; so a task's delete retires its sessions before it
 * clears them, and an account's deletion before the account goes. Each is
 * asked for the account the delete's request resolved to, and answered by
 * the harness the session runs on (`coder-host/runtime-sessions.ts`).
 *
 * A retire is a courtesy the delete does not wait on: a session that
 * cannot be reached or does not confirm is logged by its outcome and
 * status, and the delete goes on, since its sandbox is deleted on the queue
 * all the same (`session-sandboxes.ts`). Only a coding agent's session is
 * asked: a task's own session, from before every turn was an agent's, ran
 * on the retired runtime, which stands no more, and its sandbox is left to the
 * sweep.
 */

/**
 * The retires' bounds, held under the shortest deadline of a client that
 * waits on a delete: a task's or an agent's delete on the account call's
 * ten seconds (`@repo/features/account-call`'s `REQUEST_TIMEOUT_MS`), an
 * account's deletion on the desktop's fifteen
 * (`@repo/credentials/account/client`'s `DELETE_TIMEOUT_MS`). Note that a
 * native reset is a few store writes and one sandbox delete
 * (`runner-sessions.ts`'s `reset`, `machine.discard`), so a reset that has
 * not answered in seconds is one the sandbox queue finishes better than
 * the caller waits on; past these the client would say the delete did not
 * answer while it went on and deleted all the same.
 */
const RETIRE_SESSIONS = {
  CONCURRENCY: 4,
  /** How long one reset is waited on before it is logged and left. */
  TIMEOUT: Duration.seconds(5),
  /**
   * How long a delete spends on its retires in all, leaving the rest of the
   * ten seconds to the delete behind them. Note that the whole is bounded
   * as well as each, because a large account's retires, four at a time at
   * up to five seconds apiece, would otherwise outlast the client's
   * deadline. Past this the rest are skipped and logged, as one past its
   * own timeout is, and the delete goes on.
   */
  BUDGET: Duration.seconds(8),
} as const;

/** The sessions a delete retires what it deletes through, typed to retire a session and nothing else. */
export type Retiring = Pick<AgentSessions, "reset">;

/** The sessions of the account a delete's request resolved to, which it retires what it deletes through. */
export const retiringReach = (account: string): Effect.Effect<Retiring, never, DatabaseServices> =>
  routedSessions(account);

/** One session retired, or why not, written down by its outcome alone. */
const retireOne = (
  retiring: Retiring,
  session: StandingSession,
): Effect.Effect<void, never, HttpClient.HttpClient | DatabaseServices> =>
  retiring.reset(session.sessionId).pipe(
    Effect.timeoutOption(RETIRE_SESSIONS.TIMEOUT),
    Effect.flatMap((answered) => {
      if (Option.isNone(answered)) return Effect.logWarning("A session was not retired in time");
      const reset = answered.value;
      return reset.outcome === SESSION_RESET_OUTCOME.FAILED
        ? Effect.logWarning(`A session was not retired: ${reset.status}`)
        : Effect.void;
    }),
    Effect.catchTag("SessionUnreachable", (failure) =>
      Effect.logWarning(
        `A session could not be reached to retire it: ${describeUnreachable(failure)}`,
      ),
    ),
  );

/**
 * Retires every coding agent's session named, a few at a time, for as long
 * as the budget lasts; never fails, whatever a session answered. A retire still waiting when the
 * budget ends is interrupted, and it and every one not yet asked are logged
 * by their count and left to the sandbox sweep, as one never answered is.
 */
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

/**
 * What a task's or an agent's delete runs before anything goes: the sessions
 * its conversations run in, retired while those still stand, since a
 * session is found through its conversation. A task's delete
 * runs it before its transaction, over the agents it stopped alone, so no
 * lock waits on a harness, and an agent started meanwhile keeps its session and
 * refuses the delete under the task's lock. An agent's delete still runs it
 * under its conversation's lock once it reads the agent stopped, since a
 * message that woke the agent would otherwise lose its session to a delete
 * then refused; the retires' own budget bounds how long they hold it.
 */
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
