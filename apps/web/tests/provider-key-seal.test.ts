import assert from "node:assert/strict";
import { PROVIDER_KEY_PROVIDER } from "@sidecar/hosted/provider-key-wire";
import { Redacted, Result } from "effect";
import { test } from "vitest";
import {
  KEY_RING_FAULT,
  type KeyRing,
  openProviderKey,
  PROVIDER_KEY_UNREADABLE,
  parseKeyRing,
  rewrapProviderKey,
  type SealOwner,
  sealProviderKey,
} from "../server/hosted/provider-key-seal";

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

test("two seals of one key share no bytes, since each draws its own data key and nonces", () => {
  const one = ring(`1:${KEK.ONE}`);
  const first = sealProviderKey(one, OWNER, PROVIDER_KEY);
  const second = sealProviderKey(one, OWNER, PROVIDER_KEY);

  assert.notEqual(first.sealedKey, second.sealedKey);
  assert.notEqual(first.sealedDataKey, second.sealedDataKey);
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

test("a seal opened under another key, a version the ring no longer holds, or a version it was not wrapped under is unreadable", () => {
  const sealed = sealProviderKey(ring(`1:${KEK.ONE}`), OWNER, PROVIDER_KEY);

  assert.deepEqual(
    openProviderKey(ring(`1:${KEK.OTHER}`), OWNER, sealed),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
  assert.deepEqual(
    openProviderKey(ring(`2:${KEK.TWO}`), OWNER, sealed),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
  assert.deepEqual(
    openProviderKey(ring(`2:${KEK.ONE},1:${KEK.TWO}`), OWNER, { ...sealed, keyVersion: 2 }),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
});

test("a seal with one byte changed, or bytes that are no seal, is unreadable", () => {
  const one = ring(`1:${KEK.ONE}`);
  const sealed = sealProviderKey(one, OWNER, PROVIDER_KEY);
  const bytes = Buffer.from(sealed.sealedKey, "base64");
  bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;

  assert.deepEqual(
    openProviderKey(one, OWNER, { ...sealed, sealedKey: bytes.toString("base64") }),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
  assert.deepEqual(
    openProviderKey(one, OWNER, { ...sealed, sealedDataKey: "AAAA" }),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
});

test("a rewrap moves the seal onto the current version, which opens it without the old one, and leaves the sealed key as it was", () => {
  const sealed = sealProviderKey(ring(`1:${KEK.ONE}`), OWNER, PROVIDER_KEY);
  const rewrapped = rewrapProviderKey(ring(`2:${KEK.TWO},1:${KEK.ONE}`), OWNER, sealed);
  if (Result.isFailure(rewrapped)) return assert.fail("did not rewrap");

  assert.equal(rewrapped.success.keyVersion, 2);
  assert.equal(rewrapped.success.sealedKey, sealed.sealedKey);
  assert.equal(
    opened(openProviderKey(ring(`2:${KEK.TWO}`), OWNER, rewrapped.success)),
    Redacted.value(PROVIDER_KEY),
  );
  assert.deepEqual(
    rewrapProviderKey(ring(`2:${KEK.TWO}`), { ...OWNER, userId: "user-other" }, sealed),
    Result.fail(PROVIDER_KEY_UNREADABLE),
  );
});

test("a new seal wraps under the first version listed, and a ring that is no list says which shape it breaks", () => {
  assert.equal(
    sealProviderKey(ring(`2:${KEK.TWO}, 1:${KEK.ONE}`), OWNER, PROVIDER_KEY).keyVersion,
    2,
  );

  const fault = (value: string) => Result.flip(parseKeyRing(Redacted.make(value)));
  assert.deepEqual(fault(" , "), Result.succeed(KEY_RING_FAULT.EMPTY));
  assert.deepEqual(fault(KEK.ONE), Result.succeed(KEY_RING_FAULT.MALFORMED));
  assert.deepEqual(fault(`0:${KEK.ONE}`), Result.succeed(KEY_RING_FAULT.MALFORMED));
  assert.deepEqual(
    fault(`1:${Buffer.alloc(16, 1).toString("base64")}`),
    Result.succeed(KEY_RING_FAULT.MALFORMED),
  );
  assert.deepEqual(fault(`1:${KEK.ONE},1:${KEK.TWO}`), Result.succeed(KEY_RING_FAULT.DUPLICATE));
});
