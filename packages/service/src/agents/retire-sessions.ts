import type { StandingSession } from "@luke/database/models/recorded-session";
import { CONVERSATION_KIND } from "@luke/database/storage-vocabulary";
import { Duration, Effect, Option } from "effect";
import type { HttpClient } from "effect/http";
import { type HostedRefusal, hostedCarriesBearer } from "../http/http-effect.js";
import {
  describeUnreachable,
  EVE_MOUNT,
  EVE_RESET_OUTCOME,
  type EveMount,
  type EveSessions,
} from "./brain-host/eve-sessions.js";
import { type EveReach, eveFor } from "./coder-host/stop.js";

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
 * same (`session-sandboxes.ts`). The one exception is a delete that cannot
 * name its caller to eve at all, which `retiringReach` refuses before it
 * changes anything.
 */

const RETIRE_SESSIONS = {
  CONCURRENCY: 4,
  /** eve answers a reset once the session lets go of its inbox, which it waits thirty seconds for at most. */
  TIMEOUT: Duration.seconds(35),
} as const;

/** How a caller reaches eve under one mount: the delete's own caller's client, typed to retire a session and nothing else, or the refusal that there is none. */
export type EveAt = (
  mount: EveMount,
) => Effect.Effect<Pick<EveSessions, "reset">, HostedRefusal, HttpClient.HttpClient>;

/**
 * How a delete's caller reaches eve to retire what it deletes, settled
 * before the delete changes anything. A bearer's delete composes eve under
 * each mount as it retires, a courtesy as it has always been. A browser's
 * session cookie reaches eve only as the deployment, and a deployment that
 * cannot compose that caller, with no secret or no eve origin, would retire
 * nothing and still answer the delete done with every session standing; so
 * a cookie's delete composes eve under both mounts first, and is refused as
 * unavailable where it cannot.
 */
export const retiringReach = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: EveReach,
  request: Request,
  account: string,
): Effect.fn.Return<EveAt, HostedRefusal, HttpClient.HttpClient> {
  if (hostedCarriesBearer(request)) return (mount) => eveFor(reach, request, account, mount);
  const composed = {
    [EVE_MOUNT.CODER]: yield* eveFor(reach, request, account, EVE_MOUNT.CODER),
    [EVE_MOUNT.TASKS]: yield* eveFor(reach, request, account, EVE_MOUNT.TASKS),
  } satisfies Readonly<Record<EveMount, Pick<EveSessions, "reset">>>;
  return (mount) => Effect.succeed(composed[mount]);
});

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
