import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_CALLS_URL,
  HOSTED_SERVICE_PATH,
  HOSTED_WS_BASE_URL,
  hostedConversationAnswerFromWire,
  hostedMintAnswerFromWire,
  isVaultProviderId,
  VAULT_KEY_MAX_LENGTH,
  VAULT_PROVIDER_ID,
  vaultKeyIsStorable,
} from "./hosted-service.js";

const NOW = 1_800_000_000_000;
const MODEL = "gpt-realtime-2.1";

interface MintedWireOverrides {
  value?: string;
  expiresAt?: number;
  model?: string;
  callsUrl?: string;
  wsUrl?: string;
}

function mintedWire(overrides: MintedWireOverrides = {}) {
  const model = overrides.model ?? MODEL;
  return {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model,
      callsUrl: HOSTED_CALLS_URL,
      wsUrl: `${HOSTED_WS_BASE_URL}?model=${model}`,
      ...overrides,
    },
  };
}

test("the introduction mint has its own path beside the ordinary one", () => {
  assert.equal(HOSTED_SERVICE_PATH.INTRODUCTION_MINT, "/api/voice/introduction-mint");
  assert.notEqual(HOSTED_SERVICE_PATH.INTRODUCTION_MINT, HOSTED_SERVICE_PATH.VOICE_MINT);
});

test("a mint answer round-trips through the wire reader, with or without a quota", () => {
  const bare = hostedMintAnswerFromWire(mintedWire(), NOW);
  assert.deepEqual(bare, {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: MODEL,
      callsUrl: HOSTED_CALLS_URL,
      wsUrl: `${HOSTED_WS_BASE_URL}?model=${MODEL}`,
    },
  });

  const quota = { used: 1, limit: 5, remaining: 4, resetsAt: NOW + 3_600_000 };
  const metered = hostedMintAnswerFromWire({ ...mintedWire(), quota }, NOW);
  assert.deepEqual(metered?.quota, quota);
});

test("a mint answer without wsUrl (old server) still parses for new readers", () => {
  const wire = {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: MODEL,
      callsUrl: HOSTED_CALLS_URL,
    },
  };
  const answer = hostedMintAnswerFromWire(wire, NOW);
  assert.ok(answer);
  assert.equal(answer.connection.wsUrl, undefined);
});

test("a credential aimed anywhere but the canonical calls endpoint is discarded", () => {
  const foreign = hostedMintAnswerFromWire(
    mintedWire({ callsUrl: "https://evil.example/v1/realtime/calls" }),
    NOW,
  );
  assert.equal(foreign, undefined);
});

test("a wsUrl aimed at any non-canonical base is discarded", () => {
  const foreignWs = hostedMintAnswerFromWire(
    mintedWire({ wsUrl: `wss://evil.example/v1/realtime?model=${MODEL}` }),
    NOW,
  );
  assert.equal(foreignWs, undefined);
});

test("a wsUrl whose model param does not match the credential's model is discarded", () => {
  const mismatch = hostedMintAnswerFromWire(
    mintedWire({ wsUrl: `${HOSTED_WS_BASE_URL}?model=wrong-model` }),
    NOW,
  );
  assert.equal(mismatch, undefined);
});

test("the wsUrl carries the model the credential was minted for", () => {
  const answer = hostedMintAnswerFromWire(mintedWire({ model: "gpt-realtime-next" }), NOW);
  assert.equal(answer?.connection.wsUrl, `${HOSTED_WS_BASE_URL}?model=gpt-realtime-next`);
});

test("an expired or incomplete credential reads as no answer at all", () => {
  assert.equal(hostedMintAnswerFromWire(mintedWire({ expiresAt: NOW - 1 }), NOW), undefined);
  assert.equal(hostedMintAnswerFromWire(mintedWire({ value: "" }), NOW), undefined);
  assert.equal(hostedMintAnswerFromWire({ odd: true }, NOW), undefined);
});

test("a vault provider id is one of the accepted set and nothing shaped like one", () => {
  for (const providerId of Object.values(VAULT_PROVIDER_ID)) {
    assert.equal(isVaultProviderId(providerId), true);
  }
  assert.equal(isVaultProviderId("openai"), false);
  assert.equal(isVaultProviderId("linear"), false);
  assert.equal(isVaultProviderId(""), false);
  assert.equal(isVaultProviderId(undefined), false);
  assert.equal(isVaultProviderId({ providerId: "cursor" }), false);
});

test("a storable key is non-empty, whitespace-free, and bounded", () => {
  assert.equal(vaultKeyIsStorable("key_1234abcd"), true);
  assert.equal(vaultKeyIsStorable("k".repeat(VAULT_KEY_MAX_LENGTH)), true);
  assert.equal(vaultKeyIsStorable(""), false);
  assert.equal(vaultKeyIsStorable("key with spaces"), false);
  assert.equal(vaultKeyIsStorable("key\twith\ttabs"), false);
  assert.equal(vaultKeyIsStorable("key\nwith\nnewlines"), false);
  assert.equal(vaultKeyIsStorable("k".repeat(VAULT_KEY_MAX_LENGTH + 1)), false);
});

test("a conversation answer keeps only attributed, non-empty messages", () => {
  const answer = hostedConversationAnswerFromWire(
    JSON.parse(
      JSON.stringify({
        messages: [
          {
            id: "message-1",
            author: "user",
            text: "Fix the roster test",
            receivedAt: 1_800_000_000_000,
          },
          { id: "message-2", author: "agent", text: "  spaced words hold their shape  " },
          { id: "message-3", author: "tool", text: "not a voice a bubble draws" },
          { id: "message-4", author: "agent", text: "" },
          { id: "", author: "agent", text: "no id" },
          { id: "message-5", author: "agent" },
          null,
        ],
        lastMessageId: "message-9",
        hasMore: true,
      }),
    ),
  );
  assert.ok(answer);
  assert.deepEqual(answer.messages, [
    {
      id: "message-1",
      author: "user",
      text: "Fix the roster test",
      receivedAt: 1_800_000_000_000,
    },
    // The words travel exactly as written: the wire reader never trims them.
    { id: "message-2", author: "agent", text: "  spaced words hold their shape  " },
  ]);
  assert.equal(answer.lastMessageId, "message-9");
  assert.equal(answer.hasMore, true);
});

test("a conversation answer without its envelope is no answer at all", () => {
  assert.equal(hostedConversationAnswerFromWire(undefined), undefined);
  assert.equal(hostedConversationAnswerFromWire("messages"), undefined);
  assert.equal(
    hostedConversationAnswerFromWire(JSON.parse(JSON.stringify({ messages: [] }))),
    undefined,
  );
  assert.equal(
    hostedConversationAnswerFromWire(
      JSON.parse(JSON.stringify({ messages: "none", hasMore: false })),
    ),
    undefined,
  );
  const empty = hostedConversationAnswerFromWire(
    JSON.parse(JSON.stringify({ messages: [], hasMore: false })),
  );
  assert.ok(empty);
  assert.deepEqual(empty.messages, []);
  assert.equal(empty.lastMessageId, undefined);
  assert.equal(empty.hasMore, false);
});

test("a conversation answer carries its history positions when the read reported them", () => {
  const answer = hostedConversationAnswerFromWire(
    JSON.parse(
      JSON.stringify({
        messages: [],
        hasMore: false,
        firstOffset: 240,
        hasOlder: true,
      }),
    ),
  );
  assert.ok(answer);
  assert.equal(answer.firstOffset, 240);
  assert.equal(answer.hasOlder, true);

  const malformed = hostedConversationAnswerFromWire(
    JSON.parse(
      JSON.stringify({
        messages: [],
        hasMore: true,
        firstOffset: -3,
        hasOlder: "yes",
      }),
    ),
  );
  assert.ok(malformed);
  // Positions that are not what a read reports are dropped, not repaired.
  assert.equal(malformed.firstOffset, undefined);
  assert.equal(malformed.hasOlder, undefined);
});
