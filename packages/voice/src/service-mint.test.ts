import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_CALLS_URL, HOSTED_WS_BASE_URL } from "@sidecar/hosted";
import { REALTIME_MINT_OUTCOME, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import {
  type HostedRealtimeCredentialOptions,
  hostedRealtimeCredentialMinter,
  type IntroductionRealtimeCredentialOptions,
  introductionRealtimeCredentialMinter,
} from "./service-mint.js";

const NOW = 1_800_000_000_000;
const MODEL = "gpt-realtime-2.1";
const WS_URL = `${HOSTED_WS_BASE_URL}?model=${MODEL}`;
const SERVICE = "https://tryluke.dev";
const QUOTA = { used: 3, limit: 50, resetsAt: NOW + 3_600_000 };
const CONNECTION = {
  value: "eph-secret",
  expiresAt: NOW + 60_000,
  model: MODEL,
  callsUrl: HOSTED_CALLS_URL,
  wsUrl: WS_URL,
};

function mintedBody(overrides: ParsedJsonObject = {}) {
  return { connection: { ...CONNECTION, ...overrides }, quota: QUOTA };
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

function minted(body: ParsedJsonObject) {
  return () => new Response(JSON.stringify(body), { status: 200 });
}

function refused(status: number, body: ParsedJsonObject) {
  return () => new Response(JSON.stringify(body), { status });
}

function hosted(options: Partial<HostedRealtimeCredentialOptions>) {
  return hostedRealtimeCredentialMinter({
    serviceBaseUrl: SERVICE,
    readAccessToken: async () => "token-1",
    refreshAccount: async () => undefined,
    now: () => NOW,
    ...options,
  });
}

function introduction(options: Partial<IntroductionRealtimeCredentialOptions>) {
  return introductionRealtimeCredentialMinter({
    serviceBaseUrl: SERVICE,
    now: () => NOW,
    ...options,
  });
}

test("mints through the hosted service on the account's bearer token", async () => {
  const { requests, fetchLike } = service([minted(mintedBody())]);
  const minter = hosted({
    fetch: fetchLike,
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });

  assert.deepEqual(await minter.mint(), CONNECTION);

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/voice/mint");
  assert.equal(new Headers(request?.init.headers).get("authorization"), "Bearer token-1");
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });

  const report = minter.diagnostics();
  assert.equal(report.hosted, true);
  assert.equal(report.apiKeyConfigured, false);
  assert.equal(report.lastOutcome, REALTIME_MINT_OUTCOME.SUCCEEDED);
  assert.deepEqual(report.quota, QUOTA);
});

test("mints through the introduction endpoint with no authorization at all", async () => {
  const { requests, fetchLike } = service([minted({ connection: CONNECTION })]);
  const minter = introduction({
    fetch: fetchLike,
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });

  assert.deepEqual(await minter.mint(), CONNECTION);

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/voice/introduction-mint");
  assert.equal(new Headers(request?.init.headers).get("authorization"), null);
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });
  assert.equal(minter.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.SUCCEEDED);
});

test("mints a fresh secret for every call and follows a voice change on the next", async () => {
  const { requests, fetchLike } = service([minted(mintedBody())]);
  const minter = hosted({ fetch: fetchLike });

  // Never reused: the service refuses a reused secret at the calls endpoint,
  // so each call is answered by its own mint — which is also what the hosted
  // allowance counts.
  await minter.mint();
  await minter.mint();
  assert.equal(requests.length, 2);

  minter.setVoice(REALTIME_VOICE.SAGE);
  await minter.mint();
  assert.equal(requests.length, 3);
  assert.equal(JSON.parse(String(requests[2]?.init.body)).voice, REALTIME_VOICE.SAGE);
});

test("the introduction mints a fresh secret for every call too", async () => {
  const { requests, fetchLike } = service([minted({ connection: CONNECTION })]);
  const minter = introduction({ fetch: fetchLike });

  await minter.mint();
  await minter.mint();
  assert.equal(requests.length, 2);
});

test("no access token asks the service nothing and says why voice is off", async () => {
  const { requests, fetchLike } = service([]);
  const minter = hosted({ fetch: fetchLike, readAccessToken: async () => undefined });

  assert.equal(await minter.mint(), undefined);
  assert.equal(requests.length, 0);
  assert.equal(minter.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.NOT_SIGNED_IN);
});

test("a 401 refreshes the account and retries once with the new token", async () => {
  const tokens = ["stale-token", "fresh-token"];
  let refreshes = 0;
  const { requests, fetchLike } = service([
    refused(401, { error: "invalid-token" }),
    minted(mintedBody()),
  ]);
  const minter = hosted({
    fetch: fetchLike,
    readAccessToken: async () => tokens[Math.min(refreshes, tokens.length - 1)],
    refreshAccount: async () => {
      refreshes += 1;
    },
  });

  assert.ok(await minter.mint());
  assert.equal(refreshes, 1);
  assert.equal(requests.length, 2);
  assert.equal(new Headers(requests[1]?.init.headers).get("authorization"), "Bearer fresh-token");
});

test("a refresh that changes nothing is not retried and reads as signed out", async () => {
  let refreshes = 0;
  const { requests, fetchLike } = service([refused(401, { error: "invalid-token" })]);
  const minter = hosted({
    fetch: fetchLike,
    refreshAccount: async () => {
      refreshes += 1;
    },
  });

  assert.equal(await minter.mint(), undefined);
  assert.equal(refreshes, 1);
  assert.equal(requests.length, 1);
  assert.equal(minter.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.NOT_SIGNED_IN);
});

test("a 401 on the endpoint that sent no identity is a plain failure", async () => {
  const minter = introduction({
    fetch: service([refused(401, { error: "unauthorized" })]).fetchLike,
  });

  assert.equal(await minter.mint(), undefined);
  assert.equal(minter.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.HTTP_ERROR);
});

test("a spent allowance is diagnosed with the quota the refusal carried", async () => {
  const spent = { used: 51, limit: 50, resetsAt: NOW + 3_600_000 };
  const minter = hosted({
    fetch: service([refused(429, { error: "quota-exhausted", quota: spent })]).fetchLike,
  });

  assert.equal(await minter.mint(), undefined);
  const report = minter.diagnostics();
  assert.equal(report.lastOutcome, REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
  assert.deepEqual(report.quota, spent);
});

// The introduction's cap is a spent allowance too — today's free calls for
// this endpoint are gone and return at midnight UTC — and it carries no quota
// to draw, where the http-error fallback would read as a fault worth chasing.
test("a spent introduction cap reads as an exhausted quota it cannot draw", async () => {
  const minter = introduction({
    fetch: service([refused(429, { error: "quota-exhausted" })]).fetchLike,
  });

  assert.equal(await minter.mint(), undefined);
  const report = minter.diagnostics();
  assert.equal(report.lastOutcome, REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
  assert.equal(report.quota, undefined);
});

test("a switched-off service and a plain failure are told apart", async () => {
  const unavailable = hosted({
    fetch: service([refused(503, { error: "unavailable" })]).fetchLike,
  });
  assert.equal(await unavailable.mint(), undefined);
  assert.equal(unavailable.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.HOSTED_UNAVAILABLE);

  const failing = hosted({
    fetch: service([() => new Response("oops", { status: 500 })]).fetchLike,
  });
  assert.equal(await failing.mint(), undefined);
  assert.equal(failing.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.HTTP_ERROR);
});

test("a credential aimed anywhere but OpenAI's calls endpoint is refused", async () => {
  const minter = hosted({
    fetch: service([minted(mintedBody({ callsUrl: "https://evil.example/v1/realtime/calls" }))])
      .fetchLike,
  });

  assert.equal(await minter.mint(), undefined);
  assert.equal(minter.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE);
});

test("a network fault resolves to nothing and says so", async () => {
  const minter = introduction({
    fetch: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(await minter.mint(), undefined);
  assert.equal(minter.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.NETWORK_ERROR);
});
