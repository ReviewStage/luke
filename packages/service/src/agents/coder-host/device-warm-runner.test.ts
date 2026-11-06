import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { latestTurnsOf } from "@repo/database/models/agent-store";
import {
  deviceAgentLinesWaiting,
  latestDeviceAgentLaunch,
} from "@repo/database/models/device-agent-store";
import { beatDevice } from "@repo/database/models/device-store";
import { turns } from "@repo/database/schemas/storage";
import { getTestDB } from "@repo/database/testing";
import { DEVICE_AGENT_LINE_KIND, HOST_UPDATE } from "@repo/features/device-agent-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { driven, forkClockDriven } from "../../testing/clock-driven.js";
import {
  LOCAL_AGENT_ENVIRONMENT,
  launchCarries,
  linesWaiting,
  localAgentSessions,
  typedMessage,
  type WarmLocalAgent,
  warmLocalAgent,
} from "../../testing/local-agent.js";
import { claimedDeviceAgentLine, settledDeviceAgentLine } from "../device-agent.js";
import { EVE_CANCEL_OUTCOME, EVE_SEND_OUTCOME } from "../eve-host/eve-sessions.js";
import { MAC_MACHINE } from "../machine/device-machine.js";
import { runnerIdled } from "./runner-sessions.js";

const RETIRE_LINE = '{"type":"retire"}\n';

const idled = (warm: WarmLocalAgent) =>
  Effect.gen(function* () {
    const idle = runnerIdled({
      target: { userId: warm.userId, conversationId: warm.agent.conversationId },
      sessionId: warm.sessionId,
      sequence: 3,
    });
    return yield* driven(yield* forkClockDriven(idle), MAC_MACHINE.POLL);
  });

const stopped = (warm: WarmLocalAgent, turnId: string) =>
  Effect.gen(function* () {
    const cancel = Effect.flatMap(localAgentSessions(warm.userId), (sessions) =>
      sessions.cancel(warm.sessionId, turnId),
    );
    return yield* driven(yield* forkClockDriven(cancel), MAC_MACHINE.POLL);
  });

it.layer(Layer.mergeAll(getTestDB(), LOCAL_AGENT_ENVIRONMENT, noNetwork))(
  "a local agent's warm runner",
  (it) => {
    it.effect(
      "its IDLE leaves the runner warm and the next message is written to the running launch with no launch line, while a host waiting to switch release has its runner retired at its IDLE",
      () =>
        Effect.gen(function* () {
          const kept = yield* warmLocalAgent;
          const updating = yield* warmLocalAgent;
          yield* beatDevice(updating.userId, updating.deviceId, {
            update: HOST_UPDATE.WAITING,
          });

          const keptRetired = yield* idled(kept);
          const updatingRetired = yield* idled(updating);
          const sent = yield* kept.sessions.send(
            kept.sessionId,
            typedMessage(kept.agent, "Now the emails."),
          );

          assert.deepEqual([keptRetired, updatingRetired], [false, true]);
          assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
          const lines = yield* linesWaiting(kept);
          assert.equal(lines.length, 1, "one message line, to the launch its Start made");
          assert.ok(lines[0]?.includes("Now the emails."));
          assert.deepEqual(yield* linesWaiting(updating), [
            RETIRE_LINE,
            DEVICE_AGENT_LINE_KIND.STOP,
          ]);
        }),
    );

    it.effect(
      "a Stop with no turn under way writes nothing and leaves the runner warm for the next message",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;

          const canceled = yield* stopped(warm, warm.turnId);
          yield* warm.sessions.send(warm.sessionId, typedMessage(warm.agent, "Now the emails."));

          assert.equal(canceled.outcome, EVE_CANCEL_OUTCOME.NO_ACTIVE_TURN);
          const lines = yield* linesWaiting(warm);
          assert.equal(lines.length, 1, "the message alone, to the running launch");
          assert.ok(lines[0]?.includes("Now the emails."));
        }),
    );

    it.effect(
      "a Stop that lands as the runner's turn ends, then a message, relaunches with the message rather than writing it to the runner the Stop ends",
      () =>
        Effect.gen(function* () {
          const db = yield* Database;
          const warm = yield* warmLocalAgent;
          const { userId, deviceId } = warm;
          yield* TestClock.adjust("1 second");
          const [ending] = yield* db
            .insert(turns)
            .values({
              userId,
              conversationId: warm.agent.conversationId,
              origin: TURN_ORIGIN.TYPED,
              status: TURN_STATUS.RUNNING,
              queuedAt: yield* DateTime.nowAsDate,
            })
            .returning({ id: turns.id });
          assert.ok(ending !== undefined);

          const canceled = yield* stopped(warm, ending.id);
          const [stop] = yield* deviceAgentLinesWaiting(userId, deviceId);
          assert.ok(stop !== undefined);
          yield* claimedDeviceAgentLine(userId, deviceId, stop.id);
          yield* settledDeviceAgentLine(userId, deviceId, stop.id);
          yield* db
            .update(turns)
            .set({ status: TURN_STATUS.SETTLED, settledAt: yield* DateTime.nowAsDate })
            .where(eq(turns.id, ending.id));
          const sent = yield* warm.sessions.send(
            warm.sessionId,
            typedMessage(warm.agent, "And the tests."),
          );

          assert.equal(canceled.outcome, EVE_CANCEL_OUTCOME.ACCEPTED);
          assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
          assert.deepEqual(yield* linesWaiting(warm), [
            DEVICE_AGENT_LINE_KIND.STOP,
            DEVICE_AGENT_LINE_KIND.LAUNCH,
          ]);
          assert.ok(
            yield* launchCarries(warm, "And the tests."),
            "the new launch's first lines carry the message",
          );
        }),
    );

    it.effect(
      "a runner that ends on its own past its turn, its launch settled by its Mac, leaves the agent as that turn ended",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, deviceId, agent } = warm;
          const launch = yield* latestDeviceAgentLaunch(userId, agent.id);
          assert.ok(Option.isSome(launch));
          yield* TestClock.adjust("1 minute");

          yield* settledDeviceAgentLine(userId, deviceId, launch.value.id, 0);

          const newest = (yield* latestTurnsOf(userId, [agent.conversationId])).get(
            agent.conversationId,
          );
          assert.equal(newest?.id, warm.turnId);
          assert.equal(newest?.status, TURN_STATUS.SETTLED);
        }),
    );
  },
);
