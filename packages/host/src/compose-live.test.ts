import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ACCOUNT_PROVIDER } from "@luke/credentials/snapshot";
import {
  AVATAR_STOP_REASON,
  AVATAR_UNAVAILABLE_REASON,
  type AvatarStopReason,
  VOICE_SERVICE_FRAME,
} from "@luke/features";
import type { AvatarGrant } from "@luke/features/avatar-grant";
import { VIDEO_AVATAR, type VideoAvatar } from "@luke/features/video-avatar";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { EXPERIMENT } from "@luke/settings";
import { HostedLiveSessionSource } from "@luke/voice";
import {
  AVATAR_START_BOUND,
  LIVE_AVATAR_END,
  LIVE_AVATAR_STATUS,
  type LiveAvatarState,
} from "@luke/voice/live-session";
import { type FakeLiveSocket, scriptedOpenSocket } from "@luke/voice/testing";
import type { WireRecord, WireValue } from "@luke/wire";
import { Effect, Fiber, Stream } from "effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { TestClock } from "effect/testing";
import { composeLive } from "./compose-live.js";
import { HostKernelTag } from "./effect/kernel.js";
import { hostKernelOver } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";
import { SettingsStore } from "./settings-store.js";

/**
 * The video toggle over the hosted source and its scripted socket: what the
 * service is sent for `voice.setVideo`, where the avatar stands as the
 * service answers, and that the grant's token reaches the in-process grant
 * stream and no Gateway answer or event.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
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

/** The account the settings store holds signed in, whose experiments a call reads. */
const DEVELOPER = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  email: "developer@example.com",
  provider: ACCOUNT_PROVIDER.GITHUB,
} as const;

/** A settings store of this test's own, in a directory it made, with the developer signed in and no experiment on until a test turns one on. */
function settingsStore() {
  return Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("luke-live-settings-");
    const store = new SettingsStore({
      directory: () => directory,
      cipher: {
        isAvailable: () => true,
        encrypt: (text) => Buffer.from(text),
        decrypt: (bytes) => bytes.toString(),
      },
      overrides: { voice: undefined },
      fileSystem: yield* FileSystem.FileSystem,
      path: yield* Path.Path,
    });
    yield* Effect.orDie(store.setAccount(DEVELOPER));
    return store;
  }).pipe(Effect.provide([NodeFileSystem.layer, NodePath.layer]));
}

/** The developer's Video calls experiment turned on, as the service answers a switch pressed on any of their Macs. */
function videoCallsOn(store: SettingsStore) {
  return Effect.orDie(store.cacheExperiments(DEVELOPER.email, { [EXPERIMENT.VIDEO_CALLS]: true }));
}

function subject(options: { videoOnCall?: boolean; avatar?: VideoAvatar } = {}) {
  return Effect.gen(function* () {
    const store = yield* settingsStore();
    if (options.videoOnCall) {
      yield* videoCallsOn(store);
    }
    if (options.avatar !== undefined) {
      yield* Effect.orDie(store.set("videoAvatar", options.avatar));
    }
    const answerCreate = (socket: FakeLiveSocket) => {
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
    };
    // One socket for each call a test opens.
    const script = scriptedOpenSocket([answerCreate, answerCreate]);
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
        settings: {
          recordProductEvent: () => undefined,
          store,
        },
        account: { agentTrace: undefined, voiceCapabilities: { liveSessions: source } },
        activeTaskId: () => TASK_ID,
        showPlanDraft: () => undefined,
        showTaskActivity: () => undefined,
        showTaskCode: () => undefined,
        showTaskWork: () => undefined,
        taskCallEnded: () => undefined,
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
        call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, { sdp: SDP_OFFER, taskId: TASK_ID }),
      );
      const created = yield* Fiber.join(fiber);
      assert.ok(created);
      const socket = script.sockets.at(-1);
      assert.ok(socket);
      return socket;
    });
    /** Whether any Gateway answer or event so far carried either token, read as the bytes they cross as. */
    const tokenCrossedGateway = () =>
      [...answers, ...events.map((event) => event.payload)].some((value) => {
        const bytes = JSON.stringify(value);
        return bytes.includes(TOKEN) || bytes.includes(SECOND_TOKEN);
      });
    return { live, store, call, refusal, openCall, states, grants, tokenCrossedGateway };
  });
}

/** The frames the desktop sent after the handshake, by type, so a test reads the avatar's asks. */
function avatarSends(socket: FakeLiveSocket) {
  return socket.sent
    .map((data) => JSON.parse(data))
    .filter((frame) => String(frame.type).startsWith("avatar."));
}

/** The start `requestId` names, with the avatar it asks for where that is not the default. */
function start(requestId: string, avatar?: VideoAvatar) {
  return {
    type: VOICE_SERVICE_FRAME.AVATAR_START,
    requestId,
    ...(avatar === undefined ? undefined : { avatar }),
  };
}

function stop(requestId: string, reason: AvatarStopReason) {
  return { type: VOICE_SERVICE_FRAME.AVATAR_STOP, requestId, reason };
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

it.effect("the next call starts with no avatar, whatever the last one's ended as", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const first = yield* f.openCall;
    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    grantFor(first, "request-1");
    yield* settle();
    first.closeFromServer({ code: 1000 });
    yield* settle();

    const second = yield* f.openCall;

    assert.notEqual(second, first);
    assert.deepEqual(f.states.at(-1), { status: LIVE_AVATAR_STATUS.OFF });
  }),
);

it.effect(
  "a close this side did not start stops the avatar with its reason and asks for it once more on the call",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const socket = yield* f.openCall;
      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
      grantFor(socket, "request-1");
      yield* settle();

      assert.equal(f.live.service.closed(AVATAR_STOP_REASON.SERVER_CLOSED), true);
      yield* settle();
      grantFor(socket, "request-2", SECOND_GRANT);
      yield* settle();
      // The second close is not asked for again: the tile offers the restart.
      assert.equal(f.live.service.closed(AVATAR_STOP_REASON.ERROR), false);
      yield* settle();

      assert.deepEqual(avatarSends(socket), [
        start("request-1"),
        stop("request-1", AVATAR_STOP_REASON.SERVER_CLOSED),
        start("request-2"),
        stop("request-2", AVATAR_STOP_REASON.ERROR),
      ]);
      assert.deepEqual(f.grants, [GRANT, undefined, SECOND_GRANT, undefined]);
      assert.deepEqual(f.states.at(-1), {
        status: LIVE_AVATAR_STATUS.ENDED,
        end: { by: LIVE_AVATAR_END.STOPPED, reason: AVATAR_STOP_REASON.ERROR },
      });
    }),
);

it.effect("a close reported while no grant stands sends nothing", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const socket = yield* f.openCall;
    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });

    assert.equal(f.live.service.closed(AVATAR_STOP_REASON.SERVER_CLOSED), false);
    assert.deepEqual(avatarSends(socket), [start("request-1")]);
    assert.equal(f.states.at(-1)?.status, LIVE_AVATAR_STATUS.STARTING);
  }),
);

it.effect("each call has a restart of its own", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const first = yield* f.openCall;
    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    grantFor(first, "request-1");
    yield* settle();
    f.live.service.closed(AVATAR_STOP_REASON.SERVER_CLOSED);
    first.closeFromServer({ code: 1000 });
    yield* settle();

    const second = yield* f.openCall;
    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    grantFor(second, "request-3");
    yield* settle();

    assert.equal(f.live.service.closed(AVATAR_STOP_REASON.SERVER_CLOSED), true);
    yield* settle();
    assert.deepEqual(avatarSends(second), [
      start("request-3"),
      stop("request-3", AVATAR_STOP_REASON.SERVER_CLOSED),
      start("request-4"),
    ]);
  }),
);

it.effect("a call opens with the avatar asked for where video is on for calls", () =>
  Effect.gen(function* () {
    const f = yield* subject({ videoOnCall: true });
    const socket = yield* f.openCall;

    assert.deepEqual(avatarSends(socket), [start("request-1")]);
    assert.equal(f.states.at(-1)?.status, LIVE_AVATAR_STATUS.STARTING);
  }),
);

it.effect(
  "every start asks for the avatar chosen in Settings as it stands then: the call's first, the restart after a close this side did not start, and the toggle's",
  () =>
    Effect.gen(function* () {
      const f = yield* subject({ videoOnCall: true, avatar: VIDEO_AVATAR.ORION });
      const socket = yield* f.openCall;
      grantFor(socket, "request-1");
      yield* settle();
      // A choice made while the avatar stands is the one its restart asks for.
      yield* Effect.orDie(f.store.set("videoAvatar", VIDEO_AVATAR.SELENE));
      assert.equal(f.live.service.closed(AVATAR_STOP_REASON.SERVER_CLOSED), true);
      yield* settle();
      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: false });
      yield* Effect.orDie(f.store.set("videoAvatar", VIDEO_AVATAR.LYRA));
      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });

      assert.deepEqual(
        avatarSends(socket)
          .filter((frame) => frame.type === VOICE_SERVICE_FRAME.AVATAR_START)
          .map((frame) => frame.avatar),
        [VIDEO_AVATAR.ORION, VIDEO_AVATAR.SELENE, VIDEO_AVATAR.LYRA],
      );
      assert.deepEqual(avatarSends(socket).at(-1), start("request-3", VIDEO_AVATAR.LYRA));
    }),
);

it.effect("a call opens with no avatar while the Video calls experiment is off", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const socket = yield* f.openCall;

    assert.deepEqual(avatarSends(socket), []);
    assert.deepEqual(statuses(f.states), [LIVE_AVATAR_STATUS.OFF]);
  }),
);

it.effect(
  "the Video calls experiment turned on during a call opens the next call with the avatar",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const first = yield* f.openCall;
      yield* videoCallsOn(f.store);
      first.closeFromServer({ code: 1000 });
      yield* settle();

      const second = yield* f.openCall;

      // The call already standing is not changed: the experiment is read as a call comes to stand.
      assert.deepEqual(avatarSends(first), []);
      assert.deepEqual(avatarSends(second), [start("request-1")]);
    }),
);

it.effect(
  "a start the service never answers is stopped and ends as unavailable once its bound passes",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const socket = yield* f.openCall;
      yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });

      yield* TestClock.adjust(AVATAR_START_BOUND);
      yield* settle();

      assert.deepEqual(avatarSends(socket), [
        start("request-1"),
        stop("request-1", AVATAR_STOP_REASON.ERROR),
      ]);
      assert.deepEqual(f.states.at(-1), {
        status: LIVE_AVATAR_STATUS.ENDED,
        end: { by: LIVE_AVATAR_END.UNAVAILABLE, reason: AVATAR_UNAVAILABLE_REASON.ERROR },
      });
      // A grant arriving after the bound is the abandoned start's, and is dropped.
      grantFor(socket, "request-1");
      yield* settle();
      assert.deepEqual(f.grants, []);
    }),
);

it.effect("a start answered inside its bound is left standing when the bound passes", () =>
  Effect.gen(function* () {
    const f = yield* subject();
    const socket = yield* f.openCall;
    yield* f.call(GATEWAY_METHOD.VOICE_SET_VIDEO, { on: true });
    grantFor(socket, "request-1");
    yield* settle();

    yield* TestClock.adjust(AVATAR_START_BOUND);
    yield* settle();

    assert.deepEqual(avatarSends(socket), [start("request-1")]);
    assert.equal(f.states.at(-1)?.status, LIVE_AVATAR_STATUS.GRANTED);
  }),
);
