/**
 * device-warm-sweep.test.ts -- the sweep's retire of a local agent's runner left warm, over a real store and the Mac's machine: a runner warm past its device's window retired under its lease, its retire line and then a stop queued for its Mac; one at work, one a line of the developer's waits for, and one whose lease another call holds left warm; one within the window left warm but on a host waiting to switch release; and a message sent as the window closes reaching a launch whichever goes first, it or the sweep's retire.
 *
 * Synthetic accounts, agents, Macs, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { claimAgentRunnerLease } from "@repo/database/models/agent-runner-lease";
import { beatDevice } from "@repo/database/models/device-store";
import { turns } from "@repo/database/schemas/storage";
import { TOPIC } from "@repo/database/sync/notification";
import { getTestDB } from "@repo/database/testing";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND, HOST_UPDATE } from "@repo/features/device-agent-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { DateTime, Deferred, Duration, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { CODER } from "../agents/coder-host/bounds.js";
import { EVE_SEND_OUTCOME } from "../agents/eve-host/eve-sessions.js";
import { MAC_MACHINE } from "../agents/machine/device-machine.js";
import { clockWatch, Sync, type SyncShape } from "../sync/watch.js";
import { driven, forkClockDriven } from "../testing/clock-driven.js";
import {
  LOCAL_AGENT_ENVIRONMENT,
  launchCarries,
  linesWaiting,
  lineWritten,
  typedMessage,
  type WarmLocalAgent,
  warmLocalAgent,
} from "../testing/local-agent.js";
import { DEVICE_WARM_SWEEP, sweepDeviceWarmRunners } from "./device-warm-sweep.js";

/** The line a retire writes to a warm runner, as its Mac takes it. */
const RETIRE_LINE = '{"type":"retire"}\n';

/** The clock moved by the span given past the agents' turns, every Mac given having beaten since, saying it waits to update where asked. */
const passed = (
  span: Duration.Duration,
  agents: readonly WarmLocalAgent[],
  waiting: readonly WarmLocalAgent[] = [],
) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(Duration.sum(span, Duration.minutes(1)));
    for (const { userId, deviceId } of agents) yield* beatDevice(userId, deviceId);
    for (const { userId, deviceId } of waiting) {
      yield* beatDevice(userId, deviceId, undefined, { update: HOST_UPDATE.WAITING });
    }
  });

/** The clock moved past the device's warm window, which outlasts the sweep's grace. */
const pastWindow = (agents: readonly WarmLocalAgent[]) =>
  passed(Duration.max(CODER.RUNNER_WARM[AGENT_MACHINE.DEVICE], DEVICE_WARM_SWEEP.GRACE), agents);

/** One sweep at the clock's reading, driven to its end through each wait on a runner's exit. */
const swept = Effect.gen(function* () {
  const now = yield* DateTime.nowAsDate;
  return yield* driven(yield* forkClockDriven(sweepDeviceWarmRunners(now)), MAC_MACHINE.POLL);
});

/**
 * The clock's own watches, signalling once a wait opens one on the
 * account's topic, as a read of its agent's runner's exit does
 * (`device-machine.ts`'s `runnerExit`): the retire then holds the agent's
 * lease and has read that its runner took nothing since its turn ended.
 */
const signalledOn = (userId: string, opened: Deferred.Deferred<void>): SyncShape => ({
  watch: (topics, fallback) =>
    Effect.as(
      topics.some(([kind, id]) => kind === TOPIC.ACCOUNT && id === userId)
        ? Deferred.succeed(opened, undefined)
        : Effect.void,
      clockWatch(fallback),
    ),
});

it.layer(Layer.mergeAll(getTestDB(), LOCAL_AGENT_ENVIRONMENT, noNetwork))(
  "the sweep of warm local runners",
  (it) => {
    it.effect(
      "a runner warm past its device's window is retired under its lease, its retire line then a stop queued for its Mac, while one at work, one a line of the developer's waits for, and one whose lease another call holds are left warm",
      () =>
        Effect.gen(function* () {
          const retired = yield* warmLocalAgent;
          const atWork = yield* warmLocalAgent;
          const awaited = yield* warmLocalAgent;
          const held = yield* warmLocalAgent;
          yield* pastWindow([retired, atWork, awaited, held]);
          const db = yield* Database;
          const now = yield* DateTime.nowAsDate;
          // The runner took a message into a turn still under way.
          yield* db.insert(turns).values({
            userId: atWork.userId,
            conversationId: atWork.agent.conversationId,
            origin: TURN_ORIGIN.TYPED,
            status: TURN_STATUS.RUNNING,
            queuedAt: now,
          });
          yield* lineWritten(awaited, "Now the emails.");
          // Another call holds the agent's runner lease, as a send relaunching it does.
          const holder = randomUUID();
          const until = new Date(now.getTime() + Duration.toMillis(Duration.minutes(5)));
          assert.ok(yield* claimAgentRunnerLease(held.agent.id, holder, now, until));

          const outcome = yield* swept;

          assert.equal(outcome.busy, 1, "the held agent is passed by, not waited on");
          assert.deepEqual(yield* linesWaiting(retired), [
            RETIRE_LINE,
            DEVICE_AGENT_LINE_KIND.STOP,
          ]);
          for (const left of [atWork, awaited, held]) {
            assert.deepEqual(yield* linesWaiting(left), [], "nothing would end a runner left warm");
          }
        }),
    );

    it.effect(
      "a runner within its device's window is left warm past the sweep's grace, but retired on a host waiting to switch release",
      () =>
        Effect.gen(function* () {
          const kept = yield* warmLocalAgent;
          const updating = yield* warmLocalAgent;
          yield* passed(DEVICE_WARM_SWEEP.GRACE, [kept], [updating]);

          yield* swept;

          assert.deepEqual(yield* linesWaiting(kept), []);
          assert.deepEqual(yield* linesWaiting(updating), [
            RETIRE_LINE,
            DEVICE_AGENT_LINE_KIND.STOP,
          ]);
        }),
    );

    it.effect(
      "a message sent past the window before any sweep ends the runner and relaunches with it, and the sweep that follows leaves the new launch be",
      () =>
        Effect.gen(function* () {
          const late = yield* warmLocalAgent;
          yield* pastWindow([late]);

          yield* lineWritten(late, "Now the emails.");
          const sent = yield* late.sessions.send(
            late.sessionId,
            typedMessage(late.agent, "Now the emails."),
          );
          yield* swept;

          assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
          // The runner that may end itself at its idle cap is written nothing but its end.
          assert.deepEqual(yield* linesWaiting(late), [
            DEVICE_AGENT_LINE_KIND.STOP,
            DEVICE_AGENT_LINE_KIND.LAUNCH,
          ]);
          assert.ok(
            yield* launchCarries(late, "Now the emails."),
            "the new launch's first lines carry the message",
          );
        }),
    );

    it.effect(
      "a message sent once the sweep's retire read the runner idle waits on its lease, and relaunches with the message as the new launch's first line rather than writing it behind the retire",
      () =>
        Effect.gen(function* () {
          const raced = yield* warmLocalAgent;
          yield* pastWindow([raced]);
          const reading = yield* Deferred.make<void>();
          const now = yield* DateTime.nowAsDate;
          const sweep = yield* forkClockDriven(
            sweepDeviceWarmRunners(now).pipe(
              Effect.provideService(Sync, signalledOn(raced.userId, reading)),
            ),
          );
          yield* Effect.raceFirst(Deferred.await(reading), driven(sweep, MAC_MACHINE.POLL));
          assert.ok(yield* Deferred.isDone(reading), "the sweep's retire reached the runner");

          yield* lineWritten(raced, "And the tests.");
          const send = yield* forkClockDriven(
            raced.sessions.send(raced.sessionId, typedMessage(raced.agent, "And the tests.")),
          );
          yield* driven(sweep, MAC_MACHINE.POLL);
          const sent = yield* driven(send, MAC_MACHINE.POLL);

          assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
          assert.deepEqual(yield* linesWaiting(raced), [
            RETIRE_LINE,
            DEVICE_AGENT_LINE_KIND.STOP,
            DEVICE_AGENT_LINE_KIND.LAUNCH,
          ]);
          assert.ok(
            yield* launchCarries(raced, "And the tests."),
            "the new launch's first lines carry the message",
          );
        }),
    );
  },
);
