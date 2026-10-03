import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_FAILURE, type GitHubFailure } from "@sidecar/hosted/github-wire";
import { symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Effect, Redacted, Result } from "effect";
import { account, user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { githubConnectionAccess } from "../server/hosted/github-connection";
import { testSqlClient } from "./support/sql-client";

/**
 * The account's GitHub connection as production reads it: Better Auth's own
 * GitHub row on the account, its token sealed under the auth service's
 * secret the way Better Auth seals it, opened only when a read needs it and
 * only where the row records the `repo` scope the Connect GitHub step asks
 * for.
 *
 * Synthetic accounts, secrets, tokens, and repositories throughout.
 */

const AUTH_SECRET = "fixture-auth-secret-0123456789abcdef0123456789abcdef";
const OTHER_SECRET = "fixture-other-secret-0123456789abcdef0123456789abcd";
const TOKEN = "fixture-github-token-linked";

/** What sign-in alone grants, and what the Connect step's link grants on top, as GitHub reports them. */
const SCOPE = {
  SIGN_IN: "read:user,user:email",
  LINKED: "repo,read:user,user:email",
} as const;

const access = githubConnectionAccess(Redacted.make(AUTH_SECRET));

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The account's GitHub row as Better Auth writes it, its token sealed under `secret`. */
const writeGitHubRow = (userId: string, scope: string, secret = AUTH_SECRET) =>
  Effect.gen(function* () {
    const sealed = yield* Effect.promise(() => symmetricEncrypt({ key: secret, data: TOKEN }));
    yield* db.insert(account).values({
      id: randomUUID(),
      accountId: "4242",
      providerId: "github",
      userId,
      accessToken: sealed,
      scope,
      updatedAt: new Date(0),
    });
  });

/** Why the account's token could not be read, failing the test where it was. */
const refusal = (userId: string, over = access) =>
  Effect.map(Effect.result(over.token(userId)), (read): GitHubFailure => {
    if (Result.isSuccess(read)) return assert.fail("the token was read");
    return read.failure.reason;
  });

it.layer(testSqlClient)("the account's GitHub connection", (it) => {
  it.effect("an account with no GitHub row is not connected", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;

      assert.equal(yield* refusal(userId), GITHUB_FAILURE.NOT_CONNECTED);
    }),
  );

  it.effect("a GitHub sign-in without the repo scope must connect again", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeGitHubRow(userId, SCOPE.SIGN_IN);

      assert.equal(yield* refusal(userId), GITHUB_FAILURE.ACCESS_DENIED);
    }),
  );

  it.effect("a linked row opens to its token, which the row holds only sealed", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeGitHubRow(userId, SCOPE.LINKED);

      const token = yield* access.token(userId);
      const [stored] = yield* db
        .select({ accessToken: account.accessToken })
        .from(account)
        .where(eq(account.userId, userId));

      assert.equal(Redacted.value(token), TOKEN);
      assert.ok(stored?.accessToken && !stored.accessToken.includes(TOKEN));
      assert.ok(!String(token).includes(TOKEN));
    }),
  );

  it.effect("a token sealed under another secret, or no secret at all, is not read", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeGitHubRow(userId, SCOPE.LINKED, OTHER_SECRET);

      assert.equal(yield* refusal(userId), GITHUB_FAILURE.ACCESS_DENIED);
      assert.equal(
        yield* refusal(userId, githubConnectionAccess(undefined)),
        GITHUB_FAILURE.FAILED,
      );
    }),
  );
});
