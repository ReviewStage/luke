import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  type KeyRing,
  openEnvironmentValue,
  openProviderKey,
  parseKeyRing,
  sealEnvironmentValue,
  sealProviderKey,
} from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows, saveProviderKey } from "@luke/database/models/provider-key-store";
import {
  listWorkspaceEnvironmentRows,
  saveWorkspaceEnvironmentValue,
  sealedOf,
} from "@luke/database/models/workspace-environment-store";
import { accountProviderKey } from "@luke/database/schemas/account-provider-key";
import { organization, user } from "@luke/database/schemas/auth";
import { workspaceEnvironmentVariable } from "@luke/database/schemas/workspace-environment";
import { getTestDB } from "@luke/database/testing";
import { PROVIDER_KEY_PROVIDER, type ProviderKeyProvider } from "@luke/features/provider-key-wire";
import { WORKSPACE_ENVIRONMENT_KIND } from "@luke/features/workspace-environment-wire";
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
 * cannot open is left as it was, and a second pass moves nothing. A
 * workspace's environment values move in the same pass on the same terms.
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
        // A pass walks every account's and workspace's rows, so each case starts from none.
        yield* db.delete(accountProviderKey);
        yield* db.delete(workspaceEnvironmentVariable);
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
        const rotating = ring(`${KEK.TWO},${KEK.ONE}`);

        const pass = yield* rewrapProviderKeys(rotating);
        const again = yield* rewrapProviderKeys(rotating);
        const rotated = ring(KEK.TWO);

        assert.deepEqual(pass, { moved: 2, current: 1, changed: 0, unreadable: 1 });
        assert.deepEqual(again, { moved: 0, current: 3, changed: 0, unreadable: 1 });
        assert.deepEqual(yield* openedUnder(rotated, first), [
          [PROVIDER_KEY_PROVIDER.ANTHROPIC, 2, "sk-ant-first-anthropic"],
          [PROVIDER_KEY_PROVIDER.OPENAI, 2, "sk-proj-first-openai"],
        ]);
        assert.deepEqual(yield* openedUnder(rotated, second), [
          [PROVIDER_KEY_PROVIDER.ANTHROPIC, 3, "unreadable"],
          [PROVIDER_KEY_PROVIDER.OPENAI, 2, "sk-proj-second-openai"],
        ]);
      }),
  );

  it.effect(
    "moves a workspace's older environment values onto the current version in the same pass",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        yield* db.delete(accountProviderKey);
        yield* db.delete(workspaceEnvironmentVariable);
        const owner = `user-${randomUUID()}`;
        yield* db
          .insert(user)
          .values({ id: owner, name: "Test User", email: `${owner}@luke.test` });
        const organizationId = randomUUID();
        yield* db.insert(organization).values({
          id: organizationId,
          name: "Acme",
          slug: `workspace-${organizationId}`,
          createdAt: new Date(0),
        });
        const stored: ReadonlyArray<readonly [KeyRing, string, string]> = [
          [ring(KEK.ONE), "OLD_SECRET", "old-value"],
          [ring(KEK.TWO), "NEW_SECRET", "new-value"],
        ];
        for (const [keys, name, value] of stored) {
          const sealed = sealEnvironmentValue(keys, { organizationId, name }, Redacted.make(value));
          yield* saveWorkspaceEnvironmentValue(
            organizationId,
            name,
            WORKSPACE_ENVIRONMENT_KIND.SECRET,
            sealed,
            "",
            owner,
            new Date(0),
          );
        }

        const pass = yield* rewrapProviderKeys(ring(`${KEK.TWO},${KEK.ONE}`));
        const rotated = ring(KEK.TWO);
        const opened = (yield* listWorkspaceEnvironmentRows(organizationId)).map((row) => {
          const value = openEnvironmentValue(
            rotated,
            { organizationId, name: row.name },
            sealedOf(row),
          );
          return [
            row.name,
            row.keyVersion,
            Result.isSuccess(value) ? Redacted.value(value.success) : "unreadable",
          ];
        });

        assert.deepEqual(pass, { moved: 1, current: 1, changed: 0, unreadable: 0 });
        assert.deepEqual(opened, [
          ["NEW_SECRET", 2, "new-value"],
          ["OLD_SECRET", 2, "old-value"],
        ]);
      }),
  );

  it.effect(
    "the endpoint rewraps only for a POST under the deployment's secret, and answers the counts and the version they moved onto",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        yield* db.delete(accountProviderKey);
        yield* db.delete(workspaceEnvironmentVariable);
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
