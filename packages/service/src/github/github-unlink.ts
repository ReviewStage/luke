/**
 * github-unlink.ts -- the account's GitHub link removed through Better Auth's own account calls, under the session the headers carry.
 *
 * Better Auth unlinks an account by its own record's id, which
 * `listUserAccounts` answers for the session's user, so the session's GitHub
 * record is found there first and handed to `unlinkAccount`
 * (https://www.better-auth.com/docs/concepts/users-accounts#unlink-account).
 * Both read the session from the headers, which carry the Mac's signed
 * session as a bearer, so only that session's own GitHub link can go. None
 * linked is already disconnected. Better Auth refuses to unlink an account's
 * last way to sign in, and that refusal is kept by status for the route.
 */

import { type MemberFailure, pluginCall } from "@luke/database/models/workspace-seams";
import { Cause, Effect, Schema } from "effect";

/** The provider id Better Auth names a GitHub account row by. */
const GITHUB_PROVIDER = "github";

/** The account rows `listUserAccounts` answers, in the fields read here. */
const decodeAccounts = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: Schema.String, providerId: Schema.String })),
);

/** The part of a Better Auth `api` the unlink calls. */
export interface GitHubUnlinkApi {
  readonly listUserAccounts: (input: { headers: Headers }) => Promise<object | null>;
  readonly unlinkAccount: (input: {
    headers: Headers;
    body: { accountId: string };
  }) => Promise<object | null>;
}

/** Removes the GitHub link of the session the headers carry; its refusal kept by status, anything else unknown. */
export type GitHubUnlink = (headers: Headers) => Effect.Effect<void, MemberFailure>;

/** The unlink over one auth service: `auth.api` on a deployment. */
export function githubUnlink(api: GitHubUnlinkApi): GitHubUnlink {
  return (headers) =>
    Effect.gen(function* () {
      const listed = yield* pluginCall(() => api.listUserAccounts({ headers }));
      const accounts = yield* Effect.mapError(
        decodeAccounts(listed),
        (failure) => new Cause.UnknownError(failure),
      );
      const github = accounts.find((account) => account.providerId === GITHUB_PROVIDER);
      if (github === undefined) return;
      yield* pluginCall(() => api.unlinkAccount({ headers, body: { accountId: github.id } }));
    });
}
