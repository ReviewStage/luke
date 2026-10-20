import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  ensureChatGptHostId,
  listEveryProviderKeyRow,
  listProviderKeyRows,
  removeProviderKey,
  resealProviderKey,
  saveProviderKey,
  withProviderKeyLocked,
} from "../provider-key-store.js";

/**
 * An account's provider credential rows over a real dialect: an API key and
 * a Claude setup-token are rows of their own kind, each read, replaced and
 * removed by its kind for its account alone, a setup-token kept unverified,
 * and a save never replacing the provider's row of the other kind. A
 * ChatGPT sign-in is a row of its own kind with its access token's expiry,
 * resealed in place under its lock, and the account's ChatGPT host id is
 * minted once and outlives it.
 *
 * Synthetic accounts and seals throughout.
 */

const sealed = (sealedKey: string) => ({ keyVersion: 1, sealedDataKey: "wrap", sealedKey });

const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* Database.use((db) =>
      db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` }),
    );
  }
  return { owner, other };
});

const shown = (
  rows: readonly { provider: string; kind: string; sealedKey: string; status: string }[],
) => rows.map((row) => [row.provider, row.kind, row.sealedKey, row.status]);

it.layer(getTestDB())("the provider key store", (it) => {
  it.effect(
    "a setup-token is kept unverified as its own kind, read and replaced by its kind, and no other account reads it",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const { ANTHROPIC, OPENAI } = PROVIDER_KEY_PROVIDER;
        const { API_KEY, CLAUDE_SETUP_TOKEN } = PROVIDER_KEY_KIND;
        const first = yield* saveProviderKey(
          owner,
          ANTHROPIC,
          CLAUDE_SETUP_TOKEN,
          sealed("token-1"),
          "sk-ant-…aaaa",
          null,
          new Date(1),
        );
        const second = yield* saveProviderKey(
          owner,
          ANTHROPIC,
          CLAUDE_SETUP_TOKEN,
          sealed("token-2"),
          "sk-ant-…bbbb",
          null,
          new Date(2),
        );
        yield* saveProviderKey(
          owner,
          OPENAI,
          API_KEY,
          sealed("key-1"),
          "sk-…cccc",
          null,
          new Date(3),
        );

        assert.equal(first, true);
        assert.equal(second, true);
        assert.deepEqual(shown(yield* listProviderKeyRows(owner, CLAUDE_SETUP_TOKEN)), [
          [ANTHROPIC, CLAUDE_SETUP_TOKEN, "token-2", PROVIDER_KEY_STATUS.UNVERIFIED],
        ]);
        assert.deepEqual(shown(yield* listProviderKeyRows(owner, API_KEY)), [
          [OPENAI, API_KEY, "key-1", PROVIDER_KEY_STATUS.VERIFIED],
        ]);
        assert.deepEqual(yield* listProviderKeyRows(other, CLAUDE_SETUP_TOKEN), []);
        assert.deepEqual(yield* listProviderKeyRows(other, API_KEY), []);
        const everyOfOwner = (yield* listEveryProviderKeyRow()).filter(
          (row) => row.userId === owner,
        );
        assert.deepEqual(
          everyOfOwner.map((row) => [row.provider, row.kind]),
          [
            [ANTHROPIC, CLAUDE_SETUP_TOKEN],
            [OPENAI, API_KEY],
          ],
        );
      }),
  );

  it.effect(
    "a save never replaces the provider's other kind, and a removal takes its own kind of its own account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const { ANTHROPIC } = PROVIDER_KEY_PROVIDER;
        const { API_KEY, CLAUDE_SETUP_TOKEN } = PROVIDER_KEY_KIND;
        yield* saveProviderKey(
          owner,
          ANTHROPIC,
          API_KEY,
          sealed("key"),
          "sk-ant-…aaaa",
          null,
          new Date(1),
        );
        yield* saveProviderKey(
          other,
          ANTHROPIC,
          CLAUDE_SETUP_TOKEN,
          sealed("other-token"),
          "sk-ant-…bbbb",
          null,
          new Date(1),
        );

        const tokenOverKey = yield* saveProviderKey(
          owner,
          ANTHROPIC,
          CLAUDE_SETUP_TOKEN,
          sealed("token"),
          "sk-ant-…cccc",
          null,
          new Date(2),
        );
        const keyOverToken = yield* saveProviderKey(
          other,
          ANTHROPIC,
          API_KEY,
          sealed("other-key"),
          "sk-ant-…dddd",
          null,
          new Date(2),
        );
        yield* removeProviderKey(owner, ANTHROPIC, CLAUDE_SETUP_TOKEN);
        yield* removeProviderKey(other, ANTHROPIC, API_KEY);
        const ownerKeys = shown(yield* listProviderKeyRows(owner, API_KEY));
        const otherTokens = shown(yield* listProviderKeyRows(other, CLAUDE_SETUP_TOKEN));
        yield* removeProviderKey(owner, ANTHROPIC, API_KEY);

        assert.equal(tokenOverKey, false);
        assert.equal(keyOverToken, false);
        assert.deepEqual(ownerKeys, [[ANTHROPIC, API_KEY, "key", PROVIDER_KEY_STATUS.VERIFIED]]);
        assert.deepEqual(otherTokens, [
          [ANTHROPIC, CLAUDE_SETUP_TOKEN, "other-token", PROVIDER_KEY_STATUS.UNVERIFIED],
        ]);
        assert.deepEqual(yield* listProviderKeyRows(owner, API_KEY), []);
        assert.deepEqual(shown(yield* listProviderKeyRows(other, CLAUDE_SETUP_TOKEN)), otherTokens);
      }),
  );

  it.effect(
    "a ChatGPT sign-in is kept as its own kind with its expiry, resealed in place under its lock only from the seal it was read with, and no other account reads or reseals it",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const { OPENAI } = PROVIDER_KEY_PROVIDER;
        const { API_KEY, CHATGPT_OAUTH } = PROVIDER_KEY_KIND;
        const kept = yield* saveProviderKey(
          owner,
          OPENAI,
          CHATGPT_OAUTH,
          sealed("signin-1"),
          "ChatGPT",
          null,
          new Date(1),
          new Date(3_600_000),
        );

        const resealed = yield* withProviderKeyLocked(owner, OPENAI, CHATGPT_OAUTH, (row) =>
          resealProviderKey(
            owner,
            OPENAI,
            CHATGPT_OAUTH,
            Option.getOrThrow(row).sealedKey,
            sealed("signin-2"),
            new Date(7_200_000),
          ),
        );
        const stale = yield* resealProviderKey(
          owner,
          OPENAI,
          CHATGPT_OAUTH,
          "signin-1",
          sealed("signin-3"),
          new Date(9_000_000),
        );
        const othersReseal = yield* resealProviderKey(
          other,
          OPENAI,
          CHATGPT_OAUTH,
          "signin-2",
          sealed("signin-4"),
          new Date(9_000_000),
        );
        const othersLocked = yield* withProviderKeyLocked(other, OPENAI, CHATGPT_OAUTH, (row) =>
          Effect.succeed(Option.isNone(row)),
        );

        assert.deepEqual([kept, resealed, stale, othersReseal], [true, true, false, false]);
        assert.equal(othersLocked, true);
        const [row] = yield* listProviderKeyRows(owner, CHATGPT_OAUTH);
        assert.deepEqual(
          [row?.sealedKey, row?.status, row?.accessExpiresAt?.getTime(), row?.createdAt.getTime()],
          ["signin-2", PROVIDER_KEY_STATUS.UNVERIFIED, 7_200_000, 1],
        );
        assert.deepEqual(yield* listProviderKeyRows(owner, API_KEY), []);
        assert.deepEqual(yield* listProviderKeyRows(other, CHATGPT_OAUTH), []);
      }),
  );

  it.effect("an account's ChatGPT host id is minted once, its own, and outlives the sign-in", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const first = yield* ensureChatGptHostId(owner, "urn:uuid:first", new Date(1));
      yield* saveProviderKey(
        owner,
        PROVIDER_KEY_PROVIDER.OPENAI,
        PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        sealed("signin"),
        "ChatGPT",
        null,
        new Date(2),
        new Date(3),
      );
      yield* removeProviderKey(
        owner,
        PROVIDER_KEY_PROVIDER.OPENAI,
        PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      );
      const racing = yield* Effect.all(
        [
          ensureChatGptHostId(owner, "urn:uuid:second", new Date(4)),
          ensureChatGptHostId(other, "urn:uuid:other", new Date(4)),
          ensureChatGptHostId(other, "urn:uuid:other-again", new Date(4)),
        ],
        { concurrency: "unbounded" },
      );

      assert.equal(first, "urn:uuid:first");
      assert.equal(racing[0], "urn:uuid:first");
      assert.equal(racing[1], racing[2]);
      assert.notEqual(racing[1], first);
    }),
  );
});
