import assert from "node:assert/strict";
import {
  type KeyRing,
  openGitHubToken,
  openProviderKey,
  PROVIDER_KEY_UNREADABLE,
  parseKeyRing,
  type SealOwner,
  sealGitHubToken,
  sealProviderKey,
} from "@luke/database/models/provider-key-seal";
import { PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { Redacted, Result } from "effect";
import { test } from "vitest";

/**
 * An account's own provider key sealed and opened as the database holds it:
 * a seal opens for the account and provider it was made for and for no
 * other, under the ring that made it or one still holding its version, and
 * every failure to open is the one answer, unreadable.
 *
 * Synthetic keys and accounts throughout; the key-encryption keys are fixed
 * bytes written for this file and nothing else.
 */

const KEK = {
  ONE: Buffer.alloc(32, 1).toString("base64"),
  TWO: Buffer.alloc(32, 2).toString("base64"),
  OTHER: Buffer.alloc(32, 9).toString("base64"),
} as const;

const OWNER: SealOwner = { userId: "user-owner", provider: PROVIDER_KEY_PROVIDER.ANTHROPIC };
const PROVIDER_KEY = Redacted.make("sk-ant-test-0000000000000000000000abcd");

function ring(value: string): KeyRing {
  const parsed = parseKeyRing(Redacted.make(value));
  if (Result.isFailure(parsed)) return assert.fail(`not a ring: ${parsed.failure}`);
  return parsed.success;
}

function opened(result: Result.Result<Redacted.Redacted<string>, string>): string {
  if (Result.isFailure(result)) return assert.fail(`did not open: ${result.failure}`);
  return Redacted.value(result.success);
}

test("a seal opens as the key it sealed for the owner it was made for, and holds none of it in the clear", () => {
  const one = ring(`1:${KEK.ONE}`);
  const sealed = sealProviderKey(one, OWNER, PROVIDER_KEY);

  assert.equal(opened(openProviderKey(one, OWNER, sealed)), Redacted.value(PROVIDER_KEY));
  assert.equal(sealed.keyVersion, 1);
  const stored = JSON.stringify(sealed);
  assert.ok(!stored.includes(Redacted.value(PROVIDER_KEY)));
  assert.ok(!stored.includes(Buffer.from(Redacted.value(PROVIDER_KEY)).toString("base64")));
});

test("a seal moved onto another account's row or another provider's fails closed as unreadable", () => {
  const one = ring(`1:${KEK.ONE}`);
  const sealed = sealProviderKey(one, OWNER, PROVIDER_KEY);

  assert.deepEqual(
    openProviderKey(one, { ...OWNER, userId: "user-other" }, sealed),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
  assert.deepEqual(
    openProviderKey(one, { ...OWNER, provider: PROVIDER_KEY_PROVIDER.OPENAI }, sealed),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
});

test("a GitHub token's seal opens for its member alone, and no provider key's seal opens as one", () => {
  const one = ring(`1:${KEK.ONE}`);
  const token = Redacted.make(`ghp_${"0".repeat(32)}abcd`);
  const sealed = sealGitHubToken(one, OWNER.userId, token);
  const providerSealed = sealProviderKey(one, OWNER, token);

  assert.equal(opened(openGitHubToken(one, OWNER.userId, sealed)), Redacted.value(token));
  assert.deepEqual(
    openGitHubToken(one, "user-other", sealed),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
  assert.deepEqual(
    openGitHubToken(one, OWNER.userId, {
      keyVersion: providerSealed.keyVersion,
      sealedDataKey: providerSealed.sealedDataKey,
      sealedToken: providerSealed.sealedKey,
    }),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
});
