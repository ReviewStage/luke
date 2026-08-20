import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENTION_DECISION_SCHEMA_NAME,
  ATTENTION_TRIGGER,
  type AttentionPromptUpdate,
  attentionInstructions,
} from "@sidecar/attention";
import { SESSION_STATUS } from "@sidecar/session";
import {
  HOSTED_ATTENTION_DEFAULTS,
  handleAttentionReview,
} from "../server/hosted/attention-review";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";

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

const SPOKEN_DECISION = {
  disposition: "speak-during-turn",
  summary: "Claude Code is waiting on you in checkout-service.",
  answers_ask: false,
};

function reviewRequest(body: AttentionPromptUpdate): Request {
  return new Request("https://luke.test/api/attention/review", {
    method: "POST",
    headers: { authorization: "Bearer token-1" },
    body: JSON.stringify(body),
  });
}

interface UpstreamCall {
  url?: string;
  init?: RequestInit;
}

function upstream(call: UpstreamCall, response: () => Response) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    call.url = url;
    call.init = init;
    return response();
  };
}

function decisionPayload() {
  return new Response(JSON.stringify({ output_text: JSON.stringify(SPOKEN_DECISION) }), {
    status: 200,
  });
}

function options(overrides: Partial<Parameters<typeof handleAttentionReview>[0]> = {}) {
  return {
    request: reviewRequest(UPDATE),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    now: () => NOW,
    ...overrides,
  };
}

test("a review sends the build's own construction and answers the parsed decision", async () => {
  const call: UpstreamCall = {};
  const response = await handleAttentionReview(options({ fetch: upstream(call, decisionPayload) }));

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.decision, {
    disposition: SPOKEN_DECISION.disposition,
    summary: SPOKEN_DECISION.summary,
    decidedAt: NOW,
  });
  assert.deepEqual(body.quota, OPEN_SPEND.quota);

  assert.equal(call.url, "https://api.openai.com/v1/responses");
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.model, HOSTED_ATTENTION_DEFAULTS.MODEL);
  assert.equal(sent.instructions, attentionInstructions());
  assert.equal(sent.store, false);
  assert.equal(sent.text.format.name, ATTENTION_DECISION_SCHEMA_NAME);
  assert.match(sent.input, /checkout-service/);
  assert.equal(
    String(call.init?.headers && new Headers(call.init.headers).get("authorization")),
    `Bearer ${API_KEY}`,
  );
});

test("a blank model override is no override at all", async () => {
  const call: UpstreamCall = {};
  const response = await handleAttentionReview(
    options({ model: "   ", fetch: upstream(call, decisionPayload) }),
  );

  assert.equal(response.status, 200);
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.model, HOSTED_ATTENTION_DEFAULTS.MODEL);
});

test("an update that fails the wire contract is refused before anything is spent", async () => {
  let spent = 0;
  const spend = async () => {
    spent += 1;
    return OPEN_SPEND;
  };

  const malformedUpdate = { ...UPDATE, status: "sleeping" };
  const malformed = await handleAttentionReview(
    options({
      // SAFETY: Malformed status exercises wire validation after JSON serialization.
      request: reviewRequest(malformedUpdate as unknown as AttentionPromptUpdate),
      spend,
    }),
  );
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal(spent, 0);
});

test("the gate order is method, kill switch, token, body, quota", async () => {
  const wrongMethod = await handleAttentionReview(
    options({ request: new Request("https://luke.test/api/attention/review") }),
  );
  assert.equal(wrongMethod.status, 405);

  const keyless = await handleAttentionReview(options({ apiKey: undefined }));
  assert.equal(keyless.status, 503);

  const blankKey = await handleAttentionReview(options({ apiKey: "   " }));
  assert.equal(blankKey.status, 503);

  const anonymous = await handleAttentionReview(options({ resolveUserId: async () => undefined }));
  assert.equal(anonymous.status, 401);

  const exhausted = await handleAttentionReview(
    options({
      spend: async () => ({
        allowed: false,
        quota: { used: 501, limit: 500, remaining: 0, resetsAt: NOW + 43_200_000 },
      }),
    }),
  );
  assert.equal(exhausted.status, 429);
  assert.equal((await exhausted.json()).error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
});

test("an upstream failure or a decision outside the contract answers 502, never the key", async () => {
  const refused = await handleAttentionReview(
    options({ fetch: upstream({}, () => new Response("denied", { status: 429 })) }),
  );
  assert.equal(refused.status, 502);
  const refusedText = await refused.text();
  assert.equal(JSON.parse(refusedText).upstreamStatus, 429);
  assert.doesNotMatch(refusedText, /sk-hosted-secret/);

  const undecided = await handleAttentionReview(
    options({
      fetch: upstream(
        {},
        () => new Response(JSON.stringify({ output_text: "not json" }), { status: 200 }),
      ),
    }),
  );
  assert.equal(undecided.status, 502);
});
