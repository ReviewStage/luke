import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_FAILURE, MODEL_RESPONSE_OUTCOME } from "@sidecar/runtime/vocabulary";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { BRAIN_RATE_LIMIT_COOLDOWN_MS } from "./model-adapter-shared.js";
import { OpenAiModelAdapter, openAiModelAdapter } from "./openai-model-adapter.js";
import { userMessageItem } from "./responses-api.js";
import { brainToolCatalog, brainToolSchemas, resolveTurnToolPolicy } from "./tools.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

const NOW = 1_800_000_000_000;
const INPUT = [userMessageItem("[observed events] ...")];
const OPTIONS = {
  prompt: "instructions",
  tools: brainToolSchemas(resolveTurnToolPolicy(brainToolCatalog(), {}, BRAIN_TURN_TRIGGER.WAKE)),
  maximumOutputTokens: 500,
};

interface RecordedCall {
  url: string;
  init: RequestInit;
  body: UnparsedWireValue;
}

function fakeFetch(responses: readonly Response[]) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    // SAFETY: every request body this adapter sends is JSON.stringify output.
    const body = JSON.parse(String(init.body)) as UnparsedWireValue;
    calls.push({ url, init, body });
    const response = queue.shift();
    assert.ok(response, "an unexpected request was made");
    return response;
  };
  return { fetch, calls };
}

function adapter(
  fetch: RecordedCall extends never ? never : (url: string, init: RequestInit) => Promise<Response>,
  now = () => NOW,
) {
  return new OpenAiModelAdapter({
    apiKey: "sk-test",
    model: "gpt-test",
    baseUrl: "https://example.test/v1/",
    fetch,
    now,
    report: () => undefined,
  });
}

test("respond posts the fixed request on the developer's key and normalizes the answer", async () => {
  const { fetch, calls } = fakeFetch([
    Response.json({
      status: "completed",
      output: [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
      ],
      usage: { input_tokens: 5, output_tokens: 2 },
    }),
  ]);
  const answer = await adapter(fetch).respond(INPUT, OPTIONS);
  assert.ok(answer.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.equal(answer.text, "hi");
  assert.deepEqual(answer.usage, { inputTokens: 5, outputTokens: 2 });
  const [call] = calls;
  assert.ok(call && isRecord(call.body));
  assert.equal(call.url, "https://example.test/v1/responses");
  assert.equal(new Headers(call.init.headers).get("authorization"), "Bearer sk-test");
  assert.equal(call.body.model, "gpt-test");
  assert.equal(call.body.instructions, "instructions");
  assert.equal(call.body.store, false);
  assert.deepEqual(call.body.reasoning, { effort: "medium" });
  assert.equal(call.body.max_output_tokens, 500);
  assert.equal("context_management" in call.body, false);
  assert.ok(Array.isArray(call.body.tools));
  assert.deepEqual(
    call.body.tools.filter(isRecord).map((tool) => [tool.type, tool.name]),
    OPTIONS.tools.map((tool) => ["function", tool.name]),
  );
});

test("count and compact post to their own paths and read only what each answers", async () => {
  const { fetch, calls } = fakeFetch([
    Response.json({ object: "response.input_tokens", input_tokens: 77 }),
    Response.json({ output: [{ type: "compaction", id: "c", encrypted_content: "x" }] }),
    Response.json({ input_tokens: -4 }),
    Response.json({ nothing: true }),
  ]);
  const model = adapter(fetch);
  assert.deepEqual(await model.countInputTokens(INPUT, OPTIONS), {
    outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
    inputTokens: 77,
  });
  assert.equal(calls[0]?.url, "https://example.test/v1/responses/input_tokens");
  assert.ok(isRecord(calls[0]?.body) && !("max_output_tokens" in calls[0].body));
  const compacted = await model.compact(INPUT, OPTIONS);
  assert.ok(compacted.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.equal(compacted.items.length, 1);
  assert.equal(calls[1]?.url, "https://example.test/v1/responses/compact");
  assert.equal(
    (await model.countInputTokens(INPUT, OPTIONS)).outcome,
    MODEL_RESPONSE_OUTCOME.FAILED,
  );
  assert.equal((await model.compact(INPUT, OPTIONS)).outcome, MODEL_RESPONSE_OUTCOME.FAILED);
});

test("a rate limit stands the adapter down for the header's wait or the fixed cooldown, and nothing is sent meanwhile", async () => {
  let now = NOW;
  const { fetch, calls } = fakeFetch([
    new Response("", { status: 429, headers: { "retry-after": "7" } }),
    Response.json({ status: "completed", output: [] }),
    new Response("", { status: 429 }),
  ]);
  const model = adapter(fetch, () => now);
  const first = await model.respond(INPUT, OPTIONS);
  assert.deepEqual(first, { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until: NOW + 7_000 });
  assert.equal(model.quietUntil(), NOW + 7_000);
  assert.equal((await model.respond(INPUT, OPTIONS)).outcome, MODEL_RESPONSE_OUTCOME.THROTTLED);
  assert.equal(calls.length, 1);
  now = NOW + 7_000;
  assert.equal((await model.respond(INPUT, OPTIONS)).outcome, MODEL_RESPONSE_OUTCOME.ANSWERED);
  const bare = await model.respond(INPUT, OPTIONS);
  assert.deepEqual(bare, {
    outcome: MODEL_RESPONSE_OUTCOME.THROTTLED,
    until: now + BRAIN_RATE_LIMIT_COOLDOWN_MS,
  });
});

test("statuses become failures by kind, a provider-marked failed response is upstream, and a network fault names no words of its own", async () => {
  const { fetch } = fakeFetch([
    new Response("", { status: 401 }),
    new Response("", { status: 500 }),
    Response.json({ status: "failed", error: { code: "server_error" }, output: [] }),
    new Response("not json", { status: 200 }),
  ]);
  const model = adapter(fetch);
  assert.equal((await model.respond(INPUT, OPTIONS)).outcome, MODEL_RESPONSE_OUTCOME.FAILED);
  const outage = await model.respond(INPUT, OPTIONS);
  assert.ok(
    outage.outcome === MODEL_RESPONSE_OUTCOME.FAILED && outage.failure === MODEL_FAILURE.UPSTREAM,
  );
  const declared = await model.respond(INPUT, OPTIONS);
  assert.ok(
    declared.outcome === MODEL_RESPONSE_OUTCOME.FAILED && declared.reason.includes("server_error"),
  );
  const malformed = await model.respond(INPUT, OPTIONS);
  assert.ok(
    malformed.outcome === MODEL_RESPONSE_OUTCOME.FAILED &&
      malformed.failure === MODEL_FAILURE.MALFORMED,
  );
  const broken = adapter(async () => {
    throw new Error("sk-secret leaked?");
  });
  const fault = await broken.respond(INPUT, OPTIONS);
  assert.ok(
    fault.outcome === MODEL_RESPONSE_OUTCOME.FAILED && fault.failure === MODEL_FAILURE.NETWORK,
  );
  assert.ok(!fault.reason.includes("secret"));
});

test("the factory builds only from a key, and capabilities name the tool-loop Responses checkpoint", async () => {
  assert.equal(openAiModelAdapter(undefined), undefined);
  assert.equal(openAiModelAdapter("  "), undefined);
  const built = openAiModelAdapter("sk-x", { model: "gpt-y" });
  assert.ok(built);
  const capabilities = await built.capabilities();
  assert.ok(capabilities.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.equal(capabilities.capabilities.model, "gpt-y");
  assert.deepEqual(capabilities.capabilities.checkpoint, {
    runtime: "tool-loop",
    runtimeVersion: 1,
    format: "openai-responses-input",
    formatVersion: 1,
  });
  assert.equal(capabilities.capabilities.compacts, true);
});
