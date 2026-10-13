/**
 * session-sandboxes.ts -- a retired eve session's Vercel Sandboxes deleted, and the sweep that works the queue of them.
 *
 * eve opens one persistent Vercel Sandbox per top-level session, tagged with
 * the session's id, and a worker shares its parent's; a stopped sandbox
 * keeps its checkout in snapshots until Vercel lets them expire. Once Luke
 * lets go of a session for good, the purge of a deleted plan's
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
 * with. A deployment without one answers every delete as unavailable, and
 * the queue waits for a deployment that has one.
 */

import {
  nextSessionSandboxes,
  sessionSandboxDeferred,
  sessionSandboxDeleted,
} from "@sidecar/database/models/session-sandbox-cleanup";
import { readEither } from "@sidecar/wire/effect";
import { getVercelOidcToken } from "@vercel/oidc";
import { Context, Data, Effect, Layer, Result, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import type { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { EXCESS_KEYS, type UnparsedWireValue, unparsedWire } from "../core.js";

/** The tag eve sets on every session's sandbox, its value the session's id. */
const SESSION_TAG = "sessionId";

/** Vercel's answer for a sandbox already gone, which is the delete done. */
const NOT_FOUND_STATUS = 404;

const OK_STATUS = { FIRST: 200, LAST: 299 } as const;

/**
 * Vercel Sandbox's REST API, as `@vercel/sandbox` 3.3.0 (the copy eve 0.74.0
 * bundles) asks it in its `APIClient`'s `listSandboxes` and `deleteSandbox`:
 * re-read those two calls when eve's bundled copy moves.
 */
const SANDBOX_API = {
  ORIGIN: "https://vercel.com",
  PATH: "/api/v2/sandboxes",
  /** A session has one sandbox; the page is wide enough that the first is all of them. */
  PAGE: 100,
} as const;

const SESSION_SANDBOX_SWEEP = {
  /** The most sessions one sweep takes, so a backlog is worked through a sweep at a time. */
  MAX_SESSIONS: 20,
  CONCURRENCY: 5,
} as const;

/** Vercel could not be asked, or did not confirm a delete; the status where it answered one. */
class SandboxUnavailable extends Data.TaggedError("SandboxUnavailable")<{
  readonly status?: number;
}> {
  override get message(): string {
    return this.status === undefined
      ? "Vercel Sandbox was unavailable"
      : `Vercel Sandbox answered ${this.status}`;
  }
}

export interface SessionSandboxesService {
  /** Deletes every sandbox tagged with the session, with the snapshots no other sandbox uses; answers how many went. */
  readonly deleteFor: (sessionId: string) => Effect.Effect<number, SandboxUnavailable>;
}

export class SessionSandboxes extends Context.Service<SessionSandboxes, SessionSandboxesService>()(
  "SessionSandboxes",
) {}

/** The OIDC token's claims the API is asked under: the project and team it names. */
const OidcClaimsSchema = Schema.Struct({ project_id: Schema.String, owner_id: Schema.String });

/** A page of the sandboxes listed under a tag, read for their names alone. */
const ListedSandboxesSchema = Schema.Struct({
  sandboxes: Schema.Array(Schema.Struct({ name: Schema.String })),
});

const readClaims = readEither(OidcClaimsSchema, { excess: EXCESS_KEYS.DROP });
const readListed = readEither(ListedSandboxesSchema, { excess: EXCESS_KEYS.DROP });

/** How the deployment's own OIDC token is read: the function's in production, a fixed one in a test. */
type OidcTokenRead = () => Promise<string>;

/** The project and team a token names, read from its payload; Vercel verifies the token itself. */
function claimsOf(
  token: string,
): { readonly projectId: string; readonly teamId: string } | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  const decoded = Result.try(() => JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
  if (Result.isFailure(decoded)) return undefined;
  const claims = readClaims(unparsedWire(decoded.success));
  return Result.isSuccess(claims)
    ? { projectId: claims.success.project_id, teamId: claims.success.owner_id }
    : undefined;
}

/** One call to the API as the client answers it: its status and its body, or unavailable where it never answered. */
function callApi(
  client: HttpClient.HttpClient,
  request: HttpClientRequest.HttpClientRequest,
): Effect.Effect<
  { readonly status: number; readonly body: UnparsedWireValue },
  SandboxUnavailable
> {
  return client.execute(request).pipe(
    Effect.flatMap((response) =>
      response.json.pipe(
        Effect.orElseSucceed(() => undefined),
        Effect.map((body) => ({ status: response.status, body: unparsedWire(body) })),
      ),
    ),
    Effect.scoped,
    Effect.mapError(() => new SandboxUnavailable({})),
  );
}

function succeeded(status: number): boolean {
  return status >= OK_STATUS.FIRST && status <= OK_STATUS.LAST;
}

/**
 * The service over Vercel Sandbox's REST API, the two calls the SDK eve
 * opens sandboxes with makes for a list and a delete, asked directly rather
 * than through the SDK, because the SDK bundled into the sweep's function
 * fails it as it loads and carries a dozen Node modules the sweep would
 * never use. A session has one sandbox, so the first page of the list is
 * the whole of it.
 */
function vercelSessionSandboxes(
  readToken: OidcTokenRead,
): Effect.Effect<SessionSandboxesService, never, HttpClient.HttpClient> {
  return Effect.map(HttpClient.HttpClient, (client) => ({
    deleteFor: (sessionId) =>
      Effect.gen(function* () {
        const token = yield* Effect.tryPromise({
          try: readToken,
          catch: () => new SandboxUnavailable({}),
        });
        const claims = claimsOf(token);
        if (claims === undefined) return yield* new SandboxUnavailable({});
        const headers = { authorization: `Bearer ${token}` };
        const listUrl = new URL(SANDBOX_API.PATH, SANDBOX_API.ORIGIN);
        listUrl.searchParams.set("teamId", claims.teamId);
        listUrl.searchParams.set("project", claims.projectId);
        listUrl.searchParams.set("limit", String(SANDBOX_API.PAGE));
        // The API's own filter syntax, one `key:value` pair.
        listUrl.searchParams.set("tags", `${SESSION_TAG}:${sessionId}`);
        const listed = yield* callApi(client, HttpClientRequest.get(listUrl, { headers }));
        const page = readListed(listed.body);
        if (!succeeded(listed.status) || Result.isFailure(page)) {
          return yield* new SandboxUnavailable({ status: listed.status });
        }
        for (const { name } of page.success.sandboxes) {
          const deleteUrl = new URL(
            `${SANDBOX_API.PATH}/${encodeURIComponent(name)}`,
            SANDBOX_API.ORIGIN,
          );
          deleteUrl.searchParams.set("teamId", claims.teamId);
          deleteUrl.searchParams.set("projectId", claims.projectId);
          deleteUrl.searchParams.set("deleteOrphanSnapshots", "true");
          const deleted = yield* callApi(client, HttpClientRequest.delete(deleteUrl, { headers }));
          if (!succeeded(deleted.status) && deleted.status !== NOT_FOUND_STATUS) {
            return yield* new SandboxUnavailable({ status: deleted.status });
          }
        }
        return page.success.sandboxes.length;
      }),
  }));
}

/** The service as the deployment runs it, on the function's own OIDC token. */
export const sessionSandboxesLayer: Layer.Layer<SessionSandboxes, never, HttpClient.HttpClient> =
  Layer.effect(
    SessionSandboxes,
    vercelSessionSandboxes(() => getVercelOidcToken()),
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
  SqlError | Schema.SchemaError,
  SessionSandboxes | SqlClient.SqlClient
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
    SqlError | Schema.SchemaError,
    SessionSandboxes | SqlClient.SqlClient
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
