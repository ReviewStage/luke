import assert from "node:assert/strict";
import test from "node:test";
import { VAULT_PROVIDER_ID } from "@sidecar/hosted";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { Schema } from "effect";
import { PRODUCT_EVENT, PRODUCT_EVENT_BATCH_LIMIT } from "../server/core.js";
import {
  AttentionPromptUpdateSchema,
  decodeUnknown,
  ProductEventBatchSchema,
  VaultKeyStoreBodySchema,
  voiceMintPreferencesSchema,
} from "../server/hosted/schema.js";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");

test("ProductEventBatchSchema matches productEventBatchFromWire parity", () => {
  const good = {
    events: [{ name: PRODUCT_EVENT.APP_LAUNCH, at: NOW, properties: { app_version: "0.2.0" } }],
  };
  assert.ok(decodeUnknown(ProductEventBatchSchema, good));
  assert.equal(decodeUnknown(ProductEventBatchSchema, { events: [] }), undefined);
  assert.equal(
    decodeUnknown(ProductEventBatchSchema, {
      events: Array.from({ length: PRODUCT_EVENT_BATCH_LIMIT + 1 }, () => good.events[0]),
    }),
    undefined,
  );
});

test("voiceMintPreferencesSchema accepts build voice sets and rejects extras when strict", () => {
  const schema = voiceMintPreferencesSchema(["voice", "speed"]);
  assert.deepEqual(decodeUnknown(schema, { voice: REALTIME_VOICE.ECHO }), {
    voice: REALTIME_VOICE.ECHO,
  });
  assert.equal(decodeUnknown(schema, { voice: REALTIME_VOICE.ECHO, extra: true }), undefined);
  assert.deepEqual(decodeUnknown(schema, { speed: REALTIME_VOICE_SPEED.QUICK }), {
    speed: REALTIME_VOICE_SPEED.QUICK,
  });
});

test("VaultKeyStoreBodySchema rejects whitespace keys", () => {
  assert.ok(
    decodeUnknown(VaultKeyStoreBodySchema, {
      providerId: VAULT_PROVIDER_ID.COPILOT,
      key: "sk-abc",
    }),
  );
  assert.equal(
    decodeUnknown(VaultKeyStoreBodySchema, {
      providerId: VAULT_PROVIDER_ID.COPILOT,
      key: "has space",
    }),
    undefined,
  );
});

test("AttentionPromptUpdateSchema refuses malformed updates", () => {
  assert.equal(decodeUnknown(AttentionPromptUpdateSchema, "not a record"), undefined);
});

test("schema encode round trips vault store body", () => {
  const value = { providerId: VAULT_PROVIDER_ID.CURSOR, key: "sk-test" };
  const encoded = Schema.encodeSync(VaultKeyStoreBodySchema)(value);
  assert.deepEqual(decodeUnknown(VaultKeyStoreBodySchema, encoded), value);
});
