import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_CONNECT_CLAIM } from "@repo/features/github-connection-wire";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { account, user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  claimGitHubConnectIntent,
  GITHUB_CONNECT_INTENT_LIFETIME,
  githubConnection,
  openGitHubConnectIntent,
} from "../github-connection-store.js";

const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* Database.use((db) =>
      db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` }),
    );
  }
  return { owner, other };
});

interface RowTokens {
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshTokenExpiresAt: Date | null;
}

const HOUR_MS = Duration.toMillis(Duration.hours(1));

const FRESH_TOKENS: RowTokens = {
  accessToken: "sealed-fixture-token",
  refreshToken: "sealed-fixture-refresh",
  accessTokenExpiresAt: new Date(8 * HOUR_MS),
  refreshTokenExpiresAt: new Date(180 * 24 * HOUR_MS),
};

const REVOKED_TOKENS: RowTokens = {
  accessToken: null,
  refreshToken: null,
  accessTokenExpiresAt: null,
  refreshTokenExpiresAt: null,
};

const linkProvider = (
  userId: string,
  providerId: string,
  tokens: RowTokens = FRESH_TOKENS,
  updatedAt = new Date(0),
) =>
  Database.use((db) =>
    db.insert(account).values({
      id: randomUUID(),
      accountId: "4242",
      providerId,
      userId,
      ...tokens,
      updatedAt,
    }),
  );

it.layer(getTestDB())("the GitHub connection store", (it) => {
  it.effect("an intent is claimed by its own account as often as asked, never by another", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const intent = yield* openGitHubConnectIntent(owner);

      assert.equal(
        yield* claimGitHubConnectIntent(intent, other),
        GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT,
      );
      assert.equal(yield* claimGitHubConnectIntent(intent, owner), GITHUB_CONNECT_CLAIM.CLAIMED);
      assert.equal(yield* claimGitHubConnectIntent(intent, owner), GITHUB_CONNECT_CLAIM.CLAIMED);
      assert.equal(
        yield* claimGitHubConnectIntent(intent, other),
        GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT,
      );
      assert.equal(
        yield* claimGitHubConnectIntent("never-minted", owner),
        GITHUB_CONNECT_CLAIM.EXPIRED,
      );
    }),
  );

  it.effect("an intent stands for ten minutes and no longer", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const inTime = yield* openGitHubConnectIntent(owner);
      const late = yield* openGitHubConnectIntent(owner);

      yield* TestClock.adjust(
        Duration.subtract(GITHUB_CONNECT_INTENT_LIFETIME, Duration.seconds(1)),
      );
      assert.equal(yield* claimGitHubConnectIntent(inTime, owner), GITHUB_CONNECT_CLAIM.CLAIMED);

      yield* TestClock.adjust(Duration.seconds(1));
      assert.equal(yield* claimGitHubConnectIntent(late, owner), GITHUB_CONNECT_CLAIM.EXPIRED);
    }),
  );

  it.effect("an account reads as connected only with a GitHub account row of its own", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      yield* linkProvider(other, "google");
      assert.deepEqual(yield* githubConnection(owner), { connected: false, login: null });

      yield* linkProvider(owner, "github");

      assert.deepEqual(yield* githubConnection(owner), { connected: true, login: null });
      assert.deepEqual(yield* githubConnection(other), { connected: false, login: null });
    }),
  );

  it.effect("a GitHub row whose tokens were revoked reads as not connected", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      yield* linkProvider(owner, "github", REVOKED_TOKENS);
      yield* linkProvider(other, "github");

      assert.deepEqual(yield* githubConnection(owner), { connected: false, login: null });
      assert.deepEqual(yield* githubConnection(other), { connected: true, login: null });
    }),
  );

  it.effect("the connection is judged on the newest GitHub row, the one the service uses", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      yield* linkProvider(owner, "github", FRESH_TOKENS, new Date(0));
      yield* linkProvider(owner, "github", REVOKED_TOKENS, new Date(HOUR_MS));

      assert.deepEqual(yield* githubConnection(owner), { connected: false, login: null });
    }),
  );

  it.effect(
    "an expired access token still connects while its refresh token stands, and not after",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        yield* linkProvider(owner, "github");

        yield* TestClock.adjust(Duration.hours(9));
        assert.deepEqual(yield* githubConnection(owner), { connected: true, login: null });

        yield* TestClock.adjust(Duration.days(180));
        assert.deepEqual(yield* githubConnection(owner), { connected: false, login: null });
      }),
  );
});
