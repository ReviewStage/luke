/**
 * account-deletion-calls.ts -- the account deleted through Better Auth's own `deleteUser`, under the session the headers carry.
 *
 * Better Auth deletes the account only for a fresh session, one signed in
 * within its `freshAge`, and refuses an older one (`SESSION_EXPIRED`). The
 * delete asks whether the session is fresh before it undoes anything of its
 * own, by Better Auth's own session and its own configured age, so a stale
 * session leaves the account as it stood. The delete itself hands Better
 * Auth the request the headers ride on, since its `beforeDelete` deletes the
 * account's solo workspaces under that same session (`auth-policy.ts`'s
 * `accountDeletion`). A refusal is kept by status, as every plugin call's
 * is (`pluginCall`).
 */

import { type MemberFailure, pluginCall } from "@repo/database/models/workspace-seams";
import { Cause, Effect } from "effect";

/** The part of a Better Auth `api` the account's deletion reaches. */
export interface AccountDeletionApi {
  readonly getSession: (input: {
    headers: Headers;
    query: { disableCookieCache: true };
  }) => Promise<{ session: { createdAt: Date } } | null>;
  readonly deleteUser: (input: {
    headers: Headers;
    body: Record<string, never>;
    request: Request;
  }) => Promise<object | null>;
}

/** The account's deletion as the procedure asks it. */
export interface AccountDeletionCalls {
  /** Whether the session the headers carry is fresh enough for Better Auth to delete its account. */
  readonly sessionFresh: (headers: Headers) => Effect.Effect<boolean, Cause.UnknownError>;
  /** Deletes the session's account, and its solo workspaces before it. */
  readonly deleteUser: (headers: Headers) => Effect.Effect<void, MemberFailure>;
}

/** Where the request handed to Better Auth claims to be; only its headers are read. */
const DELETE_USER_URL = "http://localhost/api/auth/delete-user";

/**
 * The account's deletion over one auth service and the session age it
 * holds fresh, in seconds: `auth.api` and its `sessionConfig.freshAge` on a
 * deployment. A fresh age of zero, which turns Better Auth's own check off,
 * holds every session fresh.
 */
export function accountDeletionCalls(
  api: AccountDeletionApi,
  freshAge: () => Promise<number>,
): AccountDeletionCalls {
  return {
    sessionFresh: (headers) =>
      Effect.tryPromise({
        try: async () => {
          const [answered, seconds] = await Promise.all([
            api.getSession({ headers, query: { disableCookieCache: true } }),
            freshAge(),
          ]);
          if (answered === null) return false;
          return (
            seconds === 0 || Date.now() - answered.session.createdAt.getTime() < seconds * 1000
          );
        },
        catch: (thrown) => new Cause.UnknownError(thrown),
      }),
    deleteUser: (headers) =>
      Effect.asVoid(
        pluginCall(() =>
          api.deleteUser({ headers, body: {}, request: new Request(DELETE_USER_URL, { headers }) }),
        ),
      ),
  };
}
