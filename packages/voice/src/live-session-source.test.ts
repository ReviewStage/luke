import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { HOSTED_API_ERROR, VOICE_SERVICE_FRAME, VOICE_SERVICE_PATH } from "@luke/features";
import { VOICE_FAILURE } from "@luke/features/words";
import { LIVE_SESSION_OUTCOME, LIVE_VOICE } from "@luke/live";
import type { ParsedJsonObject } from "@luke/wire/testing";
import { Effect } from "effect";
import { type HostedLiveSessionOptions, HostedLiveSessionSource } from "./live-session-source.js";
import { SOCKET_OPEN_FAULT } from "./live-socket.js";
import { hostedVoiceFailure } from "./microphone-access.js";
import { type ScriptedOpening, type ScriptedSocketSeam, scriptedOpenSocket } from "./testing.js";

const NOW = 1_800_000_000_000;
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SDP_ANSWER =
  "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SESSION_ID = "ls_123";
const SERVICE_ORIGIN = "wss://voice.example.test";
const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT_ID = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
/** The developer's zone, other than the machine's so the frame shows it was asked. */
const TIME_ZONE = "Pacific/Chatham";
const QUOTA = { used: 3, limit: 50, resetsAt: NOW + 3_600_000 };

function createdFrame(overrides: ParsedJsonObject = {}) {
  return {
    type: VOICE_SERVICE_FRAME.SESSION_CREATED,
    sessionId: SESSION_ID,
    sdpAnswer: SDP_ANSWER,
    quota: QUOTA,
    ...overrides,
  };
}

function answering(frame: ParsedJsonObject): ScriptedOpening {
  return (socket) => {
    socket.onSent(() => queueMicrotask(() => socket.receive(frame)));
    return undefined;
  };
}

function hosted(script: ScriptedSocketSeam, options: Partial<HostedLiveSessionOptions> = {}) {
  return new HostedLiveSessionSource({
    serviceOrigin: SERVICE_ORIGIN,
    openSocket: script.openSocket,
    readAccessToken: () => Effect.succeed("token-1"),
    refreshAccount: () => Effect.void,
    readAccountKey: () => Effect.succeed("dev@example.test"),
    requestTimeoutMs: 50,
    ...options,
  });
}

it.effect(
  "the hosted source opens one socket with the bearer on its handshake and sends the create frame first, naming its task, its agent, and the developer's time zone and seeding nothing",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([answering(createdFrame())]);
      const source = hosted(script, { voice: LIVE_VOICE.MARIN, timeZone: () => TIME_ZONE });

      const opened = yield* source.create({
        sdpOffer: SDP_OFFER,
        taskId: TASK_ID,
        agentId: AGENT_ID,
      });

      assert.equal(opened?.sessionId, SESSION_ID);
      assert.equal(opened?.sdpAnswer, SDP_ANSWER);
      // A frame naming no store row for the session hands on no key for one.
      assert.equal(opened !== undefined && Object.hasOwn(opened, "voiceSessionId"), false);
      assert.equal(script.opens.length, 1);
      assert.equal(script.opens[0]?.url, `${SERVICE_ORIGIN}${VOICE_SERVICE_PATH.SESSIONS}`);
      assert.deepEqual(script.opens[0]?.headers, { authorization: "Bearer token-1" });
      const [socket] = script.sockets;
      assert.equal(socket?.sent.length, 1);
      assert.deepEqual(JSON.parse(socket?.sent[0] ?? ""), {
        type: VOICE_SERVICE_FRAME.SESSION_CREATE,
        sdp: SDP_OFFER,
        voice: LIVE_VOICE.MARIN,
        input: [],
        planId: TASK_ID,
        agentId: AGENT_ID,
        timeZone: TIME_ZONE,
      });
      const report = source.diagnostics();
      assert.equal(report.lastOutcome, LIVE_SESSION_OUTCOME.SUCCEEDED);
      assert.deepEqual(report.quota, QUOTA);
    }),
);

it.effect("the hosted source refuses to open without an access token and opens no socket", () =>
  Effect.gen(function* () {
    const script = scriptedOpenSocket([answering(createdFrame())]);
    const source = hosted(script, { readAccessToken: () => Effect.succeed(undefined) });

    assert.equal(
      yield* source.create({ sdpOffer: SDP_OFFER, taskId: TASK_ID, agentId: AGENT_ID }),
      undefined,
    );
    assert.equal(script.opens.length, 0);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
  }),
);

it.effect("the hosted source does not carry a renewed bearer for another account", () =>
  Effect.gen(function* () {
    let token = "token-old";
    let holder = "one@example.test";
    const script = scriptedOpenSocket([
      () => ({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }),
      answering(createdFrame()),
    ]);
    const source = hosted(script, {
      readAccessToken: () => Effect.succeed(token),
      readAccountKey: () => Effect.succeed(holder),
      refreshAccount: () =>
        Effect.sync(() => {
          token = "token-new";
          holder = "two@example.test";
        }),
    });

    assert.equal(
      yield* source.create({ sdpOffer: SDP_OFFER, taskId: TASK_ID, agentId: AGENT_ID }),
      undefined,
    );
    assert.equal(script.opens.length, 1);
    assert.equal(source.diagnostics().lastOutcome, LIVE_SESSION_OUTCOME.NOT_SIGNED_IN);
  }),
);

it.effect(
  "a call into an agent that runs natively is refused with a reason the developer reads, not as a plain HTTP error",
  () =>
    Effect.gen(function* () {
      const script = scriptedOpenSocket([
        answering({ error: HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE }),
      ]);
      const source = hosted(script);

      assert.equal(
        yield* source.create({ sdpOffer: SDP_OFFER, taskId: TASK_ID, agentId: AGENT_ID }),
        undefined,
      );
      assert.equal(hostedVoiceFailure(source.diagnostics()), VOICE_FAILURE.NATIVE_AGENT);
    }),
);
