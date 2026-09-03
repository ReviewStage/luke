import assert from "node:assert/strict";
import test from "node:test";
import { elevenlabsVoicesUrl, listElevenlabsVoices, MAXIMUM_VOICES } from "./elevenlabs-voices.js";
import { ELEVENLABS_OUTCOME, MAXIMUM_VOICE_FIELD_LENGTH } from "./speech-provider.js";

/** One voice record, as ElevenLabs writes it and as the fixtures bend it. */
interface VoiceFixture {
  voice_id?: string;
  name?: string;
  category?: string;
  /** Sent by ElevenLabs and deliberately dropped, so the fixtures carry it. */
  preview_url?: string;
}

/** One page of the answer ElevenLabs sends, as the fixtures spell it. */
interface VoicesPageFixture {
  voices?: readonly VoiceFixture[];
  has_more?: boolean;
  next_page_token?: string;
}

function jsonResponse(body: VoicesPageFixture, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function recordingFetch(pages: readonly VoicesPageFixture[]) {
  const urls: string[] = [];
  const headers: (string | null)[] = [];
  let index = 0;
  const fetch = async (url: string, init: RequestInit) => {
    urls.push(url);
    headers.push(new Headers(init.headers).get("xi-api-key"));
    const page = pages[Math.min(index, pages.length - 1)] ?? {};
    index += 1;
    return jsonResponse(page);
  };
  return { fetch, urls, headers };
}

test("asks for the account's own voices, sorted, without a total count", () => {
  const url = new URL(elevenlabsVoicesUrl());
  assert.equal(url.origin, "https://api.elevenlabs.io");
  assert.equal(url.pathname, "/v2/voices");
  assert.equal(
    url.search,
    "?voice_type=personal&page_size=100&sort=name&sort_direction=asc&include_total_count=false",
  );
  assert.equal(
    new URL(elevenlabsVoicesUrl("cursor-1")).searchParams.get("next_page_token"),
    "cursor-1",
  );
});

test("keeps only the bounded fields a row draws", async () => {
  const { fetch, headers } = recordingFetch([
    {
      voices: [
        { voice_id: " v1 ", name: " Ada ", category: "cloned", preview_url: "https://x" },
        { voice_id: "v2", name: "Bee" },
        { name: "no id" },
        { voice_id: "v3" },
        { voice_id: "v4", name: "x".repeat(MAXIMUM_VOICE_FIELD_LENGTH + 1) },
      ],
    },
  ]);
  const result = await listElevenlabsVoices({ apiKey: "secret", fetch });
  assert.equal(result.outcome, ELEVENLABS_OUTCOME.OK);
  assert.deepEqual(result.voices, [
    { id: "v1", name: "Ada", category: "cloned" },
    { id: "v2", name: "Bee" },
  ]);
  assert.deepEqual(headers, ["secret"]);
});

test("follows the cursor the previous page handed back", async () => {
  const { fetch, urls } = recordingFetch([
    { voices: [{ voice_id: "v1", name: "Ada" }], has_more: true, next_page_token: "c1" },
    { voices: [{ voice_id: "v2", name: "Bee" }] },
  ]);
  const result = await listElevenlabsVoices({ apiKey: "secret", fetch });
  assert.deepEqual(
    result.voices?.map((voice) => voice.id),
    ["v1", "v2"],
  );
  assert.equal(new URL(urls[0] ?? "").searchParams.has("next_page_token"), false);
  assert.equal(new URL(urls[1] ?? "").searchParams.get("next_page_token"), "c1");
});

test("refuses a page claiming more with no way to ask for it", async () => {
  const { fetch } = recordingFetch([{ voices: [], has_more: true }]);
  const result = await listElevenlabsVoices({ apiKey: "secret", fetch });
  assert.equal(result.outcome, ELEVENLABS_OUTCOME.MALFORMED_RESPONSE);
  assert.equal(result.voices, undefined);
});

test("stops at the cap rather than reading a list that never ends", async () => {
  let cursor = 0;
  const fetch = async () => {
    cursor += 1;
    return jsonResponse({
      voices: Array.from({ length: 100 }, (_, index) => ({
        voice_id: `v${cursor}-${index}`,
        name: `Voice ${cursor}-${index}`,
      })),
      has_more: true,
      next_page_token: `c${cursor}`,
    });
  };
  const result = await listElevenlabsVoices({ apiKey: "secret", fetch });
  assert.equal(result.outcome, ELEVENLABS_OUTCOME.OK);
  assert.equal(result.voices?.length, MAXIMUM_VOICES);
});

test("tells a refused key apart from any other rejection", async () => {
  for (const [status, outcome] of [
    [401, ELEVENLABS_OUTCOME.UNAUTHORIZED],
    [403, ELEVENLABS_OUTCOME.UNAUTHORIZED],
    [500, ELEVENLABS_OUTCOME.HTTP_ERROR],
  ] as const) {
    const result = await listElevenlabsVoices({
      apiKey: "secret",
      fetch: async () => jsonResponse({}, status),
    });
    assert.equal(result.outcome, outcome);
  }
});

test("reports a network failure without a list", async () => {
  const result = await listElevenlabsVoices({
    apiKey: "secret",
    fetch: async () => {
      throw new TypeError("offline");
    },
  });
  assert.equal(result.outcome, ELEVENLABS_OUTCOME.NETWORK_ERROR);
  assert.equal(result.voices, undefined);
});

test("reports an answer that is not a voice list", async () => {
  const result = await listElevenlabsVoices({
    apiKey: "secret",
    fetch: async () => new Response("not json", { status: 200 }),
  });
  assert.equal(result.outcome, ELEVENLABS_OUTCOME.MALFORMED_RESPONSE);
});

test("reads an account with no personal voices as an empty list", async () => {
  const result = await listElevenlabsVoices({
    apiKey: "secret",
    fetch: async () => jsonResponse({ voices: [] }),
  });
  assert.equal(result.outcome, ELEVENLABS_OUTCOME.OK);
  assert.deepEqual(result.voices, []);
});
