import assert from "node:assert/strict";
import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { test } from "vitest";
import { HostedQuotaExceeded, meteredModel } from "../server/hosted/brain-host/model";
import { HOSTED_DAILY_LIMIT } from "../server/hosted/quota";

/** The meter in front of the model: one spend per inference, and a refused spend runs no inference. */

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

test("every inference spends the meter once, and a spend the day cannot fit runs nothing", async () => {
  const inner = answer();
  let used = 0;
  let allowed = true;
  const model = meteredModel(inner, async () => {
    used += 1;
    return {
      allowed,
      quota: { used, limit: HOSTED_DAILY_LIMIT, resetsAt: 0 },
    };
  });

  await generateText({ model, prompt: "one" });
  await generateText({ model, prompt: "two" });
  assert.equal(used, 2);
  assert.equal(inner.doGenerateCalls.length, 2);

  allowed = false;
  await assert.rejects(generateText({ model, prompt: "three" }), HostedQuotaExceeded);
  assert.equal(used, 3);
  assert.equal(inner.doGenerateCalls.length, 2);
});
