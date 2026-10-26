/**
 * mac-machine.test.ts -- a local agent's machine over a real dialect: its launch's secrets sealed in the row and handed over open once, a read that waits for its Mac's answer or is unavailable while the Mac is away, and a turn whose runner the Mac settled as gone settled lost.
 *
 * Synthetic accounts, agents, Macs, bearers, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent, latestTurnsOfReached } from "@luke/database/models/coding-agent-store";
import {
  answerMacAgentRequest,
  claimMacAgentRequest,
  macAgentRequestsWaiting,
} from "@luke/database/models/mac-agent-store";
import { registerMacDevice } from "@luke/database/models/mac-device-store";
import { storeWriter } from "@luke/database/models/writer";
import { user } from "@luke/database/schemas/auth";
import { macAgentLine } from "@luke/database/schemas/mac-agent";
import { conversations } from "@luke/database/schemas/storage";
import { getTestDB, MAC_DEVICE_LAYOUT, startTask } from "@luke/database/testing";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { MAC_AGENT_REQUEST_KIND } from "@luke/features/mac-agent-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { eq } from "drizzle-orm";
import { Effect, Fiber, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HostedEnvironment, type HostedEnvironmentValues } from "../../environment.js";
import { claimedMacAgentLine, settledMacAgentLine } from "../mac-agent.js";
import { SandboxUnavailable } from "../vercel-sandbox-api.js";
import { macMachine } from "./mac-machine.js";

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
  yield* registerMacDevice(userId, { id: deviceId, name: "Studio", ...MAC_DEVICE_LAYOUT });
  const task = yield* startTask(userId, { name: "Invitations" });
  const started = yield* createCodingAgent(userId, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    planSnapshot: "# Invitations\n",
    prompt: null,
    repository: null,
    machine: CODING_AGENT_MACHINE.MAC,
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
    const machine = yield* macMachine;
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
    while ((yield* macAgentRequestsWaiting(userId, deviceId)).length === 0) yield* Effect.yieldNow;
    const [request] = yield* macAgentRequestsWaiting(userId, deviceId);
    return Option.getOrThrow(Option.fromNullishOr(request));
  });

it.layer(Layer.merge(getTestDB(), Layer.succeed(HostedEnvironment, ENVIRONMENT)))(
  "a local agent's machine",
  (it) => {
    it.effect("a launch's secrets are sealed in its line and handed over open once", () =>
      Effect.gen(function* () {
        const opened = yield* openLocalAgent;
        const { handle } = yield* launched(opened);
        const db = yield* Database;
        const [row] = yield* db
          .select({ sealed: macAgentLine.sealedSecrets, payload: macAgentLine.payload })
          .from(macAgentLine)
          .where(eq(macAgentLine.id, handle.command));
        const stored = JSON.stringify(row);

        const first = yield* claimedMacAgentLine(opened.userId, opened.deviceId, handle.command);
        const second = yield* claimedMacAgentLine(opened.userId, opened.deviceId, handle.command);
        const [after] = yield* db
          .select({ sealed: macAgentLine.sealedSecrets })
          .from(macAgentLine)
          .where(eq(macAgentLine.id, handle.command));

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
        const machine = yield* macMachine;
        const bytes = new Uint8Array([137, 80, 78, 71]);

        const reading = yield* Effect.forkChild(machine.readFile(session, "/tmp/shot.png", 1_024));
        const request = yield* untilAsked(userId, deviceId);
        yield* claimMacAgentRequest(userId, deviceId, request.id);
        yield* answerMacAgentRequest(userId, deviceId, request.id, {
          kind: MAC_AGENT_REQUEST_KIND.READ_FILE,
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
          yield* macAgentRequestsWaiting(userId, deviceId),
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
          yield* claimedMacAgentLine(userId, deviceId, older.handle.command);
          yield* claimedMacAgentLine(userId, deviceId, newer.handle.command);
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

          yield* settledMacAgentLine(userId, deviceId, older.handle.command);
          const afterOlder = yield* statusNow;
          yield* settledMacAgentLine(userId, deviceId, newer.handle.command);
          const askedAgain = yield* settledMacAgentLine(userId, deviceId, newer.handle.command);

          assert.equal(askedAgain, true, "a settle the Mac asks again is answered as settled");
          assert.equal(
            afterOlder,
            TURN_STATUS.QUEUED,
            "a launch a newer one replaced settles nothing",
          );
          assert.equal(yield* statusNow, TURN_STATUS.FAILED);
        }),
    );
  },
);
