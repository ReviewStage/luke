import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { GITHUB_TOKEN_STATUS } from "@luke/features/github-token-wire";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  type GitHubTokenFacts,
  readGitHubTokenRow,
  saveGitHubToken,
  setGitHubTokenStatus,
} from "../github-token-store.js";

/**
 * A member's GitHub token row over a real dialect: one row per member, read
 * and written for that member alone, replaced whole by a save, and a status
 * written only against the seal a step ran on.
 *
 * Synthetic accounts and seals throughout.
 */

const FACTS: GitHubTokenFacts = {
  hint: "ghp_…test",
  githubUserId: "7",
  githubLogin: "member",
  expiresAt: null,
};

const sealed = (sealedToken: string) => ({ keyVersion: 1, sealedDataKey: "wrap", sealedToken });

const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* Database.use((db) =>
      db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
    );
  }
  return { owner, other };
});

it.layer(getTestDB())("the GitHub token store", (it) => {
  it.effect(
    "a save replaces the member's row, no other member reads it, and a status lands only on the seal it names",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        yield* saveGitHubToken(owner, sealed("first"), FACTS, new Date(1));
        yield* saveGitHubToken(owner, sealed("second"), FACTS, new Date(2));

        yield* setGitHubTokenStatus(owner, "first", GITHUB_TOKEN_STATUS.INVALID, new Date(3));
        const afterStale = yield* readGitHubTokenRow(owner);
        yield* setGitHubTokenStatus(owner, "second", GITHUB_TOKEN_STATUS.INVALID, new Date(4));
        const afterCurrent = yield* readGitHubTokenRow(owner);

        assert.equal(afterStale?.sealedToken, "second");
        assert.equal(afterStale?.status, GITHUB_TOKEN_STATUS.VERIFIED);
        assert.equal(afterCurrent?.status, GITHUB_TOKEN_STATUS.INVALID);
        assert.equal(yield* readGitHubTokenRow(other), undefined);
      }),
  );
});
