import type { StandingSession } from "@luke/database/models/recorded-session";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { Duration, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import type { HostedRefusal } from "../http/http-effect.js";
import {
  describeUnreachable,
  EVE_MOUNT,
  EVE_RESET_OUTCOME,
  type EveMount,
  type EveSessions,
} from "./brain-host/eve-sessions.js";

/**
 * retire-sessions.ts -- the eve sessions Luke lets go of, retired for good: a task's at its delete, an account's at its deletion.
 *
 * A session retired ends its workflow run, a turn under way and the workers
 * it handed out with it, and takes nothing again, so Vercel Workflow can
 * let its history go and its sandbox can be deleted with nothing left to
 * resume it. The reset has to be asked while the session's conversation
 * still stands, because eve's door admits no one to the session of a
 * cleared conversation; so a task's delete retires its sessions before it
 * clears them, and an account's deletion before the account goes. Each is
 * asked as the delete's own caller (`coder-host/stop.ts`'s `eveFor`): over
 * the bearer the request carried, or, for a browser's session cookie, as the
 * deployment acting for the account the cookie named, which eve's door
 * admits for a retire on a session that account reaches
 * (`brain-host/auth.ts`).
 *
 * A retire is a courtesy the delete does not wait on: an eve that cannot be
 * reached or does not confirm is logged by its outcome and status, and the
 * delete goes on, since the door refuses everyone the session once its
 * conversation is cleared, and its sandbox is deleted on the queue all the
 * same (`session-sandboxes.ts`).
 */

const RETIRE_SESSIONS = {
  CONCURRENCY: 4,
  /** eve answers a reset once the session lets go of its inbox, which it waits thirty seconds for at most. */
  TIMEOUT: Duration.seconds(35),
} as const;

/** How a caller reaches eve under one mount: the delete's own caller's client, or the refusal that there is none. */
export type EveAt = (
  mount: EveMount,
) => Effect.Effect<EveSessions, HostedRefusal, HttpClient.HttpClient>;

/** The eve service a conversation's session runs under: a coding agent's under the coder mount, every other under the brain's. */
function mountOf(session: StandingSession): EveMount {
  return session.kind === CONVERSATION_KIND.CODING_AGENT ? EVE_MOUNT.CODER : EVE_MOUNT.TASKS;
}

/** One session retired, or why not, written down by its outcome alone. */
const retireOne = (
  eveAt: EveAt,
  session: StandingSession,
): Effect.Effect<void, never, HttpClient.HttpClient> =>
  eveAt(mountOf(session)).pipe(
    Effect.flatMap((eve) => eve.reset(session.sessionId)),
    Effect.timeoutOption(RETIRE_SESSIONS.TIMEOUT),
    Effect.flatMap((answered) => {
      if (Option.isNone(answered)) return Effect.logWarning("eve did not retire a session in time");
      const reset = answered.value;
      return reset.outcome === EVE_RESET_OUTCOME.FAILED
        ? Effect.logWarning(`eve did not retire a session: ${reset.status}`)
        : Effect.void;
    }),
    Effect.catchTag("EveUnreachable", (failure) =>
      Effect.logWarning(
        `eve could not be reached to retire a session: ${describeUnreachable(failure)}`,
      ),
    ),
    Effect.catch((refusal) =>
      Effect.logWarning(`eve could not be asked to retire a session: ${refusal.error}`),
    ),
  );

/** Retires every session named, a few at a time; never fails, whatever eve answered. */
export function retireSessions(
  eveAt: EveAt,
  sessions: readonly StandingSession[],
): Effect.Effect<void, never, HttpClient.HttpClient> {
  return Effect.forEach(sessions, (session) => retireOne(eveAt, session), {
    concurrency: RETIRE_SESSIONS.CONCURRENCY,
    discard: true,
  });
}
