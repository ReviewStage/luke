import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@sidecar/wire/testing";
import { Effect, Layer, Redacted } from "effect";
import type { WireValue } from "../server/core";
import {
  type AvatarGrant,
  LIVEAVATAR_FAILURE,
  LIVEAVATAR_STOP_REASON,
  LiveAvatar,
  type LiveAvatarError,
} from "../server/voice/liveavatar";

/**
 * The LiveAvatar client over a LiveAvatar that answers from a route table:
 * the grant a LITE start answers, the headers each call carries, a stop of
 * a session already gone, and what an error keeps of a refusal, which is
 * its status and never LiveAvatar's words.
 */

const BASE = "https://liveavatar.test";
const API_KEY = "la-key-1";
const AVATAR_ID = "6b0e1f0e-avatar";
const SESSION_TOKEN = "session-jwt-1";
const SESSION_ID = "3f2a-session";

/** Words a refusal's body carries that no error may repeat. */
const UPSTREAM_SECRET = "sk-upstream-secret-words";

interface Sent {
  readonly path: string;
  readonly headers: Headers;
  readonly body: unknown;
}

type Route = () => Response;

function json(status: number, body: WireValue): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const minted: Route = () =>
  json(200, {
    code: 100,
    data: { session_id: SESSION_ID, session_token: SESSION_TOKEN },
    message: "ok",
  });

const started: Route = () =>
  json(201, {
    code: 100,
    data: {
      session_id: SESSION_ID,
      livekit_url: "wss://room.livekit.test",
      livekit_client_token: "viewer-token-1",
      livekit_agent_token: "agent-token-1",
      ws_url: "wss://media.liveavatar.test/ws",
      max_session_duration: 1200,
    },
    message: "ok",
  });

const stopped: Route = () => json(200, { code: 100, data: null, message: "ok" });

/** A LiveAvatar answering each path from its route, recording every request it was sent. */
function liveAvatar(routes: Readonly<Record<string, Route>>) {
  const sent: Sent[] = [];
  const client = fakeHttpClientLayer((url, init) => {
    const path = new URL(url).pathname;
    sent.push({
      path,
      headers: new Headers(init.headers),
      body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const route = routes[path];
    if (!route) throw new Error(`no route for ${path}`);
    return route();
  });
  const layer = LiveAvatar.layer({
    apiKey: Redacted.make(API_KEY),
    avatarId: AVATAR_ID,
    baseUrl: BASE,
  }).pipe(Layer.provide(client));
  const provide = <A, E>(effect: Effect.Effect<A, E, LiveAvatar>) => Effect.provide(effect, layer);
  return { sent, provide };
}

function assertWordless(error: LiveAvatarError): void {
  const seen = `${error.message} ${JSON.stringify(error)} ${String(error)}`;
  assert.ok(!seen.includes(UPSTREAM_SECRET), seen);
  assert.ok(!seen.includes(API_KEY), seen);
  assert.ok(!seen.includes(SESSION_TOKEN), seen);
}

it.effect("a start mints a LITE token on the key and starts it on the session token", () => {
  const avatar = liveAvatar({
    "/v1/sessions/token": minted,
    "/v1/sessions/start": started,
  });
  return avatar.provide(
    Effect.gen(function* () {
      const grant = yield* (yield* LiveAvatar).start();
      const expected: AvatarGrant = {
        sessionId: SESSION_ID,
        livekitUrl: "wss://room.livekit.test",
        viewerToken: "viewer-token-1",
        mediaUrl: "wss://media.liveavatar.test/ws",
        maxSeconds: 1200,
      };
      assert.deepEqual(grant, expected);
      const [token, start] = avatar.sent;
      assert.equal(avatar.sent.length, 2);
      assert.equal(token?.path, "/v1/sessions/token");
      assert.equal(token?.headers.get("x-api-key"), API_KEY);
      assert.deepEqual(token?.body, {
        mode: "LITE",
        avatar_id: AVATAR_ID,
        video_settings: { quality: "high" },
      });
      assert.equal(start?.path, "/v1/sessions/start");
      assert.equal(start?.headers.get("authorization"), `Bearer ${SESSION_TOKEN}`);
      assert.equal(start?.headers.get("x-api-key"), null);
    }),
  );
});

it.effect(
  "a start LiveAvatar refuses fails with the status alone and stops the minted session",
  () => {
    const avatar = liveAvatar({
      "/v1/sessions/token": minted,
      "/v1/sessions/start": () => json(402, { code: 4002, message: UPSTREAM_SECRET }),
      "/v1/sessions/stop": stopped,
    });
    return avatar.provide(
      Effect.gen(function* () {
        const error = yield* Effect.flip((yield* LiveAvatar).start());
        assert.equal(error.failure, LIVEAVATAR_FAILURE.HTTP);
        assert.equal(error.status, 402);
        assertWordless(error);
        const stop = avatar.sent.at(-1);
        assert.equal(stop?.path, "/v1/sessions/stop");
        assert.equal(stop?.headers.get("x-api-key"), API_KEY);
        assert.deepEqual(stop?.body, { session_id: SESSION_ID, reason: "SERVER_ERROR" });
      }),
    );
  },
);

it.effect("a token LiveAvatar refuses fails with the status alone", () => {
  const avatar = liveAvatar({
    "/v1/sessions/token": () => json(401, { detail: `bad key ${API_KEY} ${UPSTREAM_SECRET}` }),
  });
  return avatar.provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip((yield* LiveAvatar).start());
      assert.equal(error.failure, LIVEAVATAR_FAILURE.HTTP);
      assert.equal(error.status, 401);
      assertWordless(error);
    }),
  );
});

it.effect(
  "a start answered without its media socket is malformed, and keeps none of the body",
  () => {
    const avatar = liveAvatar({
      "/v1/sessions/token": minted,
      "/v1/sessions/start": () =>
        json(201, {
          data: {
            session_id: SESSION_ID,
            livekit_url: UPSTREAM_SECRET,
            livekit_client_token: UPSTREAM_SECRET,
          },
        }),
      "/v1/sessions/stop": stopped,
    });
    return avatar.provide(
      Effect.gen(function* () {
        const error = yield* Effect.flip((yield* LiveAvatar).start());
        assert.equal(error.failure, LIVEAVATAR_FAILURE.MALFORMED);
        assert.equal(error.status, undefined);
        assertWordless(error);
        assert.equal(avatar.sent.at(-1)?.path, "/v1/sessions/stop");
      }),
    );
  },
);

it.effect("a start that reaches no LiveAvatar is a network failure", () => {
  const avatar = liveAvatar({});
  return avatar.provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip((yield* LiveAvatar).start());
      assert.equal(error.failure, LIVEAVATAR_FAILURE.NETWORK);
      assert.equal(error.status, undefined);
    }),
  );
});

it.effect("a stop names the session and the reason on the key", () => {
  const avatar = liveAvatar({ "/v1/sessions/stop": stopped });
  return avatar.provide(
    Effect.gen(function* () {
      yield* (yield* LiveAvatar).stop(SESSION_ID, LIVEAVATAR_STOP_REASON.USER_CLOSED);
      const [stop] = avatar.sent;
      assert.equal(stop?.headers.get("x-api-key"), API_KEY);
      assert.deepEqual(stop?.body, { session_id: SESSION_ID, reason: "USER_CLOSED" });
    }),
  );
});

it.effect("a stop of a session LiveAvatar no longer knows is success", () => {
  const avatar = liveAvatar({
    "/v1/sessions/stop": () => json(404, { message: UPSTREAM_SECRET }),
  });
  return avatar.provide(
    Effect.gen(function* () {
      yield* (yield* LiveAvatar).stop(SESSION_ID, LIVEAVATAR_STOP_REASON.ZOMBIE_SESSION_REAP);
      assert.equal(avatar.sent.length, 1);
    }),
  );
});

it.effect("a stop LiveAvatar refuses fails with the status alone", () => {
  const avatar = liveAvatar({
    "/v1/sessions/stop": () => json(500, { message: UPSTREAM_SECRET }),
  });
  return avatar.provide(
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        (yield* LiveAvatar).stop(SESSION_ID, LIVEAVATAR_STOP_REASON.USER_CLOSED),
      );
      assert.equal(error.failure, LIVEAVATAR_FAILURE.HTTP);
      assert.equal(error.status, 500);
      assertWordless(error);
    }),
  );
});
