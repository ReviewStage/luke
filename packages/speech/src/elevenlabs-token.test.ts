import assert from "node:assert/strict";
import test from "node:test";
import {
  ELEVENLABS_TOKEN_URL,
  elevenlabsTokenFromResponse,
  mintElevenlabsToken,
} from "./elevenlabs-token.js";
import { ELEVENLABS_OUTCOME } from "./speech-provider.js";

test("mints at the documented path, with the key in its own header alone", async () => {
  assert.equal(ELEVENLABS_TOKEN_URL, "https://api.elevenlabs.io/v1/single-use-token/tts_websocket");
  let seen: { url: string; init: RequestInit } | undefined;
  const result = await mintElevenlabsToken({
    apiKey: "secret",
    fetch: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ token: "single-use" }), { status: 200 });
    },
  });
  assert.equal(result.outcome, ELEVENLABS_OUTCOME.OK);
  assert.equal(result.token, "single-use");
  assert.equal(seen?.url, ELEVENLABS_TOKEN_URL);
  assert.equal(seen?.init.method, "POST");
  const headers = new Headers(seen?.init.headers);
  assert.equal(headers.get("xi-api-key"), "secret");
  assert.equal(seen?.init.body, undefined);
  // The key travels in its header and nowhere else: never in the address, and
  // never in a body the request does not have.
  assert.equal(seen?.url.includes("secret"), false);
});

test("reads a token only from an answer that carries one", () => {
  assert.equal(elevenlabsTokenFromResponse({ token: "abc" }), "abc");
  assert.equal(elevenlabsTokenFromResponse({ token: "" }), undefined);
  assert.equal(elevenlabsTokenFromResponse({ token: 7 }), undefined);
  assert.equal(elevenlabsTokenFromResponse({}), undefined);
  assert.equal(elevenlabsTokenFromResponse("abc"), undefined);
});

test("tells a refused key apart from any other rejection", async () => {
  for (const [status, outcome] of [
    [401, ELEVENLABS_OUTCOME.UNAUTHORIZED],
    [403, ELEVENLABS_OUTCOME.UNAUTHORIZED],
    [502, ELEVENLABS_OUTCOME.HTTP_ERROR],
  ] as const) {
    const result = await mintElevenlabsToken({
      apiKey: "secret",
      fetch: async () => new Response("", { status }),
    });
    assert.equal(result.outcome, outcome);
    assert.equal(result.token, undefined);
  }
});

test("reports a failed or unusable mint without a token", async () => {
  const network = await mintElevenlabsToken({
    apiKey: "secret",
    fetch: async () => {
      throw new TypeError("offline");
    },
  });
  assert.equal(network.outcome, ELEVENLABS_OUTCOME.NETWORK_ERROR);

  const malformed = await mintElevenlabsToken({
    apiKey: "secret",
    fetch: async () => new Response(JSON.stringify({}), { status: 200 }),
  });
  assert.equal(malformed.outcome, ELEVENLABS_OUTCOME.MALFORMED_RESPONSE);
  assert.equal(malformed.token, undefined);
});
