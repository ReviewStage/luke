import assert from "node:assert/strict";
import { jsonResponse } from "@luke/wire/testing";
import { generateText, streamText } from "ai";
import { Redacted, Result, Schema } from "effect";
import { test } from "vitest";
import type { OfferedModel } from "../../providers/model-catalog.js";
import { coderModel, type ProviderKeys } from "./model.js";
import { usageOfTurns } from "./usage.js";

/**
 * A fast step Anthropic refuses, as a coding agent's step meets it on the
 * account's key against an Anthropic faked at its fetch: the call runs again
 * at standard speed, without fast mode's beta, and its turn is marked so; and a turn so marked is priced at the
 * base model's standard rate. Synthetic keys throughout.
 */

const WINDOW = 200_000;

const FAST_CHOICE = { model: "anthropic/claude-opus-5.5-fast", effort: "high" } as const;

/** What reached Anthropic's API: the request's speed, and whether it asked for a stream. */
const readAnthropicRequest = Schema.decodeUnknownSync(
  Schema.Struct({
    model: Schema.String,
    speed: Schema.optional(Schema.String),
    stream: Schema.optional(Schema.Boolean),
  }),
);

/** Anthropic's refusal of a fast request for an organization fast mode was never enabled for, as production met it. */
const FAST_LIMIT_ZERO = {
  type: "error",
  error: {
    type: "rate_limit_error",
    message:
      "This request would exceed your organization's rate limit of 0 fast mode input tokens per minute (model: claude-opus-5-5).",
  },
};

/** Anthropic's answer to a standard request, whole. */
const STANDARD_MESSAGE = {
  id: "msg_fixture",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: "Done at standard speed." }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
};

/** Anthropic's answer to a standard request, streamed as its server-sent events. */
function standardStream(): Response {
  const events = [
    {
      type: "message_start",
      message: { ...STANDARD_MESSAGE, content: [], stop_reason: null },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "Done at standard speed." },
    },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  const body = events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

/** One request as Anthropic received it: the speed it asked for and the betas it sent. */
interface ReceivedRequest {
  readonly speed: string | undefined;
  readonly betas: string;
}

/**
 * An Anthropic whose organization fast mode refuses: every fast request
 * answered with the 429 production met, and a standard one with the
 * standard answer, or a 429 of its own where the standard rate is spent too.
 */
function anthropicRefusingFast(standard: "answers" | "refuses" = "answers") {
  const received: ReceivedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const asked = readAnthropicRequest(JSON.parse(String(init?.body)));
    received.push({
      speed: asked.speed,
      betas: new Headers(init?.headers).get("anthropic-beta") ?? "",
    });
    if (asked.speed !== undefined || standard === "refuses") {
      return jsonResponse(FAST_LIMIT_ZERO, 429);
    }
    return asked.stream === true ? standardStream() : jsonResponse(STANDARD_MESSAGE);
  };
  return { fetch, received };
}

/** A fast step on the account's key over that Anthropic, counting the turn's marks. */
function fastStep(fetch: typeof globalThis.fetch) {
  const marks: string[] = [];
  const keys: ProviderKeys = {
    anthropic: { key: Redacted.make("sk-ant-account-fixture") },
    openAi: undefined,
    fetch,
  };
  const selected = coderModel(FAST_CHOICE, keys, WINDOW, async () => {
    marks.push("fast refused");
  });
  if (Result.isFailure(selected)) return assert.fail(`no model: ${selected.failure}`);
  const { providerOptions } = selected.success.modelOptions;
  const call = {
    model: selected.success.model,
    prompt: "Go.",
    maxRetries: 0,
    ...(providerOptions === undefined ? undefined : { providerOptions }),
  };
  return { call, marks };
}

test("a fast step Anthropic refuses with a 429 answers at standard speed, without fast mode's beta, and its turn marked", async () => {
  const anthropic = anthropicRefusingFast();
  const step = fastStep(anthropic.fetch);

  const answer = await generateText(step.call);

  assert.equal(answer.text, "Done at standard speed.");
  assert.deepEqual(
    anthropic.received.map((request) => request.speed),
    ["fast", undefined],
  );
  assert.equal(anthropic.received[0]?.betas.includes("fast-mode"), true);
  assert.equal(anthropic.received[1]?.betas.includes("fast-mode"), false);
  assert.deepEqual(step.marks, ["fast refused"]);
});

test("a streamed fast step Anthropic refuses streams its answer at standard speed, its turn marked", async () => {
  const anthropic = anthropicRefusingFast();
  const step = fastStep(anthropic.fetch);

  const streamed = streamText(step.call);

  assert.equal(await streamed.text, "Done at standard speed.");
  assert.deepEqual(
    anthropic.received.map((request) => request.speed),
    ["fast", undefined],
  );
  assert.deepEqual(step.marks, ["fast refused"]);
});

test("a fast step whose standard call is refused too fails as the provider refused it, its turn unmarked", async () => {
  const anthropic = anthropicRefusingFast("refuses");
  const step = fastStep(anthropic.fetch);

  await assert.rejects(generateText(step.call), /rate limit of 0 fast mode/u);
  assert.deepEqual(
    anthropic.received.map((request) => request.speed),
    ["fast", undefined],
  );
  assert.deepEqual(step.marks, []);
});

/** Opus 5.5 and its fast version as the catalog prices them, per token. */
const PRICED: readonly OfferedModel[] = [
  {
    id: "anthropic/claude-opus-5.5",
    name: "Claude Opus 5.5",
    provider: "anthropic",
    efforts: ["high"],
    pricing: { inputUsd: 0.000004, outputUsd: 0.00002 },
  },
  {
    id: "anthropic/claude-opus-5.5-fast",
    name: "Claude Opus 5.5 Fast",
    provider: "anthropic",
    efforts: ["high"],
    pricing: { inputUsd: 0.000008, outputUsd: 0.00004 },
  },
];

test("a fast turn is priced at Fast's rate, and one Anthropic refused Fast at the base model's standard rate", () => {
  const usage = {
    inputTokens: 1_000_000,
    outputTokens: 100_000,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
  const turn = { model: FAST_CHOICE.model, usage };

  assert.equal(usageOfTurns([{ ...turn, fastRefused: false }], PRICED)?.costUsd, 12);
  assert.equal(usageOfTurns([{ ...turn, fastRefused: true }], PRICED)?.costUsd, 6);
});
