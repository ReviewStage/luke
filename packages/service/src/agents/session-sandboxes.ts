/**
 * session-sandboxes.ts -- a retired eve session's Vercel Sandboxes deleted, and the sweep that works the queue of them.
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
 * the rest. Nothing here reads a sandbox's files or a word of any account:
 * what is asked of Vercel is a tag and a name, and what is logged of a
 * failure is its status.
 *
 * Credentials are the deployment's own: the function's Vercel OIDC token,
 * which names this project and its team, as eve's own sandboxes are made
 * with (`vercel-sandbox-api.ts`). A deployment without one answers every
 * delete as unavailable, and the queue waits for a deployment that has one.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import {
  nextSessionSandboxes,
  sessionSandboxDeferred,
  sessionSandboxDeleted,
} from "@luke/database/models/session-sandbox-cleanup";
import { Context, Effect, Layer, Result, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import {
  deploymentOidcToken,
  SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

const SESSION_SANDBOX_SWEEP = {
  /** The most sessions one sweep takes, so a backlog is worked through a sweep at a time. */
  MAX_SESSIONS: 20,
  CONCURRENCY: 5,
} as const;

/** The states a sandbox is up in, which a stop ends; any other is stopped, stopping, or never came up. */
const UP_STATUSES: ReadonlySet<string> = new Set(["pending", "running"]);

export interface SessionSandboxesService {
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
