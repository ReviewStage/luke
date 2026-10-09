import assert from "node:assert/strict";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { test } from "vitest";
import {
  BRAIN_REASONING_SUMMARY,
  meteredModel,
  summarizedReasoningModel,
} from "../server/hosted/brain-host/model";

/** The meter in front of the model: one count per inference, and no count stops an inference. */

/** The ceiling the service used to refuse past. */
const FORMER_DAILY_LIMIT = 5_000;

function answer() {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text" as const, text: "ok" }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

test("every inference counts the meter once, past any former ceiling", async () => {
  const inner = answer();
  let used = FORMER_DAILY_LIMIT - 1;
  const reports: string[] = [];
  const model = meteredModel(inner, {
    spend: async () => {
      used += 1;
    },
    report: (message) => reports.push(message),
  });

  await generateText({ model, prompt: "one" });
  await generateText({ model, prompt: "two" });
  await generateText({ model, prompt: "three" });

  assert.equal(used, FORMER_DAILY_LIMIT + 2);
  assert.equal(inner.doGenerateCalls.length, 3);
  assert.deepEqual(reports, []);
});

test("a meter that cannot be written is reported, and the inference runs anyway", async () => {
  const inner = answer();
  const reports: string[] = [];
  const model = meteredModel(inner, {
    spend: async () => {
      throw new Error("fixture: store down");
    },
    report: (message) => reports.push(message),
  });

  const { text } = await generateText({ model, prompt: "one" });

  assert.equal(text, "ok");
  assert.equal(inner.doGenerateCalls.length, 1);
  assert.deepEqual(reports, ["A hosted inference was not counted: fixture: store down"]);
});

test("the planning model is asked to summarise its reasoning on every inference, beside the OpenAI options the call already carries", async () => {
  const inner = answer();
  const model = summarizedReasoningModel(inner);

  await generateText({ model, prompt: "one", providerOptions: { openai: { store: false } } });
  await generateText({ model, prompt: "two" });

  assert.deepEqual(
    inner.doGenerateCalls.map((call) => call.providerOptions?.openai),
    [
      { store: false, reasoningSummary: BRAIN_REASONING_SUMMARY.AUTO },
      { reasoningSummary: BRAIN_REASONING_SUMMARY.AUTO },
    ],
  );
});
