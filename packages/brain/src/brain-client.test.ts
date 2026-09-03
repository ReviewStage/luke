import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import {
  BRAIN_CLIENT_OUTCOME,
  BRAIN_RATE_LIMIT_COOLDOWN_MS,
  HostedBrainClient,
  OpenAiBrainClient,
  openAiBrainClient,
} from "./brain-client.js";
import { userMessageItem } from "./brain-openai.js";
import { BRAIN_TOOL } from "./brain-tools.js";

const NOW = 1_800_000_000_000;
const INPUT = [userMessageItem("[observed events] ...")];

interface RecordedCall {
  url: string;
  init: RequestInit;
  body: UnparsedWireValue;
}

function fakeFetch(responses: readonly Response[]) {
  const calls: RecordedCall[] = [];
  const queue = [...responses];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    // SAFETY: every request body this client sends is JSON.stringify output.
    const body = JSON.parse(String(init.body)) as UnparsedWireValue;
    calls.push({ url, init, body });
    const response = queue.shift();
    assert.ok(response, "an unexpected request was made");
    return response;
  };
  return { fetch, calls };
}

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

test("the keyed client posts the fixed request on the developer's key and answers the payload", async () => {
  const { fetch, calls } = fakeFetch([Response.json({ output: [], usage: { input_tokens: 5 } })]);
  const client = new OpenAiBrainClient({
    apiKey: "sk-test",
    model: "gpt-test",
    baseUrl: "https://example.test/v1/",
    fetch,
    now: () => NOW,
  });
  const answer = await client.respond(INPUT, { maximumOutputTokens: 500 });
  assert.equal(answer.outcome, BRAIN_CLIENT_OUTCOME.ANSWERED);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, "https://example.test/v1/responses");
  assert.equal(header(call.init, "authorization"), "Bearer sk-test");
  assert.ok(isRecord(call.body));
  assert.equal(call.body.model, "gpt-test");
  assert.equal(call.body.store, false);
  assert.deepEqual(call.body.context_management, [{ type: "compaction" }]);
  assert.deepEqual(call.body.reasoning, { effort: "medium" });
  assert.equal(call.body.max_output_tokens, 500);
  assert.deepEqual(call.body.input, INPUT);
  assert.ok(Array.isArray(call.body.tools));
  assert.ok(
    call.body.tools.some((tool) => isRecord(tool) && tool.name === BRAIN_TOOL.READ_TRANSCRIPT),
  );
});

test("a 429 quiets the keyed client for the retry-after it names, and nothing is sent meanwhile", async () => {
  let now = NOW;
  const { fetch, calls } = fakeFetch([
    new Response("", { status: 429, headers: { "retry-after": "7" } }),
    Response.json({ output: [] }),
  ]);
  const client = new OpenAiBrainClient({ apiKey: "sk", fetch, now: () => now, report: () => {} });
  const first = await client.respond(INPUT, { maximumOutputTokens: 10 });
  assert.deepEqual(first, { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: NOW + 7_000 });
  assert.equal(client.quietUntil(), NOW + 7_000);
  const held = await client.respond(INPUT, { maximumOutputTokens: 10 });
  assert.equal(held.outcome, BRAIN_CLIENT_OUTCOME.QUIET);
  assert.equal(calls.length, 1);
  now = NOW + 7_001;
  assert.equal(client.quietUntil(), undefined);
  const resumed = await client.respond(INPUT, { maximumOutputTokens: 10 });
  assert.equal(resumed.outcome, BRAIN_CLIENT_OUTCOME.ANSWERED);
  assert.equal(calls.length, 2);
});

test("a 429 without retry-after uses the fixed cooldown, and other failures answer a reason", async () => {
  const { fetch } = fakeFetch([
    new Response("", { status: 429 }),
    new Response("", { status: 500 }),
  ]);
  const client = new OpenAiBrainClient({ apiKey: "sk", fetch, now: () => NOW, report: () => {} });
  const quiet = await client.respond(INPUT, { maximumOutputTokens: 10 });
  assert.deepEqual(quiet, {
    outcome: BRAIN_CLIENT_OUTCOME.QUIET,
    until: NOW + BRAIN_RATE_LIMIT_COOLDOWN_MS,
  });
  const fresh = new OpenAiBrainClient({ apiKey: "sk", fetch, now: () => NOW });
  const failed = await fresh.respond(INPUT, { maximumOutputTokens: 10 });
  assert.equal(failed.outcome, BRAIN_CLIENT_OUTCOME.FAILED);
});

test("the factory builds nothing without a key and honors the model option", () => {
  assert.equal(openAiBrainClient(undefined), undefined);
  assert.equal(openAiBrainClient("   "), undefined);
  assert.equal(openAiBrainClient("sk", { model: "gpt-other" })?.model, "gpt-other");
  assert.equal(openAiBrainClient("sk")?.model, "gpt-5.6-sol");
});

test("the hosted client sends only the input and budget, retries once on 401, and quiets on quota", async () => {
  const { fetch, calls } = fakeFetch([
    new Response("", { status: 401 }),
    Response.json({ output: [] }),
    Response.json(
      { quota: { used: 9, limit: 9, remaining: 0, resetsAt: NOW + 90_000 } },
      { status: 429 },
    ),
  ]);
  let token = "stale";
  const client = new HostedBrainClient({
    serviceBaseUrl: "https://luke.test/",
    readAccessToken: async () => token,
    refreshAccount: async () => {
      token = "fresh";
    },
    fetch,
    now: () => NOW,
    report: () => {},
  });
  const answer = await client.respond(INPUT, { maximumOutputTokens: 77 });
  assert.equal(answer.outcome, BRAIN_CLIENT_OUTCOME.ANSWERED);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, `https://luke.test${HOSTED_SERVICE_PATH.BRAIN_RESPOND}`);
  assert.equal(header(calls[0]?.init ?? {}, "authorization"), "Bearer stale");
  assert.equal(header(calls[1]?.init ?? {}, "authorization"), "Bearer fresh");
  assert.deepEqual(calls[1]?.body, { input: INPUT, max_output_tokens: 77 });

  const quiet = await client.respond(INPUT, { maximumOutputTokens: 77 });
  assert.deepEqual(quiet, { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: NOW + 90_000 });
  assert.equal(client.quietUntil(), NOW + 90_000);
  const held = await client.respond(INPUT, { maximumOutputTokens: 77 });
  assert.equal(held.outcome, BRAIN_CLIENT_OUTCOME.QUIET);
  assert.equal(calls.length, 3);
});
