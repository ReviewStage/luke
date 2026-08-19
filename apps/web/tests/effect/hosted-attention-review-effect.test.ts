import assert from "node:assert/strict";
import test from "node:test";
import { ATTENTION_TRIGGER, type AttentionPromptUpdate, SESSION_STATUS } from "@sidecar/core";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  attentionReviewEffect,
  handleAttentionReview,
  runAttentionReview,
} from "../../server/hosted/attention-review";
import type { HostedSpend } from "../../server/hosted/quota";
import { runPromiseExit } from "../../src/effect/runtime-bridge";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";

const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 2, limit: 500, remaining: 498, resetsAt: NOW + 43_200_000 },
};

const UPDATE = {
  trigger: ATTENTION_TRIGGER.STATUS_CHANGED,
  providerName: "Claude Code",
  title: "checkout-service",
  status: SESSION_STATUS.WAITING,
  recap: "Waiting on a permission decision.",
};

function reviewRequest(body: AttentionPromptUpdate): Request {
  return new Request("https://luke.test/api/attention/review", {
    method: "POST",
    headers: { authorization: "Bearer token-1" },
    body: JSON.stringify(body),
  });
}

function options() {
  return {
    request: reviewRequest(UPDATE),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    now: () => NOW,
    fetch: async () =>
      new Response(
        JSON.stringify({
          output_text: JSON.stringify({
            disposition: "speak-during-turn",
            summary: "Claude Code is waiting on you in checkout-service.",
            answers_ask: false,
          }),
        }),
        { status: 200 },
      ),
  };
}

test("runtime-bridge re-exports resolve a succeeding effect", async () => {
  const exit = await runPromiseExit(Effect.succeed("hosted"));
  assert.equal(Exit.isSuccess(exit), true);
  if (Exit.isSuccess(exit)) {
    assert.equal(exit.value, "hosted");
  }
});

test("attentionReviewEffect matches handleAttentionReview", async () => {
  const [promiseResponse, effectExit] = await Promise.all([
    handleAttentionReview(options()),
    runPromiseExit(attentionReviewEffect(options())),
  ]);

  assert.equal(Exit.isSuccess(effectExit), true);
  if (!Exit.isSuccess(effectExit)) return;

  const effectResponse = effectExit.value;
  assert.equal(effectResponse.status, promiseResponse.status);
  assert.deepEqual(await effectResponse.json(), await promiseResponse.json());
});

test("runAttentionReview resolves the same response as handleAttentionReview", async () => {
  const [promiseResponse, bridgeResponse] = await Promise.all([
    handleAttentionReview(options()),
    runAttentionReview(options()),
  ]);

  assert.equal(bridgeResponse.status, promiseResponse.status);
  assert.deepEqual(await bridgeResponse.json(), await promiseResponse.json());
});
