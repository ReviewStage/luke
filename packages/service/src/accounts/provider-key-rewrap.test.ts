import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { readGitHubTokenRow, saveGitHubToken } from "@luke/database/models/github-token-store";
import {
  type KeyRing,
  openGitHubToken,
  openProviderKey,
  parseKeyRing,
  sealGitHubToken,
  sealProviderKey,
} from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows, saveProviderKey } from "@luke/database/models/provider-key-store";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { user } from "@luke/database/schemas/auth";
import { githubPersonalToken } from "@luke/database/schemas/github-personal-token";
import { getTestDB } from "@luke/database/testing";
import { PROVIDER_KEY_PROVIDER, type ProviderKeyProvider } from "@luke/features/provider-key-wire";
import { Effect, Redacted, Result } from "effect";
import { HOSTED_API_ERROR, HOSTED_HTTP_STATUS } from "../http/http.js";
import {
  handleProviderKeyRewrap,
  type ProviderKeyRewrapOptions,
  rewrapProviderKeys,
} from "./provider-key-rewrap.js";

/**
 * The rotation's rewrap over a real dialect: every stored key wrapped under
 * an older version is moved onto the current one and opens under a ring
 * that no longer holds the old, a key already current or one the ring
 * cannot open is left as it was, and a second pass moves nothing.
 *
 * A member's GitHub token, sealed under the same ring, moves in the same pass.
 *
 * Synthetic accounts and keys; the key-encryption keys are fixed bytes
 * written for this file.
 */

const KEK = {
  ONE: `1:${Buffer.alloc(32, 1).toString("base64")}`,
  TWO: `2:${Buffer.alloc(32, 2).toString("base64")}`,
  STRAY: `3:${Buffer.alloc(32, 3).toString("base64")}`,
} as const;

function ring(value: string): KeyRing {
  const parsed = parseKeyRing(Redacted.make(value));
  if (Result.isFailure(parsed)) return assert.fail(`not a ring: ${parsed.failure}`);
  return parsed.success;
}

const storeKey = (keys: KeyRing, userId: string, provider: ProviderKeyProvider, key: string) =>
  saveProviderKey(
    userId,
    provider,
    sealProviderKey(keys, { userId, provider }, Redacted.make(key)),
    "sk-…test",
    null,
    new Date(0),
  );

/** Each of the account's keys opened under the ring, or unreadable. */
const openedUnder = (keys: KeyRing, userId: string) =>
  Effect.map(listProviderKeyRows(userId), (rows) =>
    rows.map((row) => {
      const opened = openProviderKey(keys, { userId, provider: row.provider }, row);
      return [
        row.provider,
        row.keyVersion,
        Result.isSuccess(opened) ? Redacted.value(opened.success) : "unreadable",
      ];
    }),
  );

it.layer(getTestDB())("the provider key rewrap", (it) => {
  it.effect(
    "moves every older key onto the current version, leaves the current and the unreadable as they were, and moves nothing twice",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        // A pass walks every account's rows, so each case starts from none.
        yield* db.delete(accountProviderKey);
        yield* db.delete(githubPersonalToken);
        const [first, second] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
        for (const id of [first, second]) {
          yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
        }
        yield* storeKey(
          ring(KEK.ONE),
          first,
          PROVIDER_KEY_PROVIDER.ANTHROPIC,
          "sk-ant-first-anthropic",
        );
        yield* storeKey(ring(KEK.TWO), first, PROVIDER_KEY_PROVIDER.OPENAI, "sk-proj-first-openai");
        yield* storeKey(
          ring(KEK.ONE),
          second,
          PROVIDER_KEY_PROVIDER.OPENAI,
          "sk-proj-second-openai",
        );
        yield* storeKey(
          ring(KEK.STRAY),
          second,
          PROVIDER_KEY_PROVIDER.ANTHROPIC,
          "sk-ant-second-stray",
        );
        yield* saveGitHubToken(
          second,
          sealGitHubToken(ring(KEK.ONE), second, Redacted.make("second-github-token")),
          {
            hint: "ghp_…test",
            githubUserId: "1",
            githubLogin: "second",
            expiresAt: null,
          },
          new Date(0),
        );
        const rotating = ring(`${KEK.TWO},${KEK.ONE}`);

        const pass = yield* rewrapProviderKeys(rotating);
        const again = yield* rewrapProviderKeys(rotating);
        const rotated = ring(KEK.TWO);

        assert.deepEqual(pass, { moved: 3, current: 1, changed: 0, unreadable: 1 });
        assert.deepEqual(again, { moved: 0, current: 4, changed: 0, unreadable: 1 });
        assert.deepEqual(yield* openedUnder(rotated, first), [
          [PROVIDER_KEY_PROVIDER.ANTHROPIC, 2, "sk-ant-first-anthropic"],
          [PROVIDER_KEY_PROVIDER.OPENAI, 2, "sk-proj-first-openai"],
        ]);
        assert.deepEqual(yield* openedUnder(rotated, second), [
          [PROVIDER_KEY_PROVIDER.ANTHROPIC, 3, "unreadable"],
          [PROVIDER_KEY_PROVIDER.OPENAI, 2, "sk-proj-second-openai"],
        ]);
        const token = yield* readGitHubTokenRow(second);
        assert.equal(token?.keyVersion, 2);
        const openedToken = token && openGitHubToken(rotated, second, token);
        assert.ok(openedToken !== undefined && Result.isSuccess(openedToken));
        assert.equal(Redacted.value(openedToken.success), "second-github-token");
      }),
  );

  it.effect(
    "the endpoint rewraps only for a POST under the deployment's secret, and answers the counts and the version they moved onto",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        yield* db.delete(accountProviderKey);
        yield* db.delete(githubPersonalToken);
        const owner = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: owner, name: "Test User", email: `${owner}@luke.test` });
        yield* storeKey(
          ring(KEK.ONE),
          owner,
          PROVIDER_KEY_PROVIDER.OPENAI,
          "sk-proj-endpoint-openai",
        );
        const secret = Redacted.make("cron-secret-for-this-test");
        const keys = Redacted.make(`${KEK.TWO},${KEK.ONE}`);
        const ask = (
          init: { method?: string; bearer?: string },
          held: Pick<ProviderKeyRewrapOptions, "cronSecret" | "keys"> = {
            cronSecret: secret,
            keys,
          },
        ) =>
          Effect.gen(function* () {
            const response = yield* handleProviderKeyRewrap({
              request: new Request("https://luke.test/api/maintenance/provider-keys-rewrap", {
                method: init.method ?? "POST",
                headers:
                  init.bearer === undefined ? {} : { authorization: `Bearer ${init.bearer}` },
              }),
              ...held,
            });
            return { status: response.status, body: yield* Effect.promise(() => response.json()) };
          });

        const wrongMethod = yield* ask({ method: "GET", bearer: "cron-secret-for-this-test" });
        const noBearer = yield* ask({});
        const wrongBearer = yield* ask({ bearer: "not-the-secret" });
        const noRing = yield* ask(
          { bearer: "cron-secret-for-this-test" },
          { cronSecret: secret, keys: undefined },
        );
        const moved = yield* ask({ bearer: "cron-secret-for-this-test" });

        assert.deepEqual(wrongMethod, {
          status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
          body: { error: HOSTED_API_ERROR.METHOD_NOT_ALLOWED },
        });
        for (const refused of [noBearer, wrongBearer]) {
          assert.deepEqual(refused, {
            status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
            body: { error: HOSTED_API_ERROR.INVALID_TOKEN },
          });
        }
        assert.deepEqual(noRing, {
          status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
          body: { error: HOSTED_API_ERROR.UNAVAILABLE },
        });
        assert.equal(moved.status, HOSTED_HTTP_STATUS.OK);
        assert.deepEqual(moved.body, {
          version: 2,
          moved: 1,
          current: 0,
          changed: 0,
          unreadable: 0,
        });
        assert.deepEqual(yield* openedUnder(ring(KEK.TWO), owner), [
          [PROVIDER_KEY_PROVIDER.OPENAI, 2, "sk-proj-endpoint-openai"],
        ]);
      }),
  );
});
