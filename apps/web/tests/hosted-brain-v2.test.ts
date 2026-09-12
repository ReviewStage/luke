import assert from "node:assert/strict";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { test } from "vitest";
import { HOSTED_BRAIN_DEFAULTS } from "../server/brain-app";
import {
  ACTION_TOOL,
  BRAIN_OPENAI_DEFAULTS,
  BRAIN_PREFETCH_MODEL,
  BRAIN_RATE_LIMIT_COOLDOWN_MS,
  BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS,
  BRAIN_REASONING_SUMMARY,
  BRAIN_TOOL,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_LISTED_OPERATIONS,
  HOSTED_BRAIN_OPERATION,
  HOSTED_BRAIN_OPTION_BOUNDS,
  HOSTED_BRAIN_PREFETCH_KIND,
  HOSTED_BRAIN_PROMPT_BOUNDS,
  HOSTED_SERVICE_PATH,
  hostedBrainBounds,
  hostedBrainCapabilitiesFromWire,
  hostedBrainToolCatalog,
  isRecord,
  isWireString,
  maximumHostedBrainRequestBytes,
  PLAN_READS_TOOL_NAME,
  type UnparsedWireValue,
  type WireRecord,
} from "../server/core";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";
import { type BrainCall, brainAnswer } from "./support/brain-call";

const NOW = Date.parse("2026-09-07T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";
const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 2, limit: 5_000, resetsAt: NOW + 43_200_000 },
};
const INPUT: readonly WireRecord[] = [
  { type: "message", role: "user", content: [{ type: "input_text", text: "[ask] anything?" }] },
];

function message(text: string): WireRecord {
  return {
    type: "message",
    id: "msg_1",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

function request(path: string, body: WireRecord | string | null, init: RequestInit = {}): Request {
  return new Request(`https://luke.test${path}`, {
    method: "POST",
    headers: { authorization: "Bearer token-1", "content-type": "application/json" },
    body: isWireString(body) || body === null ? body : JSON.stringify(body),
    ...init,
  });
}

function respondBody(overrides: WireRecord = {}): WireRecord {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    prompt: "You are Luke.",
    tools: [ACTION_TOOL.SEND_SESSION_MESSAGE, BRAIN_TOOL.READ_TRANSCRIPT],
    options: {},
    input: INPUT,
    ...overrides,
  };
}

interface UpstreamCall {
  url: string;
  body: WireRecord;
}

function upstream(answers: readonly (() => Response)[]) {
  const calls: UpstreamCall[] = [];
  const queue = [...answers];
  const layer = fakeHttpClientLayer((url, init) => {
    // SAFETY: every upstream body the handler sends is JSON.stringify output.
    const body = JSON.parse(String(init.body)) as UnparsedWireValue;
    assert.ok(isRecord(body));
    calls.push({ url, body });
    const answer = queue.shift();
    assert.ok(answer, "an unexpected upstream call was made");
    return answer();
  });
  return { layer, calls };
}

function options(overrides: Partial<BrainCall> & { request: Request }): BrainCall {
  return {
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    ...overrides,
  };
}

async function errorOf(response: Response): Promise<string> {
  // SAFETY: response.json returns a runtime value; the reader below validates it as wire.
  const body = (await response.json()) as UnparsedWireValue;
  assert.ok(isRecord(body));
  return String(body.error);
}

test("capabilities name the contract, the model, the operations, the registered tools, and the bounds", async () => {
  const response = await brainAnswer(
    options({ request: request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, null, { method: "GET" }) }),
  );
  assert.equal(response.status, 200);
  const capabilities = hostedBrainCapabilitiesFromWire(
    // SAFETY: response.json returns a runtime value; the reader below validates it as wire.
    (await response.json()) as UnparsedWireValue,
  );
  assert.ok(capabilities);
  assert.equal(capabilities.model, BRAIN_OPENAI_DEFAULTS.MODEL);
  // The prefetch is advertised by its own field, never in the list a shipped desktop decodes against a fixed set.
  assert.deepEqual(capabilities.operations, HOSTED_BRAIN_LISTED_OPERATIONS);
  assert.equal(capabilities.operations.includes(HOSTED_BRAIN_OPERATION.PREFETCH), false);
  assert.deepEqual(capabilities.prefetch, { model: BRAIN_PREFETCH_MODEL });
  assert.deepEqual(capabilities.bounds, hostedBrainBounds());
  for (const tool of hostedBrainToolCatalog().values()) {
    assert.ok(capabilities.tools.includes(tool.name), tool.name);
  }
  assert.ok(capabilities.tools.includes(BRAIN_TOOL.ANNOUNCE));
  // A model override names the model; the method, the key, and the bearer are checked as everywhere.
  const overridden = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, null, { method: "GET" }),
      model: "gpt-override",
    }),
  );
  // SAFETY: response.json returns a runtime value; the reader below validates it as wire.
  assert.equal(((await overridden.json()) as { model: string }).model, "gpt-override");
  const posted = await brainAnswer(
    options({ request: request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, null) }),
  );
  assert.equal(posted.status, 405);
  const off = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, null, { method: "GET" }),
      apiKey: " ",
    }),
  );
  assert.equal(off.status, 503);
  const anonymous = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, null, { method: "GET" }),
      resolveUserId: async () => undefined,
    }),
  );
  assert.equal(anonymous.status, 401);
});

test("a respond request runs the prepared prompt over the schemas its names select, within the build's fixed settings", async () => {
  const output = [message("Nothing needs you.")];
  const { layer, calls } = upstream([
    () => Response.json({ id: "resp_1", status: "completed", output, usage: { input_tokens: 42 } }),
  ]);
  let spent = 0;
  const response = await brainAnswer(
    options({
      request: request(
        HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2,
        respondBody({ options: { maximumOutputTokens: 900, reasoningEffort: "low" } }),
      ),
      httpClient: layer,
      spend: async () => {
        spent += 1;
        return OPEN_SPEND;
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(spent, 1);
  const sent = calls[0]?.body;
  assert.ok(sent);
  assert.equal(calls[0]?.url, `${BRAIN_OPENAI_DEFAULTS.BASE_URL}/responses`);
  assert.equal(sent.model, HOSTED_BRAIN_DEFAULTS.MODEL);
  assert.equal(sent.instructions, "You are Luke.");
  assert.equal("store" in sent, false);
  assert.equal(sent.max_output_tokens, 900);
  assert.deepEqual(sent.reasoning, { effort: "low", summary: BRAIN_REASONING_SUMMARY });
  assert.ok(Array.isArray(sent.tools));
  assert.deepEqual(
    sent.tools.map((tool) => (isRecord(tool) ? tool.name : undefined)),
    [ACTION_TOOL.SEND_SESSION_MESSAGE, BRAIN_TOOL.READ_TRANSCRIPT],
  );
  const selected = [...hostedBrainToolCatalog().values()].find(
    (tool) => tool.name === ACTION_TOOL.SEND_SESSION_MESSAGE,
  );
  assert.deepEqual(sent.tools[0], selected);
  assert.deepEqual(sent.input, INPUT);
  // Nothing asked for a prefix cache, so nothing is forwarded upstream.
  assert.equal("prompt_cache_key" in sent, false);
});

test("a prefetch plan runs the one registered planning tool, forced, on the prefetch model at low effort, and spends once; a summary runs tool-free", async () => {
  const plan = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: PLAN_READS_TOOL_NAME,
    arguments: '{"reads":[]}',
    status: "completed",
  };
  const { layer, calls } = upstream([
    () => Response.json({ id: "resp_1", status: "completed", output: [plan] }),
    () => Response.json({ id: "resp_2", status: "completed", output: [message("Facts.")] }),
  ]);
  let spent = 0;
  const prefetchBody = (kind: string, overrides: WireRecord = {}): WireRecord => ({
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    kind,
    prompt: "Plan the reads.",
    options: { maximumOutputTokens: 600 },
    input: INPUT,
    ...overrides,
  });
  const planned = await brainAnswer(
    options({
      request: request(
        HOSTED_SERVICE_PATH.BRAIN_PREFETCH,
        prefetchBody(HOSTED_BRAIN_PREFETCH_KIND.PLAN),
      ),
      httpClient: layer,
      spend: async () => {
        spent += 1;
        return OPEN_SPEND;
      },
    }),
  );
  assert.equal(planned.status, 200);
  assert.equal(spent, 1);
  const sent = calls[0]?.body;
  assert.ok(sent);
  assert.equal(calls[0]?.url, `${BRAIN_OPENAI_DEFAULTS.BASE_URL}/responses`);
  assert.equal(sent.model, BRAIN_PREFETCH_MODEL);
  assert.deepEqual(sent.tool_choice, { type: "function", name: PLAN_READS_TOOL_NAME });
  assert.equal(sent.parallel_tool_calls, false);
  assert.ok(Array.isArray(sent.tools));
  assert.equal(sent.tools.length, 1);
  assert.deepEqual(sent.tools[0], hostedBrainToolCatalog().get(PLAN_READS_TOOL_NAME));
  assert.deepEqual(sent.reasoning, { effort: "low", summary: BRAIN_REASONING_SUMMARY });
  assert.equal(sent.max_output_tokens, 600);
  assert.equal("store" in sent, false);
  const summarized = await brainAnswer(
    options({
      request: request(
        HOSTED_SERVICE_PATH.BRAIN_PREFETCH,
        prefetchBody(HOSTED_BRAIN_PREFETCH_KIND.SUMMARIZE, {
          options: { maximumOutputTokens: 350 },
        }),
      ),
      httpClient: layer,
    }),
  );
  assert.equal(summarized.status, 200);
  const summary = calls[1]?.body;
  assert.ok(summary);
  assert.deepEqual(summary.tools, []);
  assert.equal(summary.tool_choice, "auto");
  assert.equal(summary.max_output_tokens, 350);
  // A prefetch model override names the model the prefetch runs on and leaves the turn's alone.
  const overridden = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, null, { method: "GET" }),
      prefetchModel: "gpt-small",
    }),
  );
  const read = hostedBrainCapabilitiesFromWire(
    // SAFETY: response.json returns a runtime value; the reader below validates it as wire.
    (await overridden.json()) as UnparsedWireValue,
  );
  assert.deepEqual(read?.prefetch, { model: "gpt-small" });
  assert.equal(read?.model, BRAIN_OPENAI_DEFAULTS.MODEL);
});

test("a request's prompt cache key is forwarded upstream and kept nowhere", async () => {
  const { layer, calls } = upstream([
    () => Response.json({ id: "resp_1", status: "completed", output: [message("ok")] }),
  ]);
  const response = await brainAnswer(
    options({
      request: request(
        HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2,
        respondBody({ options: { promptCacheKey: "9f86d0818" } }),
      ),
      httpClient: layer,
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls[0]?.body?.prompt_cache_key, "9f86d0818");
  assert.equal(calls[0]?.body !== undefined && "store" in calls[0].body, false);
});

test("each refusal answers its own error before anything is spent: prompt envelope, unknown tool, bounds, shape, size", async () => {
  let spent = 0;
  const refusalOf = async (body: WireRecord | string) => {
    const response = await brainAnswer(
      options({
        request: request(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, body),
        spend: async () => {
          spent += 1;
          return OPEN_SPEND;
        },
        httpClient: fakeHttpClientLayer(async () => {
          throw new Error("nothing may reach upstream");
        }),
      }),
    );
    return { status: response.status, error: await errorOf(response) };
  };
  assert.deepEqual(
    await refusalOf(
      respondBody({ prompt: "x".repeat(HOSTED_BRAIN_PROMPT_BOUNDS.MAXIMUM_CHARS + 1) }),
    ),
    { status: 400, error: HOSTED_API_ERROR.PROMPT_TOO_LARGE },
  );
  assert.deepEqual(await refusalOf(respondBody({ tools: ["shell"] })), {
    status: 400,
    error: HOSTED_API_ERROR.UNKNOWN_TOOL,
  });
  assert.deepEqual(
    await refusalOf(
      respondBody({
        options: { maximumOutputTokens: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS + 1 },
      }),
    ),
    { status: 400, error: HOSTED_API_ERROR.INVALID_REQUEST },
  );
  assert.deepEqual(
    await refusalOf(respondBody({ tools: [{ name: "uploaded", parameters: {} }] })),
    {
      status: 400,
      error: HOSTED_API_ERROR.INVALID_REQUEST,
    },
  );
  assert.deepEqual(await refusalOf(respondBody({ contract: 1 })), {
    status: 400,
    error: HOSTED_API_ERROR.INVALID_REQUEST,
  });
  assert.deepEqual(await refusalOf("not json"), {
    status: 400,
    error: HOSTED_API_ERROR.INVALID_REQUEST,
  });
  const oversized = JSON.stringify(
    respondBody({
      input: [
        { type: "message", role: "user", content: "x".repeat(maximumHostedBrainRequestBytes) },
      ],
    }),
  );
  assert.deepEqual(await refusalOf(oversized), {
    status: 413,
    error: HOSTED_API_ERROR.REQUEST_TOO_LARGE,
  });
  assert.equal(spent, 0);
});

test("a spent allowance answers 429 with the quota, and an upstream fault or an unreplayable answer is 502 with no upstream words", async () => {
  const exhausted = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      spend: async () => ({ allowed: false, quota: OPEN_SPEND.quota }),
    }),
  );
  assert.equal(exhausted.status, 429);
  // SAFETY: response.json returns a runtime value; the reader below validates it as wire.
  const body = (await exhausted.json()) as UnparsedWireValue;
  assert.ok(isRecord(body) && isRecord(body.quota));
  assert.equal(body.error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);

  const failing = upstream([() => new Response("upstream secret words", { status: 500 })]);
  const failed = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      httpClient: failing.layer,
    }),
  );
  assert.equal(failed.status, 502);

  const unreplayable = upstream([
    () => Response.json({ status: "completed", output: [{ type: "web_search_call", id: "ws_1" }] }),
  ]);
  const refused = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      httpClient: unreplayable.layer,
    }),
  );
  assert.equal(refused.status, 502);
});

test("count-tokens posts the prepared request without an output budget and answers the count alone", async () => {
  const { layer, calls } = upstream([
    () => Response.json({ object: "response.input_tokens", input_tokens: 1_234 }),
  ]);
  const response = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS, {
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        prompt: "You are Luke.",
        tools: [BRAIN_TOOL.ANNOUNCE],
        input: INPUT,
      }),
      httpClient: layer,
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { inputTokens: 1_234 });
  assert.equal(calls[0]?.url, `${BRAIN_OPENAI_DEFAULTS.BASE_URL}/responses/input_tokens`);
  const sent = calls[0]?.body;
  assert.ok(sent);
  assert.equal(sent.instructions, "You are Luke.");
  assert.ok(!("max_output_tokens" in sent));
  assert.ok(Array.isArray(sent.tools));
  assert.deepEqual(
    sent.tools.filter(isRecord).map((tool) => tool.name),
    [BRAIN_TOOL.ANNOUNCE],
  );
  const malformed = upstream([() => Response.json({ input_tokens: -1 })]);
  const bad = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS, {
        contract: HOSTED_BRAIN_CONTRACT_VERSION,
        prompt: "p",
        tools: [],
        input: INPUT,
      }),
      httpClient: malformed.layer,
    }),
  );
  assert.equal(bad.status, 502);
});

test("a provider rate limit behind the service answers 429 as the provider's throttle with a bounded Retry-After, apart from a spent allowance", async () => {
  const { layer } = upstream([
    () => new Response("", { status: 429, headers: { "retry-after": "12" } }),
    () => new Response("", { status: 429, headers: { "retry-after": "86400" } }),
    () => new Response("", { status: 429 }),
  ]);
  const throttled = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      httpClient: layer,
    }),
  );
  assert.equal(throttled.status, 429);
  assert.equal(throttled.headers.get("retry-after"), "12");
  // SAFETY: response.json returns a runtime value; the record check below validates it as wire.
  const body = (await throttled.json()) as UnparsedWireValue;
  assert.ok(isRecord(body));
  assert.equal(body.error, HOSTED_API_ERROR.UPSTREAM_THROTTLED);
  assert.equal(body.upstreamStatus, 429);
  assert.ok(!("quota" in body));
  const bounded = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      httpClient: layer,
    }),
  );
  assert.equal(
    bounded.headers.get("retry-after"),
    String(BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS / 1000),
  );
  const bare = await brainAnswer(
    options({
      request: request(HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2, respondBody()),
      httpClient: layer,
    }),
  );
  assert.equal(bare.headers.get("retry-after"), String(BRAIN_RATE_LIMIT_COOLDOWN_MS / 1000));
});
