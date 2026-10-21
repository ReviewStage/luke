import assert from "node:assert/strict";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
} from "@luke/features/provider-key-wire";
import { test } from "vitest";
import { payerOffer, startPayer } from "./payer-model.js";

/**
 * Who Start offers to pay for one agent: the Claude plan and eve's payer,
 * named for the key eve would run on, only where the plan could run the
 * agent; and a pick the offer no longer holds names no payer.
 */

const KEPT = {
  provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  hint: "sk-ant-…fake",
  addedAt: 0,
  status: PROVIDER_KEY_STATUS.VERIFIED,
  statusAt: 0,
};

const PLAN_ONLY: ProviderKeysAnswer = {
  keys: [],
  subscriptions: [{ ...KEPT, kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN }],
};

test("with no API key saved, eve's payer is Luke's key, and a service before the default reads as on", () => {
  assert.deepEqual(payerOffer(true, PLAN_ONLY, "anthropic/claude-opus-5.5"), {
    options: [
      { payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION, label: "Claude plan" },
      { payer: CODING_AGENT_PAYER.LUKE, label: "Luke" },
    ],
    fallback: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
  });
});

test("nothing is offered on a fast version, with no plan connected, or outside the cohort", () => {
  assert.equal(payerOffer(true, PLAN_ONLY, "anthropic/claude-opus-5.5-fast"), undefined);
  assert.equal(payerOffer(true, { keys: [KEPT] }, "anthropic/claude-opus-5.5"), undefined);
  assert.equal(payerOffer(false, PLAN_ONLY, "anthropic/claude-opus-5.5"), undefined);
});

const CHATGPT: ProviderKeysAnswer = {
  keys: [{ ...KEPT, provider: PROVIDER_KEY_PROVIDER.OPENAI, hint: "sk-…fake" }],
  subscriptions: [
    {
      ...KEPT,
      provider: PROVIDER_KEY_PROVIDER.OPENAI,
      kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
      forAgents: false,
    },
  ],
};

test("a GPT model with ChatGPT connected offers the ChatGPT plan and the OpenAI API key, starting on the default as Settings left it", () => {
  assert.deepEqual(payerOffer(true, CHATGPT, "openai/gpt-5.5"), {
    options: [
      { payer: CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION, label: "ChatGPT plan" },
      { payer: CODING_AGENT_PAYER.API_KEY, label: "API key" },
    ],
    fallback: CODING_AGENT_PAYER.API_KEY,
  });
});

test("a GPT model offers nothing on its fast version, with only a Claude plan, or with a sign-in OpenAI signed out", () => {
  assert.equal(payerOffer(true, CHATGPT, "openai/gpt-5.5-fast"), undefined);
  assert.equal(payerOffer(true, PLAN_ONLY, "openai/gpt-5.5"), undefined);
  const signedOut: ProviderKeysAnswer = {
    keys: [],
    subscriptions: [
      {
        ...KEPT,
        provider: PROVIDER_KEY_PROVIDER.OPENAI,
        kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
        status: PROVIDER_KEY_STATUS.INVALID,
      },
    ],
  };
  assert.equal(payerOffer(true, signedOut, "openai/gpt-5.5"), undefined);
  assert.equal(payerOffer(true, CHATGPT, "anthropic/claude-opus-5.5"), undefined);
});

test("a pick the offer no longer holds, as the API key once it was removed, names no payer, so the default decides", () => {
  const offer = payerOffer(true, PLAN_ONLY, "anthropic/claude-opus-5.5");
  assert.equal(startPayer(offer, CODING_AGENT_PAYER.API_KEY), undefined);
  assert.equal(startPayer(offer, CODING_AGENT_PAYER.LUKE), CODING_AGENT_PAYER.LUKE);
  assert.equal(startPayer(undefined, CODING_AGENT_PAYER.LUKE), undefined);
});
