import assert from "node:assert/strict";
import test from "node:test";
import {
  HOSTED_CALLS_URL,
  REALTIME_MINT_OUTCOME,
  REALTIME_VOICE,
  REALTIME_VOICE_SPEED,
} from "@sidecar/core";
import { HostedRealtimeCredentialMinter } from "../src/hosted-realtime-credentials";
import type { ParsedJsonObject } from "./support/json";

const NOW = 1_800_000_000_000;
const SERVICE = "https://tryluke.dev";
const QUOTA = { used: 3, limit: 50, remaining: 47, resetsAt: NOW + 3_600_000 };

function mintedBody(overrides: ParsedJsonObject = {}) {
  return {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
      ...overrides,
    },
    quota: QUOTA,
  };
}

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

function service(answers: Array<() => Response>) {
  const requests: RecordedRequest[] = [];
  let call = 0;
  const fetchLike = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push({ url, init });
    const answer = answers[Math.min(call, answers.length - 1)];
    call += 1;
    if (!answer) throw new Error("no scripted answer");
    return answer();
  };
  return { requests, fetchLike };
}

function minter(options: Partial<ConstructorParameters<typeof HostedRealtimeCredentialMinter>[0]>) {
  return new HostedRealtimeCredentialMinter({
    serviceBaseUrl: SERVICE,
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    now: () => NOW,
    ...options,
  });
}

test("mints through the hosted service on the account's bearer token", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(mintedBody()), { status: 200 }),
  ]);
  const hosted = minter({
    fetch: fetchLike,
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });

  const connection = await hosted.mint();
  assert.deepEqual(connection, {
    value: "eph-secret",
    expiresAt: NOW + 60_000,
    model: "gpt-realtime-2.1",
    callsUrl: HOSTED_CALLS_URL,
  });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/voice/mint");
  assert.equal(new Headers(request?.init.headers).get("authorization"), "Bearer token-1");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });

  const report = hosted.diagnostics();
  assert.equal(report.hosted, true);
  assert.equal(report.apiKeyConfigured, false);
  assert.equal(report.lastOutcome, REALTIME_MINT_OUTCOME.SUCCEEDED);
  assert.deepEqual(report.quota, QUOTA);
});

test("mints a fresh secret for every call and follows a voice change on the next", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(mintedBody()), { status: 200 }),
  ]);
  const hosted = minter({ fetch: fetchLike });

  // Never reused: the service refuses a reused secret at the calls endpoint,
  // so each call is answered by its own mint — which is also what the hosted
  // allowance counts.
  await hosted.mint();
  await hosted.mint();
  assert.equal(requests.length, 2);

  hosted.setVoice(REALTIME_VOICE.SAGE);
  await hosted.mint();
  assert.equal(requests.length, 3);
  assert.equal(JSON.parse(String(requests[2]?.init.body)).voice, REALTIME_VOICE.SAGE);
});

test("no access token asks the service nothing and says why voice is off", async () => {
  const { requests, fetchLike } = service([]);
  const hosted = minter({ fetch: fetchLike, readAccessToken: async () => undefined });

  assert.equal(await hosted.mint(), undefined);
  assert.equal(requests.length, 0);
  assert.equal(hosted.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.NOT_SIGNED_IN);
});

test("a 401 refreshes the account and retries once with the new token", async () => {
  const tokens = ["stale-token", "fresh-token"];
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
    () => new Response(JSON.stringify(mintedBody()), { status: 200 }),
  ]);
  const hosted = minter({
    fetch: fetchLike,
    readAccessToken: async () => tokens[Math.min(refreshes, tokens.length - 1)],
    refreshAccount: async () => {
      refreshes += 1;
    },
  });

  const connection = await hosted.mint();
  assert.ok(connection);
  assert.equal(refreshes, 1);
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer fresh-token");
});

// SAFETY: Fixture value matches the narrowed runtime shape this test exercises.
test("a refresh that changes nothing is not retried and reads as signed out", async () => {
  let refreshes = 0;
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify({ error: "invalid-token" }), { status: 401 }),
  ]);
  const hosted = minter({
    fetch: fetchLike,
    refreshAccount: async () => {
      refreshes += 1;
    },
  });

  assert.equal(await hosted.mint(), undefined);
  assert.equal(refreshes, 1);
  assert.equal(requests.length, 1);
  assert.equal(hosted.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.NOT_SIGNED_IN);
});

test("a spent allowance is diagnosed with the quota the refusal carried", async () => {
  const spent = { used: 51, limit: 50, remaining: 0, resetsAt: NOW + 3_600_000 };
  const { fetchLike } = service([
    () => new Response(JSON.stringify({ error: "quota-exhausted", quota: spent }), { status: 429 }),
  ]);
  const hosted = minter({ fetch: fetchLike });

  assert.equal(await hosted.mint(), undefined);
  const report = hosted.diagnostics();
  assert.equal(report.lastOutcome, REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
  assert.deepEqual(report.quota, spent);
});

test("a switched-off service and a plain failure are told apart", async () => {
  const unavailable = minter({
    fetch: service([() => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })])
      .fetchLike,
  });
  assert.equal(await unavailable.mint(), undefined);
  assert.equal(unavailable.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.HOSTED_UNAVAILABLE);

  const failing = minter({
    fetch: service([() => new Response("oops", { status: 500 })]).fetchLike,
  });
  assert.equal(await failing.mint(), undefined);
  assert.equal(failing.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.HTTP_ERROR);
});

test("a credential aimed anywhere but OpenAI's calls endpoint is refused", async () => {
  const { fetchLike } = service([
    () =>
      new Response(
        JSON.stringify(mintedBody({ callsUrl: "https://evil.example/v1/realtime/calls" })),
        { status: 200 },
      ),
  ]);
  const hosted = minter({ fetch: fetchLike });

  assert.equal(await hosted.mint(), undefined);
  assert.equal(hosted.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE);
});
