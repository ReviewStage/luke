import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_AGENT_PROVIDER_ID } from "@sidecar/session";
import {
  VAULT_KEY_MAX_LENGTH,
  vaultKeyDeleteAnswerSchema,
  vaultKeyIsStorable,
  vaultKeyStoreAnswerSchema,
  vaultKeysListAnswerSchema,
} from "./vault-wire.js";

test("a storable key is non-empty, whitespace-free, and bounded", () => {
  assert.equal(vaultKeyIsStorable("key_1234abcd"), true);
  assert.equal(vaultKeyIsStorable("k".repeat(VAULT_KEY_MAX_LENGTH)), true);
  assert.equal(vaultKeyIsStorable(""), false);
  assert.equal(vaultKeyIsStorable("key with spaces"), false);
  assert.equal(vaultKeyIsStorable("key\twith\ttabs"), false);
  assert.equal(vaultKeyIsStorable("key\nwith\nnewlines"), false);
  assert.equal(vaultKeyIsStorable("k".repeat(VAULT_KEY_MAX_LENGTH + 1)), false);
});

test("the vault answers read only their documented shapes", () => {
  assert.deepEqual(vaultKeyStoreAnswerSchema.parse({ stored: true }), { stored: true });
  assert.equal(vaultKeyStoreAnswerSchema.parse({ stored: false }), undefined);
  assert.deepEqual(vaultKeyDeleteAnswerSchema.parse({ deleted: false }), { deleted: false });
  assert.equal(vaultKeyDeleteAnswerSchema.parse({ deleted: "yes" }), undefined);
});

test("one unreadable key entry drops the whole list rather than hiding a stored key", () => {
  const listed = vaultKeysListAnswerSchema.parse({
    keys: [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: 1 }],
  });
  assert.deepEqual(listed, {
    keys: [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: 1 }],
  });
  assert.deepEqual(vaultKeysListAnswerSchema.parse({ keys: [] }), { keys: [] });
  assert.equal(
    vaultKeysListAnswerSchema.parse({
      keys: [
        { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: 1 },
        { providerId: "openai" },
      ],
    }),
    undefined,
  );
  assert.equal(
    vaultKeysListAnswerSchema.parse({
      keys: [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: -1 }],
    }),
    undefined,
  );
});
