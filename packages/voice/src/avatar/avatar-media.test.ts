import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { it } from "@effect/vitest";
import type { JsonValue } from "@sidecar/wire/testing";
import { Duration, Effect, Exit, Fiber, Scope } from "effect";
import { TestClock } from "effect/testing";
import { SOCKET_OPEN_FAULT } from "../live-socket.js";
import { type FakeLiveSocket, type ScriptedOpening, scriptedOpenSocket } from "../testing.js";
import { AVATAR_MEDIA_END_REASON, type AvatarMedia, acquireAvatarMedia } from "./avatar-media.js";

const MEDIA_URL = "wss://media.liveavatar.example.test/v1/ws?session=s_1";
const PCM = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
const PCM_BASE64 = "AQIDBA==";
const CONNECTED = { type: "session.state_updated", state: "connected" };

const opened: ScriptedOpening = () => undefined;
const unreachable: ScriptedOpening = () => ({
  fault: SOCKET_OPEN_FAULT.NETWORK,
  errorName: "Error",
});

/** The frames the media sent on one socket, read as JSON. */
function sentOn(socket: FakeLiveSocket | undefined): JsonValue[] {
  return (socket?.sent ?? []).map((frame): JsonValue => JSON.parse(frame));
}

function keepAlivesOn(socket: FakeLiveSocket | undefined): number {
  return sentOn(socket).filter((frame) => isDeepStrictEqual(frame, { type: "session.keep_alive" }))
    .length;
}

/** Lets the media's fibers run what is due now, on the clock the test keeps. */
const settle = TestClock.adjust(Duration.zero);

function acquired(answers: ScriptedOpening[]) {
  return Effect.gen(function* () {
    const script = scriptedOpenSocket(answers);
    const scope = yield* Scope.make();
    const media: AvatarMedia = yield* Scope.provide(
      acquireAvatarMedia({ url: MEDIA_URL, openSocket: script.openSocket }),
      scope,
    );
    yield* settle;
    return { script, scope, media };
  });
}

it.effect("sends nothing before the server says connected, and speaks and interrupts after", () =>
  Effect.gen(function* () {
    const { script, media } = yield* acquired([opened]);
    const socket = script.sockets[0];
    assert.equal(script.opens[0]?.url, MEDIA_URL);

    yield* media.speak(PCM);
    yield* media.interrupt();
    socket?.receive({ type: "session.state_updated", state: "new" });
    yield* settle;
    yield* media.speak(PCM);
    assert.deepEqual(sentOn(socket), []);

    socket?.receive(CONNECTED);
    yield* settle;
    yield* media.speak(PCM);
    yield* media.interrupt();
    assert.deepEqual(sentOn(socket), [
      { type: "agent.speak", audio: PCM_BASE64 },
      { type: "agent.interrupt" },
    ]);
  }),
);

it.effect(
  "passes on the first 800 ms of a quiet run after Luke spoke, and none of the quiet before he did",
  () =>
    Effect.gen(function* () {
      const { script, media } = yield* acquired([opened]);
      const socket = script.sockets[0];
      socket?.receive(CONNECTED);
      yield* settle;
      // 100 ms of 24 kHz PCM16, all zeros.
      const quiet = new Uint8Array(4_800);
      const speaks = () => sentOn(socket).length;

      yield* media.speak(quiet);
      assert.equal(speaks(), 0);
      yield* media.speak(PCM);
      for (let chunk = 0; chunk < 9; chunk += 1) yield* media.speak(quiet);
      assert.equal(speaks(), 1 + 8);
      yield* media.speak(PCM);
      yield* media.speak(quiet);
      assert.equal(speaks(), 1 + 8 + 2);
    }),
);

it.effect("keeps the session alive once a minute from the moment it connected", () =>
  Effect.gen(function* () {
    const { script } = yield* acquired([opened]);
    const socket = script.sockets[0];

    yield* TestClock.adjust(Duration.seconds(9));
    assert.equal(keepAlivesOn(socket), 0);

    socket?.receive(CONNECTED);
    yield* settle;
    yield* TestClock.adjust(Duration.seconds(59));
    assert.equal(keepAlivesOn(socket), 0);
    yield* TestClock.adjust(Duration.seconds(1));
    assert.equal(keepAlivesOn(socket), 1);
    yield* TestClock.adjust(Duration.seconds(120));
    assert.equal(keepAlivesOn(socket), 3);
  }),
);

it.effect(
  "reconnects after a drop, sending nothing in the gap, and speaks on the new socket once it connects",
  () =>
    Effect.gen(function* () {
      const { script, media } = yield* acquired([opened]);
      script.sockets[0]?.receive(CONNECTED);
      yield* settle;
      yield* TestClock.adjust(Duration.seconds(30));
      script.sockets[0]?.closeFromServer({ code: 1006 });
      yield* settle;

      yield* media.speak(PCM);
      yield* settle;
      const next = script.sockets[1];
      assert.equal(script.opens[1]?.url, MEDIA_URL);
      yield* media.speak(PCM);
      assert.deepEqual(sentOn(next), []);

      next?.receive(CONNECTED);
      yield* settle;
      yield* media.speak(PCM);
      assert.deepEqual(sentOn(next), [{ type: "agent.speak", audio: PCM_BASE64 }]);
      assert.equal(sentOn(script.sockets[0]).length, 0);
    }),
);

it.effect("a socket that never says connected is closed at the deadline and tried again", () =>
  Effect.gen(function* () {
    const { script } = yield* acquired([opened]);

    yield* TestClock.adjust(Duration.seconds(10));
    assert.equal(script.sockets[0]?.closedByClient, true);
    yield* TestClock.adjust(Duration.seconds(1));
    assert.equal(script.opens.length, 2);
  }),
);

it.effect("ends as lost once five attempts in a row have failed, backing off between them", () =>
  Effect.gen(function* () {
    const { script, media } = yield* acquired([unreachable]);
    const ending = yield* Effect.forkChild(media.ended);

    // The waits between the five attempts are one, two, four, and eight seconds.
    yield* TestClock.adjust(Duration.seconds(14));
    assert.equal(script.opens.length, 4);
    assert.equal(ending.pollUnsafe(), undefined);

    yield* TestClock.adjust(Duration.seconds(1));
    assert.equal(script.opens.length, 5);
    assert.deepEqual(yield* Fiber.join(ending), { reason: AVATAR_MEDIA_END_REASON.LOST });
  }),
);

it.effect("a connection that stood stable earns a fresh run of attempts", () =>
  Effect.gen(function* () {
    const { script, media } = yield* acquired([opened, unreachable]);
    script.sockets[0]?.receive(CONNECTED);
    yield* settle;
    yield* TestClock.adjust(Duration.seconds(5));
    script.sockets[0]?.closeFromServer({ code: 1006 });
    yield* settle;
    const ending = yield* Effect.forkChild(media.ended);

    // The drop of a stable connection is answered at once, then four backoffs.
    yield* TestClock.adjust(Duration.seconds(15));
    assert.equal(script.opens.length, 6);
    assert.deepEqual(yield* Fiber.join(ending), { reason: AVATAR_MEDIA_END_REASON.LOST });
  }),
);

it.effect("ends as refused at once when the server refuses the session as the client's fault", () =>
  Effect.gen(function* () {
    const { script, media } = yield* acquired([
      () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 404 }),
    ]);

    assert.deepEqual(yield* media.ended, { reason: AVATAR_MEDIA_END_REASON.REFUSED });
    assert.equal(script.opens.length, 1);
  }),
);

it.effect("closing the scope it was acquired into closes the socket and opens no other", () =>
  Effect.gen(function* () {
    const { script, scope } = yield* acquired([opened]);
    script.sockets[0]?.receive(CONNECTED);
    yield* settle;

    yield* Scope.close(scope, Exit.void);
    yield* TestClock.adjust(Duration.minutes(5));
    assert.equal(script.sockets[0]?.closedByClient, true);
    assert.equal(script.opens.length, 1);
    assert.equal(keepAlivesOn(script.sockets[0]), 0);
  }),
);
