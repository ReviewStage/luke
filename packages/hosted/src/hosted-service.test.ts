import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_CALLS_URL,
  HOSTED_SERVICE_PATH,
  hostedMintAnswerFromWire,
} from "./hosted-service.js";

const NOW = 1_800_000_000_000;

interface MintedWireOverrides {
  value?: string;
  expiresAt?: number;
  model?: string;
  callsUrl?: string;
}

function mintedWire(overrides: MintedWireOverrides = {}) {
  return {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
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
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
    },
  });

  const quota = { used: 1, limit: 5, remaining: 4, resetsAt: NOW + 3_600_000 };
  const metered = hostedMintAnswerFromWire({ ...mintedWire(), quota }, NOW);
  assert.deepEqual(metered?.quota, quota);
});

test("a credential aimed anywhere but the canonical calls endpoint is discarded", () => {
  const foreign = hostedMintAnswerFromWire(
    mintedWire({ callsUrl: "https://evil.example/v1/realtime/calls" }),
    NOW,
  );
  assert.equal(foreign, undefined);
});

test("an expired or incomplete credential reads as no answer at all", () => {
  assert.equal(hostedMintAnswerFromWire(mintedWire({ expiresAt: NOW - 1 }), NOW), undefined);
  assert.equal(hostedMintAnswerFromWire(mintedWire({ value: "" }), NOW), undefined);
  assert.equal(hostedMintAnswerFromWire({ odd: true }, NOW), undefined);
});
