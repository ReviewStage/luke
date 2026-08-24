import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_DEFAULTS, REALTIME_VOICE, REALTIME_VOICE_SPEED } from "@sidecar/realtime";
import { HOSTED_API_ERROR } from "../server/hosted/http";
import {
  handleIntroductionMint,
  INTRODUCTION_SECRET_EXPIRY,
  introductionCallerKey,
} from "../server/hosted/introduction-mint";
import type { IntroductionSpend } from "../server/hosted/quota";

const NOW = Date.parse("2026-08-17T12:00:00.000Z");
const API_KEY = "sk-hosted-secret";
const CALLER_IP = "203.0.113.7";

const OPEN: IntroductionSpend = { allowed: true };
const SPENT: IntroductionSpend = { allowed: false };

/** The shape a caller may send, plus the one stray field a bounds test rejects. */
interface MintRequestBody {
  voice?: string;
  speed?: number;
  task?: string;
}

function mintRequest(body?: MintRequestBody, headers: Record<string, string> = {}): Request {
  const init: RequestInit = {
    method: "POST",
    headers: { "x-forwarded-for": CALLER_IP, ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request("https://luke.test/api/voice/introduction-mint", init);
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

function options(overrides: Partial<Parameters<typeof handleIntroductionMint>[0]> = {}) {
  return {
    request: mintRequest(),
    apiKey: API_KEY,
    spend: async () => OPEN,
    now: () => NOW,
    ...overrides,
  };
}

test("a mint hands back a short-capped credential aimed at OpenAI's own calls endpoint", async () => {
  const call: UpstreamCall = {};
  const response = await handleIntroductionMint(
    options({
      request: mintRequest({ voice: REALTIME_VOICE.MARIN, speed: REALTIME_VOICE_SPEED.QUICK }),
      fetch: upstream(call, mintedPayload),
    }),
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, {
    connection: {
      value: "eph-secret",
      expiresAt: NOW + 60_000,
      model: REALTIME_DEFAULTS.MODEL,
      callsUrl: "https://api.openai.com/v1/realtime/calls",
    },
  });

  assert.equal(call.url, "https://api.openai.com/v1/realtime/client_secrets");
  const sent = JSON.parse(String(call.init?.body));
  assert.deepEqual(sent.expires_after, {
    anchor: INTRODUCTION_SECRET_EXPIRY.ANCHOR,
    seconds: INTRODUCTION_SECRET_EXPIRY.SECONDS,
  });
  assert.equal(sent.session.model, REALTIME_DEFAULTS.MODEL);
  assert.equal(sent.session.audio.output.voice, REALTIME_VOICE.MARIN);
  assert.equal(sent.session.audio.output.speed, REALTIME_VOICE_SPEED.QUICK);
  assert.equal(sent.session.audio.input.turn_detection, null);
});

test("an empty body mints the build's own defaults", async () => {
  const call: UpstreamCall = {};
  const response = await handleIntroductionMint(options({ fetch: upstream(call, mintedPayload) }));

  assert.equal(response.status, 200);
  const sent = JSON.parse(String(call.init?.body));
  assert.equal(sent.session.audio.output.voice, REALTIME_DEFAULTS.VOICE);
  assert.equal(sent.session.audio.output.speed, REALTIME_DEFAULTS.SPEED);
});

test("a field beyond voice and speed is refused before anything is spent", async () => {
  let spent = 0;
  const spend = async () => {
    spent += 1;
    return OPEN;
  };

  const unknownField = await handleIntroductionMint(
    options({ request: mintRequest({ voice: REALTIME_VOICE.MARIN, task: "say hi" }), spend }),
  );
  const badVoice = await handleIntroductionMint(
    options({ request: mintRequest({ voice: "not-a-voice" }), spend }),
  );
  const badSpeed = await handleIntroductionMint(
    options({ request: mintRequest({ speed: 9 }), spend }),
  );

  assert.equal(unknownField.status, 400);
  assert.equal((await unknownField.json()).error, HOSTED_API_ERROR.INVALID_REQUEST);
  assert.equal(badVoice.status, 400);
  assert.equal(badSpeed.status, 400);
  assert.equal(spent, 0);
});

test("the gate order is method, kill switch, body, meter", async () => {
  const wrongMethod = await handleIntroductionMint(
    options({
      request: new Request("https://luke.test/api/voice/introduction-mint", { method: "GET" }),
    }),
  );
  assert.equal(wrongMethod.status, 405);

  const keyless = await handleIntroductionMint(options({ apiKey: undefined }));
  assert.equal(keyless.status, 503);
  assert.equal((await keyless.json()).error, HOSTED_API_ERROR.UNAVAILABLE);

  const blankKey = await handleIntroductionMint(options({ apiKey: "   " }));
  assert.equal(blankKey.status, 503);

  const exhausted = await handleIntroductionMint(options({ spend: async () => SPENT }));
  assert.equal(exhausted.status, 429);
  const body = await exhausted.json();
  assert.equal(body.error, HOSTED_API_ERROR.QUOTA_EXHAUSTED);
  assert.equal(body.quota, undefined);
});

test("the meter is keyed by a hash of the caller's address, never the address itself", async () => {
  const keys: string[] = [];
  const spend = async (callerKey: string) => {
    keys.push(callerKey);
    return OPEN;
  };
  await handleIntroductionMint(options({ spend, fetch: upstream({}, mintedPayload) }));

  assert.equal(keys.length, 1);
  assert.notEqual(keys[0], CALLER_IP);
  assert.doesNotMatch(String(keys[0]), /203\.0\.113\.7/);
  assert.match(String(keys[0]), /^[0-9a-f]{64}$/);
});

test("the caller key reads the proxy's first forwarded address, and shares one bucket without any", () => {
  const forwarded = introductionCallerKey(
    new Request("https://luke.test/api/voice/introduction-mint", {
      method: "POST",
      headers: { "x-forwarded-for": `${CALLER_IP}, 10.0.0.1` },
    }),
  );
  const direct = introductionCallerKey(mintRequest());
  assert.equal(forwarded, direct);

  const realIp = introductionCallerKey(
    new Request("https://luke.test/api/voice/introduction-mint", {
      method: "POST",
      headers: { "x-real-ip": CALLER_IP },
    }),
  );
  assert.equal(realIp, direct);

  const anonymous = introductionCallerKey(
    new Request("https://luke.test/api/voice/introduction-mint", { method: "POST" }),
  );
  assert.notEqual(anonymous, direct);
  const anonymousAgain = introductionCallerKey(
    new Request("https://luke.test/api/voice/introduction-mint", { method: "POST" }),
  );
  assert.equal(anonymous, anonymousAgain);
});

test("an upstream refusal answers with its status and never the key", async () => {
  const call: UpstreamCall = {};
  const response = await handleIntroductionMint(
    options({ fetch: upstream(call, () => new Response("denied", { status: 401 })) }),
  );

  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(JSON.parse(text).error, HOSTED_API_ERROR.UPSTREAM_ERROR);
  assert.equal(JSON.parse(text).upstreamStatus, 401);
  assert.doesNotMatch(text, /sk-hosted-secret/);
});

test("a credential that is malformed or already dead is refused rather than served", async () => {
  const malformed = await handleIntroductionMint(
    options({
      fetch: upstream({}, () => new Response(JSON.stringify({ odd: true }), { status: 200 })),
    }),
  );
  assert.equal(malformed.status, 502);

  const expired = await handleIntroductionMint(
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
