import assert from "node:assert/strict";
import test from "node:test";
import { REALTIME_DEFAULTS, REALTIME_MINT_OUTCOME } from "@sidecar/core";
import {
  OpenAiRealtimeCredentialMinter,
  openAiRealtimeCredentialsFromEnvironment,
  unavailableRealtimeDiagnostics,
} from "../src/openai-realtime-credentials";

const API_KEY = "sk-test-standing-key";
const NOW = 1_800_000_000_000;
const EXPIRES_AT_SECONDS = NOW / 1000 + 60;

interface RecordedRequest {
  url: string;
  init: RequestInit;
}

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
  const requests: RecordedRequest[] = [];
  let index = 0;
  const instance = new OpenAiRealtimeCredentialMinter({
    apiKey: API_KEY,
    now: options.now ?? (() => NOW),
    fetch: async (url, init) => {
      requests.push({ url, init });
      const next = responses[Math.min(index, responses.length - 1)];
      index += 1;
      if (next instanceof Error) throw next;
      if (!next) throw new Error("No response configured");
      return next;
    },
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
      audio: { input: { turn_detection: unknown }; output: { voice: string } };
    };
  };
  assert.equal(body.session.model, REALTIME_DEFAULTS.MODEL);
  assert.equal(body.session.audio.output.voice, REALTIME_DEFAULTS.VOICE);
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

test("an outstanding credential is reused until it nears expiry", async () => {
  let now = NOW;
  const { minter: instance, requests } = minter([mintResponse(), mintResponse()], {
    now: () => now,
  });

  await instance.mint();
  await instance.mint();
  assert.equal(requests.length, 1);

  // Inside the expiry margin the credential can no longer survive a handshake.
  now = EXPIRES_AT_SECONDS * 1000 - 1_000;
  await instance.mint();
  assert.equal(requests.length, 2);
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
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "";
    assert.equal(openAiRealtimeCredentialsFromEnvironment(), undefined);

    process.env.OPENAI_API_KEY = API_KEY;
    assert.ok(openAiRealtimeCredentialsFromEnvironment());
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
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
    process.env.LUKE_REALTIME_VOICE = "cedar";

    assert.equal(openAiRealtimeCredentialsFromEnvironment()?.model, "gpt-realtime-preview");
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
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    process.env.OPENAI_API_KEY = "";
    const withoutKey = unavailableRealtimeDiagnostics(false);
    assert.equal(withoutKey.lastOutcome, REALTIME_MINT_OUTCOME.NO_API_KEY);
    assert.equal(withoutKey.apiKeyConfigured, false);

    // A fixture run has credentials available and still refuses to use them,
    // which is the case most easily mistaken for a broken key.
    process.env.OPENAI_API_KEY = API_KEY;
    const fixture = unavailableRealtimeDiagnostics(true);
    assert.equal(fixture.lastOutcome, REALTIME_MINT_OUTCOME.DISABLED_BY_FIXTURE);
    assert.equal(fixture.apiKeyConfigured, true);
    assert.ok(!JSON.stringify(fixture).includes(API_KEY));
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("an empty API key is rejected outright", () => {
  assert.throws(() => new OpenAiRealtimeCredentialMinter({ apiKey: "   " }));
});
