import assert from "node:assert/strict";
import { test } from "vitest";
import { decryptProviderKey, encryptProviderKey } from "../server/hosted/encryption";

// A valid 32-byte secret as 64 hex chars.
const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);

test("encrypt then decrypt recovers the original key", () => {
  const original = "sk-test-abc123";
  const encrypted = encryptProviderKey(original, SECRET);
  assert.equal(decryptProviderKey(encrypted, SECRET), original);
});

test("each encrypt call produces a different ciphertext (random nonce)", () => {
  const key = "sk-same-key";
  assert.notEqual(encryptProviderKey(key, SECRET), encryptProviderKey(key, SECRET));
});

test("decrypting with the wrong secret throws", () => {
  const encrypted = encryptProviderKey("sk-secret", SECRET);
  assert.throws(() => decryptProviderKey(encrypted, OTHER_SECRET));
});

test("a secret that is not 64 hex chars throws at encrypt time", () => {
  assert.throws(() => encryptProviderKey("key", "tooshort"));
});
