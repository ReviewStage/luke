import { GITHUB_FAILURE } from "@sidecar/hosted/github-wire";
import { symmetricDecrypt } from "better-auth/crypto";
import { and, desc, eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted, Schema } from "effect";
import { SqlSchema } from "effect/unstable/sql";
import { account } from "../db/auth-schema.js";
import { db } from "../db/query.js";
import { HostedEnvironment, hostedEnvironment } from "./environment.js";
import { GitHubAccess, type GitHubAccessShape, GitHubUnavailable } from "./github-source.js";
import { logStoreFailure } from "./store-failure.js";

/**
 * github-connection.ts -- the account's GitHub connection: the token Better Auth keeps sealed on the account's GitHub row, opened when a GitHub read needs it.
 *
 * The connection is the account's GitHub row in Better Auth's own `account`
 * table. A GitHub sign-in writes it without `repo` (`GITHUB_SIGN_IN_SCOPES`,
 * `auth-policy.ts`), since plans read a folder on the Mac; only the Connect
 * GitHub step (`/connect-github.html`), which nothing in the window opens any
 * more, links GitHub with `repo`. Better
 * Auth seals every token it stores under the auth service's own secret
 * (`encryptOAuthTokens`), so the row holds ciphertext.
 *
 * The token is opened here, under the same secret, at the moment a read
 * needs it, and handed on as a `Redacted` that reaches nothing but the
 * `Authorization` header of the request it rides. A row without `repo`
 * among its granted scopes is a connection that cannot read source, and
 * answers `access-denied`, the reason the window and the model word as
 * "connect GitHub again", as does a row whose token cannot be opened; GitHub
 * refusing the token itself (a 401) answers the same, where the read is made.
 */

/** Better Auth's provider id for GitHub, the social provider sign-in and the Connect step share. */
const GITHUB_PROVIDER_ID = "github";

/** The scope a classic OAuth App token needs to read a private repository's contents. */
const GITHUB_REPOSITORY_SCOPE = "repo";

const GitHubRowSchema = Schema.Struct({
  accessToken: Schema.NullOr(Schema.String),
  scope: Schema.NullOr(Schema.String),
});

/** The account's most recently written GitHub row, if it holds one. */
const findGitHubRow = SqlSchema.findOneOption({
  Request: Schema.String,
  Result: GitHubRowSchema,
  execute: (userId) =>
    db
      .select({ accessToken: account.accessToken, scope: account.scope })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, GITHUB_PROVIDER_ID)))
      .orderBy(desc(account.updatedAt))
      .limit(1),
});

/**
 * The scopes a row records. GitHub answers its granted scopes comma
 * separated and Better Auth joins what it parsed with commas, so either
 * separator is read.
 */
function grantedScopes(scope: string | null): readonly string[] {
  return (scope ?? "").split(/[\s,]+/u).filter((granted) => granted !== "");
}

function unavailable(reason: GitHubUnavailable["reason"]): GitHubUnavailable {
  return new GitHubUnavailable({ reason });
}

/** The account's GitHub access, opening tokens under the auth service's secret. */
export function githubConnectionAccess(secret: Redacted.Redacted | undefined): GitHubAccessShape {
  return {
    token: (userId) =>
      Effect.gen(function* () {
        // A deployment with no auth secret refuses every sign-in, so it holds no connection it could open.
        if (secret === undefined) return yield* unavailable(GITHUB_FAILURE.FAILED);
        const row = yield* findGitHubRow(userId).pipe(
          Effect.tapError(logStoreFailure),
          Effect.mapError(() => unavailable(GITHUB_FAILURE.FAILED)),
        );
        if (Option.isNone(row) || row.value.accessToken === null) {
          return yield* unavailable(GITHUB_FAILURE.NOT_CONNECTED);
        }
        if (!grantedScopes(row.value.scope).includes(GITHUB_REPOSITORY_SCOPE)) {
          return yield* unavailable(GITHUB_FAILURE.ACCESS_DENIED);
        }
        const sealed = row.value.accessToken;
        const token = yield* Effect.tryPromise({
          try: () => symmetricDecrypt({ key: Redacted.value(secret), data: sealed }),
          catch: () => unavailable(GITHUB_FAILURE.ACCESS_DENIED),
        });
        if (token === "") return yield* unavailable(GITHUB_FAILURE.ACCESS_DENIED);
        return Redacted.make(token);
      }),
  };
}

/**
 * The deployment's GitHub access, as the layer a route provides. A route's
 * request layer is built once with the router and closed over what it needs,
 * so it reads the environment itself, the same read the runtime makes.
 */
export const githubConnectionLayer = Layer.effect(
  GitHubAccess,
  Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    return githubConnectionAccess(environment.authSecret);
  }),
).pipe(
  Layer.provide(hostedEnvironment),
  // Every value it reads is optional, so a read that failed is a broken deployment, not an answer.
  Layer.orDie,
);
