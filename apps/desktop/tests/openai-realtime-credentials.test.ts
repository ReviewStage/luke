import assert from "node:assert/strict";
import test from "node:test";
import {
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  REALTIME_VOICE,
  REALTIME_VOICE_SPEED,
  realtimeMintExplanation,
} from "@sidecar/core";
import {
  OpenAiRealtimeCredentialMinter,
  openAiRealtimeCredentials,
  unavailableRealtimeDiagnostics,
} from "../src/openai-realtime-credentials";
import { type RecordedRequest, recordingFetch } from "./support/http-fake";

const API_KEY = "sk-test-standing-key";
const NOW = 1_800_000_000_000;
const EXPIRES_AT_SECONDS = NOW / 1000 + 60;

function mintResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      value: "ek_test_secret",
      expires_at: EXPIRES_AT_SECONDS,
      session: { model: REALTIME_DEFAULTS.MODEL },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function minter(
  responses: readonly (Response | Error)[],
  options: { now?: () => number } = {},
): { minter: OpenAiRealtimeCredentialMinter; requests: RecordedRequest[] } {
  let index = 0;
  const { fetch, requests } = recordingFetch(() => {
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (next instanceof Error) throw next;
    if (!next) throw new Error("No response configured");
    return next;
  });
  const instance = new OpenAiRealtimeCredentialMinter({
    apiKey: API_KEY,
    now: options.now ?? (() => NOW),
    fetch,
  });
  return { minter: instance, requests };
}

test("minting posts the realtime session to the client-secrets endpoint", async () => {
  const { minter: instance, requests } = minter([mintResponse()]);

  const credential = await instance.mint();

  assert.equal(credential?.value, "ek_test_secret");
  assert.equal(credential?.expiresAt, EXPIRES_AT_SECONDS * 1000);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://api.openai.com/v1/realtime/client_secrets");
  assert.equal(requests[0]?.init.method, "POST");

  const body = JSON.parse(String(requests[0]?.init.body)) as {
    session: {
      model: string;
      audio: { input: { turn_detection: unknown }; output: { voice: string; speed: number } };
    };
  };
  assert.equal(body.session.model, REALTIME_DEFAULTS.MODEL);
  assert.equal(body.session.audio.output.voice, REALTIME_DEFAULTS.VOICE);
  assert.equal(body.session.audio.output.speed, REALTIME_DEFAULTS.SPEED);
  assert.equal(body.session.audio.input.turn_detection, null);
});

test("the standing key authorizes the mint and never appears in the response", async () => {
  const { minter: instance, requests } = minter([mintResponse()]);

  const credential = await instance.mint();

  const headers = requests[0]?.init.headers as Record<string, string>;
  assert.equal(headers.authorization, `Bearer ${API_KEY}`);
  // The renderer only ever receives the ephemeral secret.
  assert.notEqual(credential?.value, API_KEY);
  assert.ok(!JSON.stringify(credential).includes(API_KEY));
});

test("every call is minted its own credential, never a reused one", async () => {
  const { minter: instance, requests } = minter([mintResponse(), mintResponse()]);

  // The service has been seen to refuse a reused secret at the calls endpoint
  // (status 401) even inside its stated expiry, so a secret answers only the
  // call it was minted for.
  assert.equal((await instance.mint())?.value, "ek_test_secret");
  assert.equal((await instance.mint())?.value, "ek_test_secret");
  assert.equal(requests.length, 2);
});

test("changing the voice mints the next credential for the new one", async () => {
  const { minter: instance, requests } = minter([mintResponse(), mintResponse()]);
  await instance.mint();

  instance.setVoice(REALTIME_VOICE.MARIN);
  await instance.mint();

  assert.equal(requests.length, 2);
  const body = JSON.parse(String(requests[1]?.init.body)) as {
    session: { audio: { output: { voice: string } } };
  };
  assert.equal(body.session.audio.output.voice, REALTIME_VOICE.MARIN);
  assert.equal(instance.diagnostics().voice, REALTIME_VOICE.MARIN);
});

test("clearing the voice returns to the one the minter was built with", () => {
  const { minter: instance } = minter([mintResponse()]);

  instance.setVoice(REALTIME_VOICE.MARIN);
  instance.setVoice(undefined);

  assert.equal(instance.diagnostics().voice, REALTIME_DEFAULTS.VOICE);
});

test("changing the pace mints the next credential for the new one", async () => {
  const { minter: instance, requests } = minter([mintResponse(), mintResponse()]);
  await instance.mint();

  instance.setSpeed(REALTIME_VOICE_SPEED.FAST);
  await instance.mint();

  assert.equal(requests.length, 2);
  const body = JSON.parse(String(requests[1]?.init.body)) as {
    session: { audio: { output: { speed: number } } };
  };
  assert.equal(body.session.audio.output.speed, REALTIME_VOICE_SPEED.FAST);
  assert.equal(instance.diagnostics().speed, REALTIME_VOICE_SPEED.FAST);
});

test("clearing the pace returns to the one the minter was built with", () => {
  const { minter: instance } = minter([mintResponse()]);

  instance.setSpeed(REALTIME_VOICE_SPEED.FAST);
  instance.setSpeed(undefined);

  assert.equal(instance.diagnostics().speed, REALTIME_DEFAULTS.SPEED);
});

test("every failure path leaves the voice experience unavailable", async () => {
  for (const response of [
    new Response("", { status: 401 }),
    new Response("", { status: 429 }),
    new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
    mintResponse({ value: "" }),
    mintResponse({ expires_at: "soon" }),
    // Already expired the moment it arrives.
    mintResponse({ expires_at: NOW / 1000 - 1 }),
    new Error("network unreachable"),
  ]) {
    const { minter: instance } = minter([response]);
    assert.equal(await instance.mint(), undefined);
  }
});

test("a failed mint is not cached as a usable credential", async () => {
  const { minter: instance, requests } = minter([
    new Response("", { status: 500 }),
    mintResponse(),
  ]);

  assert.equal(await instance.mint(), undefined);
  assert.equal((await instance.mint())?.value, "ek_test_secret");
  assert.equal(requests.length, 2);
});

test("no API key means no minter, so Luke runs without credentials", () => {
  // The key is the caller's to resolve — the settings store reads the stored one
  // and falls back to `OPENAI_API_KEY` — so voice stays off until one arrives,
  // and a key arriving later builds a minter then rather than at the next launch.
  assert.equal(openAiRealtimeCredentials(undefined), undefined);
  assert.equal(openAiRealtimeCredentials("   "), undefined);
  assert.ok(openAiRealtimeCredentials(API_KEY));
});

test("the model and voice come from the environment when set", () => {
  const previous = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.LUKE_REALTIME_MODEL,
    voice: process.env.LUKE_REALTIME_VOICE,
  };
  try {
    process.env.OPENAI_API_KEY = API_KEY;
    process.env.LUKE_REALTIME_MODEL = "gpt-realtime-preview";
    process.env.LUKE_REALTIME_VOICE = REALTIME_VOICE.MARIN;

    assert.equal(openAiRealtimeCredentials(API_KEY)?.model, "gpt-realtime-preview");
    assert.equal(openAiRealtimeCredentials(API_KEY)?.diagnostics().voice, REALTIME_VOICE.MARIN);
  } finally {
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["LUKE_REALTIME_MODEL", previous.model],
      ["LUKE_REALTIME_VOICE", previous.voice],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("the pace comes from the environment when set, and an unoffered one is refused", () => {
  const previous = { key: process.env.OPENAI_API_KEY, speed: process.env.LUKE_REALTIME_SPEED };
  try {
    process.env.OPENAI_API_KEY = API_KEY;
    process.env.LUKE_REALTIME_SPEED = String(REALTIME_VOICE_SPEED.QUICK);
    assert.equal(
      openAiRealtimeCredentials(API_KEY)?.diagnostics().speed,
      REALTIME_VOICE_SPEED.QUICK,
    );

    // The settings snapshot already refuses it, so honouring it here would
    // have the panel mark the default while minting at something else.
    process.env.LUKE_REALTIME_SPEED = "3";
    assert.equal(openAiRealtimeCredentials(API_KEY)?.diagnostics().speed, REALTIME_DEFAULTS.SPEED);
    assert.equal(
      unavailableRealtimeDiagnostics({ fixtureMode: true, apiKeyConfigured: true }).speed,
      REALTIME_DEFAULTS.SPEED,
    );
  } finally {
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["LUKE_REALTIME_SPEED", previous.speed],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("a voice from the environment that Luke does not offer is not minted", () => {
  // The settings snapshot already refuses it, so honouring it here would have
  // the panel mark the default while every session was minted for a name the
  // API refuses.
  const previous = { key: process.env.OPENAI_API_KEY, voice: process.env.LUKE_REALTIME_VOICE };
  try {
    process.env.OPENAI_API_KEY = API_KEY;
    process.env.LUKE_REALTIME_VOICE = "baritone";

    assert.equal(openAiRealtimeCredentials(API_KEY)?.diagnostics().voice, REALTIME_DEFAULTS.VOICE);
    assert.equal(
      unavailableRealtimeDiagnostics({ fixtureMode: true, apiKeyConfigured: true }).voice,
      REALTIME_DEFAULTS.VOICE,
    );
  } finally {
    for (const [name, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["LUKE_REALTIME_VOICE", previous.voice],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("diagnostics name why a mint failed without carrying the key", async () => {
  const { minter: instance } = minter([new Response("", { status: 401 })]);

  assert.equal(instance.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.NOT_ATTEMPTED);
  await instance.mint();

  const report = instance.diagnostics();
  assert.equal(report.lastOutcome, REALTIME_MINT_OUTCOME.HTTP_ERROR);
  assert.equal(report.lastDetail, "status 401");
  assert.equal(report.apiKeyConfigured, true);
  // The whole point is that this is safe to render on screen.
  assert.ok(!JSON.stringify(report).includes(API_KEY));
});

test("each mint failure reports its own distinguishable outcome", async () => {
  const cases = [
    [new Response("", { status: 429 }), REALTIME_MINT_OUTCOME.HTTP_ERROR],
    [
      new Response("not json", { status: 200, headers: { "content-type": "application/json" } }),
      REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE,
    ],
    [mintResponse({ value: "" }), REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE],
    [mintResponse({ expires_at: NOW / 1000 - 1 }), REALTIME_MINT_OUTCOME.EXPIRED_CREDENTIAL],
    [new Error("network unreachable"), REALTIME_MINT_OUTCOME.NETWORK_ERROR],
  ] as const;

  for (const [response, expected] of cases) {
    const { minter: instance } = minter([response]);
    await instance.mint();
    assert.equal(instance.diagnostics().lastOutcome, expected);
  }
});

test("a successful mint reports success", async () => {
  const { minter: instance } = minter([mintResponse()]);

  await instance.mint();

  assert.equal(instance.diagnostics().lastOutcome, REALTIME_MINT_OUTCOME.SUCCEEDED);
});

test("a missing key and a fixture run are told apart", () => {
  const withoutKey = unavailableRealtimeDiagnostics({
    fixtureMode: false,
    apiKeyConfigured: false,
  });
  assert.equal(withoutKey.lastOutcome, REALTIME_MINT_OUTCOME.NO_API_KEY);
  assert.equal(withoutKey.apiKeyConfigured, false);
  // The one thing someone in this state has to be told is where a key goes now
  // that the app takes one.
  assert.match(realtimeMintExplanation(withoutKey.lastOutcome), /Settings/);

  // A fixture run has credentials available and still refuses to use them, which
  // is the case most easily mistaken for a broken key.
  const fixture = unavailableRealtimeDiagnostics({ fixtureMode: true, apiKeyConfigured: true });
  assert.equal(fixture.lastOutcome, REALTIME_MINT_OUTCOME.DISABLED_BY_FIXTURE);
  assert.equal(fixture.apiKeyConfigured, true);
  assert.ok(!JSON.stringify(fixture).includes(API_KEY));
});

test("an empty API key is rejected outright", () => {
  assert.throws(() => new OpenAiRealtimeCredentialMinter({ apiKey: "   " }));
});
