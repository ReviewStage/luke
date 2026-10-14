import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_CONNECT_CLAIM } from "@sidecar/hosted/github-connection-wire";
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

/**
 * A Mac's request to connect GitHub, over a real dialect: an intent is
 * claimed by its own account alone, once, inside its ten minutes, and a
 * claim from another account's session leaves it standing; and an account
 * reads as connected only with a GitHub account row of its own.
 *
 * Synthetic accounts throughout.
 */

const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* Database.use((db) =>
      db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
    );
  }
  return { owner, other };
});

/** An account row as Better Auth leaves one for a provider, its token sealed and beside the point here. */
const linkProvider = (userId: string, providerId: string) =>
  Database.use((db) =>
    db.insert(account).values({
      id: randomUUID(),
      accountId: "4242",
      providerId,
      userId,
      accessToken: "sealed-fixture-token",
      updatedAt: new Date(0),
    }),
  );

it.layer(getTestDB())("the GitHub connection store", (it) => {
  it.effect(
    "an intent is claimed by its own account once, and another account's claim leaves it standing",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const intent = yield* openGitHubConnectIntent(owner);

        assert.equal(
          yield* claimGitHubConnectIntent(intent, other),
          GITHUB_CONNECT_CLAIM.OTHER_ACCOUNT,
        );
        assert.equal(yield* claimGitHubConnectIntent(intent, owner), GITHUB_CONNECT_CLAIM.CLAIMED);
        assert.equal(yield* claimGitHubConnectIntent(intent, owner), GITHUB_CONNECT_CLAIM.EXPIRED);
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
});
