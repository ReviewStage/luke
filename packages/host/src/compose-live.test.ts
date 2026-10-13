import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@sidecar/gateway";
import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  VOICE_SERVICE_FRAME,
} from "@sidecar/hosted";
import { HostedLiveSessionSource } from "@sidecar/voice";
import {
  type AvatarGrant,
  LIVE_AVATAR_END,
  LIVE_AVATAR_STATUS,
  type LiveAvatarState,
} from "@sidecar/voice/live-session";
import { type FakeLiveSocket, scriptedOpenSocket } from "@sidecar/voice/testing";
import type { WireRecord, WireValue } from "@sidecar/wire";
import { Effect, Fiber, Stream } from "effect";
import { composeLive } from "./compose-live.js";
import { HostKernelTag } from "./effect/kernel.js";
import { hostKernelOver } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";

/**
 * The video toggle over the hosted source and its scripted socket: what the
 * service is sent for `voice.setVideo`, where the avatar stands as the
 * service answers, and that the grant's token reaches the in-process grant
 * stream and no Gateway answer or event.
 */

const PLAN_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SDP_ANSWER =
  "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const TOKEN = "eyJhbGciOiJIUzI1NiJ9.grant-one.signature";
const SECOND_TOKEN = "eyJhbGciOiJIUzI1NiJ9.grant-two.signature";
const GRANT: AvatarGrant = {
  serverUrl: "wss://avatar-room.example.test",
  participantToken: TOKEN,
  agentIdentity: "keyframe-agent",
};
const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

function subject() {
  return Effect.gen(function* () {
    const script = scriptedOpenSocket([
      (socket) => {
        socket.onSent((data) => {
          if (JSON.parse(data).type !== VOICE_SERVICE_FRAME.SESSION_CREATE) return;
          queueMicrotask(() =>
            socket.receive({
              type: VOICE_SERVICE_FRAME.SESSION_CREATED,
              sessionId: "ls_1",
              sdpAnswer: SDP_ANSWER,
            }),
          );
        });
        return undefined;
      },
    ]);
    const source = new HostedLiveSessionSource({
      serviceOrigin: "wss://voice.example.test",
      openSocket: script.openSocket,
      readAccessToken: () => Effect.succeed("account-token"),
      refreshAccount: () => Effect.void,
      reattachDelaysMs: [],
    });
    const events: { kind: GatewayEventKind; payload: WireValue }[] = [];
    let minted = 0;
    const kernel = hostKernelOver({
      stateRoot: "/nowhere",
      runMode: runModeFor({ capture: false, fixture: false }),
      accountBaseUrl: "https://account.example.test",
      now: () => 0,
      createId: () => {
        minted += 1;
        return `request-${minted}`;
      },
      report: () => undefined,
      emit: (kind, payload) => events.push({ kind, payload }),
    });
    const live = yield* Effect.provideService(
      composeLive({
        settings: { recordProductEvent: () => undefined },
        account: { agentTrace: undefined, voiceCapabilities: { liveSessions: source } },
        activePlanId: () => PLAN_ID,
        showPlanDraft: () => undefined,
        showPlanActivity: () => undefined,
        showPlanCode: () => undefined,
        showPlanWork: () => undefined,
        planCallEnded: () => undefined,
      }),
      HostKernelTag,
      kernel,
    );
    const states: LiveAvatarState[] = [];
    const grants: (AvatarGrant | undefined)[] = [];
    yield* Effect.forkScoped(
      Stream.runForEach(live.service.avatarStates, (state) =>
        Effect.sync(() => states.push(state)),
      ),
    );
    yield* Effect.forkScoped(
      Stream.runForEach(live.service.avatarGrants, (grant) =>
        Effect.sync(() => grants.push(grant)),
      ),
    );
    /** Every answer a method gave, for the check that none carries a token. */
    const answers: (WireValue | undefined)[] = [];
    const call = (method: GatewayMethod, params: WireRecord = {}) =>
      Effect.gen(function* () {
        const handler = live.methods[method];
        assert.ok(handler, `no handler for ${method}`);
        const answer = yield* Effect.orDie(handler(params, context));
        answers.push(answer);
        yield* settle();
        return answer;
      });
    const refusal = (method: GatewayMethod, params: WireRecord) => {
      const handler = live.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return Effect.flip(handler(params, context));
    };
    const openCall = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp: SDP_OFFER, planId: PLAN_ID }),
      );
      const created = yield* Fiber.join(fiber);
      assert.ok(created);
      const socket = script.sockets[0];
      assert.ok(socket);
      return socket;
    });
    /** Whether any Gateway answer or event so far carried either token, read as the bytes they cross as. */
    const tokenCrossedGateway = () =>
      [...answers, ...events.map((event) => event.payload)].some((value) => {
        const bytes = JSON.stringify(value);
        return bytes.includes(TOKEN) || bytes.includes(SECOND_TOKEN);
      });
    return { call, refusal, openCall, states, grants, tokenCrossedGateway };
  });
}

/** The frames the desktop sent after the handshake, by type, so a test reads the avatar's asks. */
function avatarSends(socket: FakeLiveSocket) {
  return socket.sent
    .map((data) => JSON.parse(data))
    .filter((frame) => String(frame.type).startsWith("avatar."));
}

function start(requestId: string) {
  return { type: VOICE_SERVICE_FRAME.AVATAR_START, requestId };
}

/** The service's grant for the start `requestId` names. */
function grantFor(socket: FakeLiveSocket, requestId: string, grant: AvatarGrant = GRANT) {
  socket.receive({ type: VOICE_SERVICE_FRAME.AVATAR_STARTED, requestId, ...grant });
}

function statuses(states: readonly LiveAvatarState[]) {
  return states.map((state) => state.status);
}

const SECOND_GRANT: AvatarGrant = { ...GRANT, participantToken: SECOND_TOKEN };

it.effect(
  "turning video on asks the service, hands its grant on in process alone, and turning it off stops it as the developer's",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const socket = yield* f.openCall;

      assert.deepEqual(yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true }), {
        requested: true,
      });
      assert.deepEqual(avatarSends(socket), [start("request-1")]);

      grantFor(socket, "request-1");
      yield* settle();
      assert.deepEqual(f.grants, [GRANT]);
      // An avatar already up is not asked for again: each start is a session the plan pays for.
      assert.deepEqual(yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true }), {
        requested: false,
      });

      assert.deepEqual(yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: false }), {
        requested: true,
      });
      assert.deepEqual(avatarSends(socket), [
        start("request-1"),
        {
          type: VOICE_SERVICE_FRAME.AVATAR_STOP,
          requestId: "request-1",
          reason: AVATAR_STOP_REASON.USER,
        },
      ]);
      assert.deepEqual(f.grants, [GRANT, undefined]);
      assert.deepEqual(f.states, [
        { status: LIVE_AVATAR_STATUS.OFF },
        { status: LIVE_AVATAR_STATUS.STARTING },
        { status: LIVE_AVATAR_STATUS.GRANTED },
        {
          status: LIVE_AVATAR_STATUS.ENDED,
          end: { by: LIVE_AVATAR_END.STOPPED, reason: AVATAR_STOP_REASON.USER },
        },
      ]);
      assert.equal(f.tokenCrossedGateway(), false);
    }),
);

it.effect("video asked for with no call standing asks nothing and answers so", () =>
  Effect.gen(function* () {
    const f = yield* subject();

    assert.deepEqual(yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true }), {
      requested: false,
    });
    assert.deepEqual(yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: false }), {
      requested: false,
    });
    assert.deepEqual(statuses(f.states), [LIVE_AVATAR_STATUS.OFF]);
  }),
);

it.effect("the toggle refuses anything but a boolean", () =>
  Effect.gen(function* () {
    const f = yield* subject();

    const refusal = yield* f.refusal(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: "yes" });
    assert.equal(refusal._tag, "InvalidParamsRefusal");
  }),
);

it.effect(
  "a grant for a start stopped before it landed is dropped, and the restart's own grant is the one handed on",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const socket = yield* f.openCall;

      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: false });
      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
      grantFor(socket, "request-1");
      yield* settle();
      assert.deepEqual(f.grants, []);
      assert.equal(f.states.at(-1)?.status, LIVE_AVATAR_STATUS.STARTING);

      grantFor(socket, "request-2", SECOND_GRANT);
      yield* settle();
      assert.deepEqual(f.grants, [SECOND_GRANT]);
      assert.equal(f.tokenCrossedGateway(), false);
    }),
);

it.effect(
  "a start whose answer never came is superseded by the next press, and only the latest start's answer is heard",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const socket = yield* f.openCall;

      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
      assert.deepEqual(yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true }), {
        requested: true,
      });
      assert.deepEqual(avatarSends(socket), [start("request-1"), start("request-2")]);
      socket.receive({
        type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
        requestId: "request-1",
        reason: AVATAR_UNAVAILABLE_REASON.NO_CAPACITY,
      });
      yield* settle();
      assert.deepEqual(statuses(f.states), [LIVE_AVATAR_STATUS.OFF, LIVE_AVATAR_STATUS.STARTING]);

      grantFor(socket, "request-2", SECOND_GRANT);
      yield* settle();
      assert.deepEqual(f.grants, [SECOND_GRANT]);
    }),
);

it.effect("a refusal ends the start, and a grant that lands after it is dropped", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const socket = yield* f.openCall;

    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    socket.receive({
      type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
      requestId: "request-1",
      reason: AVATAR_UNAVAILABLE_REASON.NO_CAPACITY,
    });
    yield* settle();
    grantFor(socket, "request-1");
    yield* settle();

    assert.deepEqual(f.grants, []);
    assert.deepEqual(f.states.at(-1), {
      status: LIVE_AVATAR_STATUS.ENDED,
      end: { by: LIVE_AVATAR_END.UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.NO_CAPACITY },
    });
  }),
);

it.effect("a grant whose room is not a secure socket is read as the avatar unavailable", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const socket = yield* f.openCall;

    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    grantFor(socket, "request-1", { ...GRANT, serverUrl: "ws://avatar-room.example.test" });
    yield* settle();

    assert.deepEqual(f.grants, []);
    assert.deepEqual(f.states.at(-1), {
      status: LIVE_AVATAR_STATUS.ENDED,
      end: { by: LIVE_AVATAR_END.UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.ERROR },
    });
  }),
);

it.effect("a refusal whose reason is unreadable still ends the start it names", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const socket = yield* f.openCall;

    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    socket.receive({
      type: VOICE_SERVICE_FRAME.AVATAR_UNAVAILABLE,
      requestId: "request-1",
      reason: 42,
    });
    yield* settle();

    assert.deepEqual(f.states.at(-1), {
      status: LIVE_AVATAR_STATUS.ENDED,
      end: { by: LIVE_AVATAR_END.UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.ERROR },
    });
  }),
);

it.effect("the call's end withdraws the grant and sends no stop of its own", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const socket = yield* f.openCall;

    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    grantFor(socket, "request-1");
    yield* settle();
    socket.closeFromServer({ code: 1000 });
    yield* settle();

    assert.deepEqual(f.grants, [GRANT, undefined]);
    assert.deepEqual(f.states.at(-1), {
      status: LIVE_AVATAR_STATUS.ENDED,
      end: { by: LIVE_AVATAR_END.CALL_ENDED },
    });
    assert.deepEqual(avatarSends(socket), [start("request-1")]);
    assert.equal(f.tokenCrossedGateway(), false);
  }),
);
