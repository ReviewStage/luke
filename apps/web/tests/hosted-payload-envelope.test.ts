import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptProviderKey,
  encryptProviderKey,
  openPayload,
  type PayloadKeyRing,
  payloadKeyRing,
  sealPayload,
} from "../server/hosted/encryption";

const SECRET = "a".repeat(64);
const NEXT_SECRET = "b".repeat(64);
const USER = "user-1";

test("a sealed payload names its key, opens under the same ring and binding, and reads as nothing without them", () => {
  const ring = payloadKeyRing(SECRET);
  const sealed = sealPayload("the words", ring, USER);
  assert.equal(openPayload(sealed, ring, USER), "the words");
  assert.notEqual(sealPayload("the words", ring, USER), sealed);

  assert.throws(() => openPayload(sealed, ring, "user-2"));
  assert.throws(() => openPayload(sealed, payloadKeyRing(NEXT_SECRET), USER));
  const tampered = `${sealed.slice(0, -4)}AAAA`;
  assert.throws(() => openPayload(tampered, ring, USER));
  assert.throws(() => openPayload(sealed.slice(2), ring, USER));
  assert.throws(() => openPayload("", ring, USER));
});

test("a rotated ring opens what the earlier key sealed and seals under the current one", () => {
  const first = payloadKeyRing(SECRET);
  const sealedUnderFirst = sealPayload("kept", first, USER);
  const rotated: PayloadKeyRing = {
    current: 2,
    keys: new Map([
      [1, SECRET],
      [2, NEXT_SECRET],
    ]),
  };

  assert.equal(openPayload(sealedUnderFirst, rotated, USER), "kept");
  const sealedUnderSecond = sealPayload("kept", rotated, USER);
  assert.throws(() => openPayload(sealedUnderSecond, first, USER), /holds no key 2/);
});

test("the vault's own format is untouched: no key id, and the two envelopes do not open each other", () => {
  const ring = payloadKeyRing(SECRET);
  const vault = encryptProviderKey("sk-test", SECRET);
  assert.equal(decryptProviderKey(vault, SECRET), "sk-test");
  assert.throws(() => openPayload(vault, ring, USER));
  assert.throws(() => decryptProviderKey(sealPayload("sk-test", ring, USER), SECRET));
});
