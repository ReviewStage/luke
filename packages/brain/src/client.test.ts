import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_BRAIN_CONTRACT_VERSION, HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { MODEL_FAILURE, MODEL_RESPONSE_OUTCOME } from "@sidecar/runtime/vocabulary";
import { HTTP_METHOD } from "@sidecar/wire";
import { hostedBrainTransport, keyedBrainTransport } from "./client.js";
import {
  BRAIN_RATE_LIMIT_COOLDOWN_MS,
  BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS,
  BRAIN_REQUEST_TIMEOUT_MS,
} from "./model-adapter-shared.js";

const NOW = 1_800_000_000_000;
const BASE = "https://luke.test";
const TRANSCRIPT = '{"input":"what the session said"}';

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
  contentType: string | null;
  body: string | undefined;
  signal: AbortSignal | undefined;
}

function recorder(answers: readonly (() => Response)[]) {
  const calls: Call[] = [];
  const queue = [...answers];
  const fetch = (url: string, init: RequestInit): Promise<Response> => {
    const headers = new Headers(init.headers);
    calls.push({
      url,
      method: init.method,
      authorization: headers.get("authorization"),
      contentType: headers.get("content-type"),
      body: init.body === undefined ? undefined : String(init.body),
      signal: init.signal ?? undefined,
    });
    const answer = queue.shift();
    assert.ok(answer, `unexpected call to ${url}`);
    return Promise.resolve(answer());
  };
  return { fetch, calls };
}

function keyed(answers: readonly (() => Response)[], baseUrl = `${BASE}/v1/`) {
  const { fetch, calls } = recorder(answers);
  return {
    calls,
    transport: keyedBrainTransport({ baseUrl, apiKey: "sk-test", fetch, now: () => NOW }),
  };
}

function hosted(
  answers: readonly (() => Response)[],
  tokens: (string | undefined)[] = ["token-1"],
  accounts?: string[],
) {
  const { fetch, calls } = recorder(answers);
  const queue = [...tokens];
  const holders = accounts ? [...accounts] : undefined;
  let current = queue.shift();
  let holder = holders?.shift();
  const refreshes: number[] = [];
  const transport = hostedBrainTransport({
    baseUrl: BASE,
    readAccessToken: () => Promise.resolve(current),
    refreshAccount: () => {
      refreshes.push(1);
      current = queue.shift() ?? current;
      holder = holders?.shift() ?? holder;
      return Promise.resolve();
    },
    ...(holders ? { readAccountKey: () => Promise.resolve(holder) } : undefined),
    fetch,
    now: () => NOW,
  });
  return { calls, refreshes, transport };
}

test("a base URL is trimmed once, the credential is one bearer header, and a body names its own type", async () => {
  const { calls, transport } = keyed([() => Response.json({ ok: true })]);
  const response = await transport.send("/responses", HTTP_METHOD.POST, '{"a":1}');
  assert.ok(response instanceof Response);
  assert.equal(calls[0]?.url, `${BASE}/v1/responses`);
  assert.equal(calls[0]?.method, HTTP_METHOD.POST);
  assert.equal(calls[0]?.authorization, "Bearer sk-test");
  assert.equal(calls[0]?.contentType, "application/json");
  assert.equal(calls[0]?.body, '{"a":1}');

  const read = keyed([() => Response.json({ ok: true })]);
  await read.transport.send("/capabilities", HTTP_METHOD.GET);
  assert.equal(read.calls[0]?.body, undefined);
  assert.equal(read.calls[0]?.contentType, null);
});

test("the run's own cancellation is joined with the per-request timeout, and neither alone ends the other", async () => {
  const cancellation = new AbortController();
  const { calls, transport } = keyed([() => Response.json({})]);
  await transport.send("/responses", HTTP_METHOD.POST, "{}", cancellation.signal);
  const signal = calls[0]?.signal;
  assert.ok(signal && !signal.aborted);
  cancellation.abort();
  assert.equal(signal.aborted, true);
});

test("a fetch that throws is a network failure named by the error's kind alone, never by its words", async () => {
  const transport = keyedBrainTransport({
    baseUrl: BASE,
    apiKey: "sk-secret-key",
    fetch: () => Promise.reject(new TypeError("sk-secret-key was refused by dns")),
    now: () => NOW,
  });
  const failure = await transport.send("/responses", HTTP_METHOD.POST, "{}");
  assert.ok(!(failure instanceof Response));
  assert.equal(failure.outcome, MODEL_RESPONSE_OUTCOME.FAILED);
  assert.equal(failure.failure, MODEL_FAILURE.NETWORK);
  assert.equal(failure.reason, "request did not complete: TypeError");
});

test("the keyed transport sends one attempt and never refreshes; no account token at all is a credential failure", async () => {
  const { calls, transport } = keyed([() => new Response("", { status: 401 })]);
  const refused = await transport.send("/responses", HTTP_METHOD.POST, "{}");
  assert.ok(refused instanceof Response && refused.status === 401);
  assert.equal(calls.length, 1);

  const signedOut = hosted([], [undefined]);
  const failure = await signedOut.transport.send("/responses", HTTP_METHOD.POST, "{}");
  assert.ok(!(failure instanceof Response) && failure.failure === MODEL_FAILURE.CREDENTIAL);
  assert.deepEqual(signedOut.calls, []);
});

test("a refusal that outlived a renewed token is the caller's to read, not a failure of its own", async () => {
  const unchanged = hosted([() => new Response("", { status: 401 })], ["only"]);
  const refusal = await unchanged.transport.send("/responses", HTTP_METHOD.POST, "{}");
  assert.ok(refusal instanceof Response && refusal.status === 401);
  assert.equal(unchanged.refreshes.length, 1);
});

test("a token refreshed for another account never carries this turn's input", async () => {
  const crossed = hosted(
    [() => new Response("", { status: 401 })],
    ["stale", "fresh"],
    ["ada@luke.test", "grace@luke.test"],
  );
  const failure = await crossed.transport.send("/responses", HTTP_METHOD.POST, TRANSCRIPT);
  assert.ok(!(failure instanceof Response) && failure.failure === MODEL_FAILURE.CREDENTIAL);
  assert.equal(crossed.calls.length, 1);
  assert.equal(crossed.calls[0]?.authorization, "Bearer stale");
});

test("the brain asks for its own deadline, and an explicit one replaces it", () => {
  assert.equal(BRAIN_REQUEST_TIMEOUT_MS, 90_000);
  assert.equal(keyed([]).transport.requestTimeoutMs, BRAIN_REQUEST_TIMEOUT_MS);
  assert.equal(hosted([]).transport.requestTimeoutMs, BRAIN_REQUEST_TIMEOUT_MS);
  const tighter = keyedBrainTransport({
    baseUrl: BASE,
    apiKey: "sk-test",
    requestTimeoutMs: 5_000,
    now: () => NOW,
  });
  assert.equal(tighter.requestTimeoutMs, 5_000);
});

test("a 429 earns the bounded Retry-After or the fixed cooldown on either transport, and a spent allowance waits for its reset", () => {
  const { transport } = keyed([]);
  const header = transport.quietUntil(
    new Response("", { status: 429, headers: { "retry-after": "7" } }),
  );
  assert.deepEqual(header, {
    until: NOW + 7_000,
    message: "OpenAI brain turns are rate limited; pausing for 7s",
  });
  assert.equal(
    transport.quietUntil(new Response("", { status: 429 })).until,
    NOW + BRAIN_RATE_LIMIT_COOLDOWN_MS,
  );
  assert.equal(
    transport.quietUntil(new Response("", { status: 429, headers: { "retry-after": "86400" } }))
      .until,
    NOW + BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS,
  );

  const service = hosted([]);
  const throttle = new Response("", { status: 429, headers: { "retry-after": "7" } });
  assert.deepEqual(service.transport.quietUntil(throttle), {
    until: NOW + 7_000,
    message: "Hosted brain turns are rate limited; pausing for 7s",
  });
  const resetsAt = NOW + 3_600_000;
  assert.deepEqual(
    service.transport.quietUntil(throttle, {
      error: "quota-exhausted",
      quota: { used: 5000, limit: 5000, resetsAt },
    }),
    {
      until: resetsAt,
      message: "Hosted brain turns are out of today's allowance; pausing for 3600s",
    },
  );
  const spent = { error: "quota-exhausted", quota: { used: 1, limit: 1, resetsAt: NOW - 1 } };
  assert.equal(service.transport.quietUntil(throttle, spent).until, NOW + 7_000);
});

test("the capabilities read names a service with none, another contract, a refused token, and an outage by kind", async () => {
  const capabilities = {
    contract: HOSTED_BRAIN_CONTRACT_VERSION,
    model: "gpt-hosted",
    operations: ["respond"],
    tools: [],
    bounds: { promptChars: 1, requestBytes: 1, maximumOutputTokens: 1, inputItems: 1 },
    reasoningEfforts: ["medium"],
  };
  const served = hosted([() => Response.json(capabilities)]);
  const read = await served.transport.capabilities();
  assert.ok(!("outcome" in read) && read.model === "gpt-hosted");
  assert.equal(served.calls[0]?.url, `${BASE}${HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES}`);
  assert.equal(served.calls[0]?.method, HTTP_METHOD.GET);

  for (const [answer, failure] of [
    [() => new Response("", { status: 404 }), MODEL_FAILURE.COMPATIBILITY],
    [() => new Response("", { status: 405 }), MODEL_FAILURE.COMPATIBILITY],
    [() => Response.json({ ...capabilities, contract: 1 }), MODEL_FAILURE.COMPATIBILITY],
    [() => new Response("", { status: 401 }), MODEL_FAILURE.CREDENTIAL],
    [() => new Response("", { status: 503 }), MODEL_FAILURE.UPSTREAM],
  ] as const) {
    const refused = await hosted([answer]).transport.capabilities();
    assert.ok("outcome" in refused && refused.failure === failure);
  }
});
