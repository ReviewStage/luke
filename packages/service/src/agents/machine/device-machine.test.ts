/**
 * device-machine.test.ts -- a local agent's machine over a real dialect: its launch's secrets sealed in the row and handed over open once, a read that waits for its Mac's answer or is unavailable while the Mac is away, and a turn whose runner the Mac settled as gone settled lost.
 *
 * Synthetic accounts, agents, Macs, bearers, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent, latestTurnsOfReached } from "@luke/database/models/coding-agent-store";
import {
  answerDeviceAgentRequest,
  claimDeviceAgentRequest,
  deviceAgentRequestsWaiting,
} from "@luke/database/models/device-agent-store";
import { registerDevice } from "@luke/database/models/device-store";
import { removeHost } from "@luke/database/models/host-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { device } from "@luke/database/schemas/device";
import { deviceAgentLine } from "@luke/database/schemas/device-agent";
import { conversations } from "@luke/database/schemas/storage";
import { DEVICE_LAYOUT, getTestDB, startTask } from "@luke/database/testing";
import { BRAIN_REQUEST_FAILURE } from "@luke/features/brain";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import {
  DEVICE_AGENT_REQUEST_KIND,
  DEVICE_KIND,
  DEVICE_LAUNCH_REFUSAL,
  deviceAgentLayout,
} from "@luke/features/device-agent-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { ranDirectlyFolderOf } from "../coder-host/status.js";
import { claimedDeviceAgentLine, settledDeviceAgentLine } from "../device-agent.js";
import { SandboxUnavailable } from "../vercel-sandbox-api.js";
import { LaunchRefused } from "./agent-machine.js";
import { deviceMachine } from "./device-machine.js";

const RING = `1:${Buffer.alloc(32, 7).toString("base64")}`;
const BEARER = "fixture-runner-bearer-0123456789";
const PLAN_TOKEN = "sk-ant-oat01-fixture-plan-token";
const FIRST_LINES = '{"harness":"claude_code"}\n{"type":"message"}\n';
const ENV = { CLAUDE_CODE_OAUTH_TOKEN: PLAN_TOKEN, LUKE_RUNNER_BEARER: BEARER };

const ENVIRONMENT: HostedEnvironmentValues = {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(RING),
};

/** An account with a Mac that just registered, and an agent pinned to it whose conversation runs in a session. */
const openLocalAgent = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  const deviceId = randomUUID();
  yield* registerDevice(userId, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    machine: CODING_AGENT_MACHINE.DEVICE,
    deviceId,
  });
  const { agent } = Option.getOrThrow(started);
  const session = `cc-${randomUUID()}`;
  yield* db
    .update(conversations)
    .set({ runtimeSessionId: session })
    .where(eq(conversations.id, agent.conversationId));
  return { userId, deviceId, agent, session };
});

/** The runner launched in the agent's place, found by its session as a relaunch finds it. */
const launched = (opened: Effect.Success<typeof openLocalAgent>) =>
  Effect.gen(function* () {
    const machine = yield* deviceMachine;
    const [found] = yield* machine.findPlaces(opened.session);
    assert.ok(found?.running !== undefined, "a local agent's place always stands");
    return yield* machine.launchRunner(found.running, {
      env: ENV,
      agentId: opened.agent.id,
      name: found.name,
      ready: Effect.void,
      firstLines: () => Effect.succeed({ lines: FIRST_LINES, mark: { firstSequence: 4 } }),
      abandon: () => Effect.void,
    });
  });

/** Lets a forked read's statements run until its request waits for the Mac. */
const untilAsked = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    while ((yield* deviceAgentRequestsWaiting(userId, deviceId)).length === 0)
      yield* Effect.yieldNow;
    const [request] = yield* deviceAgentRequestsWaiting(userId, deviceId);
    return Option.getOrThrow(Option.fromNullishOr(request));
  });

it.layer(Layer.merge(getTestDB(), Layer.succeed(HostedEnvironment, ENVIRONMENT)))(
  "a local agent's machine",
  (it) => {
    it.effect(
      "an agent on a host its account removed is refused by name, and one on a Mac with no layout as before",
      () =>
        Effect.gen(function* () {
          const { userId, deviceId, agent } = yield* openLocalAgent;
          const db = yield* Database;
          // The Mac the agent is pinned to is made a host and removed, as Settings › Hosts removes one.
          yield* db.update(device).set({ kind: DEVICE_KIND.HOST }).where(eq(device.id, deviceId));
          const machine = yield* deviceMachine;
          const unregistered = yield* Effect.flip(
            machine.layout({ ...agent, deviceId: randomUUID() }),
          );
          assert.equal(yield* removeHost(userId, deviceId), true);

          const refused = yield* Effect.flip(machine.layout(agent));

          assert.ok(refused instanceof LaunchRefused);
          assert.equal(refused.deviceRemoved, true);
          assert.ok(unregistered instanceof LaunchRefused);
          assert.equal(
            unregistered.deviceRemoved,
            undefined,
            "a device never removed is no removed host",
          );
        }),
    );

    it.effect("a launch's secrets are sealed in its line and handed over open once", () =>
      Effect.gen(function* () {
        const opened = yield* openLocalAgent;
        const { handle } = yield* launched(opened);
        const db = yield* Database;
        const [row] = yield* db
          .select({ sealed: deviceAgentLine.sealedSecrets, payload: deviceAgentLine.payload })
          .from(deviceAgentLine)
          .where(eq(deviceAgentLine.id, handle.command));
        const stored = JSON.stringify(row);

        const first = yield* claimedDeviceAgentLine(opened.userId, opened.deviceId, handle.command);
        const second = yield* claimedDeviceAgentLine(
          opened.userId,
          opened.deviceId,
          handle.command,
        );
        const [after] = yield* db
          .select({ sealed: deviceAgentLine.sealedSecrets })
          .from(deviceAgentLine)
          .where(eq(deviceAgentLine.id, handle.command));

        assert.notEqual(row?.sealed ?? null, null, "the line carries its secrets sealed");
        for (const secret of [BEARER, PLAN_TOKEN, Buffer.from(BEARER).toString("base64")]) {
          assert.ok(!stored.includes(secret), "no secret stands in the row in the clear");
        }
        assert.deepEqual(
          Option.map(first, (claimed) => ("secrets" in claimed ? claimed.secrets : undefined)),
          Option.some({ env: ENV, stdin: FIRST_LINES }),
        );
        assert.ok(Option.isNone(second), "a line is claimed once");
        assert.equal(after?.sealed, null, "the claim clears the row's copy");
      }),
    );

    it.effect("a read waits for its Mac's answer, and is unavailable while the Mac is away", () =>
      Effect.gen(function* () {
        const { userId, deviceId, session } = yield* openLocalAgent;
        const machine = yield* deviceMachine;
        const bytes = new Uint8Array([137, 80, 78, 71]);

        const reading = yield* Effect.forkChild(machine.readFile(session, "/tmp/shot.png", 1_024));
        const request = yield* untilAsked(userId, deviceId);
        yield* claimDeviceAgentRequest(userId, deviceId, request.id);
        yield* answerDeviceAgentRequest(userId, deviceId, request.id, {
          kind: DEVICE_AGENT_REQUEST_KIND.READ_FILE,
          bytes,
        });
        yield* TestClock.adjust("1 second");
        const answered = yield* Fiber.join(reading);

        yield* TestClock.adjust("1 minute");
        const away = yield* Effect.flip(machine.readFile(session, "/tmp/shot.png", 1_024));

        assert.deepEqual(answered, bytes);
        assert.ok(
          away instanceof SandboxUnavailable,
          "a Mac silent past its presence window is away",
        );
        assert.deepEqual(
          yield* deviceAgentRequestsWaiting(userId, deviceId),
          [],
          "nothing was asked of it",
        );
      }),
    );

    it.effect(
      "a turn under way is settled lost once its Mac settles the newest launch, and only then",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent;
          const { userId, deviceId, agent } = opened;
          const older = yield* launched(opened);
          const newer = yield* launched(opened);
          yield* claimedDeviceAgentLine(userId, deviceId, older.handle.command);
          yield* claimedDeviceAgentLine(userId, deviceId, newer.handle.command);
          const writer = yield* storeWriter({ tools: {} });
          const turnId = randomUUID();
          yield* writer.enqueueTurn(
            { userId, conversationId: agent.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );
          const statusNow = Effect.map(
            latestTurnsOfReached([agent.conversationId]),
            (turns) => turns.get(agent.conversationId)?.status,
          );

          yield* settledDeviceAgentLine(userId, deviceId, older.handle.command);
          const afterOlder = yield* statusNow;
          yield* settledDeviceAgentLine(userId, deviceId, newer.handle.command);
          const askedAgain = yield* settledDeviceAgentLine(userId, deviceId, newer.handle.command);

          assert.equal(askedAgain, true, "a settle the Mac asks again is answered as settled");
          assert.equal(
            afterOlder,
            TURN_STATUS.QUEUED,
            "a launch a newer one replaced settles nothing",
          );
          assert.equal(yield* statusNow, TURN_STATUS.FAILED);
        }),
    );

    it.effect(
      "a launch its Mac settled unstarted because the agent ran directly on it settles the turn as a session that ended, naming the folder its work is still in",
      () =>
        Effect.gen(function* () {
          const opened = yield* openLocalAgent;
          const { userId, deviceId, agent } = opened;
          const launch = yield* launched(opened);
          yield* claimedDeviceAgentLine(userId, deviceId, launch.handle.command);
          const writer = yield* storeWriter({ tools: {} });
          const turnId = randomUUID();
          yield* writer.enqueueTurn(
            { userId, conversationId: agent.conversationId },
            { turnId, eveTurnId: turnId, origin: TURN_ORIGIN.TYPED },
          );

          yield* settledDeviceAgentLine(
            userId,
            deviceId,
            launch.handle.command,
            1,
            DEVICE_LAUNCH_REFUSAL.RAN_DIRECTLY,
          );
          const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(
            agent.conversationId,
          );

          assert.equal(turn?.status, TURN_STATUS.FAILED);
          assert.equal(turn?.failure, BRAIN_REQUEST_FAILURE.SESSION_ENDED);
          assert.equal(
            ranDirectlyFolderOf(turn),
            deviceAgentLayout(DEVICE_LAYOUT.home, agent.id).checkoutPath,
          );
        }),
    );
  },
);
