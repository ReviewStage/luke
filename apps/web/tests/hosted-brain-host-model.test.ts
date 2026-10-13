import assert from "node:assert/strict";
import { BRAIN_OPENAI_DEFAULTS } from "@sidecar/brain";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Option, Redacted, Result, Schema } from "effect";
import { test } from "vitest";
import { meteredModel } from "../server/hosted/agent-runtime/meter";
import { BRAIN_HOST } from "../server/hosted/brain-host/bounds";
import { brainModelSelection } from "../server/hosted/brain-host/model";
import { CODER_REFUSAL } from "../server/hosted/coder-host/bounds";

/**
 * The meter in front of the model: one count per inference, and no count
 * stops an inference; and the brain's model and effort reached as a coding
 * agent's step reaches its own. Synthetic keys throughout.
 */

const LUKE_KEY = Redacted.make("sk-openai-fixture");

/** A meter that counts nothing, for a selection read rather than run. */
const IDLE_METER = { spend: async () => undefined, report: () => undefined };

/** The provider's model as eve is told it, read off the SDK's handle under the meter. */
const readModel = Schema.decodeUnknownOption(
  Schema.Struct({ modelId: Schema.String, provider: Schema.String }),
);

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

test("a meter that cannot be written is reported by its kind alone, and the inference runs anyway", async () => {
  const inner = answer();
  const reports: string[] = [];
  const model = meteredModel(inner, {
    spend: async () => {
      throw new TypeError("fixture: the row for fixture-account-words was refused");
    },
    report: (message) => reports.push(message),
  });

  const { text } = await generateText({ model, prompt: "one" });

  assert.equal(text, "ok");
  assert.equal(inner.doGenerateCalls.length, 1);
  assert.deepEqual(reports, ["A hosted inference was not counted: TypeError"]);
});

test("the brain's model runs as a coding agent's does: OpenAI's Responses model at its own id, asked for the effort and a summary of its reasoning, in the brain's window", () => {
  const selected = brainModelSelection(
    {
      apiKey: LUKE_KEY,
      choice: { model: BRAIN_OPENAI_DEFAULTS.MODEL, effort: BRAIN_OPENAI_DEFAULTS.EFFORT },
    },
    IDLE_METER,
  );
  assert.ok(Result.isSuccess(selected));
  const model = Option.getOrElse(readModel(selected.success.model), () =>
    assert.fail("eve was told no provider model"),
  );
  assert.equal(model.modelId, "gpt-6.1-sol");
  assert.equal(model.provider.startsWith("openai"), true);
  assert.deepEqual(selected.success.modelOptions, {
    providerOptions: { openai: { reasoningEffort: "medium", reasoningSummary: "auto" } },
  });
  assert.equal(selected.success.modelContextWindowTokens, BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS);
});

test("a model named by OpenAI's own id rather than the catalog's is refused by name, as a coding agent's is", () => {
  assert.deepEqual(
    brainModelSelection(
      { apiKey: LUKE_KEY, choice: { model: "gpt-6.1-sol", effort: "medium" } },
      IDLE_METER,
    ),
    Result.fail(CODER_REFUSAL.UNKNOWN_PROVIDER),
  );
});
