/**
 * session-sandboxes.ts -- a session's Vercel Sandboxes kept alive while it is used, stopped, or deleted once it retired, and the sweep that works the queue of the retired.
 *
 * Whatever shows a session's sandbox in use asks `keepAliveFor` on the
 * rule `sandbox-keep-alive.ts` sets: the running session's lifetime is read
 * and extended so it ends the timeout from now, within the platform's
 * maximum. A sandbox opened before that timeout was shortened has its own
 * lowered to it on the way, for its next sessions, since Vercel reapplies a
 * sandbox's configuration at every resume. A sandbox that is not running
 * has nothing to keep alive, and a stopped one is never resumed here.
 *
 * eve opens one persistent Vercel Sandbox per top-level session, tagged with
 * the session's id, and a worker shares its parent's; a stopped sandbox
 * keeps its checkout in snapshots until Vercel lets them expire. Once Luke
 * lets go of a session for good, the purge of a deleted task's
 * conversations or an account's deletion queues it
 * (`session-sandbox-cleanup.ts`), and the scheduled sweep takes the queue a
 * bounded batch at a time: every sandbox carrying the session's tag is
 * deleted with the snapshots only it kept, and the session leaves the queue.
 * A delete Vercel did not confirm leaves the session queued, stamped, behind
 * the rest. An agent's archive stops its sandbox rather than deleting it, in
 * the background (`stoppedInBackground`), so an unarchive still resumes from
 * the snapshot. Nothing here reads a sandbox's files or a word of any account:
 * what is asked of Vercel is a tag and a name, and what is logged of a
 * failure is its status.
 *
 * Credentials are the deployment's own: the function's Vercel OIDC token,
 * which names this project and its team, as eve's own sandboxes are made
 * with (`vercel-sandbox-api.ts`). A deployment without one answers every
 * delete as unavailable, and the queue waits for a deployment that has one.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { recordedRuntimeSession } from "@luke/database/models/recorded-session";
import {
  nextSessionSandboxes,
  sessionSandboxDeferred,
  sessionSandboxDeleted,
} from "@luke/database/models/session-sandbox-cleanup";
import { Clock, Context, Duration, Effect, Layer, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { CODER } from "./coder-host/bounds.js";
import { keepAliveExtension } from "./sandbox-keep-alive.js";
import {
  deploymentOidcToken,
  RUNNING_STATUS,
  SandboxUnavailable,
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

/** The states a sandbox is up in, which a stop ends; any other is stopped, stopping, or never came up. */
const UP_STATUSES: ReadonlySet<string> = new Set(["pending", "running"]);

export interface SessionSandboxesService {
  /**
   * Keeps every running sandbox tagged with the session alive the timeout
   * from now, within the platform's maximum lifetime; answers how many were
   * extended. A sandbox not running, or one already ending far enough ahead,
   * is left as it is.
   */
  readonly keepAliveFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
  /** Deletes every sandbox tagged with the session, with the snapshots no other sandbox uses; answers how many went. */
  readonly deleteFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
  /** Stops every running sandbox tagged with the session, keeping its filesystem for a later resume; answers how many were stopped. */
  readonly stopFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
}

export class SessionSandboxes extends Context.Service<SessionSandboxes, SessionSandboxesService>()(
  "SessionSandboxes",
) {}

/** A session's sandboxes, deleted or stopped, over the REST calls `vercel-sandbox-api.ts` makes. */
function sessionSandboxesOver(api: VercelSandboxApi): SessionSandboxesService {
  return {
    keepAliveFor: (sessionId) =>
      Effect.gen(function* () {
        const sandboxes = yield* api.listTagged(sessionId);
        let extended = 0;
        for (const sandbox of sandboxes) {
          const running = sandbox.currentSessionId;
          if (sandbox.status !== RUNNING_STATUS || running === undefined) continue;
          // A sandbox opened before the cap reopens each session on its old timeout, which Vercel reapplies at every resume.
          if (sandbox.timeout !== undefined && sandbox.timeout > CODER.SANDBOX_TIMEOUT_MS) {
            yield* api.updateTimeout(sandbox.name, CODER.SANDBOX_TIMEOUT_MS);
          }
          const lifetime = yield* api.getSession(running);
          // The sandbox's record can lag its session's, which is the one whose end counts.
          if (lifetime === undefined || lifetime.status !== RUNNING_STATUS) continue;
          const extension = keepAliveExtension(lifetime, yield* Clock.currentTimeMillis);
          if (extension === undefined) continue;
          yield* api.extendTimeout(running, extension);
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
          yield* api.stopSession(running);
          stopped += 1;
        }
        return stopped;
      }),
  };
}

/** The service as the deployment runs it, on the function's own OIDC token. */
export const sessionSandboxesLayer: Layer.Layer<SessionSandboxes, never, HttpClient.HttpClient> =
  Layer.effect(
    SessionSandboxes,
    Effect.map(vercelSandboxApi(deploymentOidcToken), sessionSandboxesOver),
  );

/**
 * The session's sandbox kept alive on the function's own OIDC token, as a
 * caller that shows it in use asks it: a keep-alive Vercel did not confirm
 * is logged by its status alone, since the next one tries again well before
 * the sandbox would stop.
 */
export function keepSessionSandboxAlive(
  sessionId: string,
): Effect.Effect<void, never, HttpClient.HttpClient> {
  return Effect.flatMap(SessionSandboxes, (sandboxes) => sandboxes.keepAliveFor(sessionId)).pipe(
    Effect.provide(sessionSandboxesLayer),
    Effect.asVoid,
    Effect.catch((failure) =>
      Effect.logWarning(`a session's sandbox was not kept alive: ${failure.message}`),
    ),
  );
}

/** What an archive of an agent asks of the deployment beside it: the service that stops its sandbox, Vercel's in production and a script's in a test. */
export interface SandboxStopReach {
  readonly sessionSandboxes: Layer.Layer<SessionSandboxes, never, HttpClient.HttpClient>;
}

/** A failure as the log says it: a sandbox's own words, and the kind alone for any other, since a store failure's message may name a statement. */
function describeStopFailure(failure: {
  readonly _tag: string;
  readonly message?: string;
}): string {
  return failure._tag === "SandboxUnavailable" ? (failure.message ?? failure._tag) : failure._tag;
}

/**
 * The sandboxes of the agents just archived stopped, never deleted, so an
 * unarchive resumes from the snapshot as a stopped sandbox does. Each
 * agent's session is read here, one keyed read that fails to nothing worse
 * than a log line, and the stops at Vercel are forked detached, so this
 * returns without waiting on Vercel and the archive never fails on it. A
 * stop that fails or runs past its bound is logged and left: the turn's own
 * end stops a sandbox a turn ran (`agent-runtime/sandbox.ts`), so what is
 * left running here is one a terminal held.
 */
export const stoppedInBackground = /* @__PURE__ */ Effect.fnUntraced(function* (
  agents: ReadonlyArray<Pick<CodingAgent, "userId" | "conversationId">>,
) {
  const sandboxes = yield* SessionSandboxes;
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
  const sessions = read.filter((sessionId) => sessionId !== undefined);
  const stopOne = (sessionId: string) =>
    sandboxes.stopFor(sessionId).pipe(
      Effect.timeout(ARCHIVE_STOP.TIMEOUT),
      Effect.catch((failure) =>
        Effect.logWarning(
          `an archived agent's sandbox was not stopped: ${describeStopFailure(failure)}`,
        ),
      ),
    );
  yield* Effect.forkDetach(
    Effect.forEach(sessions, stopOne, { concurrency: ARCHIVE_STOP.CONCURRENCY, discard: true }),
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
