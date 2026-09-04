import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STATUS } from "@sidecar/session";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";
import { BRAIN_CLIENT_OUTCOME, BRAIN_RATE_LIMIT_COOLDOWN_MS } from "./brain-client.js";
import { DIGEST_STOP_STATE, type DigestInput } from "./brain-digest.js";
import { OpenAiDigestClient, openAiDigestClient } from "./brain-digest-client.js";

const NOW = 1_800_000_000_000;
const TRANSCRIPT_SECRET = "SECRET_TRANSCRIPT_TEXT";
const INPUT: DigestInput = {
  providerName: "Claude Code",
  title: "Fix the checkout tests",
  status: SESSION_STATUS.WAITING,
  hookEvent: "stop",
  truncated: false,
  transcript: `user: fix it\nassistant: ${TRANSCRIPT_SECRET}`,
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

function digestPayload(digest: Record<string, string | null>) {
  return {
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: JSON.stringify(digest) }],
      },
    ],
  };
}

const WRITTEN = {
  stop_state: "waiting-for-developer",
  last_ask: "fix it",
  did_since: "ran the tests",
  waiting_on: "which fixture to use",
};

test("the keyed client posts the strict tool-free request on the developer's key and answers the digest", async () => {
  const { fetch, calls } = fakeFetch([Response.json(digestPayload(WRITTEN))]);
  const client = new OpenAiDigestClient({
    apiKey: "sk-test",
    model: "gpt-test",
    baseUrl: "https://example.test/v1/",
    fetch,
    now: () => NOW,
  });
  const answer = await client.summarize(INPUT);
  assert.deepEqual(answer, {
    outcome: BRAIN_CLIENT_OUTCOME.ANSWERED,
    digest: {
      stopState: DIGEST_STOP_STATE.WAITING_FOR_DEVELOPER,
      lastAsk: "fix it",
      didSince: "ran the tests",
      waitingOn: "which fixture to use",
    },
  });
  const [call] = calls;
  assert.ok(call);
  assert.equal(call.url, "https://example.test/v1/responses");
  assert.equal(header(call.init, "authorization"), "Bearer sk-test");
  assert.ok(isRecord(call.body));
  assert.equal(call.body.model, "gpt-test");
  assert.equal(call.body.store, false);
  assert.equal(call.body.max_output_tokens, 2_000);
  assert.deepEqual(call.body.reasoning, { effort: "low" });
  assert.ok(!("tools" in call.body));
  assert.ok(isRecord(call.body.text) && isRecord(call.body.text.format));
  assert.equal(call.body.text.format.strict, true);
  assert.equal(call.body.text.format.name, "session_digest");
  assert.ok(JSON.stringify(call.body.input).includes(TRANSCRIPT_SECRET));
});

test("a 429 quiets the keyed client for the retry-after it names, and nothing is sent meanwhile", async () => {
  let now = NOW;
  const { fetch, calls } = fakeFetch([
    new Response("", { status: 429, headers: { "retry-after": "7" } }),
    Response.json(digestPayload(WRITTEN)),
  ]);
  const client = new OpenAiDigestClient({ apiKey: "sk", fetch, now: () => now, report: () => {} });
  assert.deepEqual(await client.summarize(INPUT), {
    outcome: BRAIN_CLIENT_OUTCOME.QUIET,
    until: NOW + 7_000,
  });
  assert.equal(client.quietUntil(), NOW + 7_000);
  assert.equal((await client.summarize(INPUT)).outcome, BRAIN_CLIENT_OUTCOME.QUIET);
  assert.equal(calls.length, 1);
  now = NOW + 7_001;
  assert.equal(client.quietUntil(), undefined);
  assert.equal((await client.summarize(INPUT)).outcome, BRAIN_CLIENT_OUTCOME.ANSWERED);
});

test("a 429 without retry-after uses the fixed cooldown, and a failure names its status alone", async () => {
  const { fetch } = fakeFetch([
    new Response("", { status: 429 }),
    new Response(TRANSCRIPT_SECRET, { status: 500 }),
  ]);
  const quietClient = new OpenAiDigestClient({
    apiKey: "sk",
    fetch,
    now: () => NOW,
    report: () => {},
  });
  assert.deepEqual(await quietClient.summarize(INPUT), {
    outcome: BRAIN_CLIENT_OUTCOME.QUIET,
    until: NOW + BRAIN_RATE_LIMIT_COOLDOWN_MS,
  });
  const client = new OpenAiDigestClient({ apiKey: "sk", fetch, now: () => NOW });
  const failed = await client.summarize(INPUT);
  assert.equal(failed.outcome, BRAIN_CLIENT_OUTCOME.FAILED);
  assert.ok(failed.outcome === BRAIN_CLIENT_OUTCOME.FAILED && failed.reason.includes("500"));
  assert.ok(!JSON.stringify(failed).includes(TRANSCRIPT_SECRET));
});

test("an off-schema answer and a non-JSON answer both fail rather than repair", async () => {
  const { fetch } = fakeFetch([
    Response.json(digestPayload({ ...WRITTEN, stop_state: "done" })),
    new Response("not json", { status: 200 }),
  ]);
  const client = new OpenAiDigestClient({ apiKey: "sk", fetch, now: () => NOW });
  assert.equal((await client.summarize(INPUT)).outcome, BRAIN_CLIENT_OUTCOME.FAILED);
  assert.equal((await client.summarize(INPUT)).outcome, BRAIN_CLIENT_OUTCOME.FAILED);
});

test("the factory builds nothing without a key and honors the model option", () => {
  assert.equal(openAiDigestClient(undefined), undefined);
  assert.equal(openAiDigestClient("   "), undefined);
  assert.equal(openAiDigestClient("sk", { model: "gpt-other" })?.model, "gpt-other");
  assert.equal(openAiDigestClient("sk")?.model, "gpt-5.6-luna");
});
