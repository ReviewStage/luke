import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/core";
import * as Exit from "effect/Exit";
import type { HostedSpend } from "../../server/hosted/quota";
import { handleVoiceMint, runVoiceMint, voiceMintEffect } from "../../server/hosted/voice-mint";
import { runPromiseExit } from "../../src/effect/runtime-bridge";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";

const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 1, limit: 50, remaining: 49, resetsAt: NOW + 43_200_000 },
};

function mintRequest(): Request {
  return new Request("https://luke.test/api/voice/mint", {
    method: "POST",
    headers: { authorization: "Bearer token-1" },
    body: JSON.stringify({ voice: REALTIME_VOICE.MARIN, speed: REALTIME_VOICE_SPEED.QUICK }),
  });
}

function options() {
  return {
    request: mintRequest(),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    now: () => NOW,
    fetch: async () =>
      new Response(JSON.stringify({ value: "eph-secret", expires_at: (NOW + 60_000) / 1000 }), {
        status: 200,
      }),
  };
}

test("voiceMintEffect matches handleVoiceMint", async () => {
  const [promiseResponse, effectExit] = await Promise.all([
    handleVoiceMint(options()),
    runPromiseExit(voiceMintEffect(options())),
  ]);

  assert.equal(Exit.isSuccess(effectExit), true);
  if (!Exit.isSuccess(effectExit)) return;

  const effectResponse = effectExit.value;
  assert.equal(effectResponse.status, promiseResponse.status);
  assert.deepEqual(await effectResponse.json(), await promiseResponse.json());
});

test("runVoiceMint resolves the same response as handleVoiceMint", async () => {
  const [promiseResponse, bridgeResponse] = await Promise.all([
    handleVoiceMint(options()),
    runVoiceMint(options()),
  ]);

  assert.equal(bridgeResponse.status, promiseResponse.status);
  assert.deepEqual(await bridgeResponse.json(), await promiseResponse.json());
});
