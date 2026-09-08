import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPERATION,
  HOSTED_SERVICE_PATH,
  hostedBrainBounds,
} from "@sidecar/hosted";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  REASONING_EFFORT,
} from "@sidecar/runtime-contracts";
import { isRecord, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import { HostedModelAdapter } from "./hosted-model-adapter.js";
import {
  BRAIN_RATE_LIMIT_COOLDOWN_MS,
  BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS,
} from "./model-adapter-shared.js";
import { userMessageItem } from "./responses-api.js";
import { brainToolCatalog, brainToolSchemas, resolveTurnToolPolicy } from "./tools.js";
import { BRAIN_TURN_TRIGGER } from "./turn.js";

const NOW = 1_800_000_000_000;
const BASE = "https://luke.test";
const INPUT = [userMessageItem("[developer ask] hi")];
const TOOLS = brainToolSchemas(
  resolveTurnToolPolicy(brainToolCatalog(), {}, BRAIN_TURN_TRIGGER.ASK),
);
const OPTIONS = { prompt: "instructions", tools: TOOLS, maximumOutputTokens: 500 };

function capabilities(overrides: WireRecord = {}): WireRecord {
  return {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: "gpt-hosted",
    operations: Object.values(HOSTED_BRAIN_OPERATION),
    tools: TOOLS.map((tool) => tool.name),
    bounds: { ...hostedBrainBounds() },
    reasoningEfforts: Object.values(REASONING_EFFORT),
    ...overrides,
  };
}

interface Call {
  url: string;
  method: string;
  token: string | null;
  body: UnparsedWireValue;
}

/** A service that answers each path from a queue, recording what reached it. */
function service(routes: Record<string, (() => Response)[]>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const path = url.slice(BASE.length);
    // SAFETY: every body this adapter sends is JSON.stringify output; a GET has none.
    const body =
      init.body === undefined ? undefined : (JSON.parse(String(init.body)) as UnparsedWireValue);
    calls.push({
      url,
      method: init.method ?? "GET",
      token: new Headers(init.headers).get("authorization"),
      body,
    });
    const answer = routes[path]?.shift();
    assert.ok(answer, `unexpected call to ${path}`);
    return answer();
  };
  return { fetch, calls };
}

function adapter(
  fetch: (url: string, init: RequestInit) => Promise<Response>,
  tokens: (string | undefined)[] = ["token-1"],
) {
  const queue = [...tokens];
  let current = queue.shift();
  return new HostedModelAdapter({
    serviceBaseUrl: BASE,
    readAccessToken: async () => current,
    refreshAccount: async () => {
      current = queue.shift() ?? current;
    },
    fetch,
    now: () => NOW,
    report: () => undefined,
  });
}

test("the adapter reads the capabilities once, then posts the prepared prompt, the tool names, and the options", async () => {
  const { fetch, calls } = service({
    [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [() => Response.json(capabilities())],
    [HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2]: [
      () =>
        Response.json({
          status: "completed",
          output: [
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
          ],
        }),
      () => Response.json({ status: "completed", output: [] }),
    ],
  });
  const model = adapter(fetch);
  assert.equal(model.model, undefined);
  const answer = await model.respond(INPUT, { ...OPTIONS, reasoningEffort: REASONING_EFFORT.HIGH });
  assert.ok(answer.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED && answer.text === "ok");
  assert.equal(model.model, "gpt-hosted");
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.url, `${BASE}${HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES}`);
  assert.equal(calls[0]?.token, "Bearer token-1");
  const sent = calls[1]?.body;
  assert.ok(isRecord(sent));
  assert.equal(calls[1]?.url, `${BASE}${HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2}`);
  assert.equal(sent.contract, 2);
  assert.equal(sent.prompt, "instructions");
  assert.deepEqual(
    sent.tools,
    TOOLS.map((tool) => tool.name),
  );
  assert.deepEqual(sent.options, { maximumOutputTokens: 500, reasoningEffort: "high" });
  assert.deepEqual(sent.input, INPUT);
  await model.respond(INPUT, OPTIONS);
  assert.equal(calls.filter((call) => call.method === "GET").length, 1);
  const known = await model.capabilities();
  assert.ok(known.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED);
  assert.deepEqual(
    known.capabilities.tools,
    TOOLS.map((tool) => tool.name),
  );
  assert.equal(known.capabilities.compacts, true);
});

test("a service without the contract, with another contract, or missing an operation or a tool is a compatibility failure, never a fall back", async () => {
  const missing = adapter(
    service({ [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [() => new Response("", { status: 404 })] })
      .fetch,
  );
  const absent = await missing.respond(INPUT, OPTIONS);
  assert.ok(
    absent.outcome === MODEL_RESPONSE_OUTCOME.FAILED &&
      absent.failure === MODEL_FAILURE.COMPATIBILITY,
  );

  const older = adapter(
    service({
      [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [
        () => Response.json(capabilities({ contract: 1 })),
      ],
    }).fetch,
  );
  const wrongContract = await older.respond(INPUT, OPTIONS);
  assert.ok(
    wrongContract.outcome === MODEL_RESPONSE_OUTCOME.FAILED &&
      wrongContract.failure === MODEL_FAILURE.COMPATIBILITY,
  );

  const narrow = adapter(
    service({
      [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [
        () => Response.json(capabilities({ operations: [HOSTED_BRAIN_OPERATION.RESPOND] })),
      ],
    }).fetch,
  );
  const noCompaction = await narrow.compact(INPUT, OPTIONS);
  assert.ok(
    noCompaction.outcome === MODEL_RESPONSE_OUTCOME.FAILED &&
      noCompaction.failure === MODEL_FAILURE.COMPATIBILITY,
  );
  const known = await narrow.capabilities();
  assert.ok(
    known.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED && known.capabilities.compacts === false,
  );

  const unregistered = adapter(
    service({
      [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [
        () => Response.json(capabilities({ tools: ["announce"] })),
      ],
    }).fetch,
  );
  const unknownTool = await unregistered.respond(INPUT, OPTIONS);
  assert.ok(
    unknownTool.outcome === MODEL_RESPONSE_OUTCOME.FAILED &&
      unknownTool.failure === MODEL_FAILURE.COMPATIBILITY,
  );
  assert.match(unknownTool.reason, /not registered/u);
});

test("the prompt envelope and the body bound are enforced before anything is sent", async () => {
  const { fetch, calls } = service({
    [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [() => Response.json(capabilities())],
  });
  const model = adapter(fetch);
  const long = await model.respond(INPUT, {
    ...OPTIONS,
    prompt: "x".repeat(hostedBrainBounds().promptChars + 1),
  });
  assert.ok(
    long.outcome === MODEL_RESPONSE_OUTCOME.FAILED && long.failure === MODEL_FAILURE.BOUNDS,
  );
  const heavy = await model.respond(
    [userMessageItem("y".repeat(hostedBrainBounds().requestBytes))],
    OPTIONS,
  );
  assert.ok(
    heavy.outcome === MODEL_RESPONSE_OUTCOME.FAILED && heavy.failure === MODEL_FAILURE.BOUNDS,
  );
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("a spent allowance stands the adapter down until the day's reset, a token refused once is refreshed and retried once, and an unreplayable answer is refused whole", async () => {
  const resetsAt = NOW + 3_600_000;
  const { fetch, calls } = service({
    [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [() => Response.json(capabilities())],
    [HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2]: [
      () => new Response("", { status: 401 }),
      () => Response.json({ status: "completed", output: [{ type: "web_search_call", id: "ws" }] }),
      () =>
        Response.json(
          { error: "quota-exhausted", quota: { used: 5000, limit: 5000, remaining: 0, resetsAt } },
          { status: 429 },
        ),
    ],
  });
  const model = adapter(fetch, ["stale", "fresh"]);
  const unreplayable = await model.respond(INPUT, OPTIONS);
  assert.ok(
    unreplayable.outcome === MODEL_RESPONSE_OUTCOME.FAILED &&
      unreplayable.failure === MODEL_FAILURE.MALFORMED,
  );
  const posts = calls.filter((call) => call.method === "POST");
  assert.deepEqual(
    posts.map((call) => call.token),
    ["Bearer stale", "Bearer fresh"],
  );
  const exhausted = await model.respond(INPUT, OPTIONS);
  assert.deepEqual(exhausted, { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until: resetsAt });
  assert.equal(model.quietUntil(), resetsAt);
  assert.equal(
    (await model.countInputTokens(INPUT, OPTIONS)).outcome,
    MODEL_RESPONSE_OUTCOME.THROTTLED,
  );
});

test("count and compact travel on their own endpoints and adopt exactly what the service answered", async () => {
  const window = [{ type: "compaction", id: "c", encrypted_content: "x" }];
  const { fetch, calls } = service({
    [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [() => Response.json(capabilities())],
    [HOSTED_SERVICE_PATH.BRAIN_COUNT_TOKENS]: [() => Response.json({ inputTokens: 12 })],
    [HOSTED_SERVICE_PATH.BRAIN_COMPACT]: [() => Response.json({ output: window })],
  });
  const model = adapter(fetch);
  assert.deepEqual(await model.countInputTokens(INPUT, OPTIONS), {
    outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
    inputTokens: 12,
  });
  const compacted = await model.compact(INPUT, OPTIONS);
  assert.deepEqual(compacted, { outcome: MODEL_RESPONSE_OUTCOME.ANSWERED, items: window });
  const compactCall = calls.find((call) => call.url.endsWith(HOSTED_SERVICE_PATH.BRAIN_COMPACT));
  assert.ok(compactCall && isRecord(compactCall.body));
  assert.deepEqual(Object.keys(compactCall.body).sort(), ["contract", "input", "prompt"]);
});

test("a 429 that names the day's quota waits for the reset; a 429 that names the provider's throttle waits the bounded Retry-After or the fixed cooldown", async () => {
  const resetsAt = NOW + 3_600_000;
  const quotaService = service({
    [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [() => Response.json(capabilities())],
    [HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2]: [
      () =>
        Response.json(
          { error: "quota-exhausted", quota: { used: 5000, limit: 5000, remaining: 0, resetsAt } },
          { status: 429, headers: { "retry-after": "5" } },
        ),
    ],
  });
  const quota = adapter(quotaService.fetch);
  assert.deepEqual(await quota.respond(INPUT, OPTIONS), {
    outcome: MODEL_RESPONSE_OUTCOME.THROTTLED,
    until: resetsAt,
  });

  const throttledService = service({
    [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [() => Response.json(capabilities())],
    [HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2]: [
      () =>
        Response.json(
          { error: "upstream-throttled", upstreamStatus: 429 },
          { status: 429, headers: { "retry-after": "7" } },
        ),
    ],
  });
  const provider = adapter(throttledService.fetch);
  assert.deepEqual(await provider.respond(INPUT, OPTIONS), {
    outcome: MODEL_RESPONSE_OUTCOME.THROTTLED,
    until: NOW + 7_000,
  });

  const unbounded = service({
    [HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES]: [
      () => Response.json(capabilities()),
      () => Response.json(capabilities()),
    ],
    [HOSTED_SERVICE_PATH.BRAIN_RESPOND_V2]: [
      () =>
        Response.json(
          { error: "upstream-throttled", upstreamStatus: 429 },
          { status: 429, headers: { "retry-after": "86400" } },
        ),
      () => Response.json({ error: "upstream-throttled", upstreamStatus: 429 }, { status: 429 }),
    ],
  });
  const bounded = adapter(unbounded.fetch);
  assert.deepEqual(await bounded.respond(INPUT, OPTIONS), {
    outcome: MODEL_RESPONSE_OUTCOME.THROTTLED,
    until: NOW + BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS,
  });
  const fresh = adapter(unbounded.fetch);
  assert.deepEqual(await fresh.respond(INPUT, OPTIONS), {
    outcome: MODEL_RESPONSE_OUTCOME.THROTTLED,
    until: NOW + BRAIN_RATE_LIMIT_COOLDOWN_MS,
  });
});
