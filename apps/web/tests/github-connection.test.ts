import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_FAILURE, type GitHubFailure } from "@sidecar/hosted/github-wire";
import { unparsedWire } from "@sidecar/wire";
import { symmetricEncrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Effect, Layer, Redacted, Result } from "effect";
import { account, user } from "../server/db/auth-schema";
import { db } from "../server/db/query";
import { githubConnectionAccess } from "../server/hosted/github-connection";
import { GitHubAccess, resolveRepository } from "../server/hosted/github-source";
import { createPlan } from "../server/hosted/plan-store";
import {
  REPOSITORY_READ_REFUSAL,
  REPOSITORY_READ_STATUS,
  runGetFileContents,
} from "../server/hosted/repository-tools";
import { type FakeRepository, fakeGitHub } from "./support/github-fake";
import { testSqlClient } from "./support/sql-client";

/**
 * The account's GitHub connection as production reads it: Better Auth's own
 * GitHub row on the account, its token sealed under the auth service's
 * secret the way Better Auth seals it, opened only when a read needs it and
 * only where the row records the `repo` scope the Connect GitHub step asks
 * for. The last case reads a plan's repository through the planning tool
 * under that connection, against a fake of GitHub at the process boundary.
 *
 * Synthetic accounts, secrets, tokens, and repositories throughout.
 */

const AUTH_SECRET = "fixture-auth-secret-0123456789abcdef0123456789abcdef";
const OTHER_SECRET = "fixture-other-secret-0123456789abcdef0123456789abcd";
const TOKEN = "fixture-github-token-linked";
const COMMIT = "4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345";

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

function relay(): FakeRepository {
  return {
    owner: "acme",
    name: "relay",
    private: true,
    defaultBranch: "main",
    branches: new Map([["main", COMMIT]]),
    commits: new Map([[COMMIT, new Map([["README.md", { text: "# Relay\n" }]])]]),
  };
}

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

  it.effect(
    "the planning tool reads through the connection, and says reconnect once GitHub refuses it",
    () => {
      const github = fakeGitHub();
      const repository = relay();
      return Effect.gen(function* () {
        const userId = yield* openUser;
        yield* writeGitHubRow(userId, SCOPE.LINKED);
        // GitHub honors the linked token for this repository; the account itself is the row above.
        github.connect(`user-${randomUUID()}`, TOKEN, [repository]);
        const resolved = yield* resolveRepository(yield* access.token(userId), "acme", "relay");
        const plan = yield* createPlan(userId, {
          name: "Teammate invitations",
          repository: resolved,
        });
        const binding = { userId, planId: plan.id };

        const read = yield* runGetFileContents(binding, unparsedWire({ path: "README.md" }));
        github.revoke(TOKEN);
        const revoked = yield* runGetFileContents(binding, unparsedWire({ path: "README.md" }));

        assert.equal(read.status === REPOSITORY_READ_STATUS.FILE && read.content, "# Relay\n");
        assert.equal(
          revoked.status === REPOSITORY_READ_STATUS.NOT_READ && revoked.reason,
          REPOSITORY_READ_REFUSAL.ACCESS_DENIED,
        );
        for (const result of [read, revoked]) assert.ok(!JSON.stringify(result).includes(TOKEN));
      }).pipe(Effect.provide(Layer.merge(github.layer, Layer.succeed(GitHubAccess, access))));
    },
  );
});
