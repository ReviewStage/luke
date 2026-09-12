import assert from "node:assert/strict";
import { CLOUD_AGENT_PROVIDER_ID } from "@sidecar/session";
import type { UnparsedWireValue } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { type Schema as EffectSchema, Either } from "effect";
import { test } from "vitest";
import {
  VAULT_KEY_MAX_LENGTH,
  vaultKeyDeleteAnswerSchema,
  vaultKeyIsStorable,
  vaultKeyStoreAnswerSchema,
  vaultKeysListAnswerSchema,
} from "./vault-wire.js";

function parse<Value, Encoded>(
  schema: EffectSchema.Schema<Value, Encoded>,
  value: UnparsedWireValue,
): Value | undefined {
  return Either.getOrUndefined(readEither(schema)(value));
}

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
  assert.deepEqual(parse(vaultKeyStoreAnswerSchema, { stored: true }), { stored: true });
  assert.equal(parse(vaultKeyStoreAnswerSchema, { stored: false }), undefined);
  assert.deepEqual(parse(vaultKeyDeleteAnswerSchema, { deleted: false }), { deleted: false });
  assert.equal(parse(vaultKeyDeleteAnswerSchema, { deleted: "yes" }), undefined);
});

test("one unreadable key entry drops the whole list rather than hiding a stored key", () => {
  const listed = parse(vaultKeysListAnswerSchema, {
    keys: [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: 1 }],
  });
  assert.deepEqual(listed, {
    keys: [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: 1 }],
  });
  assert.deepEqual(parse(vaultKeysListAnswerSchema, { keys: [] }), { keys: [] });
  assert.equal(
    parse(vaultKeysListAnswerSchema, {
      keys: [
        { providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: 1 },
        { providerId: "openai" },
      ],
    }),
    undefined,
  );
  assert.equal(
    parse(vaultKeysListAnswerSchema, {
      keys: [{ providerId: CLOUD_AGENT_PROVIDER_ID.CONDUCTOR, updatedAt: -1 }],
    }),
    undefined,
  );
});
