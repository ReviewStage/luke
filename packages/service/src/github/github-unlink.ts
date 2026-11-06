import { type MemberFailure, pluginCall } from "@repo/database/models/workspace-seams";
import { Cause, Effect, Schema } from "effect";

const GITHUB_PROVIDER = "github";

const decodeAccounts = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ id: Schema.String, providerId: Schema.String })),
);

export interface GitHubUnlinkApi {
  readonly listUserAccounts: (input: { headers: Headers }) => Promise<object | null>;
  readonly unlinkAccount: (input: {
    headers: Headers;
    body: { accountId: string };
  }) => Promise<object | null>;
}

export type GitHubUnlink = (headers: Headers) => Effect.Effect<void, MemberFailure>;

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
