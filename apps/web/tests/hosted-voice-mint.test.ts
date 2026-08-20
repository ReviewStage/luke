import assert from "node:assert/strict";
import test from "node:test";
import type { RealtimeVoice, RealtimeVoiceSpeed } from "@sidecar/realtime";
import { REALTIME_DEFAULTS, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import type { HostedSpend } from "../server/hosted/quota";
import { handleVoiceMint } from "../server/hosted/voice-mint";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";

const OPEN_SPEND: HostedSpend = {
  allowed: true,
  quota: { used: 1, limit: 50, remaining: 49, resetsAt: NOW + 43_200_000 },
};

const SPENT: HostedSpend = {
  allowed: false,
  quota: { used: 51, limit: 50, remaining: 0, resetsAt: NOW + 43_200_000 },
};

interface VoiceMintRequestBody {
  voice?: RealtimeVoice | string;
  speed?: RealtimeVoiceSpeed | number;
}

function mintRequest(body?: VoiceMintRequestBody, headers: Record<string, string> = {}): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { authorization: "Bearer token-1", ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://luke.test/api/voice/mint", init);
}

interface UpstreamCall {
  url?: string;
  init?: RequestInit;
}

function upstream(call: UpstreamCall, response: () => Response) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    call.url = url;
    call.init = init;
    return response();
  };
}

function mintedPayload() {
  return new Response(JSON.stringify({ value: "eph-secret", expires_at: (NOW + 60_000) / 1000 }), {
    status: 200,
  });
}

function options(overrides: Partial<Parameters<typeof handleVoiceMint>[0]> = {}) {
  return {
    request: mintRequest(),
    apiKey: API_KEY,
    resolveUserId: async () => "user-1",
    spend: async () => OPEN_SPEND,
    now: () => NOW,
    ...overrides,
  };
}

test("a mint hands back an ephemeral credential aimed at OpenAI's own calls endpoint", async () => {
  const call: UpstreamCall = {};
  const response = await handleVoiceMint(
    options({
      request: mintRequest({ voice: REALTIME_VOICE.MARIN, speed: REALTIME_VOICE_SPEED.QUICK }),
      fetch: upstream(call, mintedPayload),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.connection, {
    value: "eph-secret",
    expiresAt: NOW + 60_000,
    model: REALTIME_DEFAULTS.MODEL,
    callsUrl: "https://api.openai.com/v1/realtime/calls",
  });
  assert.deepEqual(body.quota, OPEN_SPEND.quota);

  assert.equal(call.url, "https://api.openai.com/v1/realtime/client_secrets");
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.session.model, REALTIME_DEFAULTS.MODEL);
  assert.equal(sent.session.audio.output.voice, REALTIME_VOICE.MARIN);
  assert.equal(sent.session.audio.output.speed, REALTIME_VOICE_SPEED.QUICK);
  assert.equal(sent.session.audio.input.turn_detection, null);
});

test("an empty body mints the build's own defaults", async () => {
  const call: UpstreamCall = {};
  const response = await handleVoiceMint(options({ fetch: upstream(call, mintedPayload) }));

  assert.equal(response.status, 200);
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.session.audio.output.voice, REALTIME_DEFAULTS.VOICE);
  assert.equal(sent.session.audio.output.speed, REALTIME_DEFAULTS.SPEED);
});

test("a configured model labels the credential even when the payload omits its own", async () => {
  const call: UpstreamCall = {};
  const response = await handleVoiceMint(
    options({ model: "gpt-realtime-next", fetch: upstream(call, mintedPayload) }),
  );

  assert.equal(response.status, 200);
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.session.model, "gpt-realtime-next");
  assert.equal((await response.json()).connection.model, "gpt-realtime-next");
});

test("a blank model override is no override at all", async () => {
  const call: UpstreamCall = {};
  const response = await handleVoiceMint(
    options({ model: "   ", fetch: upstream(call, mintedPayload) }),
  );

  assert.equal(response.status, 200);
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.session.model, REALTIME_DEFAULTS.MODEL);
});

test("a voice or pace outside the build's sets is refused before anything is spent", async () => {
  let spent = 0;
  const spend = async () => {
    spent += 1;
    return OPEN_SPEND;
  };
  const badVoice = await handleVoiceMint(
    options({ request: mintRequest({ voice: "not-a-voice" }), spend }),
  );
  const badSpeed = await handleVoiceMint(options({ request: mintRequest({ speed: 9 }), spend }));

  assert.equal(badVoice.status, 400);
  assert.equal((await badVoice.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal(badSpeed.status, 400);
  assert.equal(spent, 0);
});

test("the gate order is method, kill switch, token, body, quota", async () => {
  const wrongMethod = await handleVoiceMint(
    options({ request: new Request("https://luke.test/api/voice/mint", { method: "GET" }) }),
  );
  assert.equal(wrongMethod.status, 405);

  const keyless = await handleVoiceMint(options({ apiKey: undefined }));
  assert.equal(keyless.status, 503);
  assert.equal((await keyless.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankKey = await handleVoiceMint(options({ apiKey: "   " }));
  assert.equal(blankKey.status, 503);
  assert.equal((await blankKey.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const anonymous = await handleVoiceMint(options({ resolveUserId: async () => undefined }));
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, HOSTED_API_ERROR.INVALID_TOKEN);

  const exhausted = await handleVoiceMint(options({ spend: async () => SPENT }));
  assert.equal(exhausted.status, 429);
  const body = await exhausted.json();
  assert.equal(body.error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  assert.deepEqual(body.quota, SPENT.quota);
});

test("an upstream refusal answers with its status and never the key", async () => {
  const call: UpstreamCall = {};
  const response = await handleVoiceMint(
    options({ fetch: upstream(call, () => new Response("denied", { status: 401 })) }),
  );

  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, HOSTED_API_ERROR.UPSTREAM_ERROR);
  assert.equal(JSON.parse(text).upstreamStatus, 401);
  assert.doesNotMatch(text, /sk-hosted-secret/);
});

test("a credential that is malformed or already dead is refused rather than served", async () => {
  const malformed = await handleVoiceMint(
    options({
      fetch: upstream({}, () => new Response(JSON.stringify({ odd: true }), { status: 200 })),
    }),
  );
  assert.equal(malformed.status, 502);

  const expired = await handleVoiceMint(
    options({
      fetch: upstream(
        {},
        () =>
          new Response(JSON.stringify({ value: "eph-secret", expires_at: (NOW - 1_000) / 1000 }), {
            status: 200,
          }),
      ),
    }),
  );
  assert.equal(expired.status, 502);
});
