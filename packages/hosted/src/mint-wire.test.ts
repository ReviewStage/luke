import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_CALLS_URL,
  HOSTED_WS_BASE_URL,
  hostedMintAnswerAt,
  remoteMintAnswerAt,
} from "./mint-wire.js";

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

test("a mint answer round-trips through the wire reader, with or without a quota", () => {
  const bare = hostedMintAnswerAt(mintedWire(), NOW);
  assert.deepEqual(bare, {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: MODEL,
      callsUrl: HOSTED_CALLS_URL,
      wsUrl: `${HOSTED_WS_BASE_URL}?model=${MODEL}`,
    },
  });

  const quota = { used: 1, limit: 5, resetsAt: NOW + 3_600_000 };
  const metered = hostedMintAnswerAt({ ...mintedWire(), quota }, NOW);
  assert.deepEqual(metered?.quota, quota);
});

test("a quota the service mis-answered is dropped, and the credential still stands", () => {
  const answer = hostedMintAnswerAt({ ...mintedWire(), quota: { used: -1 } }, NOW);
  assert.ok(answer);
  assert.equal(answer.quota, undefined);
  assert.equal("quota" in answer, false);
});

test("a mint answer with no wsUrl at all is discarded", () => {
  const wire = {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: MODEL,
      callsUrl: HOSTED_CALLS_URL,
    },
  };
  assert.equal(hostedMintAnswerAt(wire, NOW), undefined);
});

test("a credential aimed anywhere but the canonical calls endpoint is discarded", () => {
  const foreign = hostedMintAnswerAt(
    mintedWire({ callsUrl: "https://evil.example/v1/realtime/calls" }),
    NOW,
  );
  assert.equal(foreign, undefined);
});

test("a wsUrl aimed at any non-canonical base is discarded", () => {
  const foreignWs = hostedMintAnswerAt(
    mintedWire({ wsUrl: `wss://evil.example/v1/realtime?model=${MODEL}` }),
    NOW,
  );
  assert.equal(foreignWs, undefined);
});

test("a wsUrl whose model param does not match the credential's model is discarded", () => {
  const mismatch = hostedMintAnswerAt(
    mintedWire({ wsUrl: `${HOSTED_WS_BASE_URL}?model=wrong-model` }),
    NOW,
  );
  assert.equal(mismatch, undefined);
});

test("the wsUrl carries the model the credential was minted for", () => {
  const answer = hostedMintAnswerAt(mintedWire({ model: "gpt-realtime-next" }), NOW);
  assert.equal(answer?.connection.wsUrl, `${HOSTED_WS_BASE_URL}?model=gpt-realtime-next`);
});

test("an expired or incomplete credential reads as no answer at all", () => {
  assert.equal(hostedMintAnswerAt(mintedWire({ expiresAt: NOW - 1 }), NOW), undefined);
  assert.equal(hostedMintAnswerAt(mintedWire({ value: "" }), NOW), undefined);
  assert.equal(hostedMintAnswerAt({ odd: true }, NOW), undefined);
});

test("a mobile mint answer carries the context the phone forwards, or is no answer at all", () => {
  const context = { sessions: { itemId: "item-0", text: "[observed session status]\nnone" } };
  const answer = remoteMintAnswerAt({ ...mintedWire(), context }, NOW);
  assert.deepEqual(answer?.context, context);
  assert.equal(remoteMintAnswerAt(mintedWire(), NOW), undefined);
  assert.equal(remoteMintAnswerAt({ ...mintedWire(), context: { sessions: {} } }, NOW), undefined);
});
