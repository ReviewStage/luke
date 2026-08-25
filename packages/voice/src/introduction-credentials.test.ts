import assert from "node:assert/strict";
import test from "node:test";
import { HOSTED_CALLS_URL } from "@sidecar/hosted";
import { REALTIME_MINT_OUTCOME, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import type { ParsedJsonObject } from "@sidecar/wire/testing";
import { IntroductionRealtimeCredentialMinter } from "./introduction-credentials.js";

const NOW = 1_800_000_000_000;
const SERVICE = "https://tryluke.dev";

function mintedBody(overrides: ParsedJsonObject = {}) {
  return {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: "gpt-realtime-2.1",
      callsUrl: HOSTED_CALLS_URL,
      ...overrides,
    },
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

function minter(
  options: Partial<ConstructorParameters<typeof IntroductionRealtimeCredentialMinter>[0]>,
) {
  return new IntroductionRealtimeCredentialMinter({
    serviceBaseUrl: SERVICE,
    now: () => NOW,
    ...options,
  });
}

test("mints through the introduction endpoint with no authorization at all", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(mintedBody()), { status: 200 }),
  ]);
  const introduction = minter({
    fetch: fetchLike,
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });

  const connection = await introduction.mint();
  assert.deepEqual(connection, {
    value: "eph-secret",
    expiresAt: NOW + 60_000,
    model: "gpt-realtime-2.1",
    callsUrl: HOSTED_CALLS_URL,
  });

  const [request] = requests;
  assert.equal(request?.url, "https://tryluke.dev/api/voice/introduction-mint");
  assert.equal(new Headers(request?.init.headers).get("authorization"), null);
  assert.deepEqual(JSON.parse(String(request?.init.body)), {
    voice: REALTIME_VOICE.MARIN,
    speed: REALTIME_VOICE_SPEED.QUICK,
  });

  const report = introduction.diagnostics();
  assert.equal(report.hosted, true);
  assert.equal(report.apiKeyConfigured, false);
  assert.equal(report.lastOutcome, REALTIME_MINT_OUTCOME.SUCCEEDED);
});

test("mints a fresh secret for every call", async () => {
  const { requests, fetchLike } = service([
    () => new Response(JSON.stringify(mintedBody()), { status: 200 }),
  ]);
  const introduction = minter({ fetch: fetchLike });

  await introduction.mint();
  await introduction.mint();
  assert.equal(requests.length, 2);
});

test("a spent introduction cap reads as an exhausted quota", async () => {
  const { fetchLike } = service([
    () => new Response(JSON.stringify({ error: "quota-exhausted" }), { status: 429 }),
  ]);
  const introduction = minter({ fetch: fetchLike });

  assert.equal(await introduction.mint(), undefined);
  assert.equal(introduction.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
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
  const introduction = minter({ fetch: fetchLike });

  assert.equal(await introduction.mint(), undefined);
  assert.equal(introduction.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE);
});

test("a network fault resolves to nothing and says so", async () => {
  const introduction = minter({
    fetch: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(await introduction.mint(), undefined);
  assert.equal(introduction.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.NETWORK_ERROR);
});
