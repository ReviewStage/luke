import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Effect, Fiber, Layer, Redacted } from "effect";
import { TestClock } from "effect/testing";
import type { WireValue } from "../core.js";
import { type AvatarGrant, KEYFRAME_FAILURE, Keyframe, type KeyframeError } from "./keyframe.js";

/**
 * The Keyframe client over a Keyframe that answers one route: the grant a
 * minted session answers, the key and persona the request carries, which
 * kind each refusal is read as, and what an error keeps of a refusal, which
 * is its status and never Keyframe's words.
 */

const BASE = "https://keyframe.test";
const API_KEY = "kf-key-1";
const PERSONA_ID = "persona-stock-1";
const PARTICIPANT_TOKEN = "participant-jwt-1";

/** Words a refusal's body carries that no error may repeat. */
const UPSTREAM_SECRET = "sk-upstream-secret-words";

interface Sent {
  readonly method: string | undefined;
  readonly path: string;
  readonly headers: Headers;
  readonly body: unknown;
}

function json(status: number, body: WireValue): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const minted = () =>
  json(200, {
    server_url: "wss://room.livekit.test",
    participant_token: PARTICIPANT_TOKEN,
    agent_identity: "keyframe-agent-1",
    expires_at: "2026-10-13T21:05:00Z",
  });

/** A Keyframe answering every request with `answer`, recording each request it was sent. */
function keyframe(answer: () => Response) {
  const sent: Sent[] = [];
  const client = fakeHttpClientLayer((url, init) => {
    sent.push({
      method: init.method,
      path: new URL(url).pathname,
      headers: new Headers(init.headers),
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    return answer();
  });
  const layer = Keyframe.layer({
    apiKey: Redacted.make(API_KEY),
    baseUrl: BASE,
  }).pipe(Layer.provide(client));
  const createSession = Effect.gen(function* () {
    return yield* (yield* Keyframe).createSession(PERSONA_ID);
  }).pipe(Effect.provide(layer));
  return { sent, createSession };
}

function assertWordless(error: KeyframeError): void {
  const seen = `${error.message} ${JSON.stringify(error)} ${String(error)}`;
  assert.ok(!seen.includes(UPSTREAM_SECRET), seen);
  assert.ok(!seen.includes(API_KEY), seen);
  assert.ok(!seen.includes(PARTICIPANT_TOKEN), seen);
}

it.effect("a session is minted on the key for the persona and answers the grant", () => {
  const upstream = keyframe(minted);
  return Effect.gen(function* () {
    const grant = yield* upstream.createSession;
    const expected: AvatarGrant = {
      serverUrl: "wss://room.livekit.test",
      participantToken: PARTICIPANT_TOKEN,
      agentIdentity: "keyframe-agent-1",
    };
    assert.deepEqual(grant, expected);
    assert.equal(upstream.sent.length, 1);
    const [request] = upstream.sent;
    assert.equal(request?.method, "POST");
    assert.equal(request?.path, "/v1/sessions");
    assert.equal(request?.headers.get("authorization"), `Bearer ${API_KEY}`);
    assert.deepEqual(request?.body, { persona_id: PERSONA_ID });
  });
});

const REFUSALS = [
  { status: 503, failure: KEYFRAME_FAILURE.NO_CAPACITY },
  { status: 429, failure: KEYFRAME_FAILURE.NO_CAPACITY },
  { status: 403, failure: KEYFRAME_FAILURE.TASK_REFUSED },
  { status: 401, failure: KEYFRAME_FAILURE.UPSTREAM },
  { status: 500, failure: KEYFRAME_FAILURE.UPSTREAM },
] as const;

for (const { status, failure } of REFUSALS) {
  it.effect(`a ${status} is ${failure}, with the status alone`, () => {
    const upstream = keyframe(() =>
      json(status, { detail: `refused ${API_KEY} ${UPSTREAM_SECRET}` }),
    );
    return Effect.gen(function* () {
      const error = yield* Effect.flip(upstream.createSession);
      assert.equal(error.failure, failure);
      assert.equal(error.status, status);
      assertWordless(error);
    });
  });
}

it.effect("a success without the token is upstream, and keeps none of the body", () => {
  const upstream = keyframe(() =>
    json(200, { server_url: UPSTREAM_SECRET, agent_identity: UPSTREAM_SECRET }),
  );
  return Effect.gen(function* () {
    const error = yield* Effect.flip(upstream.createSession);
    assert.equal(error.failure, KEYFRAME_FAILURE.UPSTREAM);
    assert.equal(error.status, 200);
    assertWordless(error);
  });
});

it.effect("a session that reaches no Keyframe is upstream with no status", () => {
  const upstream = keyframe(() => {
    throw new Error(UPSTREAM_SECRET);
  });
  return Effect.gen(function* () {
    const error = yield* Effect.flip(upstream.createSession);
    assert.equal(error.failure, KEYFRAME_FAILURE.UPSTREAM);
    assert.equal(error.status, undefined);
    assertWordless(error);
  });
});

it.effect("a success whose body never ends is upstream with no status, at the deadline", () => {
  const upstream = keyframe(
    () =>
      new Response(new ReadableStream(), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  return Effect.gen(function* () {
    const pending = yield* Effect.forkChild(Effect.flip(upstream.createSession));
    yield* TestClock.adjust("15 seconds");
    const error = yield* Fiber.join(pending);
    assert.equal(error.failure, KEYFRAME_FAILURE.UPSTREAM);
    assert.equal(error.status, undefined);
  });
});
