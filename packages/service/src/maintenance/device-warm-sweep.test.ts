/**
 * device-warm-sweep.test.ts -- the sweep's retire of a local agent's runner left warm, over a real store and the Mac's machine: a runner warm past the grace retired under its lease, its retire line and then a stop queued for its Mac; one at work, one a line of the developer's waits for, and one whose lease another call holds left warm; and a message sent as the sweep retires never written behind the retire, whichever goes first.
 *
 * Synthetic accounts, agents, Macs, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { claimAgentRunnerLease } from "@luke/database/models/agent-runner-lease";
import type { Agent } from "@luke/database/models/agent-store";
import { deviceAgentLinesWaiting } from "@luke/database/models/device-agent-store";
import { beatDevice } from "@luke/database/models/device-store";
import { conversations, messages, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { TOPIC } from "@luke/database/sync/notification";
import { getTestDB } from "@luke/database/testing";
import { DEVICE_AGENT_LINE_KIND } from "@luke/features/device-agent-wire";
import { MESSAGE_ROLE, TURN_ORIGIN, TURN_STATUS } from "@luke/wire";
import { noNetwork } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { DateTime, Deferred, Duration, Effect, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { claimedDeviceAgentLine } from "../agents/device-agent.js";
import { EVE_SEND_OUTCOME } from "../agents/eve-host/eve-sessions.js";
import { MAC_MACHINE } from "../agents/machine/device-machine.js";
import { HostedEnvironment } from "../environment.js";
import { clockWatch, Sync, type SyncShape } from "../sync/watch.js";
import { driven, forkClockDriven } from "../testing/clock-driven.js";
import { localAgentSessions, openLocalAgent } from "../testing/local-agent.js";
import { DEVICE_WARM_SWEEP, sweepDeviceWarmRunners } from "./device-warm-sweep.js";

/** The line a retire writes to a warm runner, as its Mac takes it. */
const RETIRE_LINE = '{"type":"retire"}\n';

/** The developer's message as the store hands it to the agent's sessions. */
const message = (agent: Agent, text: string) => ({
  conversationId: agent.conversationId,
  turn: "typed" as const,
  message: text,
});

/**
 * A local agent on its Mac's own login whose Start launched its runner,
 * which its Mac took, and whose first turn then settled, as its IDLE's
 * batch writes it: the agent, its sessions, and the session its Start
 * claimed.
 */
const warmAgent = Effect.gen(function* () {
  const db = yield* Database;
  const opened = yield* openLocalAgent({
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    onMacLogin: true,
  });
  const { userId, deviceId, agent } = opened;
  const sessions = yield* localAgentSessions(userId);
  const started = yield* sessions.open(message(agent, "Fix the invitations."));
  assert.ok(started.outcome === EVE_SEND_OUTCOME.ACCEPTED);
  const { sessionId } = started;
  // The agent's record names the session, as its Start claims it.
  yield* db
    .update(conversations)
    .set({ runtimeSessionId: sessionId })
    .where(eq(conversations.id, agent.conversationId));
  const [launch] = yield* deviceAgentLinesWaiting(userId, deviceId);
  assert.equal(launch?.kind, DEVICE_AGENT_LINE_KIND.LAUNCH);
  yield* claimedDeviceAgentLine(userId, deviceId, launch.id);
  const settledAt = yield* DateTime.nowAsDate;
  yield* db.insert(turns).values({
    userId,
    conversationId: agent.conversationId,
    origin: TURN_ORIGIN.TYPED,
    status: TURN_STATUS.SETTLED,
    queuedAt: settledAt,
    settledAt,
  });
  return { ...opened, sessions, sessionId };
});

type WarmAgent = Effect.Success<typeof warmAgent>;

/** The clock moved past the sweep's grace, every Mac given having beaten since. */
const pastGrace = (agents: readonly WarmAgent[]) =>
  Effect.gen(function* () {
    yield* TestClock.adjust(Duration.sum(DEVICE_WARM_SWEEP.GRACE, Duration.minutes(1)));
    for (const { userId, deviceId } of agents) yield* beatDevice(userId, deviceId);
  });

/** A line of the developer's that no turn took yet, written as the store writes it before it hands the line to the agent's sessions. */
const lineWritten = (warm: WarmAgent, text: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;
    yield* db.insert(messages).values({
      id: randomUUID(),
      userId: warm.userId,
      conversationId: warm.agent.conversationId,
      seq: 1,
      clientId: randomUUID(),
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text }],
      createdAt: now,
      placedAt: now,
    });
  });

/** What the agent's Mac has yet to take, line by line: a message line by the text it carries, any other by its kind. */
const waitingFor = (warm: WarmAgent) =>
  Effect.map(deviceAgentLinesWaiting(warm.userId, warm.deviceId), (lines) =>
    lines.map((line) =>
      line.kind === DEVICE_AGENT_LINE_KIND.MESSAGE ? String(line.payload.text) : line.kind,
    ),
  );

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

const ENVIRONMENT = Layer.succeed(HostedEnvironment, {
  posthogPersonalApiKey: undefined,
  posthogProjectId: undefined,
  posthogApiHost: undefined,
  posthogProjectApiKey: undefined,
  posthogIngestHost: undefined,
  cronSecret: undefined,
  eveDeploymentSecret: undefined,
  githubWebhookSecret: undefined,
  providerKeyEncryptionKeys: Redacted.make(`1:${Buffer.alloc(32, 5).toString("base64")}`),
});

it.layer(Layer.mergeAll(getTestDB(), ENVIRONMENT, noNetwork))(
  "the sweep of warm local runners",
  (it) => {
    it.effect(
      "a runner warm past the grace is retired under its lease, its retire line then a stop queued for its Mac, while one at work, one a line of the developer's waits for, and one whose lease another call holds are left warm",
      () =>
        Effect.gen(function* () {
          const retired = yield* warmAgent;
          const atWork = yield* warmAgent;
          const awaited = yield* warmAgent;
          const held = yield* warmAgent;
          yield* pastGrace([retired, atWork, awaited, held]);
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
          assert.deepEqual(yield* waitingFor(retired), [RETIRE_LINE, DEVICE_AGENT_LINE_KIND.STOP]);
          for (const left of [atWork, awaited, held]) {
            assert.deepEqual(yield* waitingFor(left), [], "nothing would end a runner left warm");
          }
        }),
    );

    it.effect(
      "a message whose line was written before the sweep's retire reads the runner keeps the runner, which it reaches, and nothing ends it",
      () =>
        Effect.gen(function* () {
          const kept = yield* warmAgent;
          yield* pastGrace([kept]);

          yield* lineWritten(kept, "Now the emails.");
          yield* swept;
          const sent = yield* kept.sessions.send(
            kept.sessionId,
            message(kept.agent, "Now the emails."),
          );

          assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
          const lines = yield* waitingFor(kept);
          assert.equal(lines.length, 1, "the message alone, to the runner its Start launched");
          assert.ok(lines[0]?.includes("Now the emails."));
          assert.ok(!lines[0]?.includes(RETIRE_LINE.trim()));
        }),
    );

    it.effect(
      "a message sent once the sweep's retire read the runner idle waits on its lease, and relaunches with the message as the new launch's first line rather than writing it behind the retire",
      () =>
        Effect.gen(function* () {
          const raced = yield* warmAgent;
          yield* pastGrace([raced]);
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
            raced.sessions.send(raced.sessionId, message(raced.agent, "And the tests.")),
          );
          yield* driven(sweep, MAC_MACHINE.POLL);
          const sent = yield* driven(send, MAC_MACHINE.POLL);

          assert.equal(sent.outcome, EVE_SEND_OUTCOME.ACCEPTED);
          const lines = yield* waitingFor(raced);
          assert.deepEqual(lines, [
            RETIRE_LINE,
            DEVICE_AGENT_LINE_KIND.STOP,
            DEVICE_AGENT_LINE_KIND.LAUNCH,
          ]);
          const [, , relaunch] = yield* deviceAgentLinesWaiting(raced.userId, raced.deviceId);
          assert.ok(relaunch !== undefined);
          const claimed = yield* claimedDeviceAgentLine(raced.userId, raced.deviceId, relaunch.id);
          // The launch's first lines are sealed with its secrets, which its Mac's claim opens.
          const opened = Option.map(claimed, (line) => ("secrets" in line ? line.secrets : null));
          assert.ok(
            JSON.stringify(Option.getOrNull(opened)).includes("And the tests."),
            "the new launch's first lines carry the message",
          );
        }),
    );
  },
);
