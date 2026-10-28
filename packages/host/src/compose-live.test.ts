import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { VOICE_SERVICE_FRAME } from "@luke/features";
import { GATEWAY_CLIENT_ROLE, GATEWAY_METHOD, type GatewayMethod } from "@luke/gateway";
import { HostedLiveSessionSource } from "@luke/voice";
import { type FakeLiveSocket, scriptedOpenSocket } from "@luke/voice/testing";
import type { WireRecord } from "@luke/wire";
import { Effect, Fiber } from "effect";
import { composeLive } from "./compose-live.js";
import { HostKernelTag } from "./effect/kernel.js";
import { hostKernelOver } from "./host-kernel.js";
import { runModeFor } from "./run-mode.js";

/**
 * The live composer over the hosted source and its scripted socket: which
 * offers open a call, and the agent and task the service is told it is about.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
/** An agent on the open task, one on another task, and that other task. */
const AGENT_ID = "0b5f8c1e-4d3a-4e6b-8f2c-9a1d7e3b5c40";
const OTHER_TASK = "3c9e2a7d-5b1f-4e8c-a6d2-8f4b1e7c3a50";
const OTHER_TASK_AGENT = "6e2a9d4b-1c7f-4a8e-b3d5-2f9c8e1a7b60";
/** An agent an automation started with no task, whose call is keyed by the agent alone. */
const TASKLESS_AGENT = "5e2c9a7d-1b3f-4c8e-a6d0-3f7b2e9c1a58";
const SDP_OFFER =
  "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const SDP_ANSWER =
  "v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

function subject() {
  return Effect.gen(function* () {
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
    const kernel = hostKernelOver({
      stateRoot: "/nowhere",
      runMode: runModeFor({ capture: false, fixture: false }),
      accountBaseUrl: "https://account.example.test",
      now: () => 0,
      createId: () => "id",
      report: () => undefined,
      emit: () => undefined,
    });
    const live = yield* Effect.provideService(
      composeLive({
        settings: { recordProductEvent: () => undefined },
        account: { agentTrace: undefined, voiceCapabilities: { liveSessions: source } },
        // Each agent on its own task, the taskless one on none, and any other archived, out of reach, or on another harness.
        callTaskOf: (agentId) =>
          Effect.succeed(
            agentId === AGENT_ID
              ? TASK_ID
              : agentId === OTHER_TASK_AGENT
                ? OTHER_TASK
                : agentId === TASKLESS_AGENT
                  ? null
                  : undefined,
          ),
        showTaskActivity: () => undefined,
        taskCallEnded: () => undefined,
      }),
      HostKernelTag,
      kernel,
    );
    const call = (method: GatewayMethod, params: WireRecord = {}) =>
      Effect.gen(function* () {
        const handler = live.methods[method];
        assert.ok(handler, `no handler for ${method}`);
        const answer = yield* Effect.orDie(handler(params, context));
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
        call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, {
          sdp: SDP_OFFER,
          taskId: TASK_ID,
          agentId: AGENT_ID,
        }),
      );
      const created = yield* Fiber.join(fiber);
      assert.ok(created);
      const socket = script.sockets.at(-1);
      assert.ok(socket);
      return socket;
    });
    return { call, refusal, openCall, sockets: script.sockets };
  });
}

it.effect(
  "an offer naming a task its agent is not on, or an agent no call goes into, is refused and opens no session; one into an agent on its task names both to the service",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const refused = [
        { taskId: TASK_ID, agentId: OTHER_TASK_AGENT },
        { taskId: TASK_ID, agentId: "archived-agent" },
        { taskId: TASK_ID, agentId: TASKLESS_AGENT },
        { agentId: AGENT_ID },
        { agentId: "archived-agent" },
      ];
      for (const about of refused) {
        const refusal = yield* f.refusal(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, {
          sdp: SDP_OFFER,
          ...about,
        });
        assert.equal(refusal._tag, "RefusedRefusal");
      }
      assert.equal(f.sockets.length, 0);

      const socket = yield* f.openCall;
      const create = socket.sent
        .map((data) => JSON.parse(data))
        .find((frame) => frame.type === VOICE_SERVICE_FRAME.SESSION_CREATE);
      assert.equal(create?.planId, TASK_ID);
      assert.equal(create?.agentId, AGENT_ID);
    }),
);

it.effect(
  "an offer into an agent with no task, naming none, opens its call whatever task is open, and names no task to the service",
  () =>
    Effect.gen(function* () {
      const f = yield* subject();
      const created = yield* f.call(GATEWAY_METHOD.VOICE_CREATE_LIVE_SESSION, {
        sdp: SDP_OFFER,
        agentId: TASKLESS_AGENT,
      });
      assert.ok(created);
      const create = f.sockets
        .at(-1)
        ?.sent.map((data) => JSON.parse(data))
        .find((frame) => frame.type === VOICE_SERVICE_FRAME.SESSION_CREATE);
      assert.equal(create?.agentId, TASKLESS_AGENT);
      assert.equal("planId" in create, false);
    }),
);
