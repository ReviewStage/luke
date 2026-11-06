/**
 * session-sandboxes.ts -- a session's Vercel Sandboxes kept alive while it is used, stopped, or deleted once it retired, and the sweep that works the queue of the retired.
 *
 * Whatever shows a session's sandbox in use asks `keepAliveFor` on the
 * rule `sandbox-keep-alive.ts` sets: the list names when the running session
 * ends, and it is extended so it ends the timeout from now. A sandbox that is
 * not running has nothing to keep alive, and a stopped one is never resumed
 * here.
 *
 * An agent's session has one persistent Vercel Sandbox (`agent-sandbox-open.ts`),
 * tagged with the session's id; a stopped sandbox keeps its checkout in
 * snapshots until Vercel lets them expire. Once we
 * let go of a session for good, the purge of a deleted task's
 * conversations or an account's deletion queues it
 * (`session-sandbox-cleanup.ts`), and the scheduled sweep takes the queue a
 * bounded batch at a time: every sandbox carrying the session's tag is
 * deleted with the snapshots only it kept, and the session leaves the queue.
 * A delete Vercel did not confirm leaves the session queued, stamped, behind
 * the rest. An agent's archive stops its sandbox rather than deleting it, in
 * the background (`stoppedInBackground`), so an unarchive still resumes from
 * the snapshot; a local agent's archive queues its device a discard line
 * there too (`device-discard.ts`). Nothing here reads a sandbox's files or a word of any account:
 * what is asked of Vercel is a tag and a name, and what is logged of a
 * failure is its status.
 *
 * Credentials are the deployment's own: the function's Vercel OIDC token,
 * which names this project and its team, as the agents' own sandboxes are
 * made with (`vercel-sandbox-api.ts`). A deployment without one answers every
 * delete as unavailable, and the queue waits for a deployment that has one.
 */

import type { DatabaseServices, QueryError } from "@repo/database/core/query";
import { type Agent, readAgent } from "@repo/database/models/agent-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import {
  nextSessionSandboxes,
  sessionSandboxDeferred,
  sessionSandboxDeleted,
} from "@repo/database/models/session-sandbox-cleanup";
import { Clock, Context, Duration, Effect, Layer, Option, Result, type Schema } from "effect";
import { afterResponse } from "../http/after-response.js";
import { discardedOrLogged } from "./device-discard.js";
import { sandboxFirewall } from "./sandbox-firewall.js";
import { keepAliveExtension } from "./sandbox-keep-alive.js";
import {
  deploymentOidcToken,
  SANDBOX_STATUS,
  SandboxUnavailable,
  UP_STATUSES,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

const SESSION_SANDBOX_SWEEP = {
  /** The most sessions one sweep takes, so a backlog is worked through a sweep at a time. */
  MAX_SESSIONS: 20,
  CONCURRENCY: 5,
} as const;

const ARCHIVE_STOP = {
  /**
   * The most one agent's stop runs, its list and its stop at Vercel: long
   * enough for both calls on a slow answer, short enough that a hung one
   * does not hold the function's instance for the rest of its life.
   */
  TIMEOUT: Duration.seconds(15),
  /** How many agents of an archived task are stopped at once. */
  CONCURRENCY: 5,
} as const;

export interface SessionSandboxesService {
  /**
   * Keeps every running sandbox tagged with the session alive the timeout
   * from now; answers how many were extended. A sandbox not running, or one already ending far enough ahead,
   * is left as it is.
   */
  readonly keepAliveFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
  /** Deletes every sandbox tagged with the session, with the snapshots no other sandbox uses; answers how many went. */
  readonly deleteFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
  /**
   * Stops every running sandbox tagged with the session, keeping its
   * filesystem for a later resume; answers how many were stopped. The launch kept for its firewall goes first
   * (`sandbox-firewall.ts`).
   */
  readonly stopFor: (
    sessionId: string,
  ) => Effect.Effect<number, SandboxUnavailable, DatabaseServices>;
}

export class SessionSandboxes extends Context.Service<SessionSandboxes, SessionSandboxesService>()(
  "SessionSandboxes",
) {}

/** A session's sandboxes, deleted or stopped, over the calls `vercel-sandbox-api.ts` makes. */
function sessionSandboxesOver(api: VercelSandboxApi): SessionSandboxesService {
  return {
    keepAliveFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(sessionId);
        let extended = 0;
        for (const sandbox of sandboxes) {
          const running = sandbox.currentSessionId;
          const endsAt = sandbox.expiresAt;
          if (sandbox.status !== SANDBOX_STATUS.RUNNING || running === undefined) continue;
          if (endsAt === undefined) continue;
          const extension = keepAliveExtension(endsAt, yield* Clock.currentTimeMillis);
          if (extension === undefined) continue;
          const session = yield* api.session({ name: sandbox.name, sessionId: running });
          yield* session.extendTimeout(extension);
          extended += 1;
        }
        return extended;
      }),
    deleteFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(sessionId);
        for (const { name } of sandboxes) yield* api.deleteSandbox(name);
        return sandboxes.length;
      }),
    stopFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(sessionId);
        let stopped = 0;
        for (const sandbox of sandboxes) {
          const running = sandbox.currentSessionId;
          // A sandbox already stopped has nothing to stop.
          if (sandbox.status === undefined || !UP_STATUSES.has(sandbox.status)) continue;
          // One up with no session named cannot be stopped from here, and is no sandbox stopped either.
          if (running === undefined) return yield* Effect.fail(new SandboxUnavailable({}));
          // The kept launch goes first, as ahead of every other stop, so no renewal writes to it again.
          const session = { name: sandbox.name, sessionId: running };
          yield* sandboxFirewall(api).clear(session);
          yield* Effect.flatMap(api.session(session), (held) => held.stop());
          stopped += 1;
        }
        return stopped;
      }),
  };
}

/** The service as the deployment runs it, on the function's own OIDC token. */
export const sessionSandboxesLayer: Layer.Layer<SessionSandboxes> = Layer.effect(
  SessionSandboxes,
  Effect.map(vercelSandboxApi(deploymentOidcToken), sessionSandboxesOver),
);

/**
 * The session's sandbox kept alive on the function's own OIDC token, as a
 * caller that shows it in use asks it: a keep-alive Vercel did not confirm
 * is logged by its status alone, since the next one tries again well before
 * the sandbox would stop.
 */
export function keepSessionSandboxAlive(sessionId: string): Effect.Effect<void> {
  return Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.keepAliveFor(sessionId)).pipe(
    Effect.provide(sessionSandboxesLayer),
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`a session's sandbox was not kept alive: ${failure.message}`),
    ),
  );
}

/** What an archive of an agent asks of the deployment beside it: the service that stops its sandbox, Vercel's in production and a script's in a test, and what keeps the function awake for the stop. */
export interface SandboxStopReach {
  readonly sessionSandboxes: Layer.Layer<SessionSandboxes>;
  /**
   * Runs the work on past the archive's answer and answers at once. Vercel
   * may freeze a function once it has answered unless the work is handed to
   * `waitUntil`, so production hands it there (`orpc-route.ts`); a test
   * forks it detached (`testing/session-sandboxes-fake.ts`).
   */
  readonly keepAwake: <R>(work: Effect.Effect<void, never, R>) => Effect.Effect<void, never, R>;
}

/** The reach of a caller handed none, such as an agent's tool: Vercel's sandboxes on the function's own token, the stops kept past the answer where the runtime keeps work (`afterResponse`, the web's `waitUntil`), run in place where it keeps none. */
export const deploymentSandboxStops: SandboxStopReach = {
  sessionSandboxes: sessionSandboxesLayer,
  keepAwake: (work) => afterResponse("an archived agent's sandbox stop", work),
};

/** A failure as the log says it: a sandbox's own words, and the kind alone for any other, since a store failure's message may name a statement. */
function describeStopFailure(failure: {
  readonly _tag: string;
  readonly message?: string;
}): string {
  return failure._tag === "SandboxUnavailable" ? (failure.message ?? failure._tag) : failure._tag;
}

/**
 * One archived agent's sandbox stopped, if it is still archived. Note that
 * the archive is read again just before the stop, because an agent
 * unarchived and messaged since has resumed the sandbox this would stop, and
 * its turn must keep it; what is left of the race is the moment between this
 * read and the stop.
 */
const stoppedWhileArchived = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: Pick<Agent, "id" | "userId">,
  sessionId: string,
) {
  const current = yield* readAgent(agent.userId, agent.id);
  if (Option.isNone(current) || current.value.archivedAt === null) return;
  yield* (yield* SessionSandboxes).stopFor(sessionId);
});

/**
 * The sandboxes of the agents just archived stopped, never deleted, so an
 * unarchive resumes from the snapshot as a stopped sandbox does. Each
 * agent's session is read here, one keyed read that fails to nothing worse
 * than a log line, and the stops at Vercel are handed to the reach to keep
 * the function awake for, so this returns without waiting on Vercel and the
 * archive never fails on it. A stop that fails or runs past its bound is
 * logged and left: the runner's own end stops a sandbox a turn ran
 * (`coder-host/runner-sessions.ts`'s `runnerEnded`), so what is left
 * running here is one a terminal held. A local agent among them is let go
 * of on its device beside
 * the stops, its runner stopped and its folder removed (`device-discard.ts`).
 */
export const stoppedInBackground = /* @__PURE__ */ Effect.fnUntraced(function* (
  reach: SandboxStopReach,
  agents: ReadonlyArray<Pick<Agent, "id" | "userId" | "conversationId">>,
) {
  const read = yield* Effect.forEach(agents, (agent) =>
    recordedRuntimeSession(agent).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(
            `an archived agent's sandbox was not found to stop: ${describeStopFailure(failure)}`,
          ),
          undefined,
        ),
      ),
    ),
  );
  // An agent that never opened a sandbox has no session, and none to stop.
  const stops = agents.flatMap((agent, at) => {
    const sessionId = read[at];
    return sessionId === undefined ? [] : [{ agent, sessionId }];
  });
  const stopOne = ({ agent, sessionId }: (typeof stops)[number]) =>
    stoppedWhileArchived(agent, sessionId).pipe(
      Effect.provide(reach.sessionSandboxes),
      Effect.timeout(ARCHIVE_STOP.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `an archived agent's sandbox was not stopped: ${describeStopFailure(failure)}`,
        ),
      ),
    );
  yield* reach.keepAwake(
    Effect.all(
      [
        Effect.forEach(stops, stopOne, { concurrency: ARCHIVE_STOP.CONCURRENCY, discard: true }),
        Effect.forEach(agents, discardedOrLogged, {
          concurrency: ARCHIVE_STOP.CONCURRENCY,
          discard: true,
        }),
      ],
      { concurrency: 2, discard: true },
    ),
  );
});

/** What one sweep of the queue came to: sessions whose sandboxes went, and sessions left for a later sweep. */
export interface SessionSandboxSweepOutcome {
  deleted: number;
  pending: number;
}

const SESSION_ENDING = { DELETED: "deleted", PENDING: "pending" } as const;

type SessionEnding = (typeof SESSION_ENDING)[keyof typeof SESSION_ENDING];

/** One queued session's sandboxes deleted and the session dequeued, or the session stamped for a later sweep. */
const endSession = /* @__PURE__ */ Effect.fnUntraced(function* (
  sessionId: string,
  now: Date,
): Effect.fn.Return<
  SessionEnding,
  QueryError | Schema.SchemaError,
  SessionSandboxes | DatabaseServices
> {
  const sandboxes = yield* SessionSandboxes;
  const deleted = yield* Effect.result(sandboxes.deleteFor(sessionId));
  if (Result.isSuccess(deleted)) {
    yield* sessionSandboxDeleted(sessionId);
    return SESSION_ENDING.DELETED;
  }
  yield* Effect.logWarning(`a session's sandbox was not deleted: ${deleted.failure.message}`);
  yield* sessionSandboxDeferred(sessionId, now);
  return SESSION_ENDING.PENDING;
});

/** Works the next batch of the queue, `CONCURRENCY` at a time, and counts how each session ended. */
export const sweepSessionSandboxes = /* @__PURE__ */ Effect.fn("web/sweepSessionSandboxes")(
  function* (
    now: Date,
  ): Effect.fn.Return<
    SessionSandboxSweepOutcome,
    QueryError | Schema.SchemaError,
    SessionSandboxes | DatabaseServices
  > {
    const queued = yield* nextSessionSandboxes(SESSION_SANDBOX_SWEEP.MAX_SESSIONS);
    const endings = yield* Effect.forEach(queued, (sessionId) => endSession(sessionId, now), {
      concurrency: SESSION_SANDBOX_SWEEP.CONCURRENCY,
    });
    return {
      deleted: endings.filter((ending) => ending === SESSION_ENDING.DELETED).length,
      pending: endings.filter((ending) => ending === SESSION_ENDING.PENDING).length,
    };
  },
);
